/**
 * 0DTE Command — single source of truth for the live board payload.
 * Member route (/api/market/zerodte/board), Largo (get_zerodte_plays), and BIE
 * composers (composeZeroDtePlays / composeTickerPlayState) all read through here
 * so ledger PnL, intel lines, and Night Hawk dedupe never drift.
 */
import type { ZeroDteSetupLogRow } from "@/lib/db";
import { fetchNighthawkEchoForTickers, type EcosystemNightHawkTake } from "@/lib/bie/ecosystem-context";
import { etNowParts, isTradingDayEt, nextTradingDayEt, todayEt } from "@/features/nighthawk/lib/session";
import { fetchBenzingaNews } from "@/lib/providers/polygon";
import { readGridEarnings } from "@/lib/zerodte/earnings";
import { withServerCache, serverCache, TTL } from "@/lib/server-cache";
import { roundFloats } from "@/lib/round-floats";
import {
  matchEarnings,
  matchHotNews,
  resolveFreshFindStatus,
  sessionHeat,
  type EnrichedZeroDteSetup,
} from "@/lib/zerodte/board";
import { buildIntelNote } from "@/lib/zerodte/intel";
import { allocateBoard, openPositionsFromLedger } from "@/lib/portfolio/board-allocation";
import type { AllocationDecision } from "@/lib/portfolio/allocation";
import { cortexSummaryFor } from "@/lib/zerodte/cortex-gate";
import { tierForSkip } from "@/lib/zerodte/tiers";
import {
  closedStopReason,
  isZeroDteMarkStale,
  pinnedLivePnlPct,
  ZERODTE_MARK_STALE_MS,
  type ZeroDteMarkSource,
} from "@/lib/zerodte/marks-math";
import {
  categorizeExitReason,
  ratchetFloorPct,
  type ZeroDteExitReasonCategory,
} from "@/lib/zerodte/exit-engine";
import { PLAN_RULES } from "@/lib/zerodte/plan";
import {
  loadRecordedGovernorStops,
  summarizeGovernorForBoard,
  type ZeroDteGovernorSummary,
} from "@/lib/zerodte/governor";
import { gradeZeroDteLedger, readZeroDteLedgerChecked, scanZeroDteBoard, syncLedgerLiveState } from "@/lib/zerodte/scan";

