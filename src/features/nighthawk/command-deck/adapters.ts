/**
 * COMMAND DECK adapters — map each board's own data → the horizon-agnostic TerminalPlay (types.ts).
 *
 * The terminal renders TerminalPlay and nothing else; these pure functions are the only place that knows a
 * board's native shape. 0DTE is the richest (real flow-quality components + gates); Swings/LEAPS carry the
 * lane reason until the horizon API serves component breakdowns; Legacy maps the evening edition's factors.
 * PURE — unit-tested with fixtures.
 */

import { factorsFromFlowQuality } from "@/lib/explain/trade-explanation";
import type { SwingSetupState, SwingEntryState } from "@/lib/swing/taxonomy";
import type { SwingServingSection } from "@/lib/swing/serving";
import { executableFill, type TerminalExitLadder } from "@/lib/zerodte/terminal-ladder";
import { condorGeometryFrom, type CondorGeometry } from "@/lib/zerodte/condor-render";
import { thesisManagementOverlay } from "@/lib/zerodte/thesis-health";
import type { WhyNow, WhyNowReason } from "@/lib/zerodte/why-now";
import type { NighthawkTierFactor } from "@/features/nighthawk/lib/nighthawk-tiers";
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
import { watchReferencePremium, watchTrackPct, watchUnderlyingTrackPct } from "@/lib/zerodte/watch-track";

const asDir = (d: unknown): DeckDirection =>
  String(d ?? "").toLowerCase().startsWith("s") || String(d ?? "") === "SHORT" ? "SHORT" : "LONG";
const asStatus = (s: unknown): DeckStatus => {
  const u = String(s ?? "WATCH").toUpperCase();
  return (["OPEN", "HOLD", "TRIM", "CLOSED", "WATCH", "SKIP"].includes(u) ? u : "WATCH") as DeckStatus;
};
const fin = (n: unknown): number | null => (typeof n === "number" && Number.isFinite(n) ? n : null);

/** R:R from the plan's target/stop premiums (reward ÷ risk, relative to a hypothetical entry at the mid). */
function rrFromPlan(plan: { stop_premium?: number | null; target_premium?: number | null } | null | undefined): number | null {
  const stop = fin(plan?.stop_premium);
  const target = fin(plan?.target_premium);
  if (stop == null || target == null || stop <= 0 || target <= stop) return null;
  // R:R = (target − stop) / stop, approximating entry ≈ stop (risk = entry − 0 for a long)
  return Math.round(((target - stop) / stop) * 10) / 10;
}

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
  if (status === "WATCH" || status === "SKIP") {
    return {
      recommendation: "HOLD",
      recNote:
        status === "SKIP"
          ? "Gate blocked — not a candidate. No position to manage."
          : "Candidate only — not committed. Track the setup; no position management until entry.",
      progress: null,
    };
  }
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

/** Recompute management advisory from live P&L + thesis health (called every ~1s on SSE mark tick). */
export function refreshZeroDteManagement(play: TerminalPlay): TerminalPlay {
  if (play.horizon !== "ZERO_DTE") return play;
  const mgmtBase = managementFor(play.exitModel, play.status, play.pnlPct ?? null);
  const mgmt =
    play.thesisHealth != null
      ? thesisManagementOverlay(mgmtBase.recommendation, mgmtBase.recNote, play.thesisHealth, play.pnlPct ?? null)
      : mgmtBase;
  return {
    ...play,
    recommendation: mgmt.recommendation,
    recNote: mgmt.recNote,
    progress: mgmtBase.progress,
  };
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
  /** OCC for the live-marks overlay — ledger `occ` / setup.plan.occ / plan_json.occ. */
  occ?: string | null;
  setup?: {
    direction?: "long" | "short";
    dte?: number | null;
    top_strike?: number | null;
    gamma_regime?: string | null;
    flow_quality?: { components?: Record<string, number> } | null;
    factor_breakdown?: Record<string, number> | null;
    gate?: { verdict?: string; blocks?: unknown[] } | null;
    plan?: {
      occ?: string | null;
      mark?: number | null;
      bid?: number | null;
      ask?: number | null;
      stop_premium?: number | null;
      target_premium?: number | null;
      flow_avg_fill?: number | null;
      entry_max?: number | null;
    } | null;
    market_aligned?: boolean | null;
    /** Play STRUCTURE (Phase 4): "CONDOR" for a delta-neutral credit iron condor, else DIRECTIONAL. */
    play_type?: string | null;
    /** First time the scanner surfaced this setup (board aggregation). */
    first_seen?: string | null;
  } | null;
  /**
   * First time the scanner surfaced this row, at the TOP level.
   *
   * The board serves two shapes through this one adapter: a LEDGER row, which nests the live setup
   * under `setup`, and a BARE board setup, which IS the setup with its fields at the top level. Only
   * the nested shape was read, so every bare row lost its detection time and the deck's TIME column
   * rendered "—". Measured live 2026-08-07: 10/10 board setups carried `first_seen` at the top level
   * and 0/10 had a nested `setup` object.
   */
  first_seen?: string | null;
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
  /** Thesis Health payload from the board ledger row (server-computed each board build). */
  thesis_health?: import("@/lib/zerodte/thesis-health").ThesisHealthPayload | null;
  closed_reason?: string | null;
  exit_reason?: string | null;
  exit_detail?: string | null;
  exit_at?: string | null;
  exit_pnl_pct?: number | null;
  timeline_tranches?: import("@/lib/zerodte/play-timeline").PlayTimelineTranche[] | null;
}

