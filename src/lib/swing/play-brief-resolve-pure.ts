import type { HorizonPlay } from "@/lib/horizon-plays";

const WORKING = new Set(["OPEN", "HOLD", "TRIM"]);

function fin(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** Resolve IV rank for the play brief — fresh dossier read wins over commit-pinned feature_vector. */
export function resolveBriefIvRank(input: {
  dossierIvRank?: number | null;
  featureVector?: Record<string, unknown> | null;
}): number | null {
  const fresh = fin(input.dossierIvRank);
  if (fresh != null) return fresh;
  const pinned = fin(input.featureVector?.iv_rank);
  return pinned;
}

export type ParsedSwingPlayId = {
  ticker: string;
  positionId: number | null;
};

export function parseSwingPlayId(playId: string): ParsedSwingPlayId {
  const parts = playId.split(":").filter(Boolean);
  const ticker = (parts[1] ?? parts[0] ?? "").toUpperCase();
  const pos = parts[2] != null ? Number(parts[2]) : null;
  return { ticker, positionId: pos != null && Number.isFinite(pos) ? pos : null };
}

// BUG FIX (2026-09-22, Ask Largo standing mandate — Largo C3 absence, same shape as #5401's
// roll-history fix). `contract_type` is a genuinely nullable DB column (TEXT, no NOT NULL); the
// naive `contract_type === "put" ? "P" : "C"` ternary used across this file's siblings
// (closed-plays.ts, live-plays.ts) fabricates "C" for a row whose real type was never recorded.
// Pulled out here (this module deliberately carries no heavy imports — see the file's own
// pattern with play-brief-roll-history.ts) so play-brief-resolve.ts's identity-matching logic can
// be unit-tested directly without dragging in the server-only-guarded DB/Vector import chain.
export function rightFromContractType(contract_type: string | null | undefined): "C" | "P" | null {
  if (contract_type === "put") return "P";
  if (contract_type === "call") return "C";
  return null;
}

// BUG FIX (2026-10-09, Ask Largo standing mandate — live CTVA repro, positionId 1483): the
// SG-repro fix (play-brief.ts's `pnlForDisplay`, 2026-10-09) made the "Position" section's own
// `P&L:` line redisplay from the SAME rounded-to-cent mark the `Mark:` line shows, so those two
// numbers always hand-check. But `play.pnlPct` itself — the raw, full-precision `mark/entry-1`
// value every OTHER section reads (play-brief-narrative.ts's "Round-tripped past breakeven"/"Gave
// back X% of peak"/"rail already cleared (now X%)" lines, mirrored in
// play-brief-narrative-coaching.ts and play-brief-intel.ts) — was left untouched, so the SAME
// reconciliation gap the SG fix closed in ONE section reopens in every OTHER section of the exact
// same brief. Live CTVA repro (GET /api/market/swing/play-brief?playId=SWING:CTVA&positionId=1483,
// 2026-10-09 ~05:56 UTC): entry $0.23, raw mid $0.175 (displayed "Mark: $0.18"), raw
// `livePnlPct` -23.9 (horizons board: GET /api/market/nighthawk/horizons?view=swings). "Position"
// correctly showed "P&L: **-21.7%**" (0.18/0.23-1 — reconciled), but "Trade manager read" in the
// SAME response showed "**Round-tripped past breakeven** — was up 96% at peak, now **-24%**" —
// -23.9 raw, NOT reconciled. A member reading one brief sees two different "current P&L" numbers
// for the identical position at the identical instant, a 2.2pp gap from the exact same root cause
// (rounding a sub-$1 mark to the cent) the SG fix was written to close.
//
// Fix: reconcile ONCE, upstream of every section, at the single choke point every live brief
// passes through (`loadSwingPlayBriefContext` in play-brief-context.ts) — not duplicated into
// each of the ~6 call sites that read `play.pnlPct` directly. `positionSection`'s own local
// `markRoundTripsPnl`/`pnlForDisplay` logic (play-brief.ts) is left untouched: it is idempotent
// against an already-reconciled `pnlPct` (its own raw-mark-vs-pnlPct guard just falls through to
// the "leave as-is" branch, which is now already the reconciled value) and its existing unit tests
// call `composeSwingPlayBrief` directly with hand-built fixtures that never go through
// `loadSwingPlayBriefContext`, so they are unaffected by this change.
//
// Same guard shape as `markRoundTripsPnl`: only reconcile when `pnlPct` really is a plain
// `mark/entry-1` read (recomputing from the RAW mark lands within ordinary 1dp rounding noise of
// the stored value) — a genuinely different basis (e.g. the WS-10 executable-lane `exec.pnl_pct`
// fallback) must not be silently replaced.
export function reconcileLivePnlPctWithDisplayMark(input: {
  entry: number | null | undefined;
  mark: number | null | undefined;
  pnlPct: number | null | undefined;
}): number | null {
  const entry = fin(input.entry);
  const mark = fin(input.mark);
  const pnlPct = fin(input.pnlPct);
  if (entry == null || entry === 0 || mark == null || pnlPct == null) return pnlPct;
  const rawRecompute = (mark / entry - 1) * 100;
  if (Math.abs(rawRecompute - pnlPct) > 0.5) return pnlPct;
  const roundedMark = Math.round(mark * 100) / 100;
  return (roundedMark / entry - 1) * 100;
}

function contractMatches(play: HorizonPlay, strike: number | null, right: "C" | "P" | null): boolean {
  if (strike == null) return true;
  if (play.contract.strike !== strike) return false;
  if (right == null) return true;
  return play.contract.right === right;
}

/** Pick the best lane row when multiple plays share a ticker. */
export function pickLanePlayForBrief(
  rows: HorizonPlay[],
  ticker: string,
  hints: { status?: string | null; strike?: number | null; right?: "C" | "P" | null; positionId?: number | null },
): HorizonPlay | null {
  const upper = ticker.toUpperCase();
  const forTicker = rows.filter((p) => p.ticker.toUpperCase() === upper);
  if (!forTicker.length) return null;
  if (forTicker.length === 1) return forTicker[0]!;

  // BANGER-ORIGIN IDENTITY FIX (Ask Largo standing mandate, 2026-09-21). A banger-origin swing play's
  // `positionId` is `banger_positions.id` (banger-lane-merge.ts's own doc comment: "a completely
  // separate id space from swing_positions.id"), so `loadOpenTerminalPlay`/`loadClosedPlay` in
  // play-brief-resolve.ts — which only ever query the `swing_positions` table — can NEVER find a row
  // for it, no matter which positionId the caller asked about. Before this fix, that meant the
  // positionId hint was silently dropped once resolution fell through to THIS function, and with no
  // strike/right hint either, a ticker carrying two live banger-origin positions (e.g. ABTC's 9.5C
  // TRIM +200% and 10.5C OPEN +25%, live 2026-09-21) always resolved to whichever leg had the higher
  // live P&L — REGARDLESS of which positionId was requested. Live-repro'd: `?playId=SWING:ABTC:1220`
  // and `?playId=SWING:ABTC:1185` (and the equivalent `&positionId=` query-param forms) all returned
  // the IDENTICAL 9.5C brief, while `&strike=10.5&right=C` correctly resolved the other leg — proving
  // the strike-hint path already worked and only the positionId path was blind. Since every
  // HorizonPlay this function sees DOES carry its own correct `positionId` (banger's `row.id`, or a
  // real `swing_positions.id` for a non-banger-origin lane row), the fix is a direct, exact match on
  // it here — first, before any of the heuristic fallbacks below, so an unambiguous positionId never
  // gets second-guessed by a P&L/score tiebreak it doesn't need.
  if (hints.positionId != null) {
    const exact = forTicker.find((p) => p.positionId === hints.positionId);
    if (exact) return exact;
  }

  const right = hints.right ?? null;
  const strike = hints.strike ?? null;

  if (strike != null || right != null) {
    const byContract = forTicker.filter((p) => contractMatches(p, strike, right));
    if (byContract.length === 1) return byContract[0]!;
    if (byContract.length > 1) {
      const live = byContract.find((p) => p.liveStatus);
      return live ?? byContract.sort((a, b) => b.score - a.score)[0]!;
    }
  }

  const status = String(hints.status ?? "").toUpperCase();

  // No status hint: prefer the single live ledger row over a same-ticker WATCH lane row
  // (NRG OPEN 110C vs WATCH 115C — ticker-only playId collision).
  if (!status) {
    const liveOnly = forTicker.filter((p) => p.liveStatus);
    if (liveOnly.length === 1) return liveOnly[0]!;
    if (liveOnly.length > 1) {
      if (strike != null || right != null) {
        const byContract = liveOnly.filter((p) => contractMatches(p, strike, right));
        if (byContract.length === 1) return byContract[0]!;
        if (byContract.length > 1) {
          return byContract.sort((a, b) => (b.livePnlPct ?? 0) - (a.livePnlPct ?? 0))[0]!;
        }
      }
      return liveOnly.sort((a, b) => (b.livePnlPct ?? 0) - (a.livePnlPct ?? 0))[0]!;
    }
  }

  if (WORKING.has(status)) {
    const live = forTicker.filter((p) => p.liveStatus);
    if (live.length === 1) return live[0]!;
    if (live.length > 1 && strike != null) {
      const m = live.find((p) => contractMatches(p, strike, right));
      if (m) return m;
    }
    if (live.length) return live.sort((a, b) => (b.livePnlPct ?? 0) - (a.livePnlPct ?? 0))[0]!;
  }

  if (status === "WATCH" || status === "SKIP") {
    const watch = forTicker.filter((p) => !p.liveStatus);
    if (watch.length === 1) return watch[0]!;
    if (watch.length) return watch.sort((a, b) => b.score - a.score)[0]!;
  }

  const live = forTicker.filter((p) => p.liveStatus);
  if (live.length) return live[0]!;
  return forTicker.sort((a, b) => b.score - a.score)[0]!;
}
