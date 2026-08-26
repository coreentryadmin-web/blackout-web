// 0DTE Command hard entry-gate stack (G-1..G-11) — the market-state discipline layer
// specified in docs/audit/NIGHTHAWK-0DTE-DECISION.md §2 and approved 2026-07-13
// ("best plays only"). The four evidence gates in ./board.ts measure FLOW CONVICTION
// (is somebody really loading this contract?); this module measures TRADE QUALITY
// (should WE commit a plan on it right now?). On 2026-07-13 the evidence gates
// committed 8/8 scanned candidates on a down tape and went 1W/7L — flow conviction
// alone is not a trade.
//
// Contract with the rest of the pipeline:
// - HARD gates apply to NEW plan commits only. Already-committed ledger rows are
//   NEVER retro-blocked or mutated — a printed play is managed to its exit, period.
// - Fail closed: missing/stale gate inputs block a NEW commit (same discipline as
//   the evidence gates' no_underlying_price rejection), never a free pass. This holds
//   across the stack: an unreadable tape (G-1 no_market_bias), governor (G-5
//   gate_context_unavailable), an ATTEMPTED-but-unavailable day-open VIX where a present
//   VIX could have blocked (G-4 vix_unavailable), and a FAILED macro-calendar fetch (G-7
//   macro_unavailable) all HOLD a fresh commit rather than let it through blind. The two
//   Phase-0 additions (VIX/macro) are keyed off an EXPLICIT "attempted and unavailable"
//   signal from scan.ts, so a caller that simply doesn't supply the input is unaffected,
//   and each is conservative (blocks only when a present value could actually have fired
//   the gate) and env-overridable, so it never spuriously empties the board.
// - Fail visible: every block becomes a zerodte_scan_rejections row with a
//   machine-readable code + a human sentence, and rides the setup payload as a
//   WATCH/SKIP card — a member can always see WHY the desk sat one out.
// - Pure functions only (unit-testable, replayable against fixture sessions);
//   ./scan.ts assembles the async inputs.

import type { MarketBias } from "./intraday";
import type { EarningsFlag, EnrichedZeroDteSetup, PlayType, ZeroDteGateFailure, ZeroDteGateRejection } from "./board";
import {
  evaluateZeroDteGovernor,
  premiumBudgetReason,
  GOVERNOR_ENFORCE_PREMIUM_BUDGET,
  GOVERNOR_MAX_PREMIUM_AT_RISK,
  type GovernorOpenPlan,
  type GovernorSnapshot,
} from "./governor";
import { CHASE_PCT, type ContractPlan } from "./plan";
import type { ZeroDteConfluence } from "./confluence";
import { NEW_PLAY_CUTOFF_ET_MINUTES } from "./plan";
import { commitAuthorizedBySourceHealth, type SourceHealthState } from "@/lib/ws/source-health";
import { EARLY_ENTRY_WINDOW_END_ET_MINUTES } from "./confluence";
import { evaluateMacroHardBlock, hasHighImpactMacroEvent, type MacroEventLike } from "@/lib/macro-hard-block";
import { condorLiquidityGateBlocks, condorRangeBreaking, type CondorPlan } from "./condor";

/** Read a positive-integer tuning knob from the environment, falling back to `def` when unset,
 *  non-numeric, or ≤0. Evaluated ONCE at module load so the gate FUNCTIONS stay pure (they only
 *  ever reference the resolved constant) — the same "tunable constant from env" pattern the
 *  provider layer uses. Config-gating keeps these strategy dials adjustable without a code change,
 *  per the standing "config-gated / conservative default" rule for entry-quality changes. */
function envInt(name: string, def: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return def;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : def;
}

// ── G-1 · Tape-alignment block ──────────────────────────────────────────────────
// Evidence (nh0dte forensics, 2026-07-13): counter-tape entries are the single most
// visible killer in the dataset — on 7/13 (SPY down all session) the board's longs
// went 0/5 (avg −54.7% premium) while the aligned shorts held 1W/2L. Until now this
// was only a −6 score dent (marketAlignAdjust, ./intraday.ts); a 93-score SPY long
// shrugged it off at 09:55 and stopped out. Promoted to a hard block.
/** Max age of the SPY read the bias came from. A bias computed from bars that
 *  stopped arriving 15+ minutes ago is a memory, not a market state — fail closed. */
export const MARKET_BIAS_MAX_AGE_MS = 15 * 60 * 1000;

// ── G-2 · Opening-window block ──────────────────────────────────────────────────
// USER-AUTHORIZED 2026-07-23 (supersedes the 2026-07-13 "first 15 min only" directive):
// push the unlock from 9:45 → 10:00 ET, blocking the demonstrably-worst first 30 minutes
// of RTH. Evidence (simulator, 25 sessions × SPY/QQQ/IWM, docs/audit/0DTE-RESEARCH.md): a
// fixed entry at 9:45 ran −12.1% expectancy / 26% win — the worst tested time — improving
// monotonically through the morning (10:00 −7.8%, 10:30 −9.1%, 11:00 +1.5%). 9:45 was
// literally the worst moment to unlock. The move stops at 10:00 (NOT 11:00) on purpose:
// (1) the backtest grader holds to stop/target/15:30 and ignores the live exit engine, so
// it likely UNDERSTATES early-entry outcomes; (2) blocking the whole morning would empty
// the board 9:30–11:00. The soft 10:00–12:30 gradient is handled by timeOfDayFactor
// (intraday.ts), a score nudge, not a hard block. The gate still buckets every commit by ET
// time (gate_calibration_json.committed_at_et), so the ledger — not this backtest — decides
// whether to push the unlock later. Setups found before 10:00 stay visible as WATCH/SKIP
// cards carrying the unlock time; the scanner re-evaluates every ~2 min, so a setup still
// alive at 10:00 commits then. The no-new-plays->=15:00 + hard-exit-15:30 rules are
// unchanged and live upstream (persistZeroDteScan / PLAN_RULES).
export const OPENING_WINDOW_UNLOCK_ET_MINUTES = 10 * 60;
export const OPENING_WINDOW_UNLOCK_LABEL = "10:00 ET";

// ── G-14 · Late-afternoon block ──────────────────────────────────────────────────
// Evidence (90-day prod record, 101 graded plays): the "late 14:00-15:30" bucket ran
// 14.3% WR / −19.02% avg P&L — the second-worst time window after the opening drive.
// With only ~1.5 hours of 0DTE theta left, premium-buying entries face accelerating
// decay and almost never reach the +100% target; 85.7% stopped out. Shipped at 14:00 ET
// (FINDINGS 2026-07-28) — the prior 15:00 cutoff left the entire toxic bucket open.
// CONDOR-EXEMPT: an iron condor WANTS late-session theta crush (credit seller); the late
// window is only destructive for long-premium entries.
export const LATE_AFTERNOON_BLOCK_ET_MINUTES = NEW_PLAY_CUTOFF_ET_MINUTES;
export const LATE_AFTERNOON_BLOCK_LABEL = "15:30 ET";

// ── G-12 · Confluence floor — HARD GATE (Phase 1, 2026-07-24) ─────────────────────
// Evidence (E3, 25 sessions, docs/audit/0DTE-RESEARCH.md): expectancy ladders with the number of
// INDEPENDENT confirmations that agree with the setup's direction (VWAP-side + market-aligned):
//   0-conf → −12.5% EV | 1-conf → 0.0% | 2-conf → +15.9% EV (41% win, n=22).
// confluence.ts computed this read but was explicitly NON-gating, so the ADDITIVE score
// (board.ts) let a single loud premium tier (+40) drag a ZERO-confluence setup over the 65 floor —
// exactly the −12.5% bucket. Live calibration (n=98 graded) confirmed the hole: the confluence read
// was null ("no_read") on 96/98 committed plays, so the board was committing blind to confirmation.
// G-12 makes confluence a real commit input: a fresh commit needs at least ZERODTE_CONFLUENCE_MIN
// confirmations. Default 2 (restored 2026-07-29) is the measured +EV bucket (+15.9% EV, n=22);
// 0-conf (−12.5%) and 1-conf (0% EV) are the precision filter — fewer prints, stronger book.
// Lower via ZERODTE_CONFLUENCE_MIN=1 if the desk must unstarve under provider stress.
//
// Early window: inside [10:00, 10:45) ET the floor is ZERODTE_CONFLUENCE_MIN_EARLY (default 2 —
// the measured-negative early window is where a single-confirmation loud print hurts most).
// Both floors are config-gated so the ledger can tune them without a deploy.
//
// FAIL-OPEN on a missing read: unlike the market-state preconditions (bias/governor, which fail
// CLOSED), G-12 only fires when a confluence read is actually PRESENT and shows too few
// confirmations. A null read (not the live path — scan.ts always attaches one before this gate —
// but true in fixture replays) is not itself a block; we never manufacture a block from an
// unmeasured factor.
export const ZERODTE_CONFLUENCE_MIN = envInt("ZERODTE_CONFLUENCE_MIN", 2);
export const ZERODTE_CONFLUENCE_MIN_EARLY = Math.max(
  ZERODTE_CONFLUENCE_MIN,
  envInt("ZERODTE_CONFLUENCE_MIN_EARLY", 2)
);

/** G-13 — multi-day flow accumulation must agree with setup direction (2026-07-30 session:
 *  MU long while accumulation bearish → −20% after +132% MFE). Default ON. */
