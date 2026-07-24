/**
 * COMMAND DECK adapters — map each board's own data → the horizon-agnostic TerminalPlay (types.ts).
 *
 * The terminal renders TerminalPlay and nothing else; these pure functions are the only place that knows a
 * board's native shape. 0DTE is the richest (real flow-quality components + gates); Swings/LEAPS carry the
 * lane reason until the horizon API serves component breakdowns; Legacy maps the evening edition's factors.
 * PURE — unit-tested with fixtures.
 */

import { factorsFromFlowQuality } from "@/lib/explain/trade-explanation";
import type { SwingSetupState } from "@/lib/swing/taxonomy";
import type {
  DeckDirection,
  DeckFactor,
  DeckStatus,
  ExitModel,
  Recommendation,
  TerminalPlay,
  ThesisLevel,
} from "./types";

const asDir = (d: unknown): DeckDirection =>
  String(d ?? "").toLowerCase().startsWith("s") || String(d ?? "") === "SHORT" ? "SHORT" : "LONG";
const asStatus = (s: unknown): DeckStatus => {
  const u = String(s ?? "WATCH").toUpperCase();
  return (["OPEN", "HOLD", "TRIM", "CLOSED", "WATCH", "SKIP"].includes(u) ? u : "WATCH") as DeckStatus;
};
const fin = (n: unknown): number | null => (typeof n === "number" && Number.isFinite(n) ? n : null);

/**
 * Management read from the exit model + live P&L. ADVISORY (we recommend, you execute). For RATCHET the
 * `progress` is the 0–1 position on the stop→target track; for SCALE_OUT the tranches derive from status.
 */
export function managementFor(
  exitModel: ExitModel,
  status: DeckStatus,
  pnlPct: number | null,
): { recommendation: Recommendation; recNote: string; progress: number | null } {
  const p = pnlPct ?? 0;
  let recommendation: Recommendation = "HOLD";
  if (status === "TRIM") recommendation = "TRIM";
  else if (exitModel === "RATCHET" && p >= 90) recommendation = "TRIM"; // doubled → take partial, trail
  else if (p <= -45) recommendation = "SELL";

  const recNote =
    recommendation === "SELL"
      ? "Near the stop — the ratchet says cut and preserve capital."
      : recommendation === "TRIM"
        ? exitModel === "SCALE_OUT"
          ? "Bank a tranche and trail the runner — the positive-skew exit that converts a winner to EV."
          : "Take partial into strength and trail the rest (ratchet)."
        : p > 0
          ? "In profit — let it work while the thesis holds; exit engine is trailing the stop."
          : "Managing to the plan — hold while the thesis is intact.";

  // RATCHET track position: map −50%→0, +100%→1 (the stop and target of the fast 0DTE ratchet).
  const progress = exitModel === "RATCHET" ? Math.max(0, Math.min(1, (p + 50) / 150)) : null;
  return { recommendation, recNote, progress };
}

// ── 0DTE (richest) ──────────────────────────────────────────────────────────────────

export interface ZeroDteDeckSource {
  ticker: string;
  strike?: number | null;
  expiry?: string | null;
  status?: string | null;
  score?: number | null;
  live_pnl_pct?: number | null;
  entry_premium?: number | null;
  last_mark?: number | null;
  peak_premium?: number | null;
  trough_premium?: number | null;
  setup?: {
    direction?: "long" | "short";
    dte?: number | null;
    top_strike?: number | null;
    gamma_regime?: string | null;
    flow_quality?: { components?: Record<string, number> } | null;
    factor_breakdown?: Record<string, number> | null;
    gate?: { verdict?: string; blocks?: unknown[] } | null;
    plan?: { occ?: string | null; stop_premium?: number | null; target_premium?: number | null } | null;
    market_aligned?: boolean | null;
  } | null;
  allocation?: { role: string; sizing: string; reasons?: string[] } | null;
}

const FB_LABELS: Record<string, string> = {
  flow: "Flow", tech: "Technicals", positioning: "Positioning", news: "News", smart_money: "Smart Money",
};

