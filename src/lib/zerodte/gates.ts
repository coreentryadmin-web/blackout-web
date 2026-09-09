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
import { SETUP_MAX_ITM_PCT, SETUP_MAX_OTM_PCT } from "./board";
import {
  evaluateZeroDteGovernor,
  premiumBudgetReason,
  GOVERNOR_ENFORCE_PREMIUM_BUDGET,
  GOVERNOR_MAX_PREMIUM_AT_RISK,
  type GovernorOpenPlan,
  type GovernorSnapshot,
} from "./governor";
import { CHASE_PCT, evaluateQuoteValidity, type ContractPlan } from "./plan";
import type { ZeroDteConfluence } from "./confluence";
import { DIRECTIONAL_LATE_CUTOFF_ET_MINUTES } from "./plan";
import { commitAuthorizedBySourceHealth, type SourceHealthState } from "@/lib/ws/source-health";
import { EARLY_ENTRY_WINDOW_END_ET_MINUTES } from "./confluence";
import { evaluateMacroHardBlock, hasHighImpactMacroEvent, type MacroEventLike } from "@/lib/macro-hard-block";
import { condorLiquidityGateBlocks, condorRangeBreaking, type CondorPlan } from "./condor";
import type { ZeroDteVectorPulse } from "./vector-crosslink-core";
import {
  vectorExemptsG19TopBand,
  vectorExemptsPlanChase,
  vectorPulseAlignsDirection,
} from "./vector-commit-boost";
import { planChaseExempt, planG19Exempt, type PlanChaseContext } from "./chase-exempt";

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

// ── G-20 · Cross-input synchronization/freshness ────────────────────────────────
// Architecture review 2026-09-09 (operator): G-1's SPY tape bias (fresh if ≤15min,
// MARKET_BIAS_MAX_AGE_MS above) and G-8/G-9's option quote (fresh if ≤60s,
// QUOTE_VALIDITY.max_quote_age_ms, ./plan.ts) are each checked for staleness
// INDIVIDUALLY, but nothing checks whether the two are synchronized WITH EACH OTHER.
// A quote observed seconds ago combined with a bias read from, say, 12 minutes ago is
// "fresh" by BOTH individual bounds yet describes two different instants of the
// market — the operator's framing: "a quote from now combined with an underlying/tape
// observation from materially earlier can produce a perfectly valid-looking but
// invalid decision." Scoped identically to G-1 (index ETFs, non-condor only) because
// that is the only population where the bias is actually consulted directionally —
// single names bypass G-1 (and therefore this gate) for the same reason already
// documented there: they trade on their own catalysts, not the SPY tape.
/** Max allowed skew (ms) between the option quote's own observation instant and the
 *  SPY bias read it is being judged alongside. FIRST CONSERVATIVE DEFAULT, NOT YET
 *  CALIBRATED against graded outcomes — same honesty as QUOTE_VALIDITY's own bounds
 *  ("conservative defaults ... reject only the clearly malformed/untradeable"). Picked
 *  deliberately WIDE relative to either individual bound (quote ≤60s, bias ≤15min) so
 *  this only fires on a genuine desync between two already-individually-fresh reads —
 *  never as a redundant restating of either bound alone. Revisit once the ledger has
 *  enough input_desync-tagged commits to measure real incidence/outcome. */
export const INPUT_SYNC_MAX_SKEW_MS = 5 * 60 * 1000;

// ── G-2 · Opening-window block ──────────────────────────────────────────────────
// USER-AUTHORIZED 2026-07-23 (supersedes the 2026-07-13 "first 15 min only" directive):
// push the unlock from 9:45 → 10:00 ET, blocking the demonstrably-worst first 30 minutes
// of RTH. Evidence (simulator, 25 sessions × SPY/QQQ/IWM, docs/audit/0DTE-RESEARCH.md): a
// fixed entry at 9:45 ran −12.1% expectancy / 26% win — the worst tested time — improving
// monotonically through the morning (10:00 −7.8%, 10:30 −9.1%, 11:00 +1.5%). 9:45 was
// literally the worst moment to unlock. The move stops at 10:00 (NOT 11:00) on purpose:
// (1) the backtest grader holds to stop/target/15:50 and ignores the live exit engine, so
// it likely UNDERSTATES early-entry outcomes; (2) blocking the whole morning would empty
// the board 9:30–11:00. The soft 10:00–12:30 gradient is handled by timeOfDayFactor
// (intraday.ts), a score nudge, not a hard block. The gate still buckets every commit by ET
// time (gate_calibration_json.committed_at_et), so the ledger — not this backtest — decides
// whether to push the unlock later. Setups found before 10:00 stay visible as WATCH/SKIP
// cards carrying the unlock time; the scanner re-evaluates every ~2 min, so a setup still
// alive at 10:00 commits then. The no-new-plays->=15:00 + hard-exit-15:50 rules are
// unchanged and live upstream (persistZeroDteScan / PLAN_RULES).
export const OPENING_WINDOW_UNLOCK_ET_MINUTES = 10 * 60;
export const OPENING_WINDOW_UNLOCK_LABEL = "10:00 ET";

// ── G-14 · Late-afternoon block ──────────────────────────────────────────────────
// Directional commits close at 15:30 ET (DIRECTIONAL_LATE_CUTOFF_ET_MINUTES), aligned with
// NEW_PLAY_CUTOFF and the board copy ("10:00–3:30 ET"). CONDOR-EXEMPT: credit sellers
// benefit from late-session theta. Reverted 2026-09-04 from a 14:00 hard stop — late-bucket
// outcomes stay on the graded ledger for calibration-driven tuning.
export const LATE_AFTERNOON_BLOCK_ET_MINUTES = DIRECTIONAL_LATE_CUTOFF_ET_MINUTES;
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
//
// 2026-09-08 (operator directive — whole-market volume complaint, "only 1 play on 0DTE all
// session"): pulled the standard floor to the documented release-valve value (1). The 1-conf
// bucket itself measured 0.0% EV (not negative) in the same E3 study that found 2-conf +15.9% —
// this trades some expected edge for volume deliberately, on operator instruction, not because
// the 2-conf evidence was wrong. Left ZERODTE_SCORE_FLOOR/_BREAKOUT/_PIN and
// ZERODTE_SINGLE_RAIL_PRIME_MIN untouched: those gate the 55-64 and 65-74 score bands, which have
// their OWN direct, recently-measured negative-EV evidence (F-2: 18.8% WR; G-17 extension,
// n=152: 35.7% WR) — reopening those specific bands isn't "unproven, ship and watch," it's
// re-admitting a band this desk already spent real capital proving loses money. The early-window
// floor (ZERODTE_CONFLUENCE_MIN_EARLY) is left at 2, since that window's 1-conf case was the
// specific "hurts most" case called out below.
export const ZERODTE_CONFLUENCE_MIN = envInt("ZERODTE_CONFLUENCE_MIN", 1);
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

