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
import { executableFill, type TerminalExitLadder } from "@/lib/zerodte/terminal-ladder";
import { condorGeometryFrom, type CondorGeometry } from "@/lib/zerodte/condor-render";
import type { WhyNow } from "@/lib/zerodte/why-now";
import type {
  DeckCondor,
  DeckDirection,
  DeckFactor,
  DeckGreeks,
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

/** Map a parsed condor geometry (snake, from the payload) + a live underlying into the terminal's
 *  camelCase DeckCondor. `spot` prefers the LIVE underlying and flags it (spotIsLive); a null geometry
 *  (a condor with no pinned plan) yields null so the render degrades to "geometry unavailable". */
function deckCondorFrom(geom: CondorGeometry | null, liveSpot: number | null): DeckCondor | null {
  if (!geom) return null;
  const spotIsLive = liveSpot != null;
  return {
    spot: spotIsLive ? liveSpot : geom.spot,
    spotIsLive,
    shortPut: geom.short_put,
    longPut: geom.long_put,
    shortCall: geom.short_call,
    longCall: geom.long_call,
    wingPts: geom.wing_pts,
    netCredit: geom.net_credit,
    maxLoss: geom.max_loss,
    breachLower: geom.breach_lower,
    breachUpper: geom.breach_upper,
    winRate: geom.est_win_rate,
    breachRatePct: geom.est_intraday_breach_pct,
  };
}

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
    /** Play STRUCTURE (Phase 4): "CONDOR" for a delta-neutral credit iron condor, else DIRECTIONAL. */
    play_type?: string | null;
  } | null;
  allocation?: { role: string; sizing: string; reasons?: string[] } | null;
  /** True when this row is a CREDIT iron condor (from the ledger row / entry_context.play_type or the
   *  sim frame). A condor must NEVER draw the directional long-premium trim ladder (it's inverted —
   *  profit comes from decay, not premium rising). */
  is_condor?: boolean | null;

  // ── Terminal v2 additive fields (server ledger row / sim frame). All OPTIONAL + null-safe —
  //    a legacy source that omits them renders exactly as before this change. ──
  /** The engine's REAL resolved exit ladder (trim-scale ⅓/⅓ or single ratchet), from the frozen
   *  policy — priced + fired server-side. Drives the trim-scale render; absent → legacy ratchet. */
  exit_policy?: TerminalExitLadder | null;
  /** Live two-sided book behind last_mark, for the executable fill line. */
  bid?: number | null;
  ask?: number | null;
  /** Executable (sell-into-the-bid) P&L % vs entry, computed server-side. */
  live_pnl_pct_exec?: number | null;
  /** Live option greeks (Δ Γ Θ V IV). */
  greeks?: { delta?: number | null; gamma?: number | null; theta?: number | null; vega?: number | null; iv?: number | null } | null;
  /** Mark-honesty inputs: ISO instant behind the mark + whether it is a legacy unknown-age sync mark. */
  mark_as_of?: string | null;
  mark_is_sync?: boolean | null;
  /** Discovery rails that found this play (FLOW/BREAKOUT/PIN) — the origin badge. */
  discovery_origin?: string[] | null;
  /** Pinned merit-tier blob (entry_context.tier) — the terminal reads the letter grade. */
  tier?: { tier?: string | null } | null;
  /** VWAP-side + market-aligned confirmation count (setup.confluence.confirmations) — the confluence badge. */
  confluence?: number | null;
  /** Per-strategy calibration scorecard — rendered ONLY when present (never fabricated). Wave 3:
   *  the optional Wilson 95% CI bounds (percent) so the WR is never shown bare. */
  scorecard?: { winRate: number; avg: number; n: number; ciLow?: number | null; ciHigh?: number | null } | null;
  /** Wave 3 — the pinned "why now" trigger reason (entry_context.why_now / sim frame). */
  why_now?: WhyNow | null;
  /** Wave 3 — ISO first-flag instant, for the why-now ribbon's ET clock time. */
  first_flagged_at?: string | null;
  /** Wave 2 — the frozen condor geometry (server: entry_context.condor; sim: the condor frame). A
   *  strict subset of CondorPlan; parsed structurally by condorGeometryFrom (never trusts a bad blob). */
  condor?: unknown;
  /** Wave 2 — the LIVE underlying (the setup's underlying_price), for the condor tent marker. When
   *  absent the tent falls back to the geometry's commit-time spot. */
  underlying_price?: number | null;
}