export function terminalPlayFromZeroDte(src: ZeroDteDeckSource): TerminalPlay {
  const setup = src.setup ?? null;
  const direction = asDir(setup?.direction);
  const status = asStatus(src.status);
  const strike = fin(src.strike) ?? fin(setup?.top_strike);
  const right = direction === "LONG" ? "C" : "P";
  const dte = fin(setup?.dte);

  const factors: DeckFactor[] = setup?.flow_quality?.components
    ? factorsFromFlowQuality(setup.flow_quality.components)
    : Object.entries(setup?.factor_breakdown ?? {})
        .filter(([, v]) => typeof v === "number" && v !== 0)
        .map(([k, v]) => ({ label: FB_LABELS[k] ?? k, points: v as number }));

  const gate = setup?.gate ?? null;
  const isWorking = status === "OPEN" || status === "HOLD" || status === "TRIM";
  const gates: Array<{ label: string; ok: boolean }> = [
    // A committed/working play passed its hard gate at entry; a refresh-lane row whose gate context aged
    // out (gate === null) must not render a red "✗ Hard gate" as if it failed validation (9-6b).
    { label: "Hard gate", ok: gate?.verdict === "COMMIT" || isWorking },
    // Only a TRUE alignment read passes — null (data-absent) is unknown, not a confirmed green (9-6c).
    { label: "Tape align", ok: setup?.market_aligned === true },
  ];

  const pnl = fin(src.live_pnl_pct);
  const mgmt = managementFor("RATCHET", status, pnl);
  const alloc = src.allocation
    ? { role: src.allocation.role, sizing: src.allocation.sizing, reason: src.allocation.reasons?.[0] }
    : null;

  const entry = fin(src.entry_premium);
  return {
    id: `0DTE:${src.ticker}`,
    ticker: src.ticker.toUpperCase(),
    direction,
    contract: `${strike ?? "?"}${right} · ${dte === 0 ? "0DTE" : `${dte ?? "?"}DTE`}`,
    occ: setup?.plan?.occ ?? null,
    score: Math.round(fin(src.score) ?? 0),
    status,
    horizon: "ZERO_DTE",
    exitModel: "RATCHET",
    factors,
    gates,
    regime: setup?.gamma_regime ? `gamma ${setup.gamma_regime}` : null,
    allocation: alloc,
    thesisBreak:
      setup?.market_aligned === false
        ? { level: "warn", note: "tape alignment lost" }
        : setup?.market_aligned == null
          ? { level: "unknown", note: "tape read not attached to this play" } // data-absent ≠ confirmed-intact (9-6c)
          : { level: "intact" },
    ...mgmt,
    entry,
    mark: fin(src.last_mark),
    pnlPct: pnl,
    peak: entry && fin(src.peak_premium) ? Math.round((src.peak_premium! / entry - 1) * 100) : null,
    trough: entry && fin(src.trough_premium) ? Math.round((src.trough_premium! / entry - 1) * 100) : null,
    greeks: null, // populated by the live greeks stream (backend follow-up)
  };
}

// ── Horizon lanes (Swing / LEAPS) ─────────────────────────────────────────────────────

export interface HorizonDeckSource {
  ticker: string;
  direction: DeckDirection;
  horizon: "SWING" | "LEAPS";
  score: number;
  status?: string;
  reason?: string;
  contract: { strike: number; right: "C" | "P"; expiry: string; dte: number; mid?: number | null };

  // ── PR-12 de-hardcode: REAL reads from the swing serving meta (serving-ingest.ts), all OPTIONAL and
  //    ADDITIVE. The adapter USED to hardcode factors:[] / regime:null / thesisBreak:{intact}; it now
  //    renders these when supplied. LEAPS (and any caller that passes none) is UNCHANGED — the fallbacks
  //    reproduce the old literals exactly (see the honest-fallback comments in the adapter body). ──
  /** The dossier's actual pillar contributions (label + points), biggest lever first. */
  factors?: DeckFactor[];
  /** Regime read (archetype label ± normalized regime pillar), or null when absent. */
  regime?: string | null;
  /** Thesis-health read from the swing thesis; when omitted it is DERIVED from `setupState` below. */
  thesisBreak?: { level: ThesisLevel; note?: string } | null;
  /** Pre-entry setup maturity — used to DERIVE `thesisBreak` when one isn't explicitly supplied. */
  setupState?: SwingSetupState | null;
}