export type ZeroDteBoardLedgerRow = {
  ticker: string;
  direction: "long" | "short";
  score_max: number;
  spike: boolean;
  first_flagged_at: string;
  underlying_at_flag: number | null;
  top_strike: number | null;
  /** Contract expiry (YYYY-MM-DD) — additive (PR-D): the pane's play-card header
   *  renders it; null on rows the scanner logged without one. */
  expiry: string | null;
  conviction: string | null;
  entry_premium: number | null;
  flow_avg_fill: number | null;
  status: string | null;
  last_mark: number | null;
  /** Latched premium extremes since entry — the PnL panel's peak/trough excursion (the server tracks
   *  these via advancePlayLatch; without them on the payload the terminal's Peak/Trough render "—"). */
  peak_premium: number | null;
  trough_premium: number | null;
  live_pnl_pct: number | null;
  /** Why a CLOSED play closed — now DISTINGUISHES the exit type (pre-this-change a
   *  ratchet exit and a target trim were both null, indistinguishable). "stopped" still
   *  pins live_pnl_pct to the −50% stop (B-9 D-1 fix — the number the post-session grader
   *  will stamp) and drives the "stopped −50%" badge; "ratchet"/"thesis"/"flat"/"target"
   *  categorize an engine exit from the pinned entry_context.exit; "time_stop" is a plain
   *  15:30 close with no engine exit; null = a live (still-open) row. Additive: only
   *  "stopped" pins P&L — every other value is a display label. */
  closed_reason: "stopped" | ZeroDteExitReasonCategory | "time_stop" | null;
  /** The active PROTECTIVE ratchet floor in P&L % terms (ratchet mode — the shipped
   *  default), derived purely from the latched peak + trim state: "your stop is now at
   *  breakeven/+20%/+50%". This is the guidance the exit engine computes but that never
   *  reached the member before. Null = no floor armed (peak below +25%) or a trim_scale
   *  runner (which rides the plan stop, not a ratchet floor). Pure, no IO. */
  floor_pnl_pct: number | null;
  /** Coarse category of the engine's EXIT decision, read from the pinned
   *  entry_context.exit.reason (ratchet/thesis/flat/target/stop). Present exactly when the
   *  engine stamped an exit; null on a plain time-stop close or a live row. Lets the pane
   *  say WHY the engine got out without re-deriving it from the raw snake_case reason. */
  exit_reason: ZeroDteExitReasonCategory | null;
  /** The engine's one-sentence exit rationale (entry_context.exit.detail) — the argued
   *  "Mark X (+Y%) is at/below the +Z% floor …" line. Null when no engine exit is pinned.
   *  This is the member-facing guidance sentence, surfaced verbatim (already rounded at the
   *  data layer by buildExitContext). */
  exit_detail: string | null;
  /** ISO instant of the quote behind last_mark, when the live-marks lane served
   *  it (B-9). Null = legacy sync lane (no per-quote timestamp available). */
  mark_as_of: string | null;
  /** Mark provenance from the live lane: "mid" = two-sided quote, "last" =
   *  last-trade fallback (flagged), null = legacy sync lane. */
  mark_source: ZeroDteMarkSource | null;
  /** True when the displayed mark came from the legacy SYNC lane (board `last_mark`,
   *  which carries NO per-quote timestamp — mark_as_of is null) yet a mark exists.
   *  SEV-4: lets the deck badge a non-live "sync" mark as unknown-age, so a member can't
   *  mistake an unknown-age board mark for a 1s-fresh live one. False when the live lane
   *  served this row (fresh + timestamped) or when there is no mark at all (nothing to
   *  badge). Derived, additive — no payload restructure. */
  mark_is_sync: boolean;
  move_pct: number | null;
  direction_hit: boolean | null;
  plan_outcome: string | null;
  plan_pnl_pct: number | null;
  graded: boolean;
  nighthawk_echo: EcosystemNightHawkTake | null;
  /** Commit-time Cortex evidence pinned on the row (entry_context.cortex, #318) —
   *  additive (PR-D): the pane's play card renders the evidence table from this
   *  all day, not just during the ≤2-min window the fresh find still carries its
   *  live assessment. Null on pre-wire-in rows / refresh-lane commits — the pane
   *  shows an honest "gates-only" line, never a fabricated table. Served as an
   *  opaque blob; the client validates the shape structurally (zerodte/pane.ts). */
  cortex: Record<string, unknown> | null;
  /** Commit-time merit tier pinned on the row (entry_context.tier, PR-F) — the
   *  {tier, factors[]} assignment stamped by the SAME scan pass that committed the
   *  play. Same passthrough contract as `cortex` above: served opaque, validated
   *  structurally client-side (readTierAssignment, zerodte/pane.ts); null on rows
   *  committed before the tier wiring shipped — the pane simply shows no chip,
   *  never a re-derived or fabricated grade. */
  tier: Record<string, unknown> | null;
};

export type ZeroDteBoardPayload = {
  available: true;
  as_of: string;
  upstream_ok: boolean;
  session: {
    date: string;
    trading_day: boolean;
    heat: ReturnType<typeof sessionHeat>;
  };
  setups: EnrichedZeroDteSetup[];
  ledger: ZeroDteBoardLedgerRow[];
  covered_elsewhere: string[];
  /** G-5 session risk state for the pane's governor strip — additive (PR-D). Null
   *  when the state couldn't be read this build (rendered as "unavailable", never
   *  guessed; the gate stack itself independently fails closed on the same read). */
  governor: ZeroDteGovernorSummary | null;
  /** Portfolio Allocation Engine (advisory): cross-sectional rank + duplicate-thesis + opportunity-cost
   *  decision per setup, computed over the day's setups vs the open book. ADVISORY — rides alongside the
   *  board, does not gate the engine or resize a real position (graduates on the portfolio backtest). One
   *  entry per display setup, keyed by ticker; empty when the committed set is unknowable this build. */
  allocation: AllocationDecision[];
};

const BOARD_TTL_MS = 5_000;

/** A live-lane mark overlay for one ledger row (see attachLiveMarkMeta below). */
type LiveMarkMeta = { mark: number; mark_as_of: string; mark_source: ZeroDteMarkSource };

/** Read the exit-engine record pinned on a row (entry_context.exit — stamped by
 *  exit-sync's buildExitContext on an engine EXIT). Structural + fail-soft: any missing
 *  or malformed shape yields nulls, so the board surfaces the real reason/sentence or
 *  nothing — never a fabricated one. */