function envFlag(name: string, defaultOn: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  if (raw === "1" || raw === "true" || raw === "on") return true;
  return defaultOn;
}
export const ZERODTE_BLOCK_ACCUM_MISALIGN = envFlag("ZERODTE_BLOCK_ACCUM_MISALIGN", true);

/** Telemetry: how many times G-12 encountered a null confluence read and failed OPEN
 *  (the setup was not blocked on confluence). Gives observability into how often the
 *  fail-open path fires in practice — a rising count signals scan.ts is not attaching
 *  confluence reads before gating. */
let _nullConfluencePassCount = 0;
export function getNullConfluencePassCount(): number { return _nullConfluencePassCount; }

/** The confluence floor in force at `nowEtMinutes`: the higher early-window floor inside
 *  [10:00, 10:45) ET, else the standard floor. Pure. */
export function confluenceFloorAt(nowEtMinutes: number): number {
  const early =
    nowEtMinutes >= OPENING_WINDOW_UNLOCK_ET_MINUTES &&
    nowEtMinutes < EARLY_ENTRY_WINDOW_END_ET_MINUTES;
  return early ? ZERODTE_CONFLUENCE_MIN_EARLY : ZERODTE_CONFLUENCE_MIN;
}

/** G-12 floor — single names only gate VWAP-side (G-1 exempts them from SPY tape). */
export function g12ConfluenceFloor(ticker: string, nowEtMinutes: number): number {
  if (isIndexEtfTicker(ticker)) return confluenceFloorAt(nowEtMinutes);
  return 1;
}

// ── G-4 · VIX regime throttle — HARD GATE (promoted from calibration 2026-07-16) ──
// Evidence (F-1): the strongest per-play split in the whole forensics dataset —
// Slayer plays on days opening VIX 15-17 ran 69.2% WR (n=13, +1.85 pts avg) vs
// 25.0% WR (n=12, −1.54 pts) at 17-20. Originally ran as calibration for ≥30
// sessions; promoted to a hard gate because the signal is too strong to leave
// unenforced — the 44pp WR gap (69% vs 25%) is the widest in the dataset.
//   VIX ≥ 17 → require score ≥ 75 (G-1 already enforces tape alignment);
//   VIX ≥ 20 → index/ETF products only (single names blocked outright).
// The calibration record still pins on every commit for ongoing measurement.
export const VIX_ELEVATED_THRESHOLD = 17;
export const VIX_EXTREME_THRESHOLD = 20;
export const VIX_ELEVATED_SCORE_FLOOR = 75;
/** Phase-0 firewall kill-switch: G-4 fails a fresh commit closed when the day-open VIX
 *  read was ATTEMPTED but unavailable AND a present VIX could have blocked this candidate
 *  (see the G-4 block below). ON by default; set ZERODTE_G4_FAIL_CLOSED=0 to disable (e.g.
 *  if a VIX-provider outage is emptying the board and the desk chooses to trade blind). */
export const G4_VIX_FAIL_CLOSED_ENABLED = process.env.ZERODTE_G4_FAIL_CLOSED !== "0";
/** Phase-0 firewall kill-switch: G-7 fails a fresh commit closed when the macro-calendar
 *  FETCH failed (distinct from "fetched, zero events"). ON by default; set
 *  ZERODTE_G7_FAIL_CLOSED=0 to disable. */
export const G7_MACRO_FAIL_CLOSED_ENABLED = process.env.ZERODTE_G7_FAIL_CLOSED !== "0";
/** Phase-0 firewall kill-switch: G-11 fails a fresh commit closed when the market-wide
 *  earnings FEED read failed (distinct from "read succeeded, none report today"). ON by
 *  default; set ZERODTE_G11_FAIL_CLOSED=0 to disable (e.g. if a UW earnings-feed outage is
 *  emptying the board and the desk chooses to trade blind to the print calendar). */
export const G11_EARNINGS_FAIL_CLOSED_ENABLED = process.env.ZERODTE_G11_FAIL_CLOSED !== "0";
/** Phase-0 firewall kill-switch (D2): G-11 fails a fresh commit closed when the trading-halt
 *  FEED is cold — i.e. BOTH the UW and LULD halt sources read stale (see
 *  isTradingHaltChannelStale, uw-socket.ts). Distinct from an ACTIVE stored halt (that always
 *  blocks regardless of this flag). ON by default; set ZERODTE_G11_HALT_FAIL_CLOSED=0 to disable
 *  (e.g. if a genuine halt-feed outage is emptying the board and the desk chooses to trade blind
 *  to halts). Ops revert without a redeploy — mirrors G4/G7/G11-earnings. */
export const G11_HALT_FAIL_CLOSED_ENABLED = process.env.ZERODTE_G11_HALT_FAIL_CLOSED !== "0";
/** Products that stay tradable (at half size) in an extreme-VIX regime — broad
 *  index options + their ETF wrappers, where 0DTE liquidity survives a vol spike. */
export const INDEX_ETF_TICKERS = new Set([
  "SPX", "SPXW", "XSP", "SPY", "QQQ", "NDX", "NDXP", "IWM", "RUT", "RUTW", "DIA",
]);

export function isIndexEtfTicker(ticker: string): boolean {
  return INDEX_ETF_TICKERS.has(ticker.toUpperCase());
}

/** G-12 confirmation count — index ETFs need VWAP + SPY tape; single names are G-1-exempt
 *  from tape alignment and must not re-impose the market leg via confluence. */
export function g12ConfirmationCount(
  confluence: ZeroDteConfluence,
  ticker: string
): number {
  if (isIndexEtfTicker(ticker)) return confluence.confirmations;
  return confluence.vwap_ok ? 1 : 0;
}

export function g12ConfirmationLegLabel(ticker: string): string {
  return isIndexEtfTicker(ticker)
    ? "VWAP-side + market-aligned"
    : "VWAP-side (single-name — SPY tape leg exempt, same as G-1)";
}

export type ZeroDteVixCalibration = {
  day_open_vix: number | null;
  tier: "unknown" | "normal" | "elevated" | "extreme";
  /** Would the hardened G-4 have blocked this commit? (Logged, not enforced.) */
  would_block: boolean;
  /** Extreme tier's surviving index/ETF plays would print at half size. */
  would_halve_size: boolean;
  note: string;
};

// ── G-6 · Cross-system conflict — HARD GATE (promoted from calibration 2026-07-16) ─
// Evidence (v1 §2.2): 7/13's META short opposed Night Hawk's 7/10 edition LONG A on
// META and was surfaced to members only as a whisper-echo. Slayer has an explicit
// satellite-conflict module; this is the 0DTE analogue. Now enforced: a conflict
// with score < 80 is a hard block. Calibration record still pins for measurement.
export const CONFLICT_SCORE_FLOOR = 65; // lowered from 80 — old floor blocked nearly everything with any conflict; 65 still filters genuine disagreements
/** Tickers that trade the same broad-market direction as Slayer's SPX play — a
 *  0DTE short on any of these against a live Slayer long IS a desk disagreement. */
// G-6 cross-system conflict scope: index + mega-cap tech that move in sympathy
// with SPX. Intentionally BROADER than CORRELATION_GROUPS (governor.ts) which
// only covers direct hedging pairs, and NARROWER than INDEX_ETF_TICKERS which
// includes all VIX-regime-eligible instruments.
export const SPX_CORRELATED_TICKERS = new Set(["SPX", "SPXW", "XSP", "SPY", "QQQ", "NDX", "NDXP"]);

export type ZeroDteConflictCalibration = {
  conflict: boolean;
  /** Which system(s) this setup opposes (empty when clear). */
  against: Array<"spx_slayer" | "nighthawk_edition">;
  would_block: boolean;
  note: string;
};

/** The full calibration record pinned onto a committed ledger row
 *  (zerodte_setup_log.gate_calibration_json) — the C-2 context columns: after 30
 *  gated sessions this is what decides whether G-4/G-6 harden or drop. */
export type ZeroDteGateCalibration = {
  score_at_commit: number;
  market_bias: MarketBias | null;
  /** "HH:MM" ET at evaluation — the time-of-day bucket key for the calibration
   *  loop (e.g. measuring the 10:00–10:30 band left open past the G-2 unlock). */
  committed_at_et: string;
  g4_vix: ZeroDteVixCalibration;
  g6_conflict: ZeroDteConflictCalibration;
};

// ── G-3 · Score floor ───────────────────────────────────────────────────────────
// Evidence (F-2): the engine's OWN 14-day calibration (38 graded plays) says the
// 55-64 band is where the money dies — 18.8% WR, avg −24.5% premium (n=16), far
// below the 33.3% breakeven of the fixed −50/+100 payoff. 65-74 ran 50% WR/+21.1%
// (n=10), 75+ 50%/+9.9% (n=12). The API's own calibration recommendation agrees:
// raise the floor above the 55-64 band. Judged AFTER the intraday edge layer, so a
// raw-evidence 70 that the tape/time-of-day layer marked down to 62 does NOT clear.
export const ZERODTE_SCORE_FLOOR = 65;
/** Origin-aware G-3 floors. BREAKOUT/PIN use multiplicative scoring (gain×close / regime quality)
 *  but share the SAME commit bar as FLOW: the measured 55–64 band ran 18.8% WR / −24.5% avg (F-2),
 *  under the 33% breakeven of the −50/+100 payoff. A 50 floor (WS-20) let BREAKOUT-only commits
 *  through that death band all session — live 2026-08-25: MSTR 54, LUNR 53, ASST 59 committed while
 *  score_floor blocked 90 stronger candidates. Restored to 65; breakout-source.ts BASE bump helps
 *  genuine 7%+ continuations clear without lowering the bar. Env overrides remain available. */