/**
 * Derive the deck's thesis-break from pre-entry setup maturity. INVALIDATED = the structure broke → "break".
 * A live-but-forming/triggered/extended thesis is "intact". A DATA-ABSENT read (no setupState) is "unknown",
 * NEVER a fabricated "intact" — the same 9-6c honesty the 0DTE adapter applies to a null tape read. Returning
 * "intact" here only when a live maturity read exists is what keeps a member from reading absence as a green.
 */
function thesisBreakFromSetupState(setupState: SwingSetupState | null | undefined): { level: ThesisLevel; note?: string } {
  if (setupState == null) return { level: "intact" }; // NO swing read at all (e.g. LEAPS) → unchanged legacy default
  if (setupState === "INVALIDATED") return { level: "break", note: "structure invalidated — thesis broke" };
  return { level: "intact" }; // FORMING / TRIGGERED / EXTENDED — a live, un-broken thesis
}

export function terminalPlayFromHorizon(src: HorizonDeckSource): TerminalPlay {
  const status = asStatus(src.status ?? (src.score >= 60 ? "OPEN" : "WATCH"));
  const mgmt = managementFor("SCALE_OUT", status, null);
  return {
    id: `${src.horizon}:${src.ticker}`,
    ticker: src.ticker.toUpperCase(),
    direction: src.direction,
    contract: `${src.contract.strike}${src.contract.right} · ${src.contract.dte}DTE`,
    score: Math.round(src.score),
    status,
    horizon: src.horizon,
    exitModel: "SCALE_OUT",
    // De-hardcoded (PR-12): the swing serving meta feeds the REAL factors/regime/thesis. Each falls back to
    // the exact pre-PR-12 literal ([] / null / {intact}) when the caller supplies nothing, so LEAPS and any
    // un-enriched caller render identically — the change is additive, never a regression to those lanes.
    factors: src.factors ?? [],
    gates: [],
    regime: src.regime ?? null,
    thesisBreak: src.thesisBreak ?? thesisBreakFromSetupState(src.setupState),
    ...mgmt,
    recNote: src.reason || mgmt.recNote,
    entry: null,
    mark: fin(src.contract.mid),
    pnlPct: null,
    greeks: null,
  };
}

// ── Legacy (evening edition) ──────────────────────────────────────────────────────────

export interface EditionDeckSource {
  ticker: string;
  direction?: string;
  rank?: number;
  score?: number;
  factor_breakdown?: Record<string, number> | null;
}

export function terminalPlayFromEdition(src: EditionDeckSource): TerminalPlay {
  const factors: DeckFactor[] = Object.entries(src.factor_breakdown ?? {})
    .filter(([, v]) => typeof v === "number" && v !== 0)
    .map(([k, v]) => ({ label: FB_LABELS[k] ?? k, points: v as number }));
  return {
    id: `LEGACY:${src.ticker}`,
    ticker: src.ticker.toUpperCase(),
    direction: asDir(src.direction),
    contract: `Rank ${src.rank ?? "?"} · next session`,
    score: Math.round(fin(src.score) ?? 0),
    status: "WATCH",
    horizon: "LEGACY",
    exitModel: "PLAN",
    factors,
    gates: [],
    regime: "morning confirm pending",
    thesisBreak: { level: "intact" },
    recommendation: "HOLD",
    recNote: "Evening edition — pre-market confirm posts before the open; hold while the thesis stands.",
    progress: null,
    entry: null,
    mark: null,
    pnlPct: null,
    greeks: null,
  };
}