function readPinnedExit(entryContext: Record<string, unknown> | null | undefined): {
  reason: string | null;
  detail: string | null;
} {
  const exit =
    entryContext && typeof entryContext.exit === "object"
      ? (entryContext.exit as Record<string, unknown> | null)
      : null;
  if (!exit) return { reason: null, detail: null };
  return {
    reason: typeof exit.reason === "string" ? exit.reason : null,
    detail: typeof exit.detail === "string" ? exit.detail : null,
  };
}

function mapLedgerRow(
  r: ZeroDteSetupLogRow,
  nighthawkEcho: Awaited<ReturnType<typeof fetchNighthawkEchoForTickers>>,
  liveMark: LiveMarkMeta | null
): ZeroDteBoardLedgerRow {
  // B-9: the board's mark prefers the 1s live-marks lane when it has a FRESH quote
  // for this contract — the same store the SSE push and the poller's ledger sync
  // read — so every consumer of this payload shows the same number. The legacy
  // sync value (r.last_mark) remains the fallback and carries no per-quote
  // timestamp, which is surfaced honestly as mark_as_of: null.
  const lastMark = liveMark?.mark ?? r.last_mark;
  // D-1 fix: a stopped play's displayed P&L is the stop P&L (what the grader will
  // stamp), never the frozen last_mark of whichever tick happened to cross it. This
  // "stopped" verdict is ALSO the only closed_reason that pins P&L (below) — every other
  // value is a display label.
  const closedReason = closedStopReason({
    status: r.status,
    entry_premium: r.entry_premium,
    peak_premium: r.peak_premium,
    trough_premium: r.trough_premium,
  });

  // ── Exit-engine visibility (additive, no computation change) ──────────────────────
  // The rich exit decision the engine already computes (floor / reason / detail) was
  // invisible to the member — nothing carried it onto the board. Surface it here from
  // data ALREADY on the row: the pinned entry_context.exit blob (stamped on an engine
  // EXIT) + the latched peak (for the live ratchet floor). All pure — no new IO.
  const pinnedExit = readPinnedExit(r.entry_context);
  const engineExitCategory = categorizeExitReason(pinnedExit.reason);
  // Live ratchet floor (the shipped default mode): "your stop is now at breakeven/+20/
  // +50". Derived purely from the latched peak vs the pinned entry; TRIM status is the
  // ratchet's `trimmed` latch (a trimmed runner's floor is +50%). Null when the peak
  // never armed a floor. buildZeroDteBoardPayload's roundFloats() rounds this like every
  // other premium % on the payload.
  const floorPnlPct = ratchetFloorPct(
    pinnedLivePnlPct(r.entry_premium, r.peak_premium),
    r.status === "TRIM"
  );
  // The terminal close label, now distinguishing the exit type: a pinned stop pins (and
  // wins); else an engine exit is categorized; else a plain 15:30 close is "time_stop";
  // else the row is still live (null).
  const boardClosedReason: ZeroDteBoardLedgerRow["closed_reason"] =
    closedReason === "stopped"
      ? "stopped"
      : r.status === "CLOSED"
        ? (engineExitCategory ?? "time_stop")
        : null;

  return {
    ticker: r.ticker,
    direction: r.direction,
    score_max: r.score_max,
    spike: r.spike,
    first_flagged_at: r.first_flagged_at,
    underlying_at_flag: r.underlying_at_flag,
    top_strike: r.top_strike,
    expiry: r.expiry,
    conviction: r.conviction,
    entry_premium: r.entry_premium,
    flow_avg_fill: r.flow_avg_fill,
    status: r.status,
    last_mark: lastMark,
    peak_premium: r.peak_premium,
    trough_premium: r.trough_premium,
    live_pnl_pct:
      closedReason === "stopped" ? PLAN_RULES.stop_pct : pinnedLivePnlPct(r.entry_premium, lastMark),
    closed_reason: boardClosedReason,
    floor_pnl_pct: floorPnlPct,
    exit_reason: engineExitCategory,
    exit_detail: pinnedExit.detail,
    mark_as_of: liveMark?.mark_as_of ?? null,
    mark_source: liveMark?.mark_source ?? null,
    // SEV-4: flag a mark served by the SYNC lane (no per-quote timestamp) so the deck can
    // badge it as unknown-age. liveMark == null ⟺ mark_as_of == null above; require a mark
    // to exist (lastMark != null) — an absent mark has nothing to badge.
    mark_is_sync: liveMark == null && lastMark != null,
    move_pct: r.move_pct,
    direction_hit: r.direction_hit,
    plan_outcome: r.plan_outcome,
    plan_pnl_pct: r.plan_pnl_pct,
    graded: r.graded_at != null,
    nighthawk_echo: nighthawkEcho.get(r.ticker.toUpperCase()) ?? null,
    cortex:
      r.entry_context && typeof r.entry_context.cortex === "object"
        ? ((r.entry_context.cortex as Record<string, unknown> | null) ?? null)
        : null,
    tier:
      r.entry_context && typeof r.entry_context.tier === "object"
        ? ((r.entry_context.tier as Record<string, unknown> | null) ?? null)
        : null,
  };
}