export const ZERODTE_SCORE_FLOOR_BREAKOUT = envInt("ZERODTE_SCORE_FLOOR_BREAKOUT", 65);
export const ZERODTE_SCORE_FLOOR_PIN = envInt("ZERODTE_SCORE_FLOOR_PIN", 65);

/** Resolve the G-3 score floor for a setup's discovery origin set. Pure. */
export function scoreFloorForOrigins(origins: readonly string[] | null | undefined): number {
  const set = Array.isArray(origins) ? origins : [];
  // FLOW present → strict floor (print evidence must clear the historical commit bar).
  if (set.includes("FLOW")) return ZERODTE_SCORE_FLOOR;
  if (set.includes("BREAKOUT") && !set.includes("PIN")) return ZERODTE_SCORE_FLOOR_BREAKOUT;
  if (set.includes("PIN") && !set.includes("BREAKOUT")) return ZERODTE_SCORE_FLOOR_PIN;
  // BREAKOUT+PIN corroboration (no FLOW) — still the origin floor (now = 65 by default).
  if (set.includes("BREAKOUT") || set.includes("PIN")) return ZERODTE_SCORE_FLOOR_BREAKOUT;
  return ZERODTE_SCORE_FLOOR;
}

/** G-17 — single-rail whole-market commits (BREAKOUT-only or PIN-only) must clear the
 *  measured PRIME score band (75-84 ran 63.6% WR n=11, F-5) OR carry FLOW corroboration.
 *  Live 2026-08-25: every OPEN commit was BREAKOUT-only in the 53-68 band — momentum-only
 *  names with no whale-flow confirmation. FLOW-present setups (incl. FLOW+BREAKOUT merge +8)
 *  may commit at the unified 65 floor; this gate only fires on lone whole-market rails. */
export const ZERODTE_SINGLE_RAIL_PRIME_MIN = envInt("ZERODTE_SINGLE_RAIL_PRIME_MIN", 75);

/** True when discovery_origin is exactly one non-FLOW rail (BREAKOUT or PIN alone). Pure. */
export function isSingleRailWithoutFlow(origins: readonly string[] | null | undefined): boolean {
  const set = Array.isArray(origins) ? origins : [];
  if (set.includes("FLOW")) return false;
  return set.length === 1 && (set[0] === "BREAKOUT" || set[0] === "PIN");
}

export type ZeroDteGateBlock = {
  /** Machine-readable code — same namespace as the evidence gates' gate_failed. */
  code: ZeroDteGateFailure;
  /** Human sentence the SKIP card renders verbatim. */
  reason: string;
  /** Numeric threshold the candidate was measured against (null when structural). */
  threshold: number | null;
  /** "HH:MM ET" when the block self-expires on the clock (G-2), else null. */
  unlock_et: string | null;
};

export type ZeroDteGateVerdict = {
  verdict: "COMMIT" | "BLOCKED";
  /** Every hard gate that failed — ALL of them, not just the first, so the SKIP
   *  card can say "tape + window" instead of hiding the second reason. */
  blocks: ZeroDteGateBlock[];
  /** G-4/G-6 calibration verdict (logged on every evaluation, pinned to the ledger
   *  row on commit; NEVER blocks while in calibration mode). */
  calibration: ZeroDteGateCalibration;
};

export type ZeroDteGateInput = {
  ticker: string;
  direction: "long" | "short";
  /** Play STRUCTURE (Phase 4). Absent/DIRECTIONAL → the full directional stack (unchanged). CONDOR →
   *  the delta-neutral branch: G-1 / G-10 / G-12 / G-6 (all directional) are SKIPPED, the directional
   *  plan-quality (G-8/G-9) is replaced by the condor liquidity gate, G-4 VIX blocks harder (a condor
   *  wants low vol), and G-7 macro blocks the whole session (a release is a condor's worst case). */
  play_type?: PlayType;
  /** The priced condor structure (condor.ts) — required for a CONDOR play_type's liquidity + range
   *  gates. Null on a condor → condor_liquidity fails closed (no sellable structure). Ignored for a
   *  DIRECTIONAL setup (which uses `plan` instead). */
  condorPlan?: CondorPlan | null;
  /** Post-edge-layer score (after intraday/market/time-of-day adjusts). */
  score: number;
  /** Discovery origin set — G-3 uses {@link scoreFloorForOrigins} so BREAKOUT/PIN are not
   *  judged by the FLOW print-evidence floor. Absent → strict ZERODTE_SCORE_FLOOR. */
  discovery_origin?: readonly string[] | null;
  /** ET minutes since midnight at evaluation time. */
  nowEtMinutes: number;
  /** Wall clock at evaluation time (staleness math). */
  nowMs: number;
  /** SPY/desk session bias (marketBias over the SPY intraday read); null = unknown. */
  bias: MarketBias | null;
  /** Epoch-ms of the newest SPY bar behind `bias` (IntradayRead.last_bar_ms). */
  biasAsOfMs: number | null;
  /** G-5 session state (./governor.ts). Null = state unreadable → fail closed. */
  governor: GovernorSnapshot | null;
  /** Fresh commits already accepted earlier in this same scan cycle — feeds the
   *  governor's concurrency cap + correlated-conflict check so one cycle can't
   *  overshoot the cap or commit correlated-but-opposed plans together. */
  committedThisCycle?: GovernorOpenPlan[];
  /** Phase 2c — aggregate entry premium across open plans (governor premium budget). */
  governorPremiumAtRisk?: number;
  /** Phase 2c — open short-gamma play count (governor gamma budget). */
  governorShortGammaOpen?: number;
  /** Dealer gamma regime for the name (dossier) — governor gamma budget candidate check. */
  gamma_regime?: string | null;
  /** Day-open VIX (Polygon I:VIX daily bar open). Null = value not supplied to the gate —
   *  the G-4 regime throttle only fires on a present value, never guesses. To fail a fresh
   *  commit CLOSED on an unavailable VIX, set `vixUnavailable` (below) as well. */
  vixDayOpen?: number | null;
  /** Phase-0 firewall: TRUE only when scan.ts ATTEMPTED the day-open VIX read and it came
   *  back unavailable (timeout / no bar). Distinct from a caller that simply omits VIX:
   *  those pass `undefined` here and are never blocked. When true (and G4 fail-closed is
   *  enabled), G-4 holds a fresh commit closed IF a present VIX could have blocked it. */
  vixUnavailable?: boolean;
  /** SPX Slayer's live open play today (direction only). Null = none/unreadable. */
  slayerLive?: { direction: "long" | "short" } | null;
  /** Night Hawk's most recent take on THIS ticker (recency-filtered upstream). */
  nighthawkTake?: { direction: "long" | "short"; edition_for: string } | null;
  /** G-7: today's macro calendar (CPI/FOMC/NFP windows — shared with Slayer). An empty
   *  array means "fetched, zero events" (safe); a FAILED fetch is signalled separately via
   *  `macroUnavailable` (below), never conflated with zero events. */
  macroEvents?: MacroEventLike[];
  /** Phase-0 firewall: TRUE only when the macro-calendar FETCH itself failed (not merely
   *  "no events today"). When true (and G7 fail-closed is enabled), G-7 holds a fresh
   *  commit closed — a blind macro read can't rule out a CPI/FOMC/NFP window. */
  macroUnavailable?: boolean;
  /** G-8/G-9: contract plan from attachContractPlans (null = no quote + no fill). */
  plan?: ContractPlan | null;
  /** Thesis-first live path: plan is attached AFTER gates — skip G-8/G-9 here and call
   *  refreshPlanQualityGateBlocks once attachContractPlans has run. */
  deferPlanQualityGates?: boolean;
  /** G-15: selected contract horizon (`ZERO_DTE` | `ONE_DTE` | `WEEKLY_FALLBACK`). Absent →
   *  gate no-op (legacy callers/tests). When present and not `ZERO_DTE`, fresh commits are blocked
   *  so the 0DTE board never grades a tomorrow-expiry as a same-session scalp. */
  contractHorizon?: "ZERO_DTE" | "ONE_DTE" | "WEEKLY_FALLBACK" | null;
  /** G-10: name's own VWAP/5m trend opposes the play (intraday.ts). */
  intradayConflict?: boolean;
  /** G-11: UW trading halt on the underlying. */
  halted?: boolean;
  /** Phase-0 firewall (D2): TRUE only when the trading-halt FEED is cold — BOTH the UW and LULD
   *  halt sources read stale (isTradingHaltChannelStale, uw-socket.ts). Distinct from `halted`
   *  (an ACTIVE stored halt), which always blocks. A cold feed can't rule out a halted underlying,
   *  so when true (and G11-halt fail-closed is enabled) G-11 holds a fresh commit closed rather
   *  than commit into a possible halt on a blind feed. Mirrors `earningsUnavailable`. */
  haltFeedStale?: boolean;
  /** G-11: reports today or next session. */
  earnings?: EarningsFlag | null;
  /** Phase-0 firewall: TRUE only when scan.ts ATTEMPTED the market-wide earnings read and it
   *  FAILED (within() timeout, readGridEarnings() returned its typed null, or the fetch threw).
   *  Distinct from a SUCCESSFUL read that finds no reporter among the candidates — that leaves
   *  `earnings` null with this UNSET and commits normally. When true (and G11 fail-closed is
   *  enabled), G-11 holds a fresh commit closed rather than trade into a possible print on a
   *  blind earnings feed. Mirrors `vixUnavailable`/`macroUnavailable`. */
  earningsUnavailable?: boolean;
  /** Session date (yyyy-mm-dd) for G-7 macro window math. */
  todayYmd?: string;
  /** G-12: the setup's confluence read (confluence.ts), attached by the scan BEFORE gating.
   *  Null/undefined = no read available → G-12 fails OPEN (never manufactures a block from an
   *  unmeasured factor; the live scan always supplies one). */
  confluence?: ZeroDteConfluence | null;
  /** WS-21 source-recovery gate. DEFAULT-OFF: the scan passes
   *  requireHealthySourceEnabled() (ZERODTE_REQUIRE_HEALTHY_SOURCE=1). When false/undefined the
   *  gate is a NO-OP and the existing freshness thresholds still govern — commit behavior is
   *  byte-for-byte unchanged. When true, a fresh commit is withheld unless `sourceHealth` is
   *  HEALTHY (the WS source has reconnected, reconciled its gap, and warmed). */
  requireHealthySource?: boolean;
  /** WS-21: the live WS source health state (ws/source-health.ts). Only consulted when
   *  `requireHealthySource` is true; null/undefined → the gate never fires. */
  sourceHealth?: SourceHealthState | null;
  /** G-13: multi-day flow accumulation alignment. `false` = opposing stacked positioning. */
  flowAccumulationAligned?: boolean | null;
  /** Regime Plane: block fresh commits when regime inputs are blind. */
  regimeBlockFreshCommits?: boolean;
  regimeBlockReason?: string | null;
};

