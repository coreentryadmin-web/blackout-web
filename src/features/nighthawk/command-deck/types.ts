/**
 * COMMAND DECK — the horizon-agnostic terminal contract.
 *
 * One matrix terminal renders all four boards (0DTE / Swings / LEAPS / Legacy). Each board produces this
 * shape from its own data via a pure adapter (adapters.ts), so the terminal never knows which board it's
 * showing — the payoff of the HorizonPlay/explainability/allocation unification. Pure data; no React.
 */

import type { SwingSetupState, SwingEntryState } from "@/lib/swing/taxonomy";
import type { SwingServingSection } from "@/lib/swing/serving";
import type { TerminalExitLadder } from "@/lib/zerodte/terminal-ladder";
import type { WhyNow } from "@/lib/zerodte/why-now";
import type { ThesisHealthPayload } from "@/lib/zerodte/thesis-health";
import type { NighthawkTierFactor } from "@/features/nighthawk/lib/nighthawk-tiers";

export type DeckDirection = "LONG" | "SHORT";
export type DeckStatus = "OPEN" | "HOLD" | "TRIM" | "CLOSED" | "WATCH" | "SKIP";
export type ExitModel = "RATCHET" | "SCALE_OUT" | "PLAN";
export type Recommendation = "BUY" | "HOLD" | "TRIM" | "SELL";
export type ThesisLevel = "intact" | "warn" | "break" | "unknown";

/** A signed, point-weighted reason (from the real scoring components). */
export interface DeckFactor {
  label: string;
  points: number;
}

/** Live option greeks for the streaming strip. Null fields render as "—" until the stream carries them. */
export interface DeckGreeks {
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  iv: number | null;
}

/** Resolved iron-condor render geometry (Wave 2) — the "price-inside-the-tent" gauge inputs for a
 *  CREDIT condor row. Emitted server-side from the row's frozen CondorPlan (entry_context.condor) and
 *  mapped to camelCase by the adapter; `spot` is resolved to the LIVE underlying when the board carries
 *  it (`spotIsLive`), else the commit-time spot. Present ONLY on `isCondor` rows; null otherwise. */
export interface DeckCondor {
  /** Resolved underlying: the live price when available (spotIsLive), else the commit-time spot. */
  spot: number | null;
  /** True when `spot` is a fresh live underlying; false when it fell back to the commit-time spot. */
  spotIsLive: boolean;
  shortPut: number;
  longPut: number;
  shortCall: number;
  longCall: number;
  /** Wing width per side in points (short→long). */
  wingPts: number;
  /** Net credit captured per 1-lot, $ (×100). Null when priced without a full book at commit. */
  netCredit: number | null;
  /** Defined max loss per 1-lot, $. Null without a credit. */
  maxLoss: number | null;
  /** Underlying breach levels = the short strikes (a WIN closes STRICTLY inside). */
  breachLower: number;
  breachUpper: number;
  /** Surfaced win-rate estimate — ALWAYS rendered with `breachRatePct`, never alone (honest skew). */
  winRate: number | null;
  /** The negative-skew intraday-breach companion. Null on a legacy blob → render captions it unmeasured. */
  breachRatePct: number | null;
}

export interface TerminalPlay {
  id: string;
  ticker: string;
  direction: DeckDirection;
  /** Human contract label, e.g. "192C · 0DTE". */
  contract: string;
  /** OCC symbol for the live greeks/marks subscription, when known. */
  occ?: string | null;
  score: number;
  status: DeckStatus;
  horizon: "ZERO_DTE" | "SWING" | "LEAPS" | "LEGACY";
  exitModel: ExitModel;

  // ── thesis ──
  factors: DeckFactor[];
  gates: Array<{ label: string; ok: boolean }>;
  regime?: string | null;
  confidence?: number | null; // 0–1
  allocation?: { role: string; sizing: string; reason?: string } | null;
  thesisBreak?: { level: ThesisLevel; note?: string } | null;
  /** Thesis Health — weighted Entry Truth vs Current Truth (OPEN/HOLD/TRIM only). */
  thesisHealth?: ThesisHealthPayload | null;
  /** LEGACY only: true once morning-confirm's CONFIRMED promotion actually landed this ticker
   *  in the Swing serving snapshot (not just confirmed — promotion can fail per-ticker, e.g.
   *  "no chain rows"). Drives the "moved to Swings Open" clickable link in ThesisPanel. */
  swingPromoted?: boolean;

  // ── management ──
  recommendation: Recommendation;
  recNote?: string;
  /** 0–1 position along the ratchet stop→target track (RATCHET); scale-out tranches derive from status. */
  progress?: number | null;

  // ── management: the REAL resolved exit ladder (Terminal v2) ──
  /** The engine's ACTUAL exit ladder for this row — the trim-scale ⅓/⅓ partial-scale ladder or
   *  the single ratchet track — resolved server-side from the FROZEN exit policy and priced/fired
   *  against entry + peak. When present with `policy: "trim_scale"` the terminal draws the real
   *  ladder; a ratchet/absent policy keeps the legacy single stop→target track. */
  exitPolicy?: TerminalExitLadder | null;
  /** True when this is a CREDIT iron condor — suppresses the directional long-premium trim ladder
   *  (a condor profits from decay, not a rising premium, so the ⅓@+25%/⅓@+50% ladder is inverted). */
  isCondor?: boolean | null;
  /** The resolved condor render geometry (Wave 2) — the tent gauge + breach math. Present ONLY on an
   *  isCondor row that carried a real CondorPlan; null on a directional row or a condor with no pinned
   *  geometry (the terminal then shows an honest "geometry unavailable" note, never a fabricated tent). */
  condor?: DeckCondor | null;