/**
 * Read the live-marks store (B-9 lane) for each non-CLOSED ledger row's contract.
 * Lazy-imported so this module's import graph (and its tests) stay free of the
 * lane's db/providers/ws dependencies; any failure degrades to the legacy sync
 * marks (empty map). Only FRESH quotes (≤ZERODTE_MARK_STALE_MS) overlay — a stale
 * store must never beat the sync's just-fetched snapshot.
 */
async function attachLiveMarkMeta(rows: ZeroDteSetupLogRow[]): Promise<Map<string, LiveMarkMeta>> {
  const out = new Map<string, LiveMarkMeta>();
  try {
    // RELATIVE specifier, not the "@/" alias: the tsx ESM loader (CI test runs) cannot
    // resolve tsconfig path aliases in dynamic import() — the alias form threw
    // ERR_MODULE_NOT_FOUND into this function's fail-soft catch, silently serving NO
    // live marks in tests while Next's bundler (prod) resolved it fine. Relative works
    // under both, and keeps the test's seeded store the SAME module instance.
    const { getZeroDteLiveMark, ensureZeroDteMarkPoller } = await import("../zerodte/live-marks");
    // Any board consumer keeps the 1s lane alive (idempotent; self-idles off-RTH),
    // so Largo/BIE reads through this payload stay fresh even with no SSE viewer.
    ensureZeroDteMarkPoller();
    const now = Date.now();
    for (const r of rows) {
      if (r.status === "CLOSED") continue;
      const occ = typeof r.plan_json?.occ === "string" ? (r.plan_json.occ as string) : null;
      if (!occ) continue;
      const m = getZeroDteLiveMark(occ);
      if (!m || m.mark == null || isZeroDteMarkStale(m.asOf, now, ZERODTE_MARK_STALE_MS)) continue;
      out.set(r.ticker.toUpperCase(), {
        mark: m.mark,
        mark_as_of: new Date(m.asOf).toISOString(),
        mark_source: m.source,
      });
    }
  } catch {
    // Live lane unavailable (e.g. edge/test env) — legacy sync marks stand.
  }
  return out;
}