/**
 * Evaluate the hard gate stack for ONE fresh (not-yet-committed) setup.
 * Deterministic: same inputs, same verdict. Collects every failing gate.
 */
export function evaluateZeroDteGates(input: ZeroDteGateInput): ZeroDteGateVerdict {
  const blocks: ZeroDteGateBlock[] = [];

  // Phase 4: a CONDOR is delta-neutral order structure, so the DIRECTIONAL gates must not misfire on
  // it. This one flag routes every direction-specific gate below. See each gate's condor note; the
  // condor-specific gates (liquidity / VIX-harder / macro-harder / range-intact) are added in the
  // `isCondor` block after the shared gates. Unknown/absent play_type is DIRECTIONAL (unchanged).
  const isCondor = input.play_type === "CONDOR";

  // Regime Plane — universal fail-closed ONLY for halt-feed + empty GEX (no per-ticker nuance).
  // VIX/macro blindness is handled per-candidate by G-4/G-7 with couldBlock narrowing —
  // do NOT duplicate a board-emptying kill switch here (stack audit 2026-08-04).
  if (input.regimeBlockFreshCommits) {
    blocks.push({
      code: "regime_blind",
      reason:
        input.regimeBlockReason ??
        "Regime inputs unreadable — fresh commits fail closed until VIX, macro, halt feed, and GEX recover.",
      threshold: null,
      unlock_et: null,
    });
  }

  // G-1 — tape alignment. DIRECTIONAL ONLY, INDEX ETFs ONLY: a condor has no direction to fight
  // the tape, and single-name stocks move on their own catalysts (earnings, news, sector rotation)
  // independently of SPY direction — forcing tape alignment on them kills real opportunities.
  // Index ETFs (SPY/QQQ/IWM/DIA/SPX etc.) are highly correlated with the SPY tape, so
  // counter-tape entries on those are genuinely dangerous (7/13 evidence: counter-tape longs
  // went 0/5 at the stop). Single names bypass G-1 entirely.
  const isIndexEtfG1 = INDEX_ETF_TICKERS.has(input.ticker.toUpperCase());
  if (!isCondor && isIndexEtfG1) {
    const biasStale =
      input.biasAsOfMs == null || input.nowMs - input.biasAsOfMs > MARKET_BIAS_MAX_AGE_MS;
    if (input.bias == null || biasStale) {
      blocks.push({
        code: "no_market_bias",
        reason:
          "Market tape read unavailable or stale — index ETF commits fail closed until the SPY bias is readable again.",
        threshold: null,
        unlock_et: null,
      });
    } else if (input.bias !== "flat" && (input.bias === "up") !== (input.direction === "long")) {
      blocks.push({
        code: "tape_alignment",
        reason:
          `${input.direction === "long" ? "Long" : "Short"} index setup fights the ${input.bias.toUpperCase()} market tape — ` +
          "counter-tape 0DTE entries on index ETFs are blocked (7/13 evidence: counter-tape longs went 0/5 at the stop).",
        threshold: null,
        unlock_et: null,
      });
    }
  }

  // G-2 — opening window (block the worst first 30 min, unlock 10:00 ET — user-authorized
  // 2026-07-23, see the constant's doc). Clock-based, so the block self-expires: the card
  // carries the unlock time and the next scan cycle at/after 10:00 re-evaluates cleanly.
  if (input.nowEtMinutes < OPENING_WINDOW_UNLOCK_ET_MINUTES) {
    blocks.push({
      code: "opening_window",
      reason:
        `No new 0DTE commits before ${OPENING_WINDOW_UNLOCK_LABEL} — the opening drive is still ` +
        "resolving (entries here backtest worst by expectancy). " +
        `Watching; commits unlock at ${OPENING_WINDOW_UNLOCK_LABEL} if the setup is still live.`,
      threshold: OPENING_WINDOW_UNLOCK_ET_MINUTES,
      unlock_et: OPENING_WINDOW_UNLOCK_LABEL,
    });
  }

  // G-14 — late-afternoon block. DIRECTIONAL ONLY: a condor is a credit seller that
  // BENEFITS from late-session theta crush; the late window is only destructive for
  // long-premium entries. Evidence: 14:00-15:30 = 14.3% WR / −19.02% avg P&L (90d prod).
  if (!isCondor && input.nowEtMinutes >= LATE_AFTERNOON_BLOCK_ET_MINUTES) {
    blocks.push({
      code: "late_afternoon",
      reason:
        `No new directional 0DTE commits after ${LATE_AFTERNOON_BLOCK_LABEL} — the ` +
        "late-afternoon bucket ran 14.3% WR / −19% avg premium (90-day prod record). " +
        "With <1.5 hours of theta left, long-premium entries face accelerating decay " +
        "and almost never reach target.",
      threshold: LATE_AFTERNOON_BLOCK_ET_MINUTES,
      unlock_et: null,
    });
  }

  // G-15 REMOVED (2026-07-29). ONE_DTE is a same-day horizon (isSameDayHorizon returns true),
  // the persist layer accepts it, and grading reports accurate same-day P&L. Blocking 1DTE
  // starved the board on Mondays (most equities have no Monday 0DTE — only SPX/SPY/QQQ do).
  // WEEKLY_FALLBACK (dte≥2) is still dropped by the persist layer's isSameDayHorizon guard.

  // G-3 — score floor, judged on the FINAL post-edge-layer score. Origin-aware: FLOW keeps 65;
  // BREAKOUT/PIN use the looser rail floors (see scoreFloorForOrigins).
  const scoreFloor = scoreFloorForOrigins(input.discovery_origin);
  if (input.score < scoreFloor) {
    blocks.push({
      code: "score_floor",
      reason:
        `Score ${Math.round(input.score)} is below the ${scoreFloor} commit floor` +
        (scoreFloor === ZERODTE_SCORE_FLOOR
          ? " — the <55 band ran 20% WR / −23% avg premium on this engine's own calibration, " +
            "under the 33% breakeven of the −50/+100 payoff."
          : ` for ${(input.discovery_origin ?? []).join("+") || "non-FLOW"} origin ` +
            `(all rails share the ${ZERODTE_SCORE_FLOOR} floor — the 55-64 band is near-flat EV).`),
      threshold: scoreFloor,
      unlock_et: null,
    });
  }

  // G-17 — single-rail corroboration (BREAKOUT-only / PIN-only). Whole-market rails without a
  // FLOW print must clear the prime band — the 65-74 bucket is positive EV for FLOW-backed
  // setups but today's BREAKOUT-only commits clustered there with no independent confirmation.
  if (
    !isCondor &&
    isSingleRailWithoutFlow(input.discovery_origin) &&
    input.score < ZERODTE_SINGLE_RAIL_PRIME_MIN
  ) {
    const rail = (input.discovery_origin ?? [])[0] ?? "whole-market";
    blocks.push({
      code: "single_rail_corroboration",
      reason:
        `${rail}-only setup scored ${Math.round(input.score)} — needs ≥${ZERODTE_SINGLE_RAIL_PRIME_MIN} ` +
        "without a FLOW corroborating print (prime band ran 63.6% WR vs 50% at 65-74). " +
        "Multi-rail FLOW+BREAKOUT/PIN may commit at the 65 floor.",
      threshold: ZERODTE_SINGLE_RAIL_PRIME_MIN,
      unlock_et: null,
    });
  }

  // G-12 — confluence floor (Phase 1, 2026-07-24). DIRECTIONAL ONLY: confluence counts how many of
  // {VWAP-side, market-aligned} agree with the setup's DIRECTION — a delta-neutral condor has no
  // direction to confirm, so this gate does not apply to it (the sell-regime router + range-intact
  // check are the condor's equivalent "is the structure right" test).
  if (!isCondor && input.confluence != null) {
    const floor = g12ConfluenceFloor(input.ticker, input.nowEtMinutes);
    const have = g12ConfirmationCount(input.confluence, input.ticker);
    const legLabel = g12ConfirmationLegLabel(input.ticker);
    if (have < floor) {
      const early = floor > ZERODTE_CONFLUENCE_MIN;
      blocks.push({
        code: "confluence_floor",
        reason:
          `Only ${have} of the needed ${floor} confluence confirmations ` +
          `(${legLabel}) agree with this ${input.direction} — ` +
          (early
            ? `the ${OPENING_WINDOW_UNLOCK_LABEL}–10:45 early window backtests negative (E2), so it takes the full VWAP+market double to commit here.`
            : "the 0-confirmation bucket ran −12.5% EV (E3, 25 sessions); a loud premium print alone isn't a trade."),
        threshold: floor,
        unlock_et: null,
      });
    }
  } else if (!isCondor && input.confluence == null) {
    // G-12 fail-open: no confluence read attached — not a block (see module doc), but
    // track how often this happens so a rising count signals scan.ts stopped attaching reads.
    _nullConfluencePassCount++;
  }

  // G-13 — multi-day flow accumulation direction conflict (aligned === false).
  if (
    !isCondor &&
    ZERODTE_BLOCK_ACCUM_MISALIGN &&
    input.flowAccumulationAligned === false
  ) {
    blocks.push({
      code: "flow_accumulation_conflict",
      reason:
        "Multi-day options flow accumulation opposes this setup's direction — " +
        `the stacked positioning read disagrees with the ${input.ticker}-${input.direction} commit.`,
      threshold: null,
      unlock_et: null,
    });
  }

  // G-4 — VIX regime hard gate (promoted from calibration 2026-07-16).
  // F-1: 69.2% WR at VIX<17 vs 25.0% at ≥17 — the strongest measured factor.
  // G-1 already enforces tape alignment; G-4 raises the score floor at elevated VIX
  // and blocks single names outright at extreme VIX.
  const vix = input.vixDayOpen ?? null;
  if (isCondor) {
    // ── G-4 for a CONDOR — block at EXTREME VIX only (≥20), not elevated (17-20).
    // A condor SELLS premium into a range. At VIX 17-20 on a flat/range-bound tape,
    // elevated VIX means FATTER premiums collected while the range holds — that's the
    // condor's best regime. The condor-WR backtest (condor-wr.mjs) showed 98.7% WR
    // on shipped geometry across SPY/QQQ/IWM including VIX 17-20 sessions. The old
    // threshold (17) borrowed the F-1 directional evidence (69% vs 25% WR) which
    // measures single-leg directional plays, not delta-neutral sold ranges. At VIX ≥20
    // (extreme), the vol expansion risk genuinely threatens range integrity, so condors
    // are still blocked there. Unavailable VIX still fails closed unconditionally.
    if (vix != null && vix >= VIX_EXTREME_THRESHOLD) {
      const vixR = Math.round(vix * 100) / 100;
      blocks.push({
        code: "condor_vix_regime",
        reason:
          `VIX ${vixR} ≥ ${VIX_EXTREME_THRESHOLD} — extreme vol regime threatens range integrity; ` +
          "condor sale blocked (condor G-4).",
        threshold: VIX_EXTREME_THRESHOLD,
        unlock_et: null,
      });
    } else if (vix == null && input.vixUnavailable === true && G4_VIX_FAIL_CLOSED_ENABLED) {
      blocks.push({
        code: "condor_vix_regime",
        reason:
          "Day-open VIX unavailable (provider timeout) — a condor cannot be sold blind to the vol " +
          "regime it is short; fails closed until VIX is readable (condor G-4 fail-closed).",
        threshold: null,
        unlock_et: null,
      });
    }
  } else if (vix != null) {
    // Round for display in the SKIP-card reason strings + the persisted gate_calibration_json — the raw
    // provider value can be a 17.34000000001-style float (repo-wide "round at the data layer" rule). The
    // threshold COMPARISONS below still use the raw `vix` (rounding is display-only).
    const vixR = Math.round(vix * 100) / 100;
    const tickerUp = input.ticker.toUpperCase();
    if (vix >= VIX_EXTREME_THRESHOLD) {
      if (!INDEX_ETF_TICKERS.has(tickerUp)) {
        blocks.push({
          code: "vix_extreme",
          reason:
            `VIX ${vixR} ≥ ${VIX_EXTREME_THRESHOLD} — single-name 0DTE blocked in extreme-vol regime. ` +
            "Only index/ETF products survive at this volatility.",
          threshold: VIX_EXTREME_THRESHOLD,
          unlock_et: null,
        });
      }
    } else if (vix >= VIX_ELEVATED_THRESHOLD) {
      // G-1 already hard-blocks counter-tape entries — but ONLY for index ETFs (isIndexEtfG1
      // above); single names bypass G-1 entirely and move on their own catalysts, independently
      // of SPY direction. This branch must mirror that same scoping: a single name's `bias`
      // vs `direction` comparison means nothing about ITS OWN tape, only SPY's — so judging a
      // single name against the tape here re-imposes exactly the constraint G-1 was written to
      // exempt it from. Found 2026-08-26: a single-name long at VIX 18 with a disagreeing SPY
      // tape was silently held to the stricter 75 floor though nothing in the design intends
      // single names to be judged against SPY direction at all. Non-index/ETF tickers therefore
      // always get the standard 65 floor here, exactly as if tape-aligned/flat, regardless of
      // `input.bias` — the F-1 69% vs 25% WR evidence backing the 75 floor was never measured
      // as a single-name-vs-SPY-tape effect, and G-1's own comment already establishes that
      // relationship holds for index ETFs only.
      //
      // For index ETFs: the 75 floor only applies to the residual unknown-tape case (bias ==
      // null / stale — G-1's no_market_bias already blocked these, so 75 here is
      // belt-and-suspenders if G-1 is ever disabled via ZERODTE_GATE_DISABLE). FLAT tape: no
      // directional fight with the market, so it keeps the standard 65 floor — the same
      // treatment as tape-aligned (see prior fix note: treating flat as non-aligned produced
      // zero-commit sessions on choppy/range-bound VIX 17-20 days, the most common regime).
      const tapeAlignedOrFlat =
        !isIndexEtfG1 ||
        (input.bias != null &&
          (input.bias === "flat" || (input.bias === "up") === (input.direction === "long")));
      const elevatedFloor = tapeAlignedOrFlat ? ZERODTE_SCORE_FLOOR : VIX_ELEVATED_SCORE_FLOOR;
      if (input.score < elevatedFloor) {
        blocks.push({
          code: "vix_elevated",
          reason: tapeAlignedOrFlat
            ? `VIX ${vixR} in the elevated regime (≥${VIX_ELEVATED_THRESHOLD}) — tape-aligned score ${Math.round(input.score)} needs ≥${elevatedFloor} to commit (standard floor when G-1 clears).`
            : `VIX ${vixR} in the elevated regime (≥${VIX_ELEVATED_THRESHOLD}) — score ${Math.round(input.score)} ` +
              `needs ≥${VIX_ELEVATED_SCORE_FLOOR} to commit. The 17-20 VIX regime ran 25% WR vs 69% below 17 (F-1).`,
          threshold: elevatedFloor,
          unlock_et: null,
        });
      }
    }
  } else if (input.vixUnavailable === true && G4_VIX_FAIL_CLOSED_ENABLED) {
    // ── G-4 FRESH-COMMIT FAIL-CLOSED (Phase-0 firewall) ──────────────────────────────
    // The day-open VIX read was ATTEMPTED (scan.ts's best-effort within(...,2500ms)) but
    // came back unavailable. Previously a null VIX meant "no G-4 verdict" — a free pass —
    // so on exactly the volatile days the VIX provider is most likely to time out, the
    // regime throttle silently switched off. Fail closed, BUT only when a present VIX
    // could actually have blocked THIS candidate, so a routine VIX blip never empties the
    // board:
    //   • non-index/ETF single name → a present VIX ≥ 20 would block it outright (extreme
    //     regime, index/ETF only) → could-block = true;
    //   • index/ETF → extreme never blocks it, and elevated (17–20) only blocks below its
    //     floor: 65 when tape-aligned (G-3 already guarantees ≥65), else 75. So a present
    //     VIX could only have blocked an index/ETF that is NOT tape-aligned and sits below
    //     the 75 elevated floor. A tape-aligned index/ETF (or one already ≥75) clears any
    //     VIX regime → NOT blocked here (no spurious empty).
    const tickerUp = input.ticker.toUpperCase();
    const isIndexEtf = INDEX_ETF_TICKERS.has(tickerUp);
    // Mirror the G-4 elevated logic: flat tape is treated as aligned (standard 65 floor).
    const tapeAlignedOrFlat =
      input.bias != null &&
      (input.bias === "flat" || (input.bias === "up") === (input.direction === "long"));
    const couldBlock = !isIndexEtf || (!tapeAlignedOrFlat && input.score < VIX_ELEVATED_SCORE_FLOOR);
    if (couldBlock) {
      blocks.push({
        code: "vix_unavailable",
        reason:
          "Day-open VIX read unavailable (provider timeout) — a fresh 0DTE commit that a " +
          "present VIX could have thrown out on regime fails closed until VIX is readable " +
          "again, rather than trade the vol regime blind (G-4 fail-closed).",
        threshold: null,
        unlock_et: null,
      });
    }
  }

  // G-7 — macro hard-block. For a CONDOR it blocks HARDER: the directional path only avoids the
  // ±window around the release (a directional bet just sidesteps the print minute), but a condor is
  // SHORT vol on a defined-loss structure — a CPI/FOMC/NFP breakout is its single worst outcome — so
  // ANY high-impact release scheduled today holds the sale for the WHOLE session, plus the same
  // fail-closed on an unreadable calendar.
  if (isCondor) {
    if (
      input.todayYmd &&
      (input.macroEvents?.length ?? 0) > 0 &&
      hasHighImpactMacroEvent(input.macroEvents!)
    ) {
      blocks.push({
        code: "condor_macro_block",
        reason:
          "High-impact macro release today (CPI/FOMC/NFP/PPI/GDP) — a condor is short vol into the " +
          "exact event that breaks its range; the sale is held for the whole session (condor G-7).",
        threshold: null,
        unlock_et: null,
      });
    } else if (input.macroUnavailable === true && G7_MACRO_FAIL_CLOSED_ENABLED) {
      blocks.push({
        code: "condor_macro_block",
        reason:
          "Macro calendar unavailable (fetch failed) — a condor cannot be sold blind to a possible " +
          "CPI/FOMC/NFP release; fails closed for the session (condor G-7 fail-closed).",
        threshold: null,
        unlock_et: null,
      });
    }
  } else if (input.todayYmd && (input.macroEvents?.length ?? 0) > 0) {
    const macro = evaluateMacroHardBlock(input.macroEvents!, input.nowEtMinutes, input.todayYmd);
    if (macro.blocked) {
      blocks.push({
        code: "macro_hard_block",
        reason: macro.reason ?? "Macro release window — no new 0DTE commits.",
        threshold: null,
        unlock_et: null,
      });
    }
  } else if (input.macroUnavailable === true && G7_MACRO_FAIL_CLOSED_ENABLED) {
    // ── G-7 FRESH-COMMIT FAIL-CLOSED (Phase-0 firewall) ──────────────────────────────
    // The macro-calendar FETCH failed (scan.ts distinguishes this from "fetched, zero
    // events" — only a genuine fetch failure sets macroUnavailable). Previously a failed
    // fetch silently disabled the CPI/FOMC/NFP hard-block, so the desk could open a fresh
    // 0DTE straight into a macro release it simply couldn't see. Fail closed: HOLD fresh
    // commits until the calendar is readable. (Zero-events days never reach here — the
    // first branch already ran with an empty array and found nothing to block.)
    blocks.push({
      code: "macro_unavailable",
      reason:
        "Macro calendar unavailable (fetch failed) — new 0DTE commits fail closed rather " +
        "than open blind into a possible CPI/FOMC/NFP release window (G-7 fail-closed).",
      threshold: null,
      unlock_et: null,
    });
  }

  if (isCondor) {
    // ── CONDOR liquidity + range gates — the SELL-side replacement for the directional G-8/G-9/G-10.
    // A condor is neutral, so no-chase (G-8) and single-leg spread (G-9) and VWAP/5m conflict (G-10)
    // don't apply. Instead: (1) all four legs must be quotable, the net credit must clear the wing-
    // risk floor, and the per-leg spread tax must be bounded (condor_liquidity, condor.ts); and (2)
    // the defended range must still be intact — if spot has crept up to a short strike, HOLD the sale
    // (condor_range_break, the cheap Cortex-gex-walls proxy — see condor.ts / the deferred follow-up).
    for (const b of condorLiquidityGateBlocks(input.condorPlan ?? null)) {
      blocks.push({ code: b.code, reason: b.reason, threshold: b.threshold, unlock_et: null });
    }
    if (input.condorPlan != null && condorRangeBreaking(input.condorPlan.spot, input.condorPlan)) {
      blocks.push({
        code: "condor_range_break",
        reason:
          "Spot has approached or breached a short strike — the dealer-defended range is failing, so a " +
          "fresh condor is held rather than sold into an eroding range (condor range-intact).",
        threshold: null,
        unlock_et: null,
      });
    }
  } else if (!input.deferPlanQualityGates) {
    // G-8/G-9 — plan quality: no chase (MOVED), no untradeable spread (illiquid), no
    // plan without a real quote or fill. UI SKIP already hid these; persist must match.
    blocks.push(...planQualityGateBlocks(input.plan ?? null));

    // G-10 — intraday structure conflict: DEMOTED back to score-only (2026-07-27).
    // Evidence: flow precedes trend changes, and the hard block (promoted 2026-07-18) was
    // killing valid plays where flow correctly led a reversal. The score penalty already
    // exists via adj.delta in scan.ts (computeIntradayEdge), so the signal still weighs
    // against commitment — it just can't single-handedly empty the board anymore.
    // The intradayConflict field is still set and surfaced in the UI for audit/display.
  }

  // G-11 — halt + earnings: different risk profile than a normal 0DTE scalp.
  if (input.halted === true) {
    blocks.push({
      code: "halted",
      reason: "Underlying is halted — no new 0DTE commits until trading resumes.",
      threshold: null,
      unlock_et: null,
    });
  } else if (input.haltFeedStale === true && G11_HALT_FAIL_CLOSED_ENABLED) {
    // ── G-11 HALT-FEED FAIL-CLOSED (Phase-0 firewall, D2) ────────────────────────────────
    // No ACTIVE stored halt, but the halt FEED itself is cold: BOTH the UW and LULD halt
    // sources read stale (isTradingHaltChannelStale, uw-socket.ts). scan.ts previously read
    // the board's halt with failClosedOnStale:false, so a dark/dead halt socket (post-deploy,
    // or died mid-session) left the store empty and a HALTED underlying could commit a fresh
    // 0DTE — the exact market-open danger. An empty halt store on a cold feed is NOT "no halts";
    // it's "we can't see halts." Fail closed: HOLD fresh commits until the halt channel recovers.
    // A distinct code (not `halted`) keeps observability honest — a stale FEED is a data-plane
    // outage, not a live halt on this name. Direction-agnostic → applies to BOTH lanes exactly
    // like the active-halt block above. (staleness is only ever set true on a genuine full-socket
    // + LULD outage — a healthy socket streaming flow/price/tide reads FRESH via the cross-channel
    // freshest-message proxy, so this does NOT starve the board on a normal quiet-halt session.)
    blocks.push({
      code: "halt_feed_stale",
      reason:
        "Trading-halt feed cold (UW + LULD halt sources stale) — a fresh 0DTE commit fails " +
        "closed rather than trade blind past a possible halt, since an empty halt store on a " +
        "dead feed is not the same as \"no halts\" (G-11 fail-closed).",
      threshold: null,
      unlock_et: null,
    });
  }
  if (input.earnings != null) {
    const when =
      input.earnings.when === "premarket" ? "premarket today" : "afterhours today/next";
    blocks.push({
      code: "earnings",
      reason: `Earnings ${when} (${input.earnings.report_date ?? "today"}) — 0DTE into a print is a different trade.`,
      threshold: null,
      unlock_et: null,
    });
  } else if (input.earningsUnavailable === true && G11_EARNINGS_FAIL_CLOSED_ENABLED) {
    // ── G-11 FRESH-COMMIT FAIL-CLOSED (Phase-0 firewall, D1) ─────────────────────────────
    // The market-wide earnings FEED read failed (scan.ts distinguishes this from "read
    // succeeded, none report today" — only a within() timeout / readGridEarnings() null /
    // thrown fetch sets earningsUnavailable). Previously a failed read yielded an empty map,
    // so every candidate had earnings == null and this gate found nothing to block — the desk
    // could open a fresh 0DTE straight into a name printing earnings today on a feed it simply
    // couldn't see. Fail closed: HOLD fresh commits until the earnings feed is readable.
    // Applies to BOTH lanes (directional and condor) exactly like the present-and-reporting
    // block above — earnings risk is direction-agnostic, so no couldBlock narrowing. (A
    // successful "none today" read never reaches here — earnings is null AND unavailable unset.)
    blocks.push({
      code: "earnings_unavailable",
      reason:
        "Earnings feed unavailable (read failed) — a fresh 0DTE commit fails closed rather than " +
        "trade blind into a possible earnings print today, since a failed feed read is not the " +
        "same as \"no earnings\" (G-11 fail-closed).",
      threshold: null,
      unlock_et: null,
    });
  }

  // G-5 — session governor (./governor.ts). Unreadable state fails closed: a desk
  // that can't count its own open risk doesn't add more.
  if (input.governor == null) {
    blocks.push({
      code: "gate_context_unavailable",
      reason: "Session governor state could not be read — new commits fail closed.",
      threshold: null,
      unlock_et: null,
    });
  } else {
    blocks.push(
      ...evaluateZeroDteGovernor(
        {
          ticker: input.ticker,
          direction: input.direction,
          entry_premium: input.plan?.entry_max ?? input.plan?.mark ?? null,
          gamma_regime: input.gamma_regime ?? null,
        },
        input.governor,
        input.nowMs,
        input.committedThisCycle ?? [],
        {
          etMinutes: input.nowEtMinutes,
          premiumAtRisk: input.governorPremiumAtRisk,
          shortGammaOpen: input.governorShortGammaOpen,
        }
      )
    );
  }

  // G-6 — cross-system conflict hard gate (promoted from calibration 2026-07-16).
  // A 0DTE entry opposing a live Slayer play or Night Hawk take on a correlated
  // ticker needs score ≥ 80 to override the desk disagreement. DIRECTIONAL ONLY: a
  // condor is delta-neutral, so it can't "oppose" another desk's directional take —
  // there is no side to conflict with.
  if (!isCondor) {
    const tickerUp = input.ticker.toUpperCase();
    const conflictSources: string[] = [];
    if (
      input.slayerLive != null &&
      SPX_CORRELATED_TICKERS.has(tickerUp) &&
      input.slayerLive.direction !== input.direction
    ) {
      conflictSources.push(`live SPX Slayer ${input.slayerLive.direction}`);
    }
    if (input.nighthawkTake != null && input.nighthawkTake.direction !== input.direction) {
      conflictSources.push(
        `Night Hawk ${input.nighthawkTake.direction} take (edition ${input.nighthawkTake.edition_for})`
      );
    }
    if (conflictSources.length > 0 && input.score < CONFLICT_SCORE_FLOOR) {
      blocks.push({
        code: "cross_system_conflict",
        reason:
          `${input.direction === "long" ? "Long" : "Short"} opposes ${conflictSources.join(" and ")} — ` +
          `score ${Math.round(input.score)} needs ≥${CONFLICT_SCORE_FLOOR} to override a cross-system conflict.`,
        threshold: CONFLICT_SCORE_FLOOR,
        unlock_et: null,
      });
    }
  }

  // WS-21 — source-recovery gate. DEFAULT-OFF: `requireHealthySource` is only true when
  // ZERODTE_REQUIRE_HEALTHY_SOURCE=1 (the scan passes requireHealthySourceEnabled()). When the flag
  // is off this branch never pushes a block — the existing freshness thresholds (G-1 tape staleness,
  // the flow-liveness heartbeat, the halt-channel staleness gate) still fully govern, so live commit
  // behavior is byte-for-byte unchanged. When ON, a fresh commit off a source that is still
  // recovering (OFFLINE/RECOVERING/CATCHING_UP/WARM — a reconnect gap that may not be reconciled) is
  // withheld until the source warms back to HEALTHY. Applies to directional AND condor structures:
  // both read the same recovering source.
  if (input.requireHealthySource && input.sourceHealth != null) {
    const auth = commitAuthorizedBySourceHealth({
      state: input.sourceHealth,
      requireHealthy: true,
    });
    if (!auth.authorized) {
      blocks.push({
        code: "source_recovering",
        reason:
          auth.reason ??
          "Data source recovering — new commits withheld until the source warms back to HEALTHY.",
        threshold: null,
        unlock_et: null,
      });
    }
  }

  return {
    verdict: blocks.length > 0 ? "BLOCKED" : "COMMIT",
    blocks,
    calibration: computeGateCalibration(input),
  };
}