  // ── pnl ──
  entry?: number | null;
  mark?: number | null;
  pnlPct?: number | null;
  /** WATCH-only hypothetical move since the desk flagged the setup — NOT entry P&L. */
  trackPct?: number | null;
  /** Anchor premium (0DTE) or underlying px (Swings) behind `trackPct` — for honest labeling. */
  trackReferencePremium?: number | null;
  /** Underlying price when the swing thesis was first flagged — WATCH track anchor. */
  flagUnderlyingPx?: number | null;
  peak?: number | null;
  trough?: number | null;
  /** Executable exit fill (the BID a long sells into) + its P&L vs entry — the honest realizable
   *  number beside the mid `mark`/`pnlPct`. Null without a live two-sided book (mid-only). */
  execMark?: number | null;
  execPnlPct?: number | null;

  // ── live-mark honesty (Terminal v2) ──
  /** ISO instant of the quote behind `mark` — the terminal shows its age. */
  markAsOf?: string | null;
  /** Server-flagged: the mark is a legacy SYNC mark with no per-quote timestamp (unknown age). */
  markIsSync?: boolean | null;

  // ── header badges (Terminal v2) ──
  /** Discovery rails that found this play (FLOW/BREAKOUT/PIN) — the origin badge. */
  discoveryOrigin?: string[] | null;
  /** Merit tier letter at commit (A+/A/…/F), read from the pinned tier blob. */
  tierLabel?: string | null;
  /** The tier engine's factor breakdown — each factor's label, direction (up/down), and detail
   *  string explaining WHY the tier was assigned. Present on Legacy plays from the edition's
   *  publish-context `tier.factors`; absent on older/degraded editions. */
  tierFactors?: NighthawkTierFactor[] | null;
  /** VWAP-side + market-aligned confirmation count (0–2) — the confluence badge. */
  confluence?: number | null;
  /** Per-strategy calibration scorecard — rendered ONLY when the payload carries it (never
   *  fabricated): win-rate %, average return %, and sample size n. Wave 3: the OPTIONAL Wilson
   *  95% confidence bounds (percent units, from calibration's win_rate_ci_pct, WS-07/WS-09) so
   *  the win-rate NEVER renders as a bare point estimate — present → "63% WR (95% CI 55–70%,
   *  n=214)"; absent → "63% WR (n=214 · CI n/a)". Never a fabricated interval. */
  scorecard?: { winRate: number; avg: number; n: number; ciLow?: number | null; ciHigh?: number | null; /** When "conviction_bucket", the stats are tier-level — not this play alone. */ scope?: "conviction_bucket" | "play" } | null;

  // ── edge layer (Wave 3) ──
  /** The trigger reason that surfaced this play (event-driven scan). Drives the Thesis tab's
   *  "⚡ triggered by …" ribbon; null → the ribbon is omitted (no fabricated reason). */
  whyNow?: WhyNow | null;
  /** ISO instant this play was first flagged by the scan — the honest "when" for the why-now
   *  ribbon (rendered as an ET clock time). Null on a row that carried no flag time. */
  firstFlaggedAt?: string | null;
  /** ISO instant the scanner first surfaced this name (setup.first_seen) — the WATCH "Published"
   *  clock. Null when the board never carried a detection time. */
  detectedAt?: string | null;
  /** ISO instant capital was committed (swing ledger committed_at). Null when unknown. */
  committedAt?: string | null;

  /** Timeline replay — engine exit + reconstructed tranches (0DTE only, never fabricated). */
  closedReason?: string | null;
  exitReason?: string | null;
  exitDetail?: string | null;
  exitAt?: string | null;
  exitPnlPct?: number | null;
  timelineTranches?: import("@/lib/zerodte/play-timeline").PlayTimelineTranche[] | null;

  // ── greeks (live) ──
  greeks?: DeckGreeks | null;

  /** Sector classification (lower-cased), when known. */
  sector?: string | null;
  /** Morning confirmation status for Legacy plays (CONFIRMED/DEGRADED/INVALIDATED/UNVERIFIED). */
  morningStatus?: "CONFIRMED" | "DEGRADED" | "INVALIDATED" | "UNVERIFIED" | null;

  // ── legacy edition geometry (entry/target/stop as raw strings for the thesis panel) ──
  entryRange?: string | null;
  targetLevel?: string | null;
  stopLevel?: string | null;
  thesis?: string | null;
  keySignal?: string | null;
  optionsPlay?: string | null;
  rrRatio?: number | null;
  /** Implied-vol rank at publish (0–100), when the edition carried it — metadata, not a scored factor. */
  ivRank?: number | null;
  entryCostPerContract?: number | null;
  premiumCapOk?: boolean | null;

  // ── legacy stock-level overlay (populated by overlayLegacyQuotes, not the adapter) ──
  stockPrice?: number | null;
  stockChangePct?: number | null;

  // ── swing-only enrichment (all OPTIONAL, ADDITIVE — 0DTE/LEAPS/Legacy leave them undefined; PR-12
  //    populates them through the horizon adapter). The observable swing state the serving router keys on. ──
  /** The classified swing archetype label (taxonomy.ts), when this is a SWING play. */
  archetype?: string | null;
  /** The contract sub-lane (Tactical/Standard/Extended) label, when this is a SWING play. */
  subLane?: string | null;
  /** Pre-entry setup maturity — the OBSERVABLE the serving router branches on. */
  setupState?: SwingSetupState | null;
  /** Entry-execution stance — the other OBSERVABLE the serving router branches on. */
  entryStatus?: SwingEntryState | null;
  /** The serving section (serving.ts) this play resolved to, for the section-grouped terminal. */
  servingSection?: SwingServingSection | null;
}