const FB_LABELS: Record<string, string> = {
  flow: "Flow", tech: "Technicals", positioning: "Positioning", news: "News", smart_money: "Smart Money",
  fundamental: "Fundamental", catalyst: "Catalyst", short_interest: "Short Interest",
  wall_proximity: "GEX Wall", vex: "VEX", skew: "Skew",
  // BREAKOUT lane components (breakoutScoreBreakdown). Named for what a member would recognise,
  // not for the variable: "breakout_core" is the gain x close-strength product.
  breakout_core: "Move + Close Strength", dollar_volume: "$-Volume", screen_base: "Cleared Screen",
};

/**
 * Detection instant for a deck row, tolerant of BOTH source shapes (nested ledger setup and bare
 * board setup). Null only when neither carries one — an honest "no time", never a fabricated one,
 * since the deck both sorts and ages rows off this value.
 */
export function firstSeenIso(
  src: { first_seen?: string | null } | null | undefined,
  setup: { first_seen?: string | null } | null | undefined
): string | null {
  const nested = setup?.first_seen;
  if (typeof nested === "string" && nested.length > 0) return nested;
  const top = src?.first_seen;
  if (typeof top === "string" && top.length > 0) return top;
  return null;
}

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
  // CLOSED = already committed and finished. The live setup's current gate (often BLOCKED after
  // the session heat flips) must NOT paint a red "✗ Hard gate" on a play that cleared entry —
  // that was the prod 2026-07-28 SPY CLOSED bug (gate re-litigated from today's refresh find).
  const isCommitted = isWorking || status === "CLOSED";
  const gates: Array<{ label: string; ok: boolean }> = [
    // A committed/working/closed play passed its hard gate at entry; a refresh-lane row whose gate
    // context aged out (gate === null) must not render a red "✗ Hard gate" (9-6b).
    { label: "Hard gate", ok: gate?.verdict === "COMMIT" || isCommitted },
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

  const mgmtBase = managementFor(exitModel, status, pnlDisplay);
  const thesisHealth = src.thesis_health ?? null;
  const mgmt =
    thesisHealth != null
      ? thesisManagementOverlay(mgmtBase.recommendation, mgmtBase.recNote, thesisHealth, pnlDisplay)
      : mgmtBase;
  const thesisBreak = thesisHealth
    ? { level: thesisHealth.thesisBreakLevel as ThesisLevel, note: thesisHealth.thesisBreakNote }
    : setup?.market_aligned === false
      ? { level: "warn" as ThesisLevel, note: "tape alignment lost" }
      : setup?.market_aligned == null
        ? { level: "unknown" as ThesisLevel, note: "tape read not attached to this play" }
        : { level: "intact" as ThesisLevel };
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

  // OCC: prefer the explicit source field (ledger payload) so a ledger-only working row still
  // keys the ~1s marks overlay even when setup.plan was never attached.
  const occ = (typeof src.occ === "string" && src.occ.length > 0 ? src.occ : null) ?? setup?.plan?.occ ?? null;

  const watchTrack = status === "WATCH" || status === "SKIP";
  const trackReference = watchTrack ? watchReferencePremium(setup?.plan ?? null) : null;
  const trackPct = watchTrack ? watchTrackPct(trackReference, markNum) : null;

  return {
    id: `0DTE:${src.ticker}`,
    ticker: src.ticker.toUpperCase(),
    direction,
    contract: `${strike ?? "?"}${right} · ${dte === 0 ? "0DTE" : `${dte ?? "?"}DTE`}`,
    occ,
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
    // Directional plays surface the underlying stock price; condors use the tent's spot instead.
    stockPrice: isCondor !== true ? fin(src.underlying_price) : null,
    optionsPlay: occ,
    rrRatio: rrFromPlan(setup?.plan),
    thesisBreak,
    thesisHealth,
    ...mgmt,
    progress: mgmtBase.progress,
    entry,
    mark: markNum,
    pnlPct: status === "WATCH" || status === "SKIP" ? null : pnlDisplay,
    trackPct,
    trackReferencePremium: trackReference,
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
    // Nested (ledger row) first, then the TOP-LEVEL field a bare board setup carries. Reading only
    // the nested one blanked TIME for every WATCH row — the timestamp was in the payload all along,
    // one level up from where this looked.
    detectedAt: firstSeenIso(src, setup),
    closedReason: src.closed_reason ?? null,
    exitReason: src.exit_reason ?? null,
    exitDetail: src.exit_detail ?? null,
    exitAt: src.exit_at ?? null,
    exitPnlPct: fin(src.exit_pnl_pct),
    timelineTranches: src.timeline_tranches ?? null,
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
  /** The play's contract. The greek fields are OPTIONAL and ADDITIVE (FINDINGS 2026-08-06): the SWING
   *  payload's ChainContract has always carried `delta`, and now carries gamma/theta/vega/iv for live
   *  positions, but this source type had no slot for any of them — so the deck could not have rendered
   *  a greek even when one was present. Each is independently null-safe downstream. */
  contract: {
    strike: number;
    right: "C" | "P";
    expiry: string;
    dte: number;
    mid?: number | null;
    delta?: number | null;
    gamma?: number | null;
    theta?: number | null;
    vega?: number | null;
    iv?: number | null;
  };

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
  entryStatus?: SwingEntryState | null;
  archetype?: string | null;
  subLane?: string | null;
  servingSection?: SwingServingSection | null;
  /** ISO instant the thesis was first observed. */
  firstSeenAt?: string | null;
  /** ISO instant capital was committed. */
  committedAt?: string | null;
  /** Discovery provenance kinds. */
  signalKinds?: string[] | null;
  /** Live-position status when this play is an OPEN swing (OPEN/HOLD/TRIM). */
  liveStatus?: "OPEN" | "HOLD" | "TRIM" | null;
  /** Underlying price when the thesis was first flagged — WATCH track anchor. */
  flagUnderlyingPx?: number | null;
  /** Optional live underlying for WATCH track (stock quote overlay). */
  liveSpot?: number | null;
  /** Live swing book — option entry/mark/P&L when this row is an OPEN ledger position. */
  entryPremium?: number | null;
  livePnlPct?: number | null;
  peakPremium?: number | null;
  troughPremium?: number | null;
}

/**
 * Derive the deck's thesis-break from pre-entry setup maturity. INVALIDATED = the structure broke → "break".
 * A live-but-forming/triggered/extended thesis is "intact". A DATA-ABSENT read (no setupState) on SWING is
 * "unknown", NEVER a fabricated "intact" — the same 9-6c honesty the 0DTE adapter applies to a null tape
 * read. LEAPS (and callers with no swing maturity) keep the legacy "intact" default when setupState is
 * omitted entirely AND horizon isn't SWING.
 */
function thesisBreakFromSetupState(
  setupState: SwingSetupState | null | undefined,
  horizon?: "SWING" | "LEAPS",
): { level: ThesisLevel; note?: string } {
  if (setupState == null) {
    return horizon === "SWING"
      ? { level: "unknown", note: "no setup read attached to this name yet" }
      : { level: "intact" };
  }
  if (setupState === "INVALIDATED") return { level: "break", note: "structure invalidated — thesis broke" };
  return { level: "intact" }; // FORMING / TRIGGERED / EXTENDED — a live, un-broken thesis
}

/** Map horizon play status to deck lifecycle — live capital wears OPEN/HOLD/TRIM. */
/**
 * Drop a leading ticker from a contract label, so a deck row that already renders the symbol in
 * its own element doesn't print it twice.
 *
 * Only strips a whole-word match at the very start, and only when something is left afterwards —
 * a label that is nothing but the ticker (the "no options data available" shape) keeps its symbol
 * rather than collapsing to an empty string.
 */
export function stripLeadingTicker(label: string, ticker: string | null | undefined): string {
  const sym = ticker?.trim();
  if (!sym) return label;
  const stripped = label.replace(new RegExp(`^${sym.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b[\\s]*`, "i"), "").trim();
  return stripped.length > 0 ? stripped : label;
}

function horizonDeckStatus(src: HorizonDeckSource): DeckStatus {
  if (src.liveStatus) return asStatus(src.liveStatus);
  const raw = String(src.status ?? "").toUpperCase();
  if (raw === "COMMIT") return "WATCH"; // pre-entry actionable, not committed capital
  return asStatus(src.status ?? (src.score >= 60 ? "OPEN" : "WATCH"));
}

/**
 * Build the deck greek strip from a horizon play's contract. Returns null — a genuinely absent strip —
 * when the contract carries NO greek at all, so "we have nothing" and "we have a delta but no gamma"
 * stay distinguishable at the renderer. Never fabricates: a non-finite field becomes null.
 */
export function greeksFromContract(contract: HorizonDeckSource["contract"]): DeckGreeks | null {
  const greeks: DeckGreeks = {
    delta: fin(contract.delta),
    gamma: fin(contract.gamma),
    theta: fin(contract.theta),
    vega: fin(contract.vega),
    iv: fin(contract.iv),
  };
  return Object.values(greeks).some((v) => v != null) ? greeks : null;
}

export function terminalPlayFromHorizon(src: HorizonDeckSource): TerminalPlay {
  const status = horizonDeckStatus(src);
  const entry = fin(src.entryPremium);
  const markMid = fin(src.contract.mid);
  const livePnl = fin(src.livePnlPct);
  const mgmt = managementFor("SCALE_OUT", status, status === "WATCH" || status === "SKIP" ? null : livePnl);
  const flagPx = fin(src.flagUnderlyingPx);
  const watchTrack = status === "WATCH" || status === "SKIP";
  const trackPct = watchTrack
    ? watchUnderlyingTrackPct(src.direction, flagPx, src.liveSpot ?? null)
    : null;
  const peakDisplay =
    entry != null && fin(src.peakPremium)
      ? Math.round(((src.peakPremium! / entry - 1) * 100) * 10) / 10
      : null;
  const troughDisplay =
    entry != null && fin(src.troughPremium)
      ? Math.round(((src.troughPremium! / entry - 1) * 100) * 10) / 10
      : null;
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
    thesisBreak: src.thesisBreak ?? thesisBreakFromSetupState(src.setupState, src.horizon),
    ...mgmt,
    recNote: src.reason || mgmt.recNote,
    entry,
    mark: markMid,
    pnlPct: status === "WATCH" || status === "SKIP" ? null : livePnl,
    trackPct,
    flagUnderlyingPx: flagPx,
    peak: peakDisplay,
    trough: troughDisplay,
    // FINDINGS 2026-08-06 (SEV-3, greeks never reached the desk): this was a hardcoded `null`, so the
    // SWING/LEAPS greek strip could never render anything — not even the `delta` the payload has always
    // carried. Built from the contract now, each field independently null-safe, and null ONLY when the
    // contract itself carries no greek at all so the strip stays honestly absent rather than all-"—".
    // NOTE: PlayTerminal additionally blanks the strip when the row has no live mark (`greeksOff`), so a
    // pre-entry candidate still shows nothing — this only lights up rows with a real live quote.
    greeks: greeksFromContract(src.contract),
    archetype: src.archetype ?? null,
    subLane: src.subLane ?? null,
    setupState: src.setupState ?? null,
    entryStatus: src.entryStatus ?? null,
    servingSection: src.servingSection ?? null,
    detectedAt: src.firstSeenAt ?? null,
    firstFlaggedAt: src.committedAt ?? null,
    committedAt: src.committedAt ?? null,
    discoveryOrigin:
      Array.isArray(src.signalKinds) && src.signalKinds.length > 0 ? src.signalKinds : null,
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
  target_atr_multiple?: number | null;
  flow_streak_days?: number | null;
  gate_promoted?: boolean | null;
  gate_warnings?: string[] | null;
  pulled?: boolean | null;
  pulled_reason?: string | null;
  confirming_signals?: number | null;
  earnings_risk?: boolean | null;
  entry_cost_per_contract?: number | null;
  premium_cap_ok?: boolean | null;
  sector?: string | null;
  /** Pinned tier assignment from publish-context (tier engine output). The `factors` array
   *  explains WHY the tier was assigned — present on editions built after PR-N7. */
  tier?: { tier: string; factors: NighthawkTierFactor[] } | null;
  // Morning confirmation overlay (merged by the container).
  morning_status?: "CONFIRMED" | "DEGRADED" | "INVALIDATED" | "UNVERIFIED" | null;
  morning_reason?: string | null;
  /** True once this CONFIRMED ticker was actually promoted into the Swing serving snapshot
   *  (per-ticker outcome of promoteLegacyConfirmedToSwing — promotion can fail per-name even
   *  when the morning-confirm status is CONFIRMED, e.g. "no chain rows"). */
  swing_promoted?: boolean | null;
  /** Edition publish instant — WATCH "Published" clock. */
  published_at?: string | null;
  /** Morning confirm snapshot instant — OPEN "Confirmed" clock when verified. */
  confirmed_at?: string | null;
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

  // IV rank, R:R, flow streak, and confirming count are edition metadata — NOT scored factor
  // points. They render in the P&L/thesis panels (rrRatio, ivRank, confluence) instead of the
  // "Why this play was picked" bar chart, which would mislabel them as additive score pillars.

  const direction = asDir(src.direction);
  const entryMid = parseEntryMid(src.entry_range);
  const pulled = src.pulled === true;

  // Morning confirmation drives the status + regime display.
  const ms = src.morning_status;
  const status: DeckStatus = pulled ? "CLOSED" : ms === "INVALIDATED" ? "SKIP" : ms === "CONFIRMED" ? "OPEN" : "WATCH";
  const regime = ms
    ? ms === "CONFIRMED"
      ? "pre-market CONFIRMED"
      : ms === "DEGRADED"
        ? "pre-market DEGRADED"
        : ms === "INVALIDATED"
          ? "INVALIDATED — pulled"
          : ms === "UNVERIFIED"
            ? "pre-market unverified"
            : "pre-market pending"
    : "morning confirm pending";

  // Build contract label from real options_play data when available.
  //
  // options_play is built by formatOptionsPlay() (deterministic-edition.ts) and deliberately LEADS
  // WITH THE TICKER — "MSFT $500 CALL @ $3.33 — Aug 10" — because it is also used standalone in the
  // briefing panel, the AI format contract and gex-heatmap, where the symbol has to be present.
  // Every deck surface, though, renders `ticker` in its own element right beside this label
  // (CommandDeck's .nh-deck-tk + .nh-deck-sub, PlayTerminal's header), so passing it through
  // verbatim printed the symbol twice: "MSFT MSFT $500 CALL @ $3.33 — Aug 10".
  //
  // Stripped here rather than in formatOptionsPlay() because the duplication is a property of the
  // deck's two-element layout, not of the string — the other consumers still need the prefix.
  const contractLabel = src.options_play
    ? stripLeadingTicker(`${src.options_play}`.replace(/\s+/g, " ").trim(), src.ticker)
    : `Rank ${src.rank ?? "?"} · next session`;

  // Gate warnings surface as gates (red/amber chips) in the terminal.
  const gates: Array<{ label: string; ok: boolean }> = [];
  if (src.gate_promoted && src.gate_warnings?.length) {
    for (const w of src.gate_warnings) {
      gates.push({ label: w, ok: false });
    }
  }
  if (src.earnings_risk) {
    gates.push({ label: "EARNINGS RISK", ok: false });
  }
  if (src.premium_cap_ok === false) {
    gates.push({ label: "PREMIUM HIGH", ok: false });
  }

  // Thesis break from morning confirmation — risk_note enriches the warn/intact note.
  // CONFIRMED overrides risk_note — a morning confirmation means the thesis held.
  // NOTE: ms === "INVALIDATED" is checked BEFORE the generic `pulled` branch — INVALIDATED always
  // engages the one-way `pulled` latch (morning-verdict-persist.ts), so checking `pulled` first
  // would shadow the INVALIDATED-specific copy with the generic pulled_reason fallback on every
  // INVALIDATED play. A severe-DEGRADED pull (pulled=true, ms !== "INVALIDATED") is a different
  // root cause and correctly keeps its own pulled_reason text via the branch below.
  const thesisBreak: { level: ThesisLevel; note?: string } =
    ms === "INVALIDATED"
      ? {
          level: "break",
          note: `The play has been invalidated at pre-market screening${src.morning_reason ? ` — ${src.morning_reason}` : ""}`,
        }
    : pulled ? { level: "break", note: src.pulled_reason ?? "play invalidated and pulled" }
    : ms === "DEGRADED" ? { level: "warn", note: src.morning_reason ?? (src.risk_note ?? "pre-market conditions degraded") }
    : ms === "UNVERIFIED" ? { level: "unknown", note: src.morning_reason ?? "morning confirm has not run yet" }
    : ms === "CONFIRMED" ? { level: "intact" }
    : src.risk_note ? { level: "warn", note: src.risk_note }
    : ms == null ? { level: "unknown", note: "morning confirm pending" }
    : { level: "intact" };

  // Build the recNote — key_signal enriches the thesis narrative.
  const keySignalLine = src.key_signal ? ` Key signal: ${src.key_signal}` : "";
  const recNote = ms === "INVALIDATED"
    ? `The play has been invalidated at pre-market screening${src.morning_reason ? ` — ${src.morning_reason}` : ""}.`
    : pulled
      ? `PULLED — ${src.pulled_reason ?? "thesis invalidated pre-market"}`
      : ms === "DEGRADED"
        ? `DEGRADED — ${src.morning_reason ?? "conditions shifted; validate before entry"}`
        : ms === "CONFIRMED"
          ? src.swing_promoted
            ? `Pre-market confirmed — the play is still active and moved to Swings Open.${keySignalLine}`
            : `Pre-market confirmed — thesis intact, entry levels hold.${keySignalLine}`
          : src.thesis
            ? `${src.thesis}${keySignalLine}`
            : `Evening edition — pre-market confirm posts before the open.${keySignalLine}`;

  // Score: a missing score renders as 0 in the terminal (the score display always shows a number),
  // but an absent score is different from a real 0.
  const rawScore = fin(src.score);

  // Confluence: the edition's confirming_signals count maps directly to the terminal's confluence
  // badge — same semantic (independent confirmations backing the setup).
  const confluence = src.confirming_signals != null && src.confirming_signals > 0
    ? src.confirming_signals : null;

  // Discovery origin: only data-grounded badges — flow_streak_days is real pipeline
  // data. Regex-inferred BREAKOUT/CATALYST/SWEEP from free-text key_signal was removed
  // because it fabricated provenance from prose never designed to encode taxonomy.
  const discoveryOrigin: string[] = [];
  if (src.flow_streak_days != null && src.flow_streak_days > 0) discoveryOrigin.push("FLOW");

  // "Why now" trigger: grounded in flow data only. The key_signal text is shown as-is
  // in the thesis panel — no need to re-derive taxonomy from it.
  let whyNow: WhyNow | null = null;
  if (src.flow_streak_days != null && src.flow_streak_days > 0 && src.key_signal) {
    whyNow = { reason: "accumulation" as WhyNowReason, label: src.key_signal };
  }

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
    swingPromoted: src.swing_promoted === true,
    tierLabel: src.tier?.tier ?? src.conviction ?? null,
    tierFactors: src.tier?.factors ?? null,
    recommendation: pulled || ms === "INVALIDATED" ? "SELL" : ms === "CONFIRMED" ? "BUY" : "HOLD",
    recNote,
    progress: null,
    // Stock entry mid drives P&L overlay (overlayLegacyQuotes) — option premium stays separate.
    entry: entryMid ?? fin(src.entry_premium),
    mark: null,
    pnlPct: null,
    greeks: null,
    entryRange: src.entry_range ?? null,
    targetLevel: src.target ?? null,
    stopLevel: src.stop ?? null,
    thesis: src.thesis ?? null,
    keySignal: src.key_signal ?? null,
    optionsPlay: src.options_play ?? null,
    rrRatio: fin(src.rr_ratio),
    targetAtrMultiple: fin(src.target_atr_multiple),
    ivRank: fin(src.iv_rank),
    entryCostPerContract: fin(src.entry_premium) ?? fin(src.entry_cost_per_contract),
    premiumCapOk: src.premium_cap_ok ?? null,
    sector: src.sector?.toLowerCase() ?? null,
    morningStatus: ms ?? null,
    confluence,
    discoveryOrigin: discoveryOrigin.length > 0 ? discoveryOrigin : undefined,
    whyNow: whyNow ?? undefined,
    detectedAt:
      typeof src.published_at === "string" && src.published_at.length > 0 ? src.published_at : null,
    firstFlaggedAt:
      ms === "CONFIRMED" && typeof src.confirmed_at === "string" && src.confirmed_at.length > 0
        ? src.confirmed_at
        : null,
  };
}