/** G-8/G-9 plan-quality blocks — pure, unit-testable, reused by persist defense. */
export function planQualityGateBlocks(plan: ContractPlan | null): ZeroDteGateBlock[] {
  const blocks: ZeroDteGateBlock[] = [];
  if (plan == null) {
    blocks.push({
      code: "plan_no_quote",
      reason:
        "No live quote and no flow fill on the top strike — evidence only, no committable plan.",
      threshold: null,
      unlock_et: null,
    });
    return blocks;
  }
  if (plan.entry_status === "NO_QUOTE") {
    blocks.push({
      code: "plan_no_quote",
      reason: "No live quote on the contract — cannot print an entry plan.",
      threshold: null,
      unlock_et: null,
    });
  }
  if (plan.entry_status === "MOVED") {
    const pct = plan.vs_flow_pct != null ? `${Math.round(plan.vs_flow_pct)}%` : `≥${CHASE_PCT}%`;
    blocks.push({
      code: "plan_moved",
      reason:
        `Premium already ran ${pct} past the flow's fill — skip, don't chase (G-8).`,
      threshold: CHASE_PCT,
      unlock_et: null,
    });
  }
  if (plan.illiquid) {
    const spread = plan.spread_pct != null ? `${plan.spread_pct.toFixed(0)}%` : ">15%";
    blocks.push({
      code: "plan_illiquid",
      reason:
        `Bid/ask spread is ${spread} of the mark — market too thin for a 0DTE scalp (G-9).`,
      threshold: 15,
      unlock_et: null,
    });
  }
  // WS-04: translate the plan's fail-closed malformed-quote verdict into a DISTINCT
  // block. `stale` → plan_quote_stale (age beyond bound); every other reason →
  // plan_quote_invalid (a structurally malformed book). Null-guarded so a historical /
  // hand-built plan that predates the field (undefined) produces no new block — the
  // existing valid-quote path is unregressed. Additive: the legacy plan_illiquid /
  // plan_no_quote blocks above are untouched.
  if (plan.quote_invalid_reason != null) {
    if (plan.quote_invalid_reason === "stale") {
      blocks.push({
        code: "plan_quote_stale",
        reason:
          "Contract quote is stale (age beyond the freshness bound) — cannot commit off a stale book (G-9).",
        threshold: null,
        unlock_et: null,
      });
    } else {
      blocks.push({
        code: "plan_quote_invalid",
        reason: `${QUOTE_INVALID_SENTENCE[plan.quote_invalid_reason]} — malformed quote fails closed (G-9).`,
        threshold: null,
        unlock_et: null,
      });
    }
  }
  return blocks;
}