/** G-12 floor — index ETFs need VWAP + market; BREAKOUT high-score gets a single confirm. */
export function g12ConfluenceFloor(
  ticker: string,
  nowEtMinutes: number,
  opts?: { score?: number; discovery_origin?: readonly string[] | null }
): number {
  if (isIndexEtfTicker(ticker)) {
    const floor = confluenceFloorAt(nowEtMinutes);
    const origins = opts?.discovery_origin ?? [];
    const score = opts?.score ?? 0;
    // BREAKOUT momentum at top decile: one VWAP+market leg is enough (Vector-style chase).
    if (origins.includes("BREAKOUT") && score >= 80 && floor > 1) return 1;
    return floor;
  }
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

/** Runner-profile confluence — uses the pinned `confirmations` count when it exceeds the
 *  G-12 gate leg count so A/B commits that passed with VWAP+market agreement get extended
 *  runner targets (replay 2026-09: runner_profile null despite confirmations: 2). */
export function runnerConfluenceCount(
  confluence: ZeroDteConfluence | null | undefined,
  ticker: string,
  vectorCredit: number
): number {
  if (!confluence) return Math.max(0, Math.min(1, vectorCredit));
  const gateCount = g12ConfirmationCount(confluence, ticker);
  const pinned = confluence.confirmations ?? 0;
  return Math.max(gateCount, pinned) + Math.max(0, Math.min(1, vectorCredit));
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
export const CONFLICT_SCORE_FLOOR = 55; // 2026-09-08: lowered from 65 (was itself lowered from 80) — this floor gates CONFLICT tolerance, not the raw score-band EV G-3/G-17 already measured negative; no direct evidence ties 55-64 conflicted setups to a worse outcome than 65-74 conflicted ones, so admitting them trades scarcity for volume on operator instruction
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
  /** False for a CONDOR — delta-neutral, so it structurally cannot "oppose" a directional
   *  take, mirroring the live gate's own `if (!isCondor)` G-6 scoping. `gateVerdictOf`
   *  treats an inapplicable row as a non-observation (like G-4's `tier: "unknown"`), so
   *  it never dilutes either bucket in `recommendGate("g6_conflict", ...)`. */
  applicable: boolean;
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

/** G-17 — the 65-74 score band requires the PRIME floor (75) UNLESS the setup clears it on its
 *  own merits some other way. Originally (2026-08-06, n=11) scoped to single-rail whole-market
 *  commits only — BREAKOUT-only or PIN-only — on the theory that FLOW/multi-rail corroboration
 *  was itself enough evidence to skip the extra floor. EXTENDED 2026-08-28 (real n=152 over a
 *  90-day window, /api/market/zerodte/record) after that theory stopped holding: multi-rail/FLOW
 *  commits in the UNRESTRICTED 65-74 band graded 35.7% WR / -10.43% avg pnl (n=34) — WORSE than
 *  single-rail-without-flow at the 75+ floor (41.0% WR / -3.76% avg pnl, n=89, the only single-rail
 *  population that can even commit) and worse than multi-rail/FLOW itself at 75+ (42.3% WR /
 *  -11.6% avg pnl, n=29). The 65-74 band is weak EV on its OWN score, independent of rail
 *  composition — corroboration was never actually buying safety there, it was just exempting a
 *  weak-score population from the floor that governs everyone else in that band. */
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
  /** G-19 (2026-09-09, downgraded from hard block to telemetry): true when this candidate
   *  is score>=85, FLOW-origin, and NOT Vector-winner/runner-aligned — the exact population
   *  the old F-5 top-band-inversion hard gate used to block. Never gates a commit; persisted
   *  for recurrence analysis. */
  topBandInversionFlag: boolean;
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
  /** Play direction vs SPY tape — regime chase / G-19 relief on amplify days. */
  market_aligned?: boolean | null;
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
  /**
   * Moneyness re-check input (P0 fix, 2026-08-27 — live-caught: SNXX short 9.55% ITM, PATH long
   * 4.11% ITM both committed past the 2% SETUP_MAX_ITM_PCT cap). board.ts's deriveZeroDteSetups
   * gates SETUP_MAX_ITM_PCT/SETUP_MAX_OTM_PCT exactly ONCE, off whatever underlying_price the flow
   * print carried at candidate-derivation time. scan.ts's attachContractPlans later REFRESHES
   * `otm_pct` from a fresher live option snapshot (refreshUnderlyingFromLiveSpot, board.ts) — but
   * until this field existed, nothing ever re-compared that refreshed value against either cap, so
   * a candidate whose true (post-refresh) moneyness had drifted past a cap could still commit with
   * `otm_pct` riding through as a passive audit field only. Pass the setup's CURRENT (ideally
   * post-refresh) `otm_pct` here so `moneynessGateBlocks` can re-fire the same two caps board.ts
   * already applies once. DIRECTIONAL ONLY — a CONDOR has no single-strike moneyness
   * (hasSingleStrikeMoneyness=false at the refresh call site pins its otm_pct to null), so this
   * never fires for one regardless of what is passed. Fails OPEN on null/undefined — like every
   * other optional gate input here (VIX, macro, confluence), a caller that simply doesn't supply
   * this is unaffected; it is a SUPPLEMENTARY re-check, not the sole authority — board.ts's own
   * evidence gate already fails CLOSED on an unreadable underlying before a candidate ever reaches
   * this function. When the live scan's attachContractPlans runs BEFORE this gate (the ordinary
   * pipeline), pass the already-refreshed value directly; when it runs AFTER (thesis-first deferred
   * attach), the caller must re-apply via {@link refreshMoneynessGateBlocks} once the refresh has run.
   */
  otmPct?: number | null;
  /** Vector desk pulse for this ticker (read-only cross-link). When aligned + winner/runner,
   *  relaxes G-17 and can credit confluence — see vector-commit-boost.ts. */
  vector_pulse?: ZeroDteVectorPulse | null;
  /** Pre-computed Vector gate boost (score bump already applied upstream). */
  vector_g17_exempt?: boolean;
  /** Extra confluence credit from Vector alignment (0 or 1). */
  vector_confluence_credit?: number;
  /** Market State Engine structure at scan time — amplify chase / G-19 regime relief. */
  regime_structure?: string | null;
  market_state_confidence?: number | null;
  /** Override far-OTM lotto cap (runner relax). Defaults to SETUP_MAX_OTM_PCT. */
  max_otm_pct?: number | null;
  /**
   * G-23 qualification-to-commit dislocation circuit-breaker inputs. `qualification*` is the
   * FROZEN underlying price/as-of the setup qualified on (EnrichedZeroDteSetup's
   * `qualification_underlying_price`/`_as_of`, stamped once in board.ts's enrichSetup — see that
   * field's doc for why a frozen copy is necessary at all). `current*` is the underlying price/
   * as-of AT COMMIT TIME — in the ordinary (non-thesis-first) pipeline this is the
   * live-refreshed `underlying_price`/`underlying_price_as_of` after attachContractPlans has
   * already run (same ordering board.ts's `otmPct` doc describes); under thesis-first, where
   * attachContractPlans runs AFTER this gate, `current*` is still pre-refresh on the first pass
   * and the caller should re-derive + re-apply via {@link refreshQualificationDislocationGateBlocks}
   * once the refresh has happened, mirroring refreshMoneynessGateBlocks. All four fail OPEN on
   * null/undefined, same convention as otmPct.
   */
  qualificationUnderlyingPrice?: number | null;
  qualificationUnderlyingPriceAsOfMs?: number | null;
  currentUnderlyingPrice?: number | null;
  currentUnderlyingPriceAsOfMs?: number | null;
};

/** Build chase-exempt context from a gate evaluation input. */
export function planChaseContextFromGateInput(input: ZeroDteGateInput): PlanChaseContext {
  return {
    direction: input.direction,
    score: input.score,
    vector_pulse: input.vector_pulse,
    discovery_origin: input.discovery_origin,
    gamma_regime: input.gamma_regime ?? null,
    market_aligned: input.market_aligned ?? null,
    regime_structure: input.regime_structure ?? null,
    market_state_confidence: input.market_state_confidence,
  };
}

/** G-17's 70-74 conditional band (below) needs "every other execution/safety gate clean" —
 *  G-8/G-9 (quote quality) and G-21 (contract liquidity/depth). Named here, not inline, so
 *  the set is a single place to extend when a future execution/safety gate (e.g. G-23) is
 *  added. */
const EXECUTION_SAFETY_GATE_CODES: ReadonlySet<ZeroDteGateFailure> = new Set([
  "plan_no_quote",
  "plan_moved",
  "plan_illiquid",
  "plan_quote_stale",
  "plan_quote_invalid",
  "plan_thin_size",
  "plan_no_volume_or_oi",
]);

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

  // G-20 — cross-input synchronization/freshness. Same scope as G-1 (index ETF, non-condor):
  // this only matters where the bias is actually consulted directionally against the quote.
  // FAIL-OPEN on missing data (either timestamp absent) — same "absence is not staleness"
  // convention as every other conditional gate here (quote age, confluence, VIX/macro
  // unavailability): a caller/fixture that doesn't supply one or both timestamps is
  // unaffected, never blocked from an unmeasured factor.
  if (!isCondor && isIndexEtfG1) {
    const quoteAgeMs = input.plan?.quoteAgeMs ?? null;
    // Reconstruct the quote's absolute observation instant the same way it was measured:
    // nowMs is the SAME wall-clock the live scan passes to both buildContractPlan (which
    // computed quoteAgeMs) and evaluateZeroDteGates (this call) — see scan.ts's shared `nowMs`.
    const quoteObservedAtMs = quoteAgeMs != null ? input.nowMs - quoteAgeMs : null;
    if (quoteObservedAtMs != null && input.biasAsOfMs != null) {
      const skewMs = Math.abs(quoteObservedAtMs - input.biasAsOfMs);
      if (skewMs > INPUT_SYNC_MAX_SKEW_MS) {
        blocks.push({
          code: "input_desync",
          reason:
            `Option quote and SPY tape read are ${Math.round(skewMs / 1000)}s apart — over the ` +
            `${Math.round(INPUT_SYNC_MAX_SKEW_MS / 1000)}s cross-input sync tolerance. Both are ` +
            "individually fresh (quote ≤60s, bias ≤15min) but describe different instants of the " +
            "market — a fresh price read against a stale tape read (or vice versa) can look like a " +
            "valid setup while describing a market state that no longer exists.",
          threshold: INPUT_SYNC_MAX_SKEW_MS,
          unlock_et: null,
        });
      }
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

  // G-14 — late-afternoon block (directional only). Condors stay eligible through persist cutoff.
  if (!isCondor && input.nowEtMinutes >= LATE_AFTERNOON_BLOCK_ET_MINUTES) {
    blocks.push({
      code: "late_afternoon",
      reason:
        `No new directional 0DTE commits after ${LATE_AFTERNOON_BLOCK_LABEL} — session ` +
        "discipline (entries need room to work before the 15:50 flat exit).",
      threshold: LATE_AFTERNOON_BLOCK_ET_MINUTES,
      unlock_et: null,
    });
  }

  // G-15 — WEEKLY_FALLBACK horizon (dte≥5 or no listed 0DTE/1DTE contract). ONE_DTE commits
  // (same-day grading); only multi-day weeklies are blocked here so the board never shows a
  // ghost COMMIT that persist drops anyway (BBWI-class misleading WATCH/COMMIT on 2026-09-04).
  if (input.contractHorizon === "WEEKLY_FALLBACK") {
    blocks.push({
      code: "horizon_weekly_fallback",
      reason:
        "Selected contract is a weekly/multi-day fallback — excluded from the same-day 0DTE ledger " +
        "(only ZERO_DTE and ONE_DTE horizons commit and grade with the 15:50 time-stop).",
      threshold: null,
      unlock_et: null,
    });
  }

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

  // G-17 — RESTRUCTURED (2026-09-09, operator-approved CTO gate-architecture review) from a
  // flat "65-74 needs >=75 regardless of corroboration" rule into a three-band architecture:
  //   <65     REJECT (G-3's own floor, above — untouched)
  //   65-69   REJECT unconditionally — no admission path at all
  //   70-74   CONDITIONAL — eligible ONLY with confluence>=2 AND clean tape/VIX/execution
  //           (see the end-of-function check below, which needs G-1/G-4/G-8/G-9/G-21's
  //           results already collected in `blocks`)
  //   75+     PRIME, unrestricted here (unchanged)
  // Rationale: the 2026-08-28 measurement (multi-rail/FLOW in 65-74 ran 35.7% WR, WORSE than
  // single-rail at 75+) showed an UNCONFIRMED 65-74 setup is weak EV — it never showed that a
  // GENUINELY well-confirmed 70-74 setup (real confluence, clean tape, clean VIX regime, clean
  // execution) is equally weak. The flat rule conflated "unconfirmed" with "sub-75", rejecting
  // a narrow admission window the evidence never actually closed. 65-69 keeps the flat reject —
  // no evidence supports admitting that lower sub-band under any condition.
  if (!isCondor && input.score >= 65 && input.score < 70) {
    blocks.push({
      code: "single_rail_corroboration",
      reason:
        `Score ${Math.round(input.score)} sits in the 65-69 band — rejected outright, no ` +
        "admission path (measured 2026-08-28: the unconfirmed 65-74 band ran weak EV; only the " +
        "70-74 sub-band has a narrow conditional path, gated on real confirmation — see the " +
        "conditional-band check).",
      threshold: 70,
      unlock_et: null,
    });
  }

  // G-18 — early-window prime score floor (E2 + replay 2026-09: sub-prime scores in [10:00, 10:45)
  // cluster on full-stop losers). UNCONDITIONAL 75+ prime band inside this window as of
  // 2026-09-09 (operator-approved CTO gate-architecture review) — the Vector exemption is
  // REMOVED specifically from this gate's block condition. Root cause: the early window is
  // the SPECIFIC replay-measured worst-timed slice of the session (E2's own evidence is about
  // TIMING, not about whether Vector happens to agree), and Vector alignment was never itself
  // measured as curing that early-window effect — it was borrowed verbatim from G-17's own
  // exemption predicate. G-17's OWN Vector exemption (a SEPARATE code path, `single_rail_
  // corroboration`, further below) is explicitly UNTOUCHED by this change — be precise about
  // which gate is being read: both G-17 and G-19 still reference `vectorExemptsG17PrimeBand`/
  // their own exemption predicates; only G-18's block condition drops it.
  if (
    !isCondor &&
    input.nowEtMinutes >= OPENING_WINDOW_UNLOCK_ET_MINUTES &&
    input.nowEtMinutes < EARLY_ENTRY_WINDOW_END_ET_MINUTES &&
    input.score < 75
  ) {
    blocks.push({
      code: "early_window_prime_score",
      reason:
        `Score ${Math.round(input.score)} in the ${OPENING_WINDOW_UNLOCK_LABEL}–10:45 early window ` +
        "needs the 75+ prime band (E2 negative EV below prime — unconditional in this window, " +
        "no Vector-alignment exemption).",
      threshold: 75,
      unlock_et: "10:45 ET",
    });
  }

  // G-19 — F-5 top-band inversion: DOWNGRADED from hard block to non-blocking telemetry
  // (2026-09-09, operator-approved CTO gate-architecture review). Previously blocked
  // FLOW-origin score>=85 unless Vector confirmed winner/runner. Removed as a hard block —
  // score>=85 FLOW-origin now proceeds normally through the rest of the stack. The
  // determination itself (would this candidate have been in the population the old hard
  // gate targeted?) remains real signal, so it now surfaces as the non-blocking
  // `topBandInversionFlag` field on the verdict — true precisely for the population that
  // WOULD have been blocked under the old logic (score>=85 AND FLOW-origin AND NOT
  // Vector-winner/runner-aligned) — persisted to the ledger (gate_calibration_json,
  // scan.ts) so future analysis can check for a recurrence of the F-5 inversion pattern
  // without needing to re-derive it from raw scores/origins after the fact.
  const g19Origins = input.discovery_origin ?? [];
  const g19FlowBacked = g19Origins.length === 0 || g19Origins.includes("FLOW");
  const g19WouldHaveExempted =
    input.vector_g17_exempt === true ||
    vectorExemptsG19TopBand(input.direction, input.score, input.vector_pulse) ||
    planG19Exempt(input.direction, input.score, input.vector_pulse, {
      discovery_origin: input.discovery_origin,
      gamma_regime: input.gamma_regime ?? null,
      market_aligned: input.market_aligned ?? null,
      regime_structure: input.regime_structure ?? null,
      market_state_confidence: input.market_state_confidence,
    });
  const topBandInversionFlag =
    !isCondor && g19FlowBacked && input.score >= 85 && !g19WouldHaveExempted;

  // G-12 — confluence floor (Phase 1, 2026-07-24). DIRECTIONAL ONLY: confluence counts how many of
  // {VWAP-side, market-aligned} agree with the setup's DIRECTION — a delta-neutral condor has no
  // direction to confirm, so this gate does not apply to it (the sell-regime router + range-intact
  // check are the condor's equivalent "is the structure right" test).
  if (!isCondor && input.confluence != null) {
    const floor = g12ConfluenceFloor(input.ticker, input.nowEtMinutes, {
      score: input.score,
      discovery_origin: input.discovery_origin,
    });
    const credit = Math.max(0, Math.min(1, input.vector_confluence_credit ?? 0));
    const have = g12ConfirmationCount(input.confluence, input.ticker) + credit;
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
  // DOWNGRADED from unconditional hard block to an ELEVATED QUALITY REQUIREMENT
  // (2026-09-09, operator-approved CTO gate-architecture review): a setup whose
  // stacked positioning opposes its direction can still proceed if it clears a HIGHER
  // bar than the ordinary commit floors — score >= 75 (the same PRIME band G-17/G-18
  // already use elsewhere in this stack) AND confluence confirmations >= 2 (reusing
  // g12ConfirmationCount, the exact G-12 leg count — not a new metric). The conflict
  // stays fully visible in the block reason/telemetry even when it doesn't block, so
  // the disagreement is never silently hidden by a strong score. ZERODTE_BLOCK_ACCUM_MISALIGN
  // remains the on/off flag for the WHOLE mechanism (both the block and the elevated-
  // quality check it now gates) — set it false to disable G-13 entirely.
  //
  // A missing confluence read cannot itself satisfy the >=2 confirmation requirement:
  // this is an ELEVATED bar being asked to override a real, measured conflict signal,
  // not G-12's own ordinary fail-open (which never manufactures a block from an
  // unmeasured factor) — the absence of measurement here is not evidence of agreement.
  if (!isCondor && ZERODTE_BLOCK_ACCUM_MISALIGN && input.flowAccumulationAligned === false) {
    const confirmCount = input.confluence != null ? g12ConfirmationCount(input.confluence, input.ticker) : 0;
    const clearsElevatedQuality = input.score >= 75 && confirmCount >= 2;
    if (!clearsElevatedQuality) {
      blocks.push({
        code: "flow_accumulation_conflict",
        reason:
          "Multi-day options flow accumulation opposes this setup's direction — " +
          `the stacked positioning read disagrees with the ${input.ticker}-${input.direction} commit ` +
          `(score ${Math.round(input.score)}, ${confirmCount} confluence confirmations — needs >=75 ` +
          "score AND >=2 confirmations to override a stacked-positioning conflict).",
        threshold: 75,
        unlock_et: null,
      });
    }
  }

  // ── Moneyness re-check (live-refreshed underlying) — P0 fix, 2026-08-27 ─────────────────
  // See the `otmPct` field doc above for the full root cause. In short: board.ts's evidence
  // gate compared otm_pct to SETUP_MAX_ITM_PCT/SETUP_MAX_OTM_PCT exactly once, before the
  // scan's later live-spot refresh could move it; this re-applies the SAME two caps to
  // whatever otm_pct the caller currently has (ideally the refreshed value), so a name that
  // drifted past a cap between candidate derivation and commit no longer slips through. Pure
  // pass-through to moneynessGateBlocks, which is also exported standalone so scan.ts can
  // re-run it after a deferred (thesis-first) contract-plan attach — see
  // refreshMoneynessGateBlocks below, mirroring refreshPlanQualityGateBlocks.
  blocks.push(
    ...moneynessGateBlocks(input.otmPct, isCondor, {
      maxOtmPct: input.max_otm_pct ?? null,
    })
  );

  // ── G-23 — qualification-to-commit dislocation circuit-breaker ──────────────────────────
  // See the module doc above qualificationDislocationGateBlocks for the full distinction from
  // G-8 (no-chase) and the moneyness re-check just above.
  blocks.push(
    ...qualificationDislocationGateBlocks({
      qualificationPrice: input.qualificationUnderlyingPrice ?? null,
      qualificationAsOfMs: input.qualificationUnderlyingPriceAsOfMs ?? null,
      currentPrice: input.currentUnderlyingPrice ?? null,
      currentAsOfMs: input.currentUnderlyingPriceAsOfMs ?? null,
      quote: input.plan ? { bid: input.plan.bid, ask: input.plan.ask, mark: input.plan.mark } : null,
      isCondor,
    })
  );

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
      // G-4 CANONICALIZED (2026-09-09, operator-approved CTO gate-architecture review):
      // VIX ≥ 17 (elevated, <20) → required score ≥ 75, FULL STOP, for EVERY ticker and
      // instrument type — no tape-alignment relief, no single-name carve-out. This replaces
      // the previous two-way exemption: single names always got the standard 65 floor
      // regardless of VIX (bypassing G-4 entirely — found 2026-08-26, the single-name-vs-
      // SPY-tape scoping bug that produced the `tapeAlignedOrFlat` branch this comment used
      // to describe), and index ETFs got 65 when tape-aligned/flat vs 75 when counter-tape.
      // Both exemptions are REMOVED: the F-1 evidence backing this floor (69.2% WR at VIX<17
      // vs 25.0% WR at VIX≥17, the strongest per-play split in the whole forensics dataset)
      // was never measured as a tape-alignment- or ticker-type-conditional effect — it is a
      // VIX-REGIME effect, full stop, so the score floor now applies uniformly. The ≥20
      // extreme-VIX single-name block (index/ETF-only survival, at reduced size) below is
      // explicitly PRESERVED UNCHANGED — this only simplifies the elevated (17-20) tier.
      const elevatedFloor = VIX_ELEVATED_SCORE_FLOOR;
      if (input.score < elevatedFloor) {
        blocks.push({
          code: "vix_elevated",
          reason:
            `VIX ${vixR} in the elevated regime (≥${VIX_ELEVATED_THRESHOLD}) — score ${Math.round(input.score)} ` +
            `needs ≥${elevatedFloor} to commit, for every ticker/instrument type (no tape-alignment or ` +
            "single-name relief). The 17-20 VIX regime ran 25% WR vs 69% below 17 (F-1).",
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
    //   • index/ETF → extreme never blocks it, and elevated (17–20) now blocks uniformly
    //     below the canonical 75 floor (no tape-alignment relief, per the 2026-09-09
    //     canonicalization above) — so a present VIX could only have blocked an index/ETF
    //     sitting below that floor. An index/ETF already ≥75 clears any VIX regime → NOT
    //     blocked here (no spurious empty).
    const tickerUp = input.ticker.toUpperCase();
    const isIndexEtf = INDEX_ETF_TICKERS.has(tickerUp);
    const couldBlock = !isIndexEtf || input.score < VIX_ELEVATED_SCORE_FLOOR;
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
    blocks.push(
      ...planQualityGateBlocks(input.plan ?? null, {
        chaseExempt: planChaseExempt(planChaseContextFromGateInput(input)),
      })
    );
    // G-21 — contract liquidity/depth (2026-09-09 split OUT of G-9's plan_quote_invalid):
    // a SIBLING check, not a branch — a well-formed, in-band quote can still be too thin
    // to fill. Evaluated alongside G-8/G-9, same deferPlanQualityGates gating (a plan
    // attached AFTER gates under thesis-first needs the same refresh treatment — see
    // refreshContractLiquidityGateBlocks below, mirroring refreshPlanQualityGateBlocks).
    blocks.push(...contractLiquidityGateBlocks(input.plan ?? null));

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

  // G-17 — 70-74 CONDITIONAL BAND admission check (2026-09-09 restructure, see the doc
  // comment on the 65-69 reject above). Deliberately evaluated HERE, at the very end of the
  // function, because "clean tape/VIX/execution" needs G-1/G-4/G-8/G-9/G-21's results
  // already collected in `blocks` — this is the ONLY gate in the stack whose eligibility is
  // itself defined in terms of every OTHER gate's outcome, rather than its own independent
  // read. Eligible only if ALL of:
  //   (a) confluence confirmations >= 2 — this band's OWN bar, via g12ConfirmationCount,
  //       regardless of time-of-day (separate from G-12's own ordinary floor above, which
  //       can be as low as 1 via ZERODTE_CONFLUENCE_MIN). An UNKNOWN/missing confluence read
  //       does NOT satisfy this — see the G-12 fix note below.
  //   (b) tape alignment satisfied where applicable (no G-1 tape_alignment/no_market_bias
  //       block already fired — condors and single names are exempt from G-1 to begin with,
  //       so they trivially pass this leg).
  //   (c) VIX-regime requirements met (no vix_elevated/vix_extreme/vix_unavailable block
  //       already fired — the canonicalized G-4 uniform-floor rule, 2026-09-09).
  //   (d) every other execution/safety gate (G-8/G-9 plan quality, G-21 contract liquidity)
  //       clean — no code in EXECUTION_SAFETY_GATE_CODES already fired.
  // Any failing leg blocks with the distinct `conditional_band_unmet` code (never conflated
  // with the unconditional 65-69 reject or with the specific gate that actually failed —
  // those already carry their own block/code in `blocks`; this one names the BAND decision).
  //
  // G-12 FIX (bundled with this restructure): the elevated >=2 bar above is asked "is this
  // confirmed enough to admit at a sub-prime score" — a genuinely different question from
  // G-12's own ordinary floor, which fails OPEN on a missing read (never manufactures a
  // block from an unmeasured factor elsewhere in this file). Here, absence of measurement
  // cannot answer "yes, confirmed" — so a null confluence read counts as 0 confirmations for
  // THIS check ONLY, distinct from a measured 0 or 1 (which already fail this bar the same
  // way). G-12's own fail-open behavior everywhere else in this file is UNCHANGED.
  if (!isCondor && input.score >= 70 && input.score < 75) {
    const confirmCount =
      input.confluence != null ? g12ConfirmationCount(input.confluence, input.ticker) : 0;
    const confluenceOk = confirmCount >= 2;
    const tapeOk = !blocks.some((b) => b.code === "tape_alignment" || b.code === "no_market_bias");
    const vixOk = !blocks.some(
      (b) => b.code === "vix_elevated" || b.code === "vix_extreme" || b.code === "vix_unavailable"
    );
    const executionOk = !blocks.some((b) => EXECUTION_SAFETY_GATE_CODES.has(b.code));
    if (!(confluenceOk && tapeOk && vixOk && executionOk)) {
      const unmet: string[] = [];
      if (!confluenceOk) unmet.push(`confluence ${confirmCount}/2`);
      if (!tapeOk) unmet.push("tape misaligned");
      if (!vixOk) unmet.push("VIX regime");
      if (!executionOk) unmet.push("execution/safety");
      blocks.push({
        code: "conditional_band_unmet",
        reason:
          `Score ${Math.round(input.score)} sits in the 70-74 conditional band — admission needs ` +
          `confluence>=2 AND clean tape AND clean VIX regime AND clean execution/safety, all at ` +
          `once. Unmet: ${unmet.join(", ")}.`,
        threshold: 2,
        unlock_et: null,
      });
    }
  }

  return {
    verdict: blocks.length > 0 ? "BLOCKED" : "COMMIT",
    blocks,
    calibration: computeGateCalibration(input),
    topBandInversionFlag,
  };
}

export type PlanQualityGateOpts = {
  /** Vector/regime-confirmed momentum — commit at live mark, skip G-8 chase block. */
  vectorChaseExempt?: boolean;
  /** Alias — same as vectorChaseExempt (regime widen included). */
  chaseExempt?: boolean;
};

/** G-8/G-9 plan-quality blocks — pure, unit-testable, reused by persist defense. */
export function planQualityGateBlocks(
  plan: ContractPlan | null,
  opts?: PlanQualityGateOpts
): ZeroDteGateBlock[] {
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
  if (plan.entry_status === "MOVED" && !(opts?.vectorChaseExempt || opts?.chaseExempt)) {
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
    const cap = plan.illiquid_spread_cap ?? 15;
    const spread = plan.spread_pct != null ? `${plan.spread_pct.toFixed(0)}%` : `>${cap}%`;
    blocks.push({
      code: "plan_illiquid",
      reason:
        `Bid/ask spread is ${spread} of the mark — market too thin for a 0DTE scalp (G-9).`,
      threshold: cap,
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

/** Human-readable sentence per malformed-quote reason (WS-04, G-9 quote INTEGRITY only —
 *  see the 2026-09-09 G-9/G-21 split). Keyed by the QuoteInvalidReason values that map to
 *  plan_quote_invalid (stale is handled separately as plan_quote_stale). */
const QUOTE_INVALID_SENTENCE: Record<
  Exclude<NonNullable<ContractPlan["quote_invalid_reason"]>, "stale">,
  string
> = {
  zero_bid: "Contract has no real two-sided quote (zero/null bid or ask)",
  crossed: "Contract quote is crossed (bid > ask)",
  locked: "Contract quote is locked (bid == ask — zero-width book)",
  mark_out_of_band: "Contract mark sits outside its own bid/ask",
  wide_dollars: "Contract bid/ask dollar spread is over the cap",
};

/** Human-readable sentence per contract-liquidity reason (G-21, 2026-09-09 split OUT of
 *  QUOTE_INVALID_SENTENCE — see ContractLiquidityInvalidReason's doc). */
const LIQUIDITY_INVALID_SENTENCE: Record<NonNullable<ContractPlan["liquidity_invalid_reason"]>, string> = {
  thin_size: "Contract resting quote size is below the floor",
  no_volume_or_oi: "Contract has no real trading activity (zero day volume AND zero open interest)",
};

/**
 * G-21 contract-liquidity gate blocks — pure, unit-testable, SIBLING to
 * planQualityGateBlocks (G-8/G-9), not a branch of it. A plan can pass G-9's quote-
 * integrity check (real, in-band, fresh two-sided market) and still fail here because
 * the book is too THIN to fill without moving the market — a distinct failure mode with
 * its own distinct gate codes (plan_thin_size / plan_no_volume_or_oi), per the 2026-09-09
 * G-9/G-21 split (operator-approved CTO gate-architecture review).
 */
export function contractLiquidityGateBlocks(plan: ContractPlan | null): ZeroDteGateBlock[] {
  if (plan == null || plan.liquidity_invalid_reason == null) return [];
  const reason = plan.liquidity_invalid_reason;
  const code = reason === "thin_size" ? "plan_thin_size" : "plan_no_volume_or_oi";
  return [
    {
      code,
      reason: `${LIQUIDITY_INVALID_SENTENCE[reason]} — thin liquidity fails closed (G-21).`,
      threshold: null,
      unlock_et: null,
    },
  ];
}

/**
 * Moneyness cap re-check — pure, unit-testable, reused by the deferred (thesis-first) refresh
 * below. Re-applies the SAME two board.ts constants (SETUP_MAX_ITM_PCT / SETUP_MAX_OTM_PCT) the
 * evidence gate already used once, against whatever `otmPct` the caller currently holds. Never
 * invents a different threshold — see the `otmPct` field doc on ZeroDteGateInput for why.
 *
 * `isCondor` short-circuits to no blocks: a CONDOR is delta-neutral (no single-strike moneyness),
 * and its otm_pct is always null at the refresh call site anyway (hasSingleStrikeMoneyness=false),
 * so this is belt-and-suspenders, not load-bearing, for that branch.
 *
 * Fails OPEN on null/undefined `otmPct` — this is a supplementary re-check layered on top of
 * board.ts's own fail-closed evidence gate (no_underlying_price), not a replacement for it, and a
 * caller that doesn't supply a value must see zero behavior change (mirrors every other optional
 * gate input in this file).
 */
export function moneynessGateBlocks(
  otmPct: number | null | undefined,
  isCondor: boolean,
  opts?: { maxOtmPct?: number | null }
): ZeroDteGateBlock[] {
  if (isCondor || otmPct == null) return [];
  const otmCap =
    opts?.maxOtmPct != null && Number.isFinite(opts.maxOtmPct) && opts.maxOtmPct > 0
      ? opts.maxOtmPct
      : SETUP_MAX_OTM_PCT;
  const blocks: ZeroDteGateBlock[] = [];
  if (otmPct < -SETUP_MAX_ITM_PCT) {
    blocks.push({
      code: "max_itm_pct",
      reason:
        `Top strike is ${Math.abs(otmPct).toFixed(2)}% ITM — past the ${SETUP_MAX_ITM_PCT}% ` +
        "stock-replacement cap on the live-refreshed underlying (re-checked post live-spot refresh).",
      threshold: -SETUP_MAX_ITM_PCT,
      unlock_et: null,
    });
  } else if (otmPct > otmCap) {
    blocks.push({
      code: "max_otm_pct",
      reason:
        `Top strike is ${otmPct.toFixed(2)}% OTM — past the ${otmCap}% far-OTM lotto ` +
        "cap on the live-refreshed underlying (re-checked post live-spot refresh).",
      threshold: otmCap,
      unlock_et: null,
    });
  }
  return blocks;
}

const MONEYNESS_GATE_CODES: ReadonlySet<ZeroDteGateFailure> = new Set(["max_itm_pct", "max_otm_pct"]);

/** Re-apply the moneyness cap after a deferred (thesis-first) contract-plan attach (scan.ts) —
 *  mirrors refreshPlanQualityGateBlocks exactly. Needed because thesis-first defers
 *  attachContractPlans (and therefore refreshUnderlyingFromLiveSpot) until AFTER
 *  evaluateZeroDteGates has already run once against the PRE-refresh otm_pct. */
export function refreshMoneynessGateBlocks(
  gate: ZeroDteGateVerdict,
  otmPct: number | null | undefined,
  isCondor: boolean,
  opts?: { maxOtmPct?: number | null }
): ZeroDteGateVerdict {
  const rest = gate.blocks.filter((b) => !MONEYNESS_GATE_CODES.has(b.code));
  const blocks = [...rest, ...moneynessGateBlocks(otmPct, isCondor, opts)];
  return {
    ...gate,
    verdict: blocks.length > 0 ? "BLOCKED" : "COMMIT",
    blocks,
  };
}

// ── G-23 · Qualification-to-commit price dislocation / circuit-breaker ──────────────────
// Architecture review 2026-09-09: a setup can pass the evidence gates (board.ts's
// deriveZeroDteSetups) at one underlying price/moment and then reach COMMIT (this file's
// evaluateZeroDteGates) minutes later against a market that has moved violently in between —
// a fast spike/crash, a temporary feed glitch, or a crossed/unstable book. The thesis that
// justified the setup (a specific strike distance, a specific premium, a specific tape read)
// can be stale by the time it actually commits, even though every OTHER gate in the stack
// still reads clean.
//
// This is DISTINCT from the two existing checks that look similar, confirmed by reading both:
//   • G-8 no-chase (planQualityGateBlocks/CHASE_PCT above, plan.ts) compares the LIVE MARK to
//     the flow PRINT's own fill price — it is anchored to what the smart-money tape paid, not
//     to the moment this candidate qualified, and it never re-examines the UNDERLYING at all
//     (a mispriced/illiquid option can pass G-8 while the underlying itself has gapped).
//   • The moneyness re-check (moneynessGateBlocks above, P0 fix 2026-08-27) re-tests otm_pct
//     against the SAME static ITM/OTM caps board.ts already applied once — it only asks "where
//     did the strike distance END UP", never "how fast did it get there". A 3% underlying move
//     over 20 minutes and a 3% move in 90 seconds can land at an IDENTICAL final otm_pct and
//     therefore read identically to that gate — but they are different risk profiles (normal
//     intraday drift vs a violent dislocation the original thesis never priced in). Neither
//     existing gate has a time dimension; this one is built specifically to have one.
//
// Two independent trigger conditions, either one blocks a FRESH commit:
//   (1) MAGNITUDE + VELOCITY: the underlying moved >= QUALIFICATION_DISLOCATION_MAX_PCT since
//       qualification, AND that move happened inside QUALIFICATION_DISLOCATION_WINDOW_MS. Both
//       conditions must hold — a large move over a long window is ordinary drift (already priced
//       by the moneyness re-check if it pushed past a strike cap); a small move in a short window
//       is noise. Only the combination — fast AND large — is the abnormal case this gate targets.
//   (2) CROSSED/LOCKED BOOK: the contract's live quote is crossed (bid > ask) or locked
//       (bid == ask) at commit time. Reuses evaluateQuoteValidity (plan.ts) rather than
//       reinventing the predicate — same function G-9's plan_quote_invalid already calls via
//       buildContractPlan's quote_invalid_reason. This IS already blocked by G-9 whenever a plan
//       exists at eval time (deliberately redundant there — a genuinely crossed/unstable book is
//       exactly the "market state invalidates the thesis" case this circuit-breaker exists to
//       catch, so it is asserted here too rather than assumed covered by a sibling gate); it adds
//       real coverage in the thesis-first pipeline, where G-8/G-9 are deferred
//       (deferPlanQualityGates) until refreshPlanQualityGateBlocks re-applies them later — this
//       check runs unconditionally whenever a plan is already attached, closing the same gap in
//       the same style as refreshMoneynessGateBlocks/refreshPlanQualityGateBlocks below.
//
// Config-gated, conservative defaults (same discipline as every other threshold in this file):
// 1.5% is well past normal 0DTE-hours intraday noise (the moneyness caps themselves tolerate a
// 12-16% OTM band and a 2% ITM band — this is a much tighter, SPEED-gated trigger, not a
// replacement for those), and 5 minutes is short enough that only a genuinely fast dislocation —
// not an ordinary multi-minute drift — can trip it. Both are env-overridable so the ledger can
// tune them without a deploy, mirroring CHASE_PCT/QUOTE_VALIDITY above.
export const QUALIFICATION_DISLOCATION_MAX_PCT = envInt("ZERODTE_QUALIFICATION_DISLOCATION_MAX_PCT", 1.5);
export const QUALIFICATION_DISLOCATION_WINDOW_MS = envInt(
  "ZERODTE_QUALIFICATION_DISLOCATION_WINDOW_MS",
  5 * 60 * 1000
);

/**
 * G-23 pure predicate — reused by evaluateZeroDteGates below and unit-tested directly.
 * Fails OPEN (returns no blocks) whenever the qualification-time snapshot, the current
 * snapshot, or either timestamp is missing/non-finite — this is a SUPPLEMENTARY circuit-
 * breaker layered on top of the evidence gates' own fail-closed no_underlying_price check,
 * not a replacement for it; a caller that simply doesn't supply qualification data (tests,
 * fixtures, a setup enrichSetup never touched) sees zero behavior change, same convention as
 * otmPct/vixDayOpen/macroEvents above.
 */
export function qualificationDislocationGateBlocks(input: {
  qualificationPrice: number | null | undefined;
  qualificationAsOfMs: number | null | undefined;
  currentPrice: number | null | undefined;
  currentAsOfMs: number | null | undefined;
  /** Live quote at commit time (from the attached ContractPlan) — undefined/null when no plan
   *  has attached yet (e.g. thesis-first's first pass); the crossed/locked trigger simply does
   *  not fire in that case, same as G-9 with no plan. */
  quote?: { bid: number | null; ask: number | null; mark: number | null } | null;
  isCondor: boolean;
  maxPct?: number;
  maxWindowMs?: number;
}): ZeroDteGateBlock[] {
  const blocks: ZeroDteGateBlock[] = [];
  const maxPct =
    input.maxPct != null && Number.isFinite(input.maxPct) && input.maxPct > 0
      ? input.maxPct
      : QUALIFICATION_DISLOCATION_MAX_PCT;
  const maxWindowMs =
    input.maxWindowMs != null && Number.isFinite(input.maxWindowMs) && input.maxWindowMs > 0
      ? input.maxWindowMs
      : QUALIFICATION_DISLOCATION_WINDOW_MS;

  // ── Trigger 1: magnitude + velocity ──────────────────────────────────────────────
  const qp = input.qualificationPrice;
  const cp = input.currentPrice;
  const qAt = input.qualificationAsOfMs;
  const cAt = input.currentAsOfMs;
  if (
    qp != null &&
    Number.isFinite(qp) &&
    qp > 0 &&
    cp != null &&
    Number.isFinite(cp) &&
    cp > 0 &&
    qAt != null &&
    Number.isFinite(qAt) &&
    cAt != null &&
    Number.isFinite(cAt)
  ) {
    const elapsedMs = cAt - qAt;
    // elapsedMs <= 0 means the "current" snapshot is not actually newer than qualification
    // (clock skew, or the two timestamps were never meant to be compared) — never manufacture
    // a dislocation from a non-positive window, same "fail toward the KNOWN" discipline
    // refreshUnderlyingFromLiveSpot uses for its own observed-at guard.
    if (elapsedMs > 0 && elapsedMs <= maxWindowMs) {
      const movePct = Math.abs((cp - qp) / qp) * 100;
      if (movePct >= maxPct) {
        const minutes = elapsedMs / 60_000;
        blocks.push({
          code: "qualification_dislocation",
          reason:
            `Underlying moved ${movePct.toFixed(2)}% in ${minutes.toFixed(1)} min since this setup ` +
            `qualified — past the ${maxPct}%/${(maxWindowMs / 60_000).toFixed(0)}-min dislocation ` +
            "circuit-breaker; the thesis this setup qualified on may no longer hold.",
          threshold: maxPct,
          unlock_et: null,
        });
      }
    }
  }

  // ── Trigger 2: crossed/locked book at commit time ────────────────────────────────
  // CONDOR is delta-neutral across 4 legs priced by condor.ts's own liquidity gate
  // (condorLiquidityGateBlocks) — this single-quote predicate does not apply to it, same
  // short-circuit moneynessGateBlocks uses for the same reason.
  if (!input.isCondor && input.quote) {
    const reason = evaluateQuoteValidity({
      bid: input.quote.bid,
      ask: input.quote.ask,
      mark: input.quote.mark,
    });
    if (reason === "crossed" || reason === "locked") {
      blocks.push({
        code: "qualification_dislocation",
        reason:
          `Contract quote is ${reason} at commit time (bid/ask book is ` +
          `${reason === "crossed" ? "impossible" : "zero-width"}) — an unstable book fails a fresh commit closed (G-23).`,
        threshold: null,
        unlock_et: null,
      });
    }
  }

  return blocks;
}

const QUALIFICATION_DISLOCATION_GATE_CODES: ReadonlySet<ZeroDteGateFailure> = new Set([
  "qualification_dislocation",
]);

/** Re-apply G-23 after a deferred (thesis-first) contract-plan attach (scan.ts) — mirrors
 *  refreshMoneynessGateBlocks/refreshPlanQualityGateBlocks exactly, needed for the same reason:
 *  thesis-first defers attachContractPlans (and therefore both the live underlying refresh and
 *  the live quote) until AFTER evaluateZeroDteGates has already run once with stale/absent
 *  current-side inputs. */
export function refreshQualificationDislocationGateBlocks(
  gate: ZeroDteGateVerdict,
  input: {
    qualificationPrice: number | null | undefined;
    qualificationAsOfMs: number | null | undefined;
    currentPrice: number | null | undefined;
    currentAsOfMs: number | null | undefined;
    quote?: { bid: number | null; ask: number | null; mark: number | null } | null;
    isCondor: boolean;
    maxPct?: number;
    maxWindowMs?: number;
  }
): ZeroDteGateVerdict {
  const rest = gate.blocks.filter((b) => !QUALIFICATION_DISLOCATION_GATE_CODES.has(b.code));
  const blocks = [...rest, ...qualificationDislocationGateBlocks(input)];
  return {
    ...gate,
    verdict: blocks.length > 0 ? "BLOCKED" : "COMMIT",
    blocks,
  };
}

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
  plan: ContractPlan | null,
  opts?: PlanQualityGateOpts
): ZeroDteGateVerdict {
  const nonPlan = gate.blocks.filter((b) => !PLAN_QUALITY_GATE_CODES.has(b.code));
  const blocks = [...nonPlan, ...planQualityGateBlocks(plan, opts)];
  return {
    ...gate,
    verdict: blocks.length > 0 ? "BLOCKED" : "COMMIT",
    blocks,
  };
}

const CONTRACT_LIQUIDITY_GATE_CODES: ReadonlySet<ZeroDteGateFailure> = new Set([
  "plan_thin_size",
  "plan_no_volume_or_oi",
]);

/** Re-apply G-21 after thesis-first deferred plan attach (scan.ts) — SIBLING to
 *  refreshPlanQualityGateBlocks (G-8/G-9), same reason: a plan attached AFTER gates
 *  never got a chance to fire this check on the first pass. */
export function refreshContractLiquidityGateBlocks(
  gate: ZeroDteGateVerdict,
  plan: ContractPlan | null
): ZeroDteGateVerdict {
  const nonLiquidity = gate.blocks.filter((b) => !CONTRACT_LIQUIDITY_GATE_CODES.has(b.code));
  const blocks = [...nonLiquidity, ...contractLiquidityGateBlocks(plan)];
  return {
    ...gate,
    verdict: blocks.length > 0 ? "BLOCKED" : "COMMIT",
    blocks,
  };
}

/** Belt-and-suspenders: true when a fresh find must NOT write a ledger row. Checks BOTH
 *  G-8/G-9 (quote quality) and G-21 (contract liquidity/depth) — a plan can slip past the
 *  first pass on either axis. */
export function freshCommitBlockedByPlan(
  plan: ContractPlan | null | undefined,
  opts?: PlanQualityGateOpts
): boolean {
  return (
    planQualityGateBlocks(plan ?? null, opts).length > 0 ||
    contractLiquidityGateBlocks(plan ?? null).length > 0
  );
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

const GOVERNOR_CYCLE_GATE_CODES: ReadonlySet<ZeroDteGateFailure> = new Set([
  "governor_session_stops",
  "governor_session_loss_halt",
  "governor_max_concurrent",
  "governor_premium_budget",
  "governor_gamma_budget",
  "correlated_conflict",
  "governor_concentration",
  "governor_reentry_lock",
]);

/**
 * Re-apply G-5 governor cycle blocks after thesis-first deferred plan attach (scan.ts).
 * The first gate pass may have counted phantom commits in `committedThisCycle` before plan
 * quality / moneyness refresh flipped verdicts — this pass threads the ACCURATE cycle set.
 */
export function refreshGovernorCycleBlocks(
  gate: ZeroDteGateVerdict,
  input: {
    ticker: string;
    direction: "long" | "short";
    plan: ContractPlan | null;
    gamma_regime: string | null;
    governor: GovernorSnapshot;
    nowMs: number;
    nowEtMinutes: number;
    governorPremiumAtRisk: number;
    governorShortGammaOpen: number;
    committedThisCycle: GovernorOpenPlan[];
  }
): ZeroDteGateVerdict {
  const nonGov = gate.blocks.filter((b) => !GOVERNOR_CYCLE_GATE_CODES.has(b.code));
  const blocks = [
    ...nonGov,
    ...evaluateZeroDteGovernor(
      {
        ticker: input.ticker,
        direction: input.direction,
        entry_premium: input.plan?.entry_max ?? input.plan?.mark ?? null,
        gamma_regime: input.gamma_regime,
      },
      input.governor,
      input.nowMs,
      input.committedThisCycle,
      {
        etMinutes: input.nowEtMinutes,
        premiumAtRisk: input.governorPremiumAtRisk,
        shortGammaOpen: input.governorShortGammaOpen,
      }
    ),
  ];
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
  // Phase 4: mirrors evaluateZeroDteGates's own `isCondor` flag (line ~531) — a delta-neutral
  // condor is scored under entirely different VIX (G-4) and conflict (G-6) rules than a
  // directional play, so both calibration verdicts below must branch on it the same way the
  // live gate does, or a condor row gets a directional verdict the live gate never computed.
  const isCondor = input.play_type === "CONDOR";

  // G-4 — VIX regime throttle verdict. Canonicalized 2026-09-09: the elevated (17-20) tier's
  // score floor is now uniform across every ticker/instrument type, so this function no longer
  // needs a tape-alignment ("aligned") read to compute it — see the live gate's own comment.
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
    if (isCondor) {
      // Mirrors the live condor G-4 branch above (~line 800): extreme VIX blocks EVERY condor
      // unconditionally — there is no index/ETF half-size carve-out for a delta-neutral sale,
      // unlike the directional branch below.
      g4 = {
        day_open_vix: vix,
        tier: "extreme",
        would_block: true,
        would_halve_size: false,
        note: `VIX ${vixR} ≥ ${VIX_EXTREME_THRESHOLD}: extreme vol regime threatens range integrity — condor sale blocked (condor G-4).`,
      };
    } else {
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
    }
  } else if (vix >= VIX_ELEVATED_THRESHOLD) {
    if (isCondor) {
      // Mirrors the live condor G-4 branch above: 17-20 VIX is the condor's BEST regime (fatter
      // premium collected while the range holds — condor-wr.mjs measured 98.7% WR on shipped
      // geometry including 17-20 sessions), so unlike the directional score-floor logic below,
      // a condor is never blocked here. Score/alignment play no role in the condor's own G-4.
      g4 = {
        day_open_vix: vix,
        tier: "elevated",
        would_block: false,
        would_halve_size: false,
        note: `VIX ${vixR} ≥ ${VIX_ELEVATED_THRESHOLD} (< ${VIX_EXTREME_THRESHOLD} extreme): a condor's best regime — fatter premium while the range holds; condor G-4 only blocks at extreme.`,
      };
    } else {
      // Mirrors the canonicalized live gate (2026-09-09): uniform ≥75 floor for every
      // ticker/instrument type, no tape-alignment or single-name relief.
      const clears = input.score >= VIX_ELEVATED_SCORE_FLOOR;
      g4 = {
        day_open_vix: vix,
        tier: "elevated",
        would_block: !clears,
        would_halve_size: false,
        note: clears
          ? `VIX ${vixR} ≥ ${VIX_ELEVATED_THRESHOLD}: score ≥ ${VIX_ELEVATED_SCORE_FLOOR} — clears canonicalized G-4 (uniform floor, every ticker/instrument type).`
          : `VIX ${vixR} ≥ ${VIX_ELEVATED_THRESHOLD}: canonicalized G-4 needs score ≥ ${VIX_ELEVATED_SCORE_FLOOR} for every ticker/instrument type (17-20 regime ran 25% WR vs 69% at 15-17).`,
      };
    }
  } else {
    g4 = {
      day_open_vix: vix,
      tier: "normal",
      would_block: false,
      would_halve_size: false,
      note: `VIX ${vixR} < ${VIX_ELEVATED_THRESHOLD}: normal regime.`,
    };
  }

  // G-6 — cross-system conflict verdict. CONDOR-EXEMPT: mirrors the live gate's own
  // `if (!isCondor)` scoping at G-6's enforcement site above — a delta-neutral condor has
  // no directional side to "oppose" another desk's take with. Without this, a PIN-sourced
  // condor that happens to correlate-and-oppose a live Slayer/Night Hawk take would get
  // tagged conflict:true/would_block:true here even though the live gate never blocks it,
  // silently mixing a structurally different (delta-neutral) population into the
  // directional would-block/would-pass cohorts `recommendGate("g6_conflict", ...)` uses to
  // decide whether G-6 should harden further.
  let g6: ZeroDteConflictCalibration;
  if (isCondor) {
    g6 = {
      conflict: false,
      against: [],
      would_block: false,
      applicable: false,
      note: "N/A — CONDOR is delta-neutral, G-6 exempt (mirrors the live gate).",
    };
  } else {
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
    g6 = {
      conflict,
      against,
      would_block: conflict && input.score < CONFLICT_SCORE_FLOOR,
      applicable: true,
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
  }

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
    // Every failing code, not just the primary one — see the field's own doc comment
    // (board.ts) for why: primary-only made unique/redundant-rejection and gate-ablation
    // analysis impossible to compute from history (a setup that failed both G-1 and G-12
    // only ever recorded whichever evaluated first).
    blocks: verdict && verdict.blocks.length > 0 ? verdict.blocks.map((b) => b.code) : [primary.code],
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