/** Uncached board assembly — the exact pipeline the member route used before extraction. */
export async function buildZeroDteBoardPayload(): Promise<ZeroDteBoardPayload> {
  const today = todayEt();
  const tradingDay = isTradingDayEt(today);
  const { hour, minute } = etNowParts();
  const heat = sessionHeat(hour * 60 + minute, tradingDay);

  const [news, earningsSnap, ledgerRead] = await Promise.all([
    serverCache("news:benzinga:15", TTL.NEWS, () => fetchBenzingaNews(15)).catch(() => []),
    readGridEarnings().catch(() => null),
    readZeroDteLedgerChecked(),
  ]);
  const rawLedger = ledgerRead.rows;

  const ledgerRows = await syncLedgerLiveState(rawLedger).catch(() => rawLedger);
  const [nighthawkEcho, liveMarks, governor] = await Promise.all([
    fetchNighthawkEchoForTickers(ledgerRows.map((r) => r.ticker)),
    attachLiveMarkMeta(ledgerRows),
    // PR-D governor strip: same ledger + recorded-stop snapshot the gate stack's
    // G-5 judges (governor.ts). Best-effort: an unreadable Redis record degrades to
    // ledger-only stops (untimed but still counted); a hard failure serves null,
    // which the pane renders as "unavailable" — never fabricated risk state.
    loadRecordedGovernorStops(today)
      .catch(() => [])
      .then((recorded) => summarizeGovernorForBoard(ledgerRows, recorded))
      .catch((): ZeroDteGovernorSummary | null => null),
  ]);

  const nextDay = nextTradingDayEt(today);
  const earningsFlags = matchEarnings(earningsSnap?.items ?? [], { today, nextDay });
  const newsFlags = matchHotNews(news, Date.now());

  const { setups, nighthawk_covered, upstream_ok } = await scanZeroDteBoard({
    earnings: earningsFlags,
    news: newsFlags,
  });

  void gradeZeroDteLedger().catch(() => {});

  // One-way commit door, presentation half (P0): when the committed set is
  // UNKNOWABLE this build (ledger read failed with no same-session fallback), no
  // fresh find may render — a committed play's ticker usually still ranks in the
  // scan, and serving it as a "fresh find" demotes a member's OPEN position to a
  // watch card. Same fail-closed rule persistZeroDteScan applies to commits
  // ("can't tell fresh from committed → nothing new may print"), applied to
  // display. upstream_ok goes false so the pane's freshness badge says degraded
  // instead of impersonating a live-but-empty board.
  const committedKnown = ledgerRead.committed_known;
  const displaySetups = committedKnown ? setups : [];

  // Portfolio Allocation Engine (advisory): rank today's setups cross-sectionally, collapse duplicate theses,
  // and price opportunity cost against the currently-open book. Additive — attached alongside the setups; it
  // does not gate the engine. Fail-soft: any error yields an empty allocation, never a broken board.
  let allocation: AllocationDecision[] = [];
  try {
    allocation = allocateBoard(displaySetups, openPositionsFromLedger(ledgerRows)).decisions;
  } catch (err) {
    console.warn("[zerodte-service] allocation failed (advisory, empty):", err);
  }

  const payload = roundFloats({
    available: true,
    as_of: new Date().toISOString(),
    upstream_ok: upstream_ok && committedKnown,
    session: { date: today, trading_day: tradingDay, heat },
    setups: displaySetups,
    ledger: ledgerRows.map((r) => mapLedgerRow(r, nighthawkEcho, liveMarks.get(r.ticker.toUpperCase()) ?? null)),
    covered_elsewhere: nighthawk_covered,
    governor,
    allocation,
  }) as ZeroDteBoardPayload;

  // roundFloats() rounds entry_premium/last_mark independently; recompute PnL from the
  // member-visible rounded premiums so live_pnl_pct always matches (mark-entry)/entry —
  // except a stopped play, whose result is PINNED to the stop P&L (D-1 fix; matches
  // what gradePlanFromBars will stamp after the session).
  return {
    ...payload,
    ledger: payload.ledger.map((row) => ({
      ...row,
      live_pnl_pct:
        row.closed_reason === "stopped"
          ? PLAN_RULES.stop_pct
          : pinnedLivePnlPct(row.entry_premium, row.last_mark),
    })),
  };
}

/** Cached board read — shared by the member route and Largo/BIE consumers. */
export async function getZeroDteBoardPayload(): Promise<ZeroDteBoardPayload> {
  return withServerCache("zerodte:board:v1", BOARD_TTL_MS, buildZeroDteBoardPayload);
}