/** Human-readable sentence per malformed-quote reason (WS-04). Keyed by the
 *  QuoteInvalidReason values that map to plan_quote_invalid (stale is handled
 *  separately as plan_quote_stale). */
const QUOTE_INVALID_SENTENCE: Record<
  Exclude<NonNullable<ContractPlan["quote_invalid_reason"]>, "stale">,
  string
> = {
  zero_bid: "Contract has no real two-sided quote (zero/null bid or ask)",
  crossed: "Contract quote is crossed (bid > ask)",
  locked: "Contract quote is locked (bid == ask — zero-width book)",
  mark_out_of_band: "Contract mark sits outside its own bid/ask",
  wide_dollars: "Contract bid/ask dollar spread is over the cap",
  thin_size: "Contract resting quote size is below the floor",
};

const PLAN_QUALITY_GATE_CODES: ReadonlySet<ZeroDteGateFailure> = new Set([
  "plan_no_quote",
  "plan_moved",
  "plan_illiquid",
  "plan_quote_stale",
  "plan_quote_invalid",
]);

/** Re-apply G-8/G-9 after thesis-first deferred plan attach (scan.ts). */
export function refreshPlanQualityGateBlocks(
  gate: ZeroDteGateVerdict,
  plan: ContractPlan | null
): ZeroDteGateVerdict {
  const nonPlan = gate.blocks.filter((b) => !PLAN_QUALITY_GATE_CODES.has(b.code));
  const blocks = [...nonPlan, ...planQualityGateBlocks(plan)];
  return {
    ...gate,
    verdict: blocks.length > 0 ? "BLOCKED" : "COMMIT",
    blocks,
  };
}