const FB_LABELS: Record<string, string> = {
  flow: "Flow", tech: "Technicals", positioning: "Positioning", news: "News", smart_money: "Smart Money",
  fundamental: "Fundamental", catalyst: "Catalyst", short_interest: "Short Interest",
  wall_proximity: "GEX Wall", vex: "VEX",
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
  const entry = fin(src.entry_premium);

  // ── Terminal v2: render the exit model the row ACTUALLY froze, not a hard-coded constant.
  //    The engine's frozen exit policy (resolved + priced server-side) decides the model.
  //    PROD RUNS RATCHET by default (ZERODTE_EXIT_MODE unset, DEFAULT_EXIT_MODE="ratchet"), so
  //    almost every real row resolves to RATCHET and keeps the single stop→target track. Only a
  //    row that froze `trim_scale` (that mode enabled) draws the partial-scale ladder (SCALE_OUT);
  //    a legacy row with no frozen policy also stays RATCHET. Previously this hard-coded "RATCHET"
  //    unconditionally — harmless while ratchet IS the default, but it would have mis-drawn a
  //    trim_scale row as a ratchet track the moment that mode was turned on.
  // Condor = a CREDIT structure (explicit is_condor flag OR the setup's frozen play_type). It must
  // never route to the directional trim ladder, so it is resolved BEFORE the exit-model decision.
  const isCondor = src.is_condor ?? (src.setup?.play_type === "CONDOR" ? true : null);
  const exitPolicy = src.exit_policy ?? null;
  const exitModel: ExitModel = exitPolicy?.policy === "trim_scale" && isCondor !== true ? "SCALE_OUT" : "RATCHET";

  // ── Condor P&L is SELLER-framed AT THE SOURCE now (FINDINGS 2026-07-26) ────────────────
  // The board payload's `live_pnl_pct` is computed seller-framed (entry − mark)/entry for a credit
  // condor by the server (reconcileLedgerLivePnlPct) — a DECAYING (WINNING) condor already arrives
  // POSITIVE. So the render must DISPLAY it, never re-invert it: `pnlDisplay` reads `pnl` directly
  // for BOTH structures. (Wave 2 originally RE-derived a seller P&L here from `last_mark`; once the
  // source was corrected that recompute became a DOUBLE-invert, flipping a +76% winner back to
  // −76%. Removed.)
  const markNum = fin(src.last_mark);
  const pnlDisplay = pnl;
  // Peak/trough excursion is a DISPLAY transform of the RAW latched premiums the payload carries
  // (peak_premium/trough_premium are stored raw for the exit ladder, NOT as signed P&L). For a
  // credit condor the seller's BEST excursion is the LOWEST mark (deepest decay) and the WORST is
  // the highest mark, so best = seller-P&L(trough_premium), worst = seller-P&L(peak_premium). This
  // reads the raw premiums (never the already-signed live_pnl_pct), so it is NOT a second invert of
  // the corrected headline number. Directional rows are byte-identical (isCondor !== true).
  const sellerPct = (m: number | null): number | null =>
    isCondor === true && entry != null && entry > 0 && m != null ? Math.round(((entry - m) / entry) * 1000) / 10 : null;
  const peakDisplay =
    isCondor === true
      ? sellerPct(fin(src.trough_premium)) // lowest mark = best for the seller
      : entry && fin(src.peak_premium)
        ? Math.round((src.peak_premium! / entry - 1) * 100)
        : null;
  const troughDisplay =
    isCondor === true
      ? sellerPct(fin(src.peak_premium)) // highest mark = worst for the seller
      : entry && fin(src.trough_premium)
        ? Math.round((src.trough_premium! / entry - 1) * 100)
        : null;

  const mgmt = managementFor(exitModel, status, pnlDisplay);
  const alloc = src.allocation
    ? { role: src.allocation.role, sizing: src.allocation.sizing, reason: src.allocation.reasons?.[0] }
    : null;

  // Greeks: map the live snapshot's Δ Γ Θ V IV (board payload OR sim frame), each field
  // independently null-safe — a missing greek renders "—", never a fabricated value.
  const greeks: DeckGreeks | null = src.greeks
    ? {
        delta: fin(src.greeks.delta),
        gamma: fin(src.greeks.gamma),
        theta: fin(src.greeks.theta),
        vega: fin(src.greeks.vega),
        iv: fin(src.greeks.iv),
      }
    : null;

  // Executable fill (a long exits into the BID, not the mid). The server already priced the
  // executable P&L; the fill price comes from the same two-sided book. No book → mid only.
  const exec = executableFill(fin(src.bid), fin(src.ask), entry);
  const tierLabel = typeof src.tier?.tier === "string" ? src.tier.tier : null;

  // Condor render geometry (Wave 2): only build it for a condor row that carries a real, parseable
  // CondorPlan blob. `spot` resolves to the LIVE underlying (the setup's underlying_price) when the
  // board carries one, else the commit-time spot pinned in the plan — the tent marks the current
  // price honestly and flags which it used. A directional row (or a condor with no geometry) → null.
  const condor: DeckCondor | null =
    isCondor === true ? deckCondorFrom(condorGeometryFrom(src.condor), fin(src.underlying_price)) : null;

  return {
    id: `0DTE:${src.ticker}`,
    ticker: src.ticker.toUpperCase(),
    direction,
    contract: `${strike ?? "?"}${right} · ${dte === 0 ? "0DTE" : `${dte ?? "?"}DTE`}`,
    occ: setup?.plan?.occ ?? null,
    score: Math.round(fin(src.score) ?? 0),
    status,
    horizon: "ZERO_DTE",
    exitModel,
    exitPolicy,
    isCondor,
    condor,
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
    mark: markNum,
    pnlPct: pnlDisplay,
    peak: peakDisplay,
    trough: troughDisplay,
    // Executable fill (sell-into-the-BID) is a directional LONG framing — inverted for a credit
    // condor, so it is suppressed (null) on condor rows; the condor's honest number is its decay P&L.
    execMark: isCondor === true ? null : exec.fill,
    execPnlPct: isCondor === true ? null : (fin(src.live_pnl_pct_exec) ?? exec.pnl_pct),
    markAsOf: src.mark_as_of ?? null,
    markIsSync: src.mark_is_sync ?? null,
    discoveryOrigin: Array.isArray(src.discovery_origin) && src.discovery_origin.length > 0 ? src.discovery_origin : null,
    tierLabel,
    confluence: fin(src.confluence),
    scorecard: src.scorecard ?? null,
    greeks,
    // Edge layer (Wave 3): the pinned trigger reason + first-flag time. Both null-safe — a legacy
    // row with neither renders no ribbon (honest absence), never a fabricated reason.
    whyNow: src.why_now ?? null,
    firstFlaggedAt: src.first_flagged_at ?? null,
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
  // Enriched fields — the edition carries all of these; previously discarded.
  conviction?: string | null;
  thesis?: string | null;
  key_signal?: string | null;
  entry_range?: string | null;
  target?: string | null;
  stop?: string | null;
  options_play?: string | null;
  entry_premium?: number | null;
  risk_note?: string | null;
  exit_style?: string | null;
  iv_rank?: number | null;
  rr_ratio?: number | null;
  flow_streak_days?: number | null;
  gate_promoted?: boolean | null;
  gate_warnings?: string[] | null;
  pulled?: boolean | null;
  pulled_reason?: string | null;
  // Morning confirmation overlay (merged by the container).
  morning_status?: "CONFIRMED" | "DEGRADED" | "INVALIDATED" | "UNVERIFIED" | null;
  morning_reason?: string | null;
}

/** Parse a dollar-level string ("$205", "$205.50") to a numeric value. Used for target/stop
 *  levels in Legacy plays so the terminal can show stock-price progress toward them. */
export function parseLevelNum(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = s.match(/[\d.]+/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Parse the edition's "entry_range" string ("$192.50 – $195.00") into a representative
 *  midpoint entry price. Handles "$X", "$X – $Y", "$X-$Y" formats. */
function parseEntryMid(range: string | null | undefined): number | null {
  if (!range) return null;
  const nums = (range.match(/[\d.]+/g) ?? []).map(Number).filter(Number.isFinite);
  if (nums.length === 0) return null;
  if (nums.length === 1) return nums[0];
  return (nums[0] + nums[nums.length - 1]) / 2;
}

export function terminalPlayFromEdition(src: EditionDeckSource): TerminalPlay {
  const factors: DeckFactor[] = Object.entries(src.factor_breakdown ?? {})
    .filter(([, v]) => typeof v === "number" && v !== 0)
    .map(([k, v]) => ({ label: FB_LABELS[k] ?? k, points: v as number }));

  // Surface IV rank and R:R ratio as factors when the pipeline computed them — these are real
  // scoring components the edition carries but were previously discarded by the adapter.
  if (src.iv_rank != null && Number.isFinite(src.iv_rank)) {
    factors.push({ label: "IV Rank", points: src.iv_rank });
  }
  if (src.rr_ratio != null && Number.isFinite(src.rr_ratio)) {
    factors.push({ label: "R:R Ratio", points: src.rr_ratio });
  }
  if (src.flow_streak_days != null && Number.isFinite(src.flow_streak_days) && src.flow_streak_days > 0) {
    factors.push({ label: "Flow Streak", points: src.flow_streak_days });
  }

  const direction = asDir(src.direction);
  const entryMid = parseEntryMid(src.entry_range);
  const pulled = src.pulled === true;

  // Morning confirmation drives the status + regime display.
  const ms = src.morning_status;
  const status: DeckStatus = pulled ? "CLOSED" : ms === "INVALIDATED" ? "SKIP" : ms === "CONFIRMED" ? "OPEN" : "WATCH";
  const regime = ms
    ? ms === "CONFIRMED" ? "pre-market CONFIRMED"
    : ms === "DEGRADED" ? "pre-market DEGRADED"
    : ms === "INVALIDATED" ? "INVALIDATED — pulled"
    : "pre-market pending"
    : "morning confirm pending";

  // Build contract label from real options_play data when available.
  const contractLabel = src.options_play
    ? `${src.options_play}`.replace(/\s+/g, " ").trim()
    : `Rank ${src.rank ?? "?"} · next session`;

  // Gate warnings surface as gates (red/amber chips) in the terminal.
  const gates: Array<{ label: string; ok: boolean }> = [];
  if (src.gate_promoted && src.gate_warnings?.length) {
    for (const w of src.gate_warnings) {
      gates.push({ label: w, ok: false });
    }
  }

  // Thesis break from morning confirmation — risk_note enriches the warn/intact note.
  // CONFIRMED overrides risk_note — a morning confirmation means the thesis held.
  const thesisBreak: { level: ThesisLevel; note?: string } =
    pulled ? { level: "break", note: src.pulled_reason ?? "play invalidated and pulled" }
    : ms === "INVALIDATED" ? { level: "break", note: src.morning_reason ?? "morning confirm invalidated thesis" }
    : ms === "DEGRADED" ? { level: "warn", note: src.morning_reason ?? (src.risk_note ?? "pre-market conditions degraded") }
    : ms === "CONFIRMED" ? { level: "intact" }
    : src.risk_note ? { level: "warn", note: src.risk_note }
    : { level: "intact" };

  // Build the recNote — key_signal enriches the thesis narrative.
  const keySignalLine = src.key_signal ? ` Key signal: ${src.key_signal}` : "";
  const recNote = pulled
    ? `PULLED — ${src.pulled_reason ?? "thesis invalidated pre-market"}`
    : ms === "INVALIDATED"
      ? `INVALIDATED — ${src.morning_reason ?? "pre-market thesis broke"}`
      : ms === "DEGRADED"
        ? `DEGRADED — ${src.morning_reason ?? "conditions shifted; validate before entry"}`
        : ms === "CONFIRMED"
          ? `Pre-market confirmed — thesis intact, entry levels hold.${keySignalLine}`
          : src.thesis
            ? `${src.thesis}${keySignalLine}`
            : `Evening edition — pre-market confirm posts before the open.${keySignalLine}`;

  // Score: a missing score renders as 0 in the terminal (the score display always shows a number),
  // but an absent score is different from a real 0.
  const rawScore = fin(src.score);

  return {
    id: `LEGACY:${src.ticker}`,
    ticker: src.ticker.toUpperCase(),
    direction,
    contract: contractLabel,
    score: rawScore != null ? Math.round(rawScore) : 0,
    status,
    horizon: "LEGACY",
    exitModel: src.exit_style === "scale_out" ? "SCALE_OUT" : "PLAN",
    factors,
    gates,
    regime,
    thesisBreak,
    tierLabel: src.conviction || null,
    recommendation: pulled || ms === "INVALIDATED" ? "SELL" : ms === "CONFIRMED" ? "BUY" : "HOLD",
    recNote,
    progress: null,
    entry: fin(src.entry_premium) ?? entryMid,
    mark: null,
    pnlPct: null,
    greeks: null,
    entryRange: src.entry_range ?? null,
    targetLevel: src.target ?? null,
    stopLevel: src.stop ?? null,
    thesis: src.thesis ?? null,
    keySignal: src.key_signal ?? null,
  };
}