/** Largo / BIE tool shape — derived from the same board payload the UI polls. */
export async function zeroDtePlaysForLargo(): Promise<Record<string, unknown>> {
  const board = await getZeroDteBoardPayload();
  const { hour, minute } = etNowParts();
  const nowEtMinutes = hour * 60 + minute;
  const byTicker = new Map(board.setups.map((s) => [s.ticker, s]));

  const plays = board.ledger.map((r) => {
    const setup = byTicker.get(r.ticker) ?? null;
    const status = (["OPEN", "HOLD", "TRIM", "CLOSED"].includes(r.status ?? "") ? r.status : "HOLD") as
      | "OPEN"
      | "HOLD"
      | "TRIM"
      | "CLOSED";
    const intel = buildIntelNote({
      status,
      setup,
      plan: setup?.plan ?? null,
      entryPremium: r.entry_premium,
      livePnlPct: r.live_pnl_pct,
      planOutcome: r.plan_outcome,
      planPnlPct: r.plan_pnl_pct,
      nowEtMinutes,
      lastMark: r.last_mark,
    });
    return {
      ticker: r.ticker,
      direction: r.direction,
      strike: r.top_strike,
      status,
      entry_premium: r.entry_premium,
      last_mark: r.last_mark,
      live_pnl_pct: r.live_pnl_pct,
      peak_score: r.score_max,
      action: intel.action,
      intel: intel.reason,
      // Commit-time merit tier (PR-F) — the pinned {tier, factors} blob riding the
      // board row (entry_context passthrough, already read: zero extra IO). Null on
      // pre-wiring rows; Largo cites the letter, never invents one.
      tier: r.tier,
      graded: r.plan_outcome ? { outcome: r.plan_outcome, pnl_pct: r.plan_pnl_pct } : null,
    };
  });

  // Same time-of-day gate ZeroDteBoard.tsx's mergePlays() applies to fresh (not-
  // yet-ledgered) finds — without it, a find surfacing during POWER_HOUR/LATE_SESSION
  // (or after CLOSED, before the ledger sync catches up) got told to Largo as an
  // actionable play even though the product rule (this function's own `rules` string
  // below) is "no new plays after 15:00 ET" and the board itself would show it as
  // SKIP/watch-only. A COMMITTED ticker never re-enters this lane (one-way commit
  // door): the ledger row above is the only presentation of that ticker, and the
  // dedupe is case-insensitive so a casing drift can never double-present a play.
  const heatState = board.session.heat.state;
  const sessionClosed = heatState === "CLOSED";
  const committedTickers = new Set(board.ledger.map((row) => row.ticker.toUpperCase()));
  const fresh = sessionClosed
    ? []
    : board.setups
        .filter((s) => !committedTickers.has(s.ticker.toUpperCase()))
        .slice(0, 5)
        .map((s) => {
          const moved = s.plan?.entry_status === "MOVED";
          // Hard-gate-blocked finds are SKIP regardless of clock/liquidity — the gate
          // stack (src/lib/zerodte/gates.ts) already decided this is not committable.
          // Everything else is at most WATCH (never "OPEN" — resolveFreshFindStatus,
          // board.ts): an uncommitted find is a candidate, not a position.
          const status =
            s.gate?.verdict === "BLOCKED"
              ? ("SKIP" as const)
              : resolveFreshFindStatus(heatState, moved, Boolean(s.plan?.illiquid));
          return {
            ticker: s.ticker,
            // Presentation status for the fresh lane — WATCH (candidate) or SKIP
            // (refused). Explicit so Largo never has to infer commitment from the
            // absence of ledger fields.
            status,
            direction: s.direction,
            strike: s.top_strike,
            score: s.score,
            gross_premium: s.gross_premium,
            aggression: s.aggression,
            plan: s.plan,
            // Machine code + human sentence per failing gate (null = clear/ungated) —
            // the same copy the board's SKIP cards render.
            gate_blocks: s.gate?.verdict === "BLOCKED" ? s.gate.blocks : null,
            // Merit tier (PR-F): a refused find IS a decision, so a SKIP carries the
            // F assignment with each failing gate as a "down" factor (gate blocks
            // when hard-gated; tierForSkip's generic factor for chase/liquidity/late
            // refusals). A WATCH candidate is NOT a decision yet — no tier, ever:
            // inventing a provisional grade for an uncommitted find would be exactly
            // the asserted-not-earned labeling the tier engine exists to kill.
            tier: status === "SKIP" ? tierForSkip(s.gate?.verdict === "BLOCKED" ? s.gate.blocks : null) : null,
            // Night Hawk Cortex verdict summary (design §2 "the full evidence table
            // on every card — including SKIPs"): committed finds carry score/
            // conviction + top supports; Cortex-blocked SKIPs carry the veto /
            // net-negative evidence. Null = Cortex never ran (gate-blocked first).
            cortex: cortexSummaryFor(s.cortex),
            intel: buildIntelNote({
              status,
              setup: s,
              plan: s.plan,
              entryPremium: s.plan?.entry_max ?? s.top_strike_avg_fill,
              livePnlPct: null,
              planOutcome: null,
              planPnlPct: null,
              nowEtMinutes,
              lastMark: s.plan?.mark ?? null,
            }).reason,
          };
        });

  return {
    source: "0DTE Command (always-on scanner, /grid)",
    session_date: board.session.date,
    plays,
    fresh_finds: fresh,
    excluded_covered_elsewhere: board.covered_elsewhere,
    rules: "0DTE discipline: no new plays after 15:00 ET; stop -50%, trim +100%, hard exit 15:30 ET.",
  };
}