/** Belt-and-suspenders: true when a fresh find must NOT write a ledger row. */
export function freshCommitBlockedByPlan(plan: ContractPlan | null | undefined): boolean {
  return planQualityGateBlocks(plan ?? null).length > 0;
}

/**
 * Re-apply the G-5 premium-budget check after thesis-first deferred plan attach (scan.ts),
 * mirroring refreshPlanQualityGateBlocks. G-5 (governor.ts's evaluateZeroDteGovernor) runs
 * INSIDE attachGateVerdicts with `entry_premium: input.plan?.entry_max ?? input.plan?.mark ?? null`
 * — under thesis-first, `input.plan` is still null at that point (contract plans attach
 * afterward), so the candidate's OWN contribution to the premium budget is permanently computed
 * as 0 for the life of that gate verdict, even once the real plan is attached. Currently dormant
 * in production (GOVERNOR_ENFORCE_PREMIUM_BUDGET defaults false — this is a MEASURE-only path
 * today), but the same "stale verdict never reconciled after deferred attach" shape as the
 * plan_no_quote bug (#2911) — found 2026-08-26 alongside it. If the flag is ever flipped on
 * without this refresh, every thesis-first commit would silently under-count its own premium
 * against the session cap.
 *
 * `gamma_regime` is NOT similarly stale — it comes from discovery/positioning data already on
 * the setup before gates ever run, not from the deferred plan, so G-5's gamma-budget check
 * (governor_gamma_budget) needs no refresh here.
 */
export function refreshGovernorPremiumBudgetBlocks(
  gate: ZeroDteGateVerdict,
  entryPremium: number | null,
  premiumAtRisk: number,
  /** Test-only override for GOVERNOR_ENFORCE_PREMIUM_BUDGET — the flag is read once at module
   *  load (envFlag), so a test cannot flip it at runtime. Production always uses the default
   *  (the real env-driven flag); only tests pass this explicitly. */
  enforce: boolean = GOVERNOR_ENFORCE_PREMIUM_BUDGET
): ZeroDteGateVerdict {
  const nonPremium = gate.blocks.filter((b) => b.code !== "governor_premium_budget");
  const premiumReason = premiumBudgetReason(premiumAtRisk + (entryPremium ?? 0));
  const blocks =
    enforce && premiumReason
      ? [
          ...nonPremium,
          {
            code: "governor_premium_budget" as const,
            reason: premiumReason
              .replace(" (MEASURE)", "")
              .replace(/Surfaced as calibration evidence.*/, "Blocked — premium budget exceeded."),
            threshold: GOVERNOR_MAX_PREMIUM_AT_RISK,
            unlock_et: null,
          },
        ]
      : nonPremium;
  return {
    ...gate,
    verdict: blocks.length > 0 ? "BLOCKED" : "COMMIT",
    blocks,
  };
}

/** "HH:MM" from ET minutes-since-midnight. */
function etLabel(etMinutes: number): string {
  const h = Math.floor(etMinutes / 60);
  const m = etMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * G-4 (VIX regime) + G-6 (cross-system conflict) — calibration RECORD (still
 * computed and pinned to every ledger row for ongoing measurement). The blocking
 * itself now lives in evaluateZeroDteGates above (promoted 2026-07-16); this
 * function produces the durable calibration columns that the record analysis
 * reads. Pure and deterministic.
 */
export function computeGateCalibration(input: ZeroDteGateInput): ZeroDteGateCalibration {
  const ticker = input.ticker.toUpperCase();
  // Flat tape = no directional opposition (same treatment as aligned in G-4). Single names are
  // scoped OUT of the SPY-tape comparison here, mirroring the live gate's own G-1 scoping
  // (INDEX_ETF_TICKERS-only) — a single name's bias-vs-direction comparison says nothing about
  // its own tape, only SPY's, so an ungated non-index/ETF ticker reads as unconditionally
  // "aligned" (found alongside the same bug in the live elevated-VIX gate, 2026-08-26).
  const aligned: boolean | null = !INDEX_ETF_TICKERS.has(ticker)
    ? true
    : input.bias == null
      ? null
      : input.bias === "flat"
        ? true
        : (input.bias === "up") === (input.direction === "long");

  // G-4 — VIX regime throttle verdict.
  const vix = input.vixDayOpen ?? null;
  // Display-rounded for the persisted calibration notes (raw `vix` still used for comparisons + day_open_vix).
  const vixR = vix == null ? null : Math.round(vix * 100) / 100;
  let g4: ZeroDteVixCalibration;
  if (vix == null) {
    g4 = {
      day_open_vix: null,
      tier: "unknown",
      would_block: false,
      would_halve_size: false,
      note: "Day-open VIX unavailable — no G-4 verdict recorded (never guessed).",
    };
  } else if (vix >= VIX_EXTREME_THRESHOLD) {
    const isIndexEtf = INDEX_ETF_TICKERS.has(ticker);
    g4 = {
      day_open_vix: vix,
      tier: "extreme",
      would_block: !isIndexEtf,
      would_halve_size: isIndexEtf,
      note: isIndexEtf
        ? `VIX ${vixR} ≥ ${VIX_EXTREME_THRESHOLD}: index/ETF product survives at HALF plan size under hardened G-4.`
        : `VIX ${vixR} ≥ ${VIX_EXTREME_THRESHOLD}: single names blocked under hardened G-4 (index/ETF only).`,
    };
  } else if (vix >= VIX_ELEVATED_THRESHOLD) {
    const elevatedFloor =
      aligned === true ? ZERODTE_SCORE_FLOOR : VIX_ELEVATED_SCORE_FLOOR;
    const clears = aligned === true ? input.score >= ZERODTE_SCORE_FLOOR : input.score >= VIX_ELEVATED_SCORE_FLOOR;
    g4 = {
      day_open_vix: vix,
      tier: "elevated",
      would_block: !clears,
      would_halve_size: false,
      note: clears
        ? aligned === true
          ? `VIX ${vixR} ≥ ${VIX_ELEVATED_THRESHOLD}: tape-aligned with score ≥ ${ZERODTE_SCORE_FLOOR} — clears hardened G-4.`
          : `VIX ${vixR} ≥ ${VIX_ELEVATED_THRESHOLD}: score ≥ ${VIX_ELEVATED_SCORE_FLOOR} — clears hardened G-4.`
        : aligned === true
          ? `VIX ${vixR} ≥ ${VIX_ELEVATED_THRESHOLD}: tape-aligned setups need score ≥ ${ZERODTE_SCORE_FLOOR} under hardened G-4.`
          : `VIX ${vixR} ≥ ${VIX_ELEVATED_THRESHOLD}: hardened G-4 needs tape alignment AND score ≥ ${VIX_ELEVATED_SCORE_FLOOR} (17-20 regime ran 25% WR vs 69% at 15-17).`,
    };
  } else {
    g4 = {
      day_open_vix: vix,
      tier: "normal",
      would_block: false,
      would_halve_size: false,
      note: `VIX ${vixR} < ${VIX_ELEVATED_THRESHOLD}: normal regime.`,
    };
  }

  // G-6 — cross-system conflict verdict.
  const against: Array<"spx_slayer" | "nighthawk_edition"> = [];
  if (
    input.slayerLive != null &&
    SPX_CORRELATED_TICKERS.has(ticker) &&
    input.slayerLive.direction !== input.direction
  ) {
    against.push("spx_slayer");
  }
  if (input.nighthawkTake != null && input.nighthawkTake.direction !== input.direction) {
    against.push("nighthawk_edition");
  }
  const conflict = against.length > 0;
  const g6: ZeroDteConflictCalibration = {
    conflict,
    against,
    would_block: conflict && input.score < CONFLICT_SCORE_FLOOR,
    note: conflict
      ? `CONFLICT: ${input.direction} opposes ${against
          .map((a) =>
            a === "spx_slayer"
              ? `the live SPX Slayer ${input.slayerLive!.direction}`
              : `Night Hawk's ${input.nighthawkTake!.direction} take (edition ${input.nighthawkTake!.edition_for})`
          )
          .join(" and ")} — hardened G-6 would require score ≥ ${CONFLICT_SCORE_FLOOR}.`
      : "No cross-system conflict.",
  };

  return {
    score_at_commit: Math.round(input.score),
    market_bias: input.bias,
    committed_at_et: etLabel(input.nowEtMinutes),
    g4_vix: g4,
    g6_conflict: g6,
  };
}

// ── G-6 input normalization ────────────────────────────────────────────────────────

/** How far back a Night Hawk take on a ticker still counts as "today's context".
 *  The 7/13 META conflict was against the 7/10 edition (3 calendar days) — the
 *  echo's most-recent-row-per-ticker can reach back arbitrarily far, and a
 *  two-week-old edition take is history, not a live desk position. */
export const NIGHTHAWK_TAKE_MAX_AGE_DAYS = 5;

/** Normalize a nighthawk_echo row into a G-6 input: recency-bounded, direction
 *  strictly long/short (anything else is not a directional take). Pure. */
export function recentNighthawkTake(
  echo: { direction: string; edition_for: string } | null | undefined,
  todayYmd: string
): { direction: "long" | "short"; edition_for: string } | null {
  if (!echo) return null;
  if (echo.direction !== "long" && echo.direction !== "short") return null;
  const editionMs = Date.parse(echo.edition_for);
  const todayMs = Date.parse(todayYmd);
  if (!Number.isFinite(editionMs) || !Number.isFinite(todayMs)) return null;
  const ageDays = (todayMs - editionMs) / 86_400_000;
  if (ageDays < 0 || ageDays > NIGHTHAWK_TAKE_MAX_AGE_DAYS) return null;
  return { direction: echo.direction, edition_for: echo.edition_for.slice(0, 10) };
}

// ── Rejection-row bridge ───────────────────────────────────────────────────────────
// One zerodte_scan_rejections row per blocked setup per cycle: gate_failed is the
// PRIMARY (first-evaluated) failing gate, reason concatenates every failing gate's
// sentence. Deliberately ONE row, not one per block — persistZeroDteRejections'
// per-ticker throttle keys on (gate_failed, direction), and two alternating codes
// for one steadily-blocked setup would defeat the throttle and spam a row per scan
// tick. The full block list still rides the live setup payload (setup.gate.blocks).

/** Fields a gate rejection needs off the setup — everything the evidence-gate
 *  rejections also record, so both families are comparable in one table. */
type GateRejectionSource = Pick<
  EnrichedZeroDteSetup,
  | "ticker"
  | "direction"
  | "gross_premium"
  | "aggression"
  | "side_dominance"
  | "otm_pct"
  | "prints"
  | "first_seen"
  | "last_seen"
>;

/** Build the durable rejection row for a hard-gate-blocked setup. `verdict` null
 *  means the gate stack could not even be evaluated (context unavailable) — that is
 *  itself a fail-closed block, recorded honestly as such. */
export function gateRejectionFor(
  setup: GateRejectionSource,
  verdict: ZeroDteGateVerdict | null
): ZeroDteGateRejection {
  const primary: ZeroDteGateBlock =
    verdict && verdict.blocks.length > 0
      ? verdict.blocks[0]!
      : {
          code: "gate_context_unavailable",
          reason:
            "Gate inputs (session ledger / governor state) could not be read — new commits fail closed.",
          threshold: null,
          unlock_et: null,
        };
  return {
    ticker: setup.ticker,
    gate_failed: primary.code,
    reason: verdict && verdict.blocks.length > 0
      ? verdict.blocks.map((b) => b.reason).join(" ")
      : primary.reason,
    threshold: primary.threshold,
    gross_premium: setup.gross_premium,
    aggression: setup.aggression,
    side_dominance: setup.side_dominance,
    otm_pct: setup.otm_pct,
    direction: setup.direction,
    prints: setup.prints,
    first_seen: setup.first_seen,
    last_seen: setup.last_seen,
  };
}
