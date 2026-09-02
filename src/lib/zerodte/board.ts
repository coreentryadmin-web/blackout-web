// 0DTE Command board — pure aggregation logic. Composes the EXISTING graded engines
// (SPX play / lotto / power hour) and the live HELIX tape into one ranked intraday
// board. Deliberately deterministic and read-only: full plays (entry/stop/target)
// come ONLY from the engines that already grade themselves into the track record;
// single-name flow reads are surfaced as SETUPS (direction + strike + evidence),
// never as fabricated entries — the same honesty rule the rest of the desk follows.
//
// Everything here is a pure function of its inputs (rows, clock) so it is unit-
// testable without providers; the API route does the fetching.

import { formatEtDate, isTradingDayEt } from "@/features/nighthawk/lib/session";
import { ZERODTE_MAX_DTE } from "@/lib/horizons";

export type SessionHeatState =
  | "PRE_MARKET" // before 9:30 ET — system warming: feeds, morning confirm, lotto scan
  | "OPENING_DRIVE" // 9:30-10:00 ET — heating up: ranges forming, engines arming
  | "RTH" // 10:00-15:30 ET — fully hot; directional 0DTE commits allowed
  | "POST_COMMIT" // 15:30-15:50 ET — no fresh commits (G-14); manage open risk to hard exit
  | "LATE_SESSION" // 15:50-16:00 ET — flat by time stop; no fresh entries
  | "CLOSED"; // outside RTH — hand off to Night Hawk

export type SessionHeat = {
  state: SessionHeatState;
  label: string;
  /** 0-100 "how hot is the desk" meter for the header visual. */
  heat_pct: number;
  note: string;
};

/** ET clock → heat state. `etMinutes` = minutes since midnight ET; weekday/holiday
 *  gating happens upstream (callers pass isTradingDay). */
export function sessionHeat(etMinutes: number, isTradingDay: boolean): SessionHeat {
  if (!isTradingDay) {
    return {
      state: "CLOSED",
      label: "Market closed",
      heat_pct: 0,
      note: "No session today — Night Hawk's evening playbook covers the next open.",
    };
  }
  const OPEN = 9 * 60 + 30;
  const TEN = 10 * 60;
  const COMMIT_CUTOFF = 15 * 60 + 30; // NEW_PLAY_CUTOFF / G-14
  const TIME_STOP = 15 * 60 + 50; // PLAN_RULES hard exit
  const CLOSE = 16 * 60;

  if (etMinutes < OPEN) {
    // Ramp 0→40 across the 2h before the open so the meter visibly "warms".
    const ramp = Math.max(0, Math.min(1, (etMinutes - (OPEN - 120)) / 120));
    return {
      state: "PRE_MARKET",
      label: "Warming up",
      heat_pct: Math.round(40 * ramp),
      note: "Pre-market: feeds warming, overnight plays confirming, lotto scan pending.",
    };
  }
  if (etMinutes < TEN) {
    return {
      state: "OPENING_DRIVE",
      label: "Opening drive",
      heat_pct: 70,
      note: "Ranges forming — engines arming. Best entries usually come after 9:50.",
    };
  }
  if (etMinutes < COMMIT_CUTOFF) {
    return {
      state: "RTH",
      label: "Desk hot",
      heat_pct: 100,
      note: "All engines live — new 0DTE commits until 3:30 PM ET.",
    };
  }
  if (etMinutes < TIME_STOP) {
    return {
      state: "POST_COMMIT",
      label: "Managing",
      heat_pct: 70,
      note: "No new 0DTE commits after 3:30 PM ET — managing open risk to the 3:50 PM hard exit.",
    };
  }
  if (etMinutes < CLOSE) {
    return {
      state: "LATE_SESSION",
      label: "Winding down",
      heat_pct: 50,
      note: "Past the 3:50 PM time stop — everything should be flat.",
    };
  }
  return {
    state: "CLOSED",
    label: "Session closed",
    heat_pct: 0,
    note: "Session done — Night Hawk builds tomorrow's playbook after the close.",
  };
}

/**
 * Status for a FRESH (not-yet-ledgered) find, given the session clock and the
 * find's own plan flags — the same "no new 0DTE plays after 3:30 PM ET"
 * cutoff every consumer of a fresh find must apply consistently. `heatState`
 * undefined is treated as closed (matches sessionHeat()'s own "no session today"
 * fallback).
 *
 * NEVER "OPEN" (P0 fix — the one-way commit door): a fresh find has NOT been
 * committed to the session ledger — its gate/plan/liquidity read is re-derived
 * from scratch on every ~5s scan build, so any label it wears here can flap on
 * the next tick (entry_status flips to MOVED, the spread widens to illiquid, a
 * gate re-evaluation blocks). This function used to return "OPEN" for a clean
 * RTH find, which rendered indistinguishably from a committed open position and
 * then visibly regressed to a watch/SKIP card seconds later. OPEN is reserved
 * for LEDGER rows (the desk's durable commit, written only after the full gate +
 * Cortex stack passed at persist time); until that row exists a find is at most
 * WATCH — a candidate, explicitly not a position.
 */
export function resolveFreshFindStatus(
  heatState: SessionHeatState | undefined,
  moved: boolean,
  illiquid: boolean
): "WATCH" | "SKIP" {
  const pastCutoff =
    heatState === "POST_COMMIT" ||
    heatState === "LATE_SESSION" ||
    heatState === "CLOSED" ||
    heatState === undefined;
  return moved || pastCutoff || illiquid ? "SKIP" : "WATCH";
}

// ── Polygon symbol mapping for index option roots ─────────────────────────────────
// The scan's mandate explicitly admits index products (SPY/SPX/NDX/QQQ…), and UW
// tape rows carry the OPTION ROOT as the ticker (SPXW, NDXP, …). Polygon's stock
// aggs endpoint returns an EMPTY result set (status OK, resultsCount 0) for those
// roots — the index itself prices under the `I:` namespace. Live-verified
// 2026-07-13: /v2/aggs/ticker/SPXW/range/1/day/2026-07-10/2026-07-10 → 0 results,
// I:SPX → o 7547.64 / c 7575.39. Without this mapping, an SPXW/SPX/NDX ledger row
// silently gets close=null at grading time and is stamped graded with a null
// direction grade FOREVER (fetchAggBars succeeds, so the retry path never fires),
// and the intraday-edge read (VWAP/opening-range/5m-trend) never attaches for
// index setups. ETF wrappers (SPY/QQQ/IWM) are real equities and pass through.
const POLYGON_INDEX_SPOT: Record<string, string> = {
  SPX: "I:SPX",
  SPXW: "I:SPX", // weekly/0DTE SPX root — same underlying index
  NDX: "I:NDX",
  NDXP: "I:NDX", // PM-settled NDX root
  RUT: "I:RUT",
  RUTW: "I:RUT",
  XSP: "I:XSP",
  VIX: "I:VIX",
};

/** Polygon aggs symbol for a flow/ledger ticker — index option roots map to the
 *  `I:` index namespace; everything else (equities, ETFs) passes through as-is. */
export function polygonSpotTicker(ticker: string): string {
  const upper = ticker.toUpperCase();
  return POLYGON_INDEX_SPOT[upper] ?? upper;
}

/** The index option roots the mapping above covers — exported for the P-6 regrade
 *  backfill (zerodte/regrade.ts), which must select EXACTLY the tickers whose
 *  historical null grades this mapping fixes. Single source of truth: derived from
 *  the map, never a second hand-maintained list. */
export const INDEX_OPTION_ROOTS: readonly string[] = Object.keys(POLYGON_INDEX_SPOT);

// ── Single-name 0DTE flow setups (evidence, not fabricated plays) ────────────────

export type FlowSetupInput = {
  ticker: string;
  premium: number;
  option_type: string;
  strike: number;
  expiry: string;
  dte?: number;
  alert_rule?: string;
  ask_pct?: number;
  underlying_price?: number;
  /** Per-contract fill price the print actually paid (UW alert `price`). */
  fill_price?: number;
  /** Open interest on the contract at alert time — sizes "new money" vs closing. */
  open_interest?: number;
  alerted_at: string;
};

// ── Discovery origin provenance (Phase 3a, docs/audit/0DTE-UNIFICATION-DESIGN.md §1a) ──
// Each committed setup carries a SET of the independent discovery sources that surfaced it —
// never collapsed into one undifferentiated pool. A flow-sourced setup is ["FLOW"]; a
// whole-market breakout ["BREAKOUT"]; a ticker found by BOTH ["FLOW","BREAKOUT"]. The set is
// persisted (ledger entry_context + feature vector) so the graded ledger can slice win-rate /
// P&L by origin (the calibration origin band, calibration.ts) and each source graduates
// through the n>=10 / delta>=15 ladder independently. PIN arrives in a later phase; the type
// already admits it so the merge/label math never has to be revisited.
export type DiscoveryOrigin = "FLOW" | "BREAKOUT" | "PIN";

// ── Play type (Phase 4, docs/audit/0DTE-UNIFICATION-DESIGN.md §1c + §3) ─────────────
// The board commits TWO kinds of structure. Everything shipped through Phase 3b is
// DIRECTIONAL — a single-contract long/short call/put graded on the −50/+100 premium
// path (plan.ts). Phase 4 adds CONDOR — a non-directional 4-leg defined-risk iron
// condor SOLD for a net credit, graded WIN=close-inside-both-shorts / DEFINED-LOSS=
// breach (condor.ts). The field defaults to DIRECTIONAL at EVERY construction site, so
// with the ZERODTE_CONDOR flag off nothing is ever a condor and the board is byte-for-
// byte unchanged. It routes the gate stack (gates.ts branches G-1/G-10/G-12/G-6 OFF for
// a neutral condor and swaps directional plan-quality for a condor liquidity gate), the
// plan shape, the grader, and the calibration band — so it must travel with the setup
// from discovery all the way to the graded ledger.
export type PlayType = "DIRECTIONAL" | "CONDOR";

// ── Contract horizon (0DTE hardening PR-1: HORIZON INTEGRITY; WIDENED 2026-08-06) ───
// docs/audit/0DTE-DESIGN-DECISIONS.md Q2. A setup's HORIZON is derived from the REAL
// dte of the contract that was actually selected — not from the intended board scope.
// The 0DTE board grades every committed row on the SESSION CLOCK (same-day 15:30 entry
// cutoff / 15:50 time-stop, plan.ts / condor.ts) — this is a DAY-TRADE discipline (exit by
// close), not a same-day-EXPIRY requirement; the grading math never reads the contract's own
// expiration date (see `src/lib/horizons.ts`'s DTE-windows note and the G-15-removal below).
// So the horizon is stamped at every construction site and carried to the graded ledger:
//   0     → ZERO_DTE          (same-day expiry; graded 15:30 close)
//   1..SETUP_MAX_DTE → ONE_DTE (nearest-available-this-week; still same-day-EXIT discipline)
//   >SETUP_MAX_DTE   → WEEKLY_FALLBACK (EXCLUDED — never committed, never graded)
// SETUP_MAX_DTE was widened 1→4 (2026-08-06, `src/lib/horizons.ts`'s `ZERODTE_MAX_DTE`) so a
// Friday-only-weekly single name (most single-name equities; no Mon-Thu listing) is admissible
// from any weekday, not just Thu/Fri — see docs/audit/FINDINGS.md for the live evidence (a
// Wednesday BREAKOUT scan rejecting 88/99 candidates as `no_same_day`) and G-15's removal note
// (gates.ts) proving the same-day-EXIT grading already holds correctly for dte=1 in production.
// Only ZERO_DTE/ONE_DTE ever commit; a WEEKLY_FALLBACK is dropped (the contract pickers don't
// reach past `SETUP_MAX_DTE`, and persist fails closed on any that somehow slips through). This
// keeps the 0DTE calibration/feature population structurally HOMOGENEOUS (same grading
// horizon for every row) — the precondition the later per-horizon versioning (Q12) needs, now
// enforced via `strategy-version.ts`'s DISCOVERY_VERSION/CONTRACT_SELECTOR_VERSION bump so
// pre-widening (dte=1 only) and post-widening (dte 1-4) "ONE_DTE" rows partition into separate
// calibration cohorts automatically rather than silently blending two different populations.
export type ContractHorizon = "ZERO_DTE" | "ONE_DTE" | "WEEKLY_FALLBACK";

/** Grading policy for the two committed same-day horizons — the ONLY policy that ever reaches
 *  the ledger (a WEEKLY_FALLBACK is excluded before commit, so no other policy is persisted). */
export const SAME_DAY_GRADING_POLICY = "same_day_1530_close";

/** Derive the horizon from the SELECTED contract's real dte (0→ZERO_DTE, 1..SETUP_MAX_DTE→
 *  ONE_DTE, else→WEEKLY_FALLBACK). Fail-closed: a non-finite/negative dte is treated as
 *  WEEKLY_FALLBACK so an unknown horizon can never be mistaken for same-day and graded with the
 *  15:30 time-stop. Pure. */
export function deriveContractHorizon(dte: number): ContractHorizon {
  if (Number.isFinite(dte)) {
    if (dte === 0) return "ZERO_DTE";
    if (dte >= 1 && dte <= SETUP_MAX_DTE) return "ONE_DTE";
  }
  return "WEEKLY_FALLBACK";
}

/** True for a committed same-day horizon (ZERO_DTE/ONE_DTE) the 0DTE 15:30 grader legitimately
 *  applies to. Used both at commit (drop anything else) and at grade time (assert before the
 *  same-day time-stop runs) so a stray dte≥2 can never be graded as same-day. Pure. */
export function isSameDayHorizon(h: ContractHorizon): boolean {
  return h === "ZERO_DTE" || h === "ONE_DTE";
}

/** The grading_policy string a setup carries for its horizon: the same-day 15:30 policy for a
 *  committed ZERO/ONE_DTE, or an explicit "excluded_non_same_day" marker for a WEEKLY_FALLBACK
 *  (which never commits — the marker only surfaces if such a setup is inspected pre-drop). Pure. */
export function gradingPolicyForHorizon(h: ContractHorizon): string {
  return isSameDayHorizon(h) ? SAME_DAY_GRADING_POLICY : "excluded_non_same_day";
}

// ── NH-R4: trading-session-aware DTE gap tracking (evidence-only) ────────────────────────────
// DTE above is pure CALENDAR days — a dte=1 (ONE_DTE) contract carries the SAME calendar-dte
// label whether the overnight is a normal ~16h hold (e.g. Tue→Wed) or a weekend/holiday hold
// (2-3 calendar days of unhedgeable gap risk). Nothing downstream (gates.ts's ONE_DTE handling,
// the pin/breakout scorers) distinguished the two. `calendarDteBetween` was ALSO duplicated
// identically in pin-source.ts and breakout-source.ts; both now import it from here.

/** Calendar days between two YYYY-MM-DD dates (UTC-noon anchored, DST-agnostic). Shared by the
 *  pin/breakout ATM contract pickers (previously duplicated verbatim in both files). */
export function calendarDteBetween(todayYmd: string, expiryYmd: string): number {
  const a = Date.parse(`${todayYmd}T12:00:00Z`);
  const b = Date.parse(`${expiryYmd.slice(0, 10)}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.NaN;
  return Math.round((b - a) / 86_400_000);
}

/** Count of SKIPPED non-trading calendar days strictly between `todayYmd` (exclusive) and
 *  `expiryYmd` (exclusive) — 0 for a normal single overnight (next calendar day is itself the
 *  expiry and a trading day), 2 for a plain weekend (Sat+Sun skipped between a Friday and the
 *  following Monday), 3+ for a holiday-adjacent weekend (the holiday plus the weekend). Reuses
 *  `isTradingDayEt`/`formatEtDate` (features/nighthawk/lib/session.ts) — the SAME holiday
 *  calendar `edition-funnel.ts` already relies on — rather than reinventing holiday logic. Pure.
 *
 * EVIDENCE ONLY (calibration-first, mirrors flow_accumulation/confluence above): this measures
 * the gap, it does not gate or score anything — see `session_gap_days` on EnrichedZeroDteSetup.
 *
 * Returns null (never fabricates) when either date is malformed, or `expiryYmd` is not strictly
 * after `todayYmd` (a same-day 0DTE expiry has no overnight to measure at all — that is "not
 * applicable", not a zero-day gap). */
export function tradingSessionGapDays(todayYmd: string, expiryYmd: string): number | null {
  const expiry = expiryYmd.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(todayYmd) || !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return null;
  const todayMs = Date.parse(`${todayYmd}T12:00:00Z`);
  const expiryMs = Date.parse(`${expiry}T12:00:00Z`);
  if (!Number.isFinite(todayMs) || !Number.isFinite(expiryMs) || expiryMs <= todayMs) return null;
  let gap = 0;
  let cursorMs = todayMs + 86_400_000;
  // Bounded to ~30 days so a malformed far-future expiry can't spin an unbounded loop; the 0/1DTE
  // pickers never select anything remotely that far out, so this never trims a real result.
  for (let i = 0; i < 30 && cursorMs < expiryMs; i++, cursorMs += 86_400_000) {
    if (!isTradingDayEt(formatEtDate(new Date(cursorMs)))) gap++;
  }
  return gap;
}

/** Canonical order for a stable, dedup-friendly origin set/label (FLOW < BREAKOUT < PIN). */
export const DISCOVERY_ORIGIN_ORDER: readonly DiscoveryOrigin[] = ["FLOW", "BREAKOUT", "PIN"];

/** Union two origin sets into a deduped, canonically-ordered set (pure). Used at merge time so
 *  a ticker found by two sources carries both origins, never a collapsed single value. */
export function unionDiscoveryOrigins(
  a: readonly DiscoveryOrigin[],
  b: readonly DiscoveryOrigin[]
): DiscoveryOrigin[] {
  const seen = new Set<DiscoveryOrigin>([...a, ...b]);
  return DISCOVERY_ORIGIN_ORDER.filter((o) => seen.has(o));
}

/** Opposing-direction co-discovery record (design Q1). When a second origin surfaces a
 *  ticker the merge already holds but in the OPPOSITE direction, the merge keeps the
 *  evidence-bearing setup's direction (it never fabricates agreement by flipping) — but
 *  that disagreement is real signal-quality information, so it is STAMPED here rather than
 *  silently dropped. EVIDENCE ONLY: it does not change what commits; the graded origin band
 *  measures whether opposing-co-discovery plays underperform before any no-trade rule. */
export type OriginDirectionConflict = {
  /** The direction the committed setup keeps (the evidence-bearing origin's read). */
  kept_direction: "long" | "short";
  /** The opposing direction the second origin argued for. */
  masked_direction: "long" | "short";
  /** The origin(s) whose opposing read was masked (e.g. ["PIN"] fading a FLOW long). */
  masked_origin: DiscoveryOrigin[];
};

/** Record an opposing-direction co-discovery on the KEPT setup (design Q1), mutating it in
 *  place, when an incoming same-ticker setup argues the opposite direction. Same-direction
 *  corroboration (the common case) sets nothing. Idempotent-ish: re-merging keeps the first
 *  recorded conflict. Pure aside from the single in-place stamp the merge functions rely on. */
export function noteOriginDirectionConflict(
  kept: EnrichedZeroDteSetup,
  incoming: Pick<EnrichedZeroDteSetup, "direction" | "discovery_origin">
): void {
  if (incoming.direction === kept.direction) return;
  if (kept.origin_direction_conflict) return; // first conflict wins
  kept.origin_direction_conflict = {
    kept_direction: kept.direction,
    masked_direction: incoming.direction,
    masked_origin: [...incoming.discovery_origin],
  };
}

// ── WS-06: FULL origin maps (persist every rail's read at merge, not just the first conflict) ──
// noteOriginDirectionConflict above keeps only the FIRST opposing pair, and the feature vector
// keeps only a collapsed origin LABEL. So a 3-origin / 2-direction merge (e.g. FLOW long +
// BREAKOUT long + PIN short) loses which rail argued what and at what strength — the raw material
// the calibration origin band needs to ask "does opposing co-discovery underperform, and does it
// matter WHICH rails disagreed?". This records EACH rail's (direction, score) as it merges, so the
// committed row can freeze the whole picture. EVIDENCE ONLY — merge behavior is unchanged; the kept
// setup's direction/score are exactly what they were.

/** The merge/precedence version these maps were frozen under. Bump BY HAND if the origin
 *  precedence (which rail owns the kept direction) or the merge/union rule changes.
 *  v1 = FLOW > BREAKOUT > PIN seating-order precedence (incumbent always wins on conflict).
 *  v2 = evidence-weighted on conflict (higher rail score owns direction; seating-order wins ties);
 *  same-direction corroboration still gets +CORROBORATION_SCORE_BOOST; opposing co-discovery does not. */
export const MERGE_POLICY_VERSION = "v2";

/** Score bump when ≥2 rails agree on the SAME direction for a ticker. Not applied on opposing
 *  co-discovery — fighting rails are not conviction. */
export const CORROBORATION_SCORE_BOOST = 8;

/** Per-origin (direction, score) contribution recorded at merge time. Score is the rail's raw
 *  evidence score at merge (rounded). First-write-wins per origin. */
export type OriginContribution = { direction: "long" | "short"; score: number };

/** The frozen origin maps pinned on a committed row (entry_context.origin_maps). Back-compat:
 *  legacy rows have none — readers must null-guard. */
export type OriginMaps = {
  /** Each rail's argued direction at merge, e.g. {FLOW:"long",BREAKOUT:"long",PIN:"short"}. */
  origin_direction_map: Partial<Record<DiscoveryOrigin, "long" | "short">>;
  /** Each rail's raw evidence score at merge. */
  origin_score_map: Partial<Record<DiscoveryOrigin, number>>;
  /** Which origin's direction was KEPT under the merge precedence (v2: highest score among rails
   *  that agree with the kept direction; seating-order FLOW > BREAKOUT > PIN breaks ties). */
  direction_owner: DiscoveryOrigin;
  /** Origins whose argued direction DISAGREES with the kept direction — ALL of them, not just the
   *  first (the gap noteOriginDirectionConflict left). Empty on full agreement / single origin. */
  disagreeing_origins: DiscoveryOrigin[];
  merge_policy_version: string;
};

/** Record `origins`' (direction, score) onto a setup's contribution map, first-write-wins per
 *  origin. Pure aside from the single in-place stamp (same idiom as noteOriginDirectionConflict). */
function seedOriginContributions(
  setup: EnrichedZeroDteSetup,
  origins: readonly DiscoveryOrigin[],
  direction: "long" | "short",
  score: number
): void {
  if (!setup.origin_contributions) setup.origin_contributions = {};
  const s = Number.isFinite(score) ? Math.round(score) : 0;
  for (const o of origins) {
    if (setup.origin_contributions[o] == null) setup.origin_contributions[o] = { direction, score: s };
  }
}

/** At a merge, record BOTH the kept setup's own rails and the incoming rail's read (before the
 *  union rewrites discovery_origin). Called by mergeDiscoveryOrigins / mergePinOrigins so every
 *  rail that touched a ticker leaves its (direction, score) — the whole disagreement picture, not
 *  just the first pair. Evidence only. */
export function recordOriginContributionsOnMerge(
  kept: EnrichedZeroDteSetup,
  incoming: Pick<EnrichedZeroDteSetup, "direction" | "discovery_origin" | "score">
): void {
  seedOriginContributions(kept, kept.discovery_origin, kept.direction, kept.score);
  seedOriginContributions(kept, incoming.discovery_origin, incoming.direction, incoming.score);
}

/**
 * Pick which rail owns the kept direction under v2 evidence-weighting: among rails that argued
 * `keptDirection`, highest score wins; seating-order (FLOW > BREAKOUT > PIN) breaks ties.
 * Pure. Falls back to the first origin on the row when none agree (defensive — should not happen
 * after a correctly applied merge).
 */
export function resolveDirectionOwner(
  origins: readonly DiscoveryOrigin[],
  dirMap: Partial<Record<DiscoveryOrigin, "long" | "short">>,
  scoreMap: Partial<Record<DiscoveryOrigin, number>>,
  keptDirection: "long" | "short"
): DiscoveryOrigin {
  const agreeing = DISCOVERY_ORIGIN_ORDER.filter(
    (o) => origins.includes(o) && dirMap[o] === keptDirection
  );
  if (agreeing.length === 0) return origins[0] ?? "FLOW";
  let best = agreeing[0]!;
  let bestScore = scoreMap[best] ?? 0;
  for (const o of agreeing.slice(1)) {
    const s = scoreMap[o] ?? 0;
    if (s > bestScore) {
      best = o;
      bestScore = s;
    }
  }
  return best;
}

/** When a whole-market rail gains FLOW corroboration, stamp whale-flow evidence onto the
 *  kept row (breakouts carry gross_premium=0 by construction). Contract geometry stays
 *  with the kept setup — only the flow conviction fields copy over. */
function stampFlowEvidenceFromIncoming(
  kept: EnrichedZeroDteSetup,
  incoming: EnrichedZeroDteSetup
): void {
  const incomingHasFlow = incoming.discovery_origin?.includes("FLOW");
  const keptHasFlowEvidence = (kept.gross_premium ?? 0) > 0;
  if (!incomingHasFlow || keptHasFlowEvidence || (incoming.gross_premium ?? 0) <= 0) return;
  kept.gross_premium = incoming.gross_premium;
  kept.prints = incoming.prints;
  kept.sweep_pct = incoming.sweep_pct;
  kept.side_dominance = incoming.side_dominance;
  kept.aggression = incoming.aggression;
  kept.flow_quality = incoming.flow_quality;
  kept.new_money = incoming.new_money;
  kept.spike = incoming.spike;
  kept.recent_premium_30m = incoming.recent_premium_30m;
  kept.net_premium = incoming.net_premium;
  if (incoming.first_seen) kept.first_seen = kept.first_seen ?? incoming.first_seen;
  if (incoming.last_seen) kept.last_seen = incoming.last_seen;
}

/**
 * Merge one incoming discovery setup onto a same-ticker kept setup (MERGE_POLICY_VERSION v2).
 * Returns the setup that should occupy the ticker slot after the merge (may be `kept` or a
 * replaced `incoming`). Same-direction → union origins + corroboration boost. Opposing
 * directions → higher score owns the slot (strict `>`); seating order wins ties (kept was seated
 * first, so equal scores keep FLOW/BREAKOUT over a later PIN). No boost on opposing co-discovery.
 */
export function mergeSameTickerDiscovery(
  kept: EnrichedZeroDteSetup,
  incoming: EnrichedZeroDteSetup
): EnrichedZeroDteSetup {
  recordOriginContributionsOnMerge(kept, incoming);
  const keptCondor = kept.play_type === "CONDOR";
  const incomingCondor = incoming.play_type === "CONDOR";
  // Structure-preserving: a CONDOR seat carries condor_plan + credit geometry. Same-direction
  // union used to keep the FLOW/directional incumbent and silently drop play_type/condor_plan —
  // SPX FLOW + SPX CONDOR then never seated a condor (FINDINGS 2026-07-28 CTO audit). Prefer the
  // CONDOR structure when exactly one side is CONDOR; union origins + corroboration onto it.
  if (keptCondor !== incomingCondor && kept.direction === incoming.direction) {
    const condor = keptCondor ? kept : incoming;
    if (!keptCondor) {
      incoming.origin_contributions = kept.origin_contributions;
    }
    condor.discovery_origin = unionDiscoveryOrigins(kept.discovery_origin, incoming.discovery_origin);
    if (condor.discovery_origin.length > 1) {
      condor.score = Math.min(100, (condor.score ?? 0) + CORROBORATION_SCORE_BOOST);
    }
    stampFlowEvidenceFromIncoming(condor, incoming);
    stampFlowEvidenceFromIncoming(condor, kept);
    return condor;
  }
  if (kept.direction === incoming.direction) {
    kept.discovery_origin = unionDiscoveryOrigins(kept.discovery_origin, incoming.discovery_origin);
    if (kept.discovery_origin.length > 1) {
      kept.score = Math.min(100, (kept.score ?? 0) + CORROBORATION_SCORE_BOOST);
    }
    stampFlowEvidenceFromIncoming(kept, incoming);
    return kept;
  }
  const keptScore = Number.isFinite(kept.score) ? kept.score : 0;
  const incomingScore = Number.isFinite(incoming.score) ? incoming.score : 0;
  // On a direction fight, prefer CONDOR on a score tie (structure > seating-order for credit seats).
  if (incomingScore > keptScore || (incomingScore === keptScore && incomingCondor && !keptCondor)) {
    // Incoming owns the direction — take its setup, preserve contribution maps, stamp the masked read.
    incoming.origin_contributions = kept.origin_contributions;
    incoming.discovery_origin = unionDiscoveryOrigins(kept.discovery_origin, incoming.discovery_origin);
    if (!incoming.origin_direction_conflict) {
      incoming.origin_direction_conflict = {
        kept_direction: incoming.direction,
        masked_direction: kept.direction,
        masked_origin: [...kept.discovery_origin],
      };
    }
    return incoming;
  }
  // Kept wins (higher or equal score). Stamp conflict; no corroboration boost on a fight.
  noteOriginDirectionConflict(kept, incoming);
  kept.discovery_origin = unionDiscoveryOrigins(kept.discovery_origin, incoming.discovery_origin);
  return kept;
}

/** Count how many board setups carry each discovery rail (and how many are multi-rail). Pure. */
export function summarizeDiscoveryRailMix(
  setups: ReadonlyArray<Pick<EnrichedZeroDteSetup, "discovery_origin">>
): { FLOW: number; BREAKOUT: number; PIN: number; multi: number; total: number } {
  const out = { FLOW: 0, BREAKOUT: 0, PIN: 0, multi: 0, total: setups.length };
  for (const s of setups) {
    const origins = Array.isArray(s.discovery_origin) ? s.discovery_origin : [];
    for (const o of origins) {
      if (o === "FLOW" || o === "BREAKOUT" || o === "PIN") out[o] += 1;
    }
    if (origins.length > 1) out.multi += 1;
  }
  return out;
}

/** Build the frozen origin maps for a committing setup. Reads the contributions recorded at merge
 *  time; for any origin on the setup with no recorded contribution (the common single-rail case, or
 *  a rail that never went through a conflicting merge) it seeds from the setup's own kept
 *  direction/score — so the maps are ALWAYS complete for the row's discovery_origin set. Pure.
 *  direction_owner (v2) = highest-score rail among those that agree with the kept setup direction;
 *  seating-order breaks ties. */
export function buildOriginMaps(setup: EnrichedZeroDteSetup): OriginMaps {
  const contributions = setup.origin_contributions ?? {};
  const dirMap: Partial<Record<DiscoveryOrigin, "long" | "short">> = {};
  const scoreMap: Partial<Record<DiscoveryOrigin, number>> = {};
  // Defensive: a setup always carries discovery_origin in production, but tolerate an
  // absent/empty set (older fixtures) rather than throw — origin maps are evidence, never load-bearing.
  const origins: readonly DiscoveryOrigin[] = Array.isArray(setup.discovery_origin) ? setup.discovery_origin : [];
  for (const o of origins) {
    const c = contributions[o];
    dirMap[o] = c ? c.direction : setup.direction;
    scoreMap[o] = c ? c.score : (Number.isFinite(setup.score) ? Math.round(setup.score) : 0);
  }
  const keptDirection = setup.direction;
  const owner = resolveDirectionOwner(origins, dirMap, scoreMap, keptDirection);
  const disagreeing = origins.filter((o) => dirMap[o] !== keptDirection);
  return {
    origin_direction_map: dirMap,
    origin_score_map: scoreMap,
    direction_owner: owner,
    disagreeing_origins: disagreeing,
    merge_policy_version: MERGE_POLICY_VERSION,
  };
}

/** Canonical "+"-joined label for an origin set ("FLOW", "BREAKOUT", "FLOW+BREAKOUT", …). An
 *  empty/absent set (a pre-3a ledger row) is "no_origin" so the calibration band never
 *  mislabels a legacy row as a real origin. Pure. */
export function discoveryOriginLabel(origins: readonly DiscoveryOrigin[] | null | undefined): string {
  if (!Array.isArray(origins) || origins.length === 0) return "no_origin";
  const ordered = DISCOVERY_ORIGIN_ORDER.filter((o) => origins.includes(o));
  return ordered.length ? ordered.join("+") : "no_origin";
}

// ── Underlying-mark provenance (frozen-underlying fix) ──────────────────────────────
// A setup's `underlying_price` drives the entry/target/stop geometry AND the P&L a member reads
// off the card, so "how old is this mark" must travel WITH the mark. See the field docs on
// ZeroDteSetup.underlying_price_as_of / _source below for the failure this closes.
export type UnderlyingPriceSource = "flow_print" | "chain_spot" | "live_option_snapshot";

/**
 * Age of a setup's underlying mark in ms, or null when the age is UNKNOWABLE (no as-of stamped,
 * or no mark at all). null is deliberately NOT 0: an unstamped mark must degrade to MISSING, the
 * repo's standing "missing looks missing, never confident-and-wrong" rule (PR #1792) — never be
 * silently rendered as fresh. A negative age (provider clock ahead of ours) floors to 0, mirroring
 * computeQuoteAgeMs in scan.ts so clock skew can never manufacture staleness.
 */
export function underlyingMarkAgeMs(
  setup: Pick<ZeroDteSetup, "underlying_price" | "underlying_price_as_of">,
  nowMs: number
): number | null {
  if (setup.underlying_price == null) return null;
  if (!setup.underlying_price_as_of) return null;
  const t = Date.parse(setup.underlying_price_as_of);
  if (!Number.isFinite(t)) return null;
  const age = nowMs - t;
  return age > 0 ? age : 0;
}

/**
 * Pure re-stamp of a setup's underlying mark from a FRESHER observation, returning the patch to
 * apply (or null when there is nothing fresher — the caller then leaves the setup untouched).
 *
 * `otm_pct` is recomputed here on purpose. It is derived from the underlying with the SAME formula
 * the flow/breakout/pin construction sites use (positive = OTM on either side), so refreshing the
 * mark while leaving the old moneyness behind would leave the setup internally inconsistent by
 * exactly the staleness we just removed — and `otm_pct` is a gate input (SETUP_MAX_ITM_PCT /
 * SETUP_MAX_OTM_PCT).
 *
 * CORRECTED 2026-08-27 (P0 fix — this comment previously claimed "the refresh runs BEFORE
 * attachGateVerdicts, so the moneyness gate now judges the REAL moneyness", which was FALSE: the
 * refresh restamps this field, but until gates.ts's evaluateZeroDteGates gained the `otmPct` input
 * (moneynessGateBlocks/refreshMoneynessGateBlocks), NOTHING ever re-compared the refreshed value
 * against SETUP_MAX_ITM_PCT/SETUP_MAX_OTM_PCT — it rode through the gate stack as a passive AUDIT
 * field only, exactly like the ordinary (non-refreshed) case this function exists to fix. Caught
 * live 2026-08-27: SNXX short committed 9.55% ITM and PATH long 4.11% ITM, both ~2-5x past the 2%
 * SETUP_MAX_ITM_PCT cap. What actually happens now: in the ordinary pipeline (scan.ts's
 * attachContractPlans runs before attachGateVerdicts) the caller passes this refreshed otm_pct
 * straight into evaluateZeroDteGates's `otmPct` input, so the moneyness gate DOES now judge the
 * real, refreshed moneyness. In the thesis-first pipeline (attachContractPlans runs AFTER gates),
 * the caller must additionally call refreshMoneynessGateBlocks once this refresh has run — see
 * that function's doc. This is precisely the feedback the no_underlying_price comment below
 * ("a live underlying price is available moments later in scan.ts's attachContractPlans ... but
 * was never fed back") flagged as missing — restamping the field alone was not "feeding it back";
 * feeding it back requires the gate to actually re-read it, which this fix adds.
 */
export function refreshUnderlyingFromLiveSpot(input: {
  livePrice: number | null | undefined;
  liveObservedAtMs: number | null | undefined;
  /** Side the setup's top strike sits on — long ⇒ call, short ⇒ put (every construction site). */
  direction: "long" | "short";
  topStrike: number;
  /** CONDOR has no single moneyness (4 legs) — otm_pct stays null for it. */
  hasSingleStrikeMoneyness: boolean;
}): Pick<ZeroDteSetup, "underlying_price" | "underlying_price_as_of" | "underlying_price_source" | "otm_pct"> | null {
  const price = Number(input.livePrice);
  if (!Number.isFinite(price) || price <= 0) return null; // no live mark → keep the stamped one
  // An as-of we cannot read is worse than the mark we already have a real as-of for: refusing to
  // refresh here keeps the honest older stamp instead of swapping in a fresher number with an
  // unknown age. Fail toward the KNOWN.
  const observed = Number(input.liveObservedAtMs);
  if (!Number.isFinite(observed) || observed <= 0) return null;
  const underlying = Math.round(price * 100) / 100; // round at the data layer (repo-wide rule)
  const raw = ((input.topStrike - underlying) / underlying) * 100;
  return {
    underlying_price: underlying,
    underlying_price_as_of: new Date(observed).toISOString(),
    underlying_price_source: "live_option_snapshot",
    otm_pct: input.hasSingleStrikeMoneyness
      ? Math.round((input.direction === "long" ? raw : -raw) * 100) / 100
      : null,
  };
}

export type ZeroDteSetup = {
  ticker: string;
  direction: "long" | "short";
  /** Order STRUCTURE type (Phase 4). DIRECTIONAL = single-contract long/short call/put
   *  (the only kind through Phase 3b); CONDOR = a delta-neutral 4-leg iron condor sold
   *  for credit. Defaults DIRECTIONAL at every construction site — a CONDOR is only ever
   *  produced by the flag-gated condor router (condor.ts). For a CONDOR, `direction` is
   *  NOMINAL provenance only (the fade side of the pin it came from); the structure is
   *  neutral, so the directional gates and the −50/+100 grader do NOT apply to it. */
  play_type: PlayType;
  /** Discovery provenance SET (Phase 3a) — which independent source(s) surfaced this setup.
   *  Flow-sourced setups are ["FLOW"]; breakout-sourced ["BREAKOUT"]; both ["FLOW","BREAKOUT"].
   *  Never collapsed into one pool — persisted so calibration can slice outcomes by origin. */
  discovery_origin: DiscoveryOrigin[];
  /** Dominant strike by premium on the dominant side. */
  top_strike: number;
  expiry: string;
  dte: number;
  /** Contract HORIZON (PR-1 horizon integrity) derived from the REAL selected-contract dte:
   *  0→ZERO_DTE, 1→ONE_DTE, ≥2→WEEKLY_FALLBACK (deriveContractHorizon). Stamped at every
   *  construction site and persisted to the ledger so downstream reads the HORIZON, not just the
   *  numeric dte. Only ZERO_DTE/ONE_DTE ever commit; a WEEKLY_FALLBACK is excluded pre-commit. */
  contract_horizon: ContractHorizon;
  /** The REAL dte of the selected contract at commit — equal to `dte` today, but named to make the
   *  "which horizon was this actually graded on" question answerable at the ledger without inferring
   *  it back from expiry vs session date. */
  actual_dte_at_commit: number;
  /** Grading policy this setup is graded under. Committed rows are always the same-day 15:30 policy
   *  (SAME_DAY_GRADING_POLICY); the excluded weeklies never reach commit. */
  grading_policy: string;
  net_premium: number;
  gross_premium: number;
  prints: number;
  sweep_pct: number;
  /** Premium-weighted dominance of the winning side (0.5-1). */
  side_dominance: number;
  underlying_price: number | null;
  /**
   * PROVENANCE of `underlying_price` — WHEN that mark was observed (ISO-8601 UTC), so a consumer
   * can tell a live spot from a hours-old stamp. Historically the flow lane picked the freshest
   * SURVIVING print's `underlying_price` and THREW THE AS-OF AWAY (see deriveZeroDteSetups), which
   * made a frozen mark indistinguishable from a live one: a thinly-traded name with no new
   * qualifying print kept its last print's underlying indefinitely and nothing downstream could
   * tell. Measured live 2026-08-06 against the RTH close: 9/20 board setups >0.5% off, 4 >1%,
   * worst FSLR +2.62% on a 2h18m-old print (docs/audit/FINDINGS.md).
   * null = as-of genuinely UNKNOWN — treat as MISSING, never as fresh.
   */
  underlying_price_as_of: string | null;
  /**
   * WHICH observation produced `underlying_price`:
   *   "flow_print"           — carried by a historical UW flow alert (as-of = that alert's time).
   *   "chain_spot"           — the live chain/GEX spot read by the BREAKOUT/PIN/CONDOR discovery pass.
   *   "live_option_snapshot" — refreshed off the batched unified option snapshot the scan already
   *                            fetches for contract pricing (scan.ts attachContractPlans) — the
   *                            freshest mark available, at ZERO extra request cost.
   * null only when `underlying_price` itself is null (missing looks missing).
   */
  underlying_price_source: UnderlyingPriceSource | null;
  /** 0-100 deterministic evidence score (premium tiers + sweeps + dominance + breadth). */
  score: number;
  /** Premium-weighted avg per-contract fill on the top strike — what flow PAID. */
  top_strike_avg_fill: number | null;
  /** Premium-weighted share of the tape that traded AT THE ASK (0-1; aggressive buying). */
  aggression: number | null;
  /** Top strike's distance from spot, % — positive = OTM, negative = ITM. */
  otm_pct: number | null;
  /** Share of top-strike flow that exceeds existing OI — opening positioning, not closing. */
  new_money: boolean;
  /** Premium that landed in the last 30 minutes of the observed tape. */
  recent_premium_30m: number;
  /** Sudden-flow-spike flag: ≥half the ticker's whole tape arrived in the last 30m. */
  spike: boolean;
  first_seen: string | null;
  last_seen: string | null;
  /**
   * 0-100 flow-quality read on THIS setup's tape (computeFlowQuality) — the institutional
   * flow-quality layer. Kept alongside `score` (not folded into it) so the feature store
   * records it as an independent signal for the probability/Bayesian layers to weigh; the
   * gate stack still judges `score`. Null only if the tape produced no usable prints.
   */
  flow_quality: FlowQuality | null;
};

// Exported so the audit trail (buildZeroDteAuditRow below) can cite the actual
// live gate thresholds instead of a second, driftable copy of these numbers.
export const SETUP_MIN_GROSS = 200_000; // lowered 750K→300K→200K — quiet tapes were starving FLOW; $200K still filters noise while catching mid-cap institutional prints
export const SETUP_MIN_DOMINANCE = 0.55; // lowered from 0.65 — still requires directional lean but lets mixed-tape movers through
// Day Trade board admission ceiling — re-exported under its historical name (SETUP_MAX_DTE) so
// existing call sites (:828, :853 below) need no edit. Sourced from horizons.ts's ZERODTE_MAX_DTE,
// the single cross-engine ceiling — see that file's header for the 2026-08-06 widening rationale.
export const SETUP_MAX_DTE = ZERODTE_MAX_DTE;
/** Aggressive (at-the-ask) share of the tape must be meaningful — a tape of SOLD
 *  premium (bid-side prints) is income harvesting, not directional conviction. */
export const SETUP_MIN_AGGR_SHARE = 0.3;
/** At least this fraction of the gross premium must come from prints that actually CARRY
 *  aggressor metadata (a finite ask_pct). Prints with no ask_pct get a neutral 0.5 aggression
 *  weight so thin metadata doesn't zero the board — but if (almost) EVERY print lacks it, the
 *  aggression share collapses to ~0.5 and clears SETUP_MIN_AGGR_SHARE with ZERO real aggressor
 *  evidence, and direction reverts to a raw call-vs-put premium split. This floor fails that
 *  case closed: no aggressor data ⇒ can't assert conviction (9-1 / PR #1028). */
export const SETUP_MIN_KNOWN_AGGR_FRAC = 0.5;
/** Top strike more than this % IN the money = stock replacement, not a directional
 *  0DTE bet — the SNDK 1880p-at-1723 class of fake-out. */
export const SETUP_MAX_ITM_PCT = 2;
/** Far-OTM lotto cap (Phase 0 firewall): a top strike more than this % OUT of the money
 *  is an egregious 0DTE lottery ticket, not a momentum play — the moneyness gate had NO
 *  upper bound, so a far-OTM lotto stack (big premium, terrible geometry) passed straight
 *  through. Default DELIBERATELY GENEROUS (12%) so a normal slightly-OTM momentum entry
 *  (typ. 2–5% OTM) is untouched — this only rejects the tail. Env-overridable via
 *  ZERODTE_SETUP_MAX_OTM_PCT (a number; invalid/absent → the 12 default). Set very high
 *  (e.g. 999) to effectively disable. */
export const SETUP_MAX_OTM_PCT = ((): number => {
  const raw = Number(process.env.ZERODTE_SETUP_MAX_OTM_PCT);
  return Number.isFinite(raw) && raw > 0 ? raw : 12;
})();

/** How much of a print's premium counts DIRECTIONALLY, by aggressor side.
 *  At/near the ask = conviction buying; bid-side = sold premium (opposite intent);
 *  unknown = partial credit so thin metadata doesn't zero the board. */
function aggressionWeight(askPct: number | null | undefined): number {
  if (askPct == null || !Number.isFinite(askPct)) return 0.5;
  if (askPct >= 60) return 1;
  if (askPct >= 45) return 0.6;
  return 0.15;
}

/**
 * Reconcile the tier-based FLOW evidence score with `computeFlowQuality`.
 * Mega-cap / ETF tapes (QQQ, SPY) often carry $5–10M gross with mixed-side hedging
 * that crushes dominance points in the tier formula while flow_quality still reads
 * real institutional accumulation — measured live 2026-08-25: QQQ $7.6M gross scored
 * 58 on tiers alone despite clearing every evidence gate. This lifts toward the
 * flow-quality read when gross + FQ agree; it never inflates above what FQ supports.
 */
export function calibrateFlowEvidenceScore(
  evidenceScore: number,
  flowQuality: FlowQuality | null,
  gross: number
): number {
  const base = Math.max(0, Math.min(100, evidenceScore));
  if (!flowQuality || gross < 1_000_000) return base;
  const fq = flowQuality.score;
  if (gross >= 5_000_000 && fq >= 55) {
    const blended = Math.round(base * 0.5 + fq * 0.5);
    // Already inside gross >= 5_000_000 here (line 792's guard), so the floor is just 65 vs 62.
    const institutionalFloor = gross >= 7_000_000 ? 65 : 62;
    return Math.max(0, Math.min(100, Math.max(blended, Math.min(institutionalFloor, fq + 5))));
  }
  if (gross >= 2_000_000 && fq >= 65) {
    return Math.max(base, Math.min(100, Math.round(base * 0.65 + fq * 0.35)));
  }
  return base;
}

// ── Gate-rejection / near-miss capture (task #147) ────────────────────────────────
// deriveZeroDteSetups below evaluates 4 real gates per aggregated candidate ticker
// (SETUP_MIN_GROSS, SETUP_MIN_AGGR_SHARE, SETUP_MIN_DOMINANCE, SETUP_MAX_ITM_PCT) —
// plus two defensive structural guards: a dominant side with premium but somehow no
// strike on record (practically unreachable in real data), and a candidate whose tape
// never carried a usable underlying price (see no_underlying_price below — NOT
// practically unreachable; UW alert payloads can legitimately omit it) — and
// `continue`s straight past any candidate that fails one, with nothing surviving past
// that loop iteration.
// This type + the optional `opts.rejections` out-array below let a caller durably
// record exactly what was known about a candidate AT THE POINT it was rejected — no
// more, no less. A rejection at an EARLIER gate genuinely never computes the LATER
// gates' metrics (the real scan short-circuits there too), so this deliberately
// leaves those fields `null` rather than back-filling a full recompute the live scan
// itself never performs — the same "never fabricate a reading that wasn't actually
// evaluated" discipline this codebase applies to shadow-factor availability.
export type ZeroDteGateFailure =
  | "min_gross"
  | "min_aggr_share"
  | "min_dominance"
  | "max_itm_pct"
  | "no_dominant_strike"
  | "no_underlying_price"
  // ── Hard entry-gate stack (G-1/G-2/G-3/G-5, docs/audit/NIGHTHAWK-0DTE-DECISION.md §2) —
  // evaluated in ./gates.ts AFTER the four evidence gates above, i.e. only for candidates
  // that already qualified as setups. Persisted through the same rejection log so "why
  // didn't ticker X commit" is one queryable surface for both gate families.
  | "tape_alignment" // G-1: direction fights the SPY session bias
  | "no_market_bias" // G-1 fail-closed: bias read missing or stale
  | "opening_window" // G-2: no new commits before 10:00 ET
  | "late_afternoon" // G-14: no new directional commits after 15:30 ET
  | "score_floor" // G-3: post-edge-layer score below 65
  | "single_rail_corroboration" // G-17: the 65-74 band needs the prime floor (≥75), any origin combo
  | "confluence_floor" // G-12: too few VWAP-side/market-aligned confirmations (0-conf −12.5% EV; higher floor 10:00–10:45)
  | "governor_max_concurrent" // G-5: 3 plans already open
  | "governor_session_stops" // G-5: 3 stops today — halted for the session
  | "governor_session_loss_halt" // G-5/SEV-3: realized-loss halt (3 losers or -120% cumulative) — distinct from hard-stop halt
  | "governor_reentry_lock" // G-5: same-direction re-entry within 20m of that ticker's stop
  | "correlated_conflict" // G-5/B-3: opposes an OPEN plan on a correlated ticker
  | "gate_context_unavailable" // fail-closed: gate inputs (ledger/governor) unreadable
  // ── G-4/G-6 hard gates (promoted from calibration 2026-07-16) ─────────────
  | "vix_elevated" // G-4: VIX 17-20 regime + score < 75 (69.2% WR at <17 vs 25.0% at ≥17)
  | "vix_extreme" // G-4: VIX ≥ 20 + non-index/ETF product (blocked outright)
  | "cross_system_conflict" // G-6: opposes live Slayer or Night Hawk take + score < 80
  | "macro_hard_block" // G-7: CPI/FOMC/NFP/PPI/GDP hard-block window (shared w/ Slayer)
  | "plan_moved" // G-8: mark ran ≥35% past the flow fill — don't chase
  | "plan_illiquid" // G-9: bid/ask spread >15% of mark — untradeable exit tax
  | "plan_no_quote" // G-9: no live quote and no fill — evidence only
  // ── WS-04 malformed-quote validation (fail-closed; additive to plan_illiquid/plan_no_quote) ──
  | "plan_quote_invalid" // G-9: malformed book — zero/null bid, crossed, locked, mark out of band, or $-spread over cap
  | "plan_quote_stale" // G-9: quote age beyond the freshness bound (only when a quote timestamp is available)
  | "intraday_conflict" // G-10: VWAP + 5m trend oppose the play direction
  | "halted" // G-11: underlying trading halt
  | "earnings" // G-11: reports today/next session — different trade than 0DTE scalp
  // ── Fresh-commit fail-CLOSED firewall (Phase 0) — a gate INPUT was attempted but came
  // back UNAVAILABLE, so a present value COULD have blocked this candidate. Blocking is
  // conservative (only when a present value could actually have fired the gate) so it
  // never spuriously empties the board. Each is env-overridable (see gates.ts).
  | "vix_unavailable" // G-4 fail-closed: day-open VIX unreadable AND a present VIX could have blocked
  | "macro_unavailable" // G-7 fail-closed: macro-calendar FETCH failed (not "zero events") — can't rule out CPI/FOMC/NFP
  | "earnings_unavailable" // G-11 fail-closed: earnings FEED read failed (not "none report today") — can't rule out a print today
  | "halt_feed_stale" // G-11 fail-closed (D2): halt feed cold — BOTH UW + LULD halt sources stale — can't rule out a halted underlying
  | "max_otm_pct" // far-OTM lotto cap: top strike is more than SETUP_MAX_OTM_PCT% OTM
  // ── WS-21 source-recovery gate (default-OFF; ZERODTE_REQUIRE_HEALTHY_SOURCE=1 to arm) ──────
  // Only fires when the flag is ON and the WS data source is mid-recovery (not yet HEALTHY): a
  // reconnect gap may not be reconciled, so a fresh source-dependent commit is withheld. Flag OFF
  // (default) ⇒ this code is never produced and the existing freshness thresholds still govern.
  | "source_recovering"
  // ── Night Hawk Cortex layer (./cortex-gate.ts, NIGHTHAWK-CORTEX-DESIGN.md §2) —
  // evaluated on gate SURVIVORS only, i.e. only after every hard gate above passed.
  // The <source> suffix names the Cortex source that vetoed (e.g. "cortex_veto:flow-quality").
  | `cortex_veto:${string}` // a Cortex source hard-vetoed the entry
  | "cortex_veto_blind" // Cortex blind to BOTH veto-capable sources on a fresh commit → HOLD
  | "cortex_net_negative" // no veto, but the evidence score nets < 0 — doesn't print
  | "cortex_thin_evidence" // 2026-09-01: no veto, score >= 0 but too few sources answered to trust it — distinct from cortex_net_negative, whose score is always negative
  | "cortex_contested" // NH-R9: both a real support case and a real oppose case, net score below the A floor — unresolved internal fight, doesn't print
  | "cortex_gex_walls_oppose_unresolved" // 2026-08-28: a real, active gex-walls oppose below the A floor — evidenced (90-day + same-week live) to grade worse even at net score >= 0
  // ── CONDOR play-type gates (Phase 4, gates.ts) — replace the DIRECTIONAL plan-quality /
  // tape / confluence gates for a delta-neutral iron condor. A condor is graded WIN=close-
  // inside-both-shorts / DEFINED-LOSS=breach, so it wants a CONTAINED, LOW-vol tape and a
  // real credit — the opposite discipline from a directional momentum entry.
  | "condor_liquidity" // all 4 legs must be quotable, credit ≥ floor, per-leg spread tax bounded
  | "condor_vix_regime" // condor WANTS low VIX — elevated/extreme vol raises the bar / blocks the sale
  | "condor_macro_block" // block a condor HARDER in a macro window (a CPI/FOMC breakout is its worst case)
  | "condor_range_break" // spot has approached/breached a short strike — the defended range is failing
  | "flow_accumulation_conflict" // G-13: multi-day flow direction opposes the setup (aligned === false)
  | "regime_blind" // Regime Plane: VIX/macro/halt/GEX blind — no fresh commits
  | "governor_concentration" // Q9 enforced: too many correlated same-direction opens
  | "governor_premium_budget" // Phase 2c: aggregate entry premium budget exceeded
  | "governor_gamma_budget" // Phase 2c: short-gamma open count exceeded
  // ── Thesis-first pipeline (thesis/live-pipeline.ts) — archetype + rank tier fail-closed
  | "thesis_rank_reject"
  | "thesis_archetype_block";

export type ZeroDteGateRejection = {
  ticker: string;
  gate_failed: ZeroDteGateFailure;
  /** Human-readable block sentence (hard-gate rows; the UI's SKIP card copy). Null for
   *  the four evidence gates, whose numeric columns already carry the whole story. */
  reason?: string | null;
  /** The real threshold constant this candidate was measured against (cited live,
   *  same discipline buildZeroDteAuditRow uses, so a future threshold tune can't
   *  retroactively relabel a historical rejection). `null` for the structural
   *  no_dominant_strike/no_underlying_price guards, which have no numeric threshold. */
  threshold: number | null;
  gross_premium: number;
  /** Null when the scan never reached the aggression-share gate for this candidate. */
  aggression: number | null;
  /** Null when the scan never reached the dominance gate for this candidate. */
  side_dominance: number | null;
  /** Null when the scan never reached the moneyness gate — including a
   *  no_underlying_price rejection, since that IS the moneyness gate failing closed
   *  on unreadable data (P0 fix: previously an unknown underlying price silently
   *  SKIPPED this gate instead of failing it — see SETUP_MAX_ITM_PCT below). */
  otm_pct: number | null;
  /** The dominant side's lean, once the scan gets far enough to compute it (gate C
   *  onward). Null for a min_gross/min_aggr_share rejection — the real scan does not
   *  know a direction at that point either. */
  direction: "long" | "short" | null;
  prints: number;
  first_seen: string | null;
  last_seen: string | null;
};

/**
 * Derive ranked single-name setups from HELIX tape rows. Index products should be
 * excluded upstream (SPX has its own engines on this board).
 *
 * `opts.rejections`, when supplied, is an accumulator this function pushes a
 * `ZeroDteGateRejection` into for every candidate ticker that fails a gate — purely
 * additive (mutates the caller's array; never read from, never affects `setups`) and
 * a complete no-op when omitted, so every existing caller/test that doesn't pass it
 * sees zero behavior or allocation change. See the module doc above the type for why
 * the captured data is necessarily partial per gate.
 */
export function deriveZeroDteSetups(
  rows: FlowSetupInput[],
  opts?: {
    maxSetups?: number;
    excludeTickers?: Set<string>;
    nowMs?: number;
    todayYmd?: string;
    rejections?: ZeroDteGateRejection[];
  }
): ZeroDteSetup[] {
  const maxSetups = opts?.maxSetups ?? 12;
  type Agg = {
    call: number;
    put: number;
    /** Aggression-weighted (at-the-ask) sums — what the DIRECTIONAL read uses. */
    callAggr: number;
    putAggr: number;
    aggrWeighted: number;
    /** Gross premium from prints that carry aggressor metadata (finite ask_pct). */
    knownAskPrem: number;
    sweep: number;
    gross: number;
    prints: number;
    strikes: Map<
      string,
      {
        prem: number;
        premAggr: number;
        strike: number;
        expiry: number;
        isCall: boolean;
        fillPrem: number;
        fillW: number;
        contracts: number;
        oi: number;
        /** Per-print (timestamp, fill price, premium) at this strike — lets avgFill prefer
         *  the RECENT window over the whole lookback (see the recency note at avgFill below). */
        fillEntries: Array<{ ts: number; price: number; prem: number }>;
      }
    >;
    underlying: number | null;
    /** alerted_at of the print that supplied `underlying` — keep only the freshest. */
    underlyingSeen: string | null;
    firstSeen: string | null;
    lastSeen: string | null;
    minDte: number;
    /** (epoch-ms, premium) per print — for the sudden-spike read. */
    stamps: Array<[number, number]>;
    /** Raw prints in FlowQuality's shape — feeds computeFlowQuality on emit (the flow-quality read). */
    flowPrints: FlowPrint[];
  };
  const byTicker = new Map<string, Agg>();

  for (const r of rows) {
    const ticker = r.ticker?.toUpperCase();
    if (!ticker || opts?.excludeTickers?.has(ticker)) continue;
    const dte = r.dte ?? null;
    if (dte == null || dte > SETUP_MAX_DTE || dte < 0) continue;
    // dte was stamped at ALERT time — a 0DTE print from a prior session (the tape
    // window can straddle sessions) is an EXPIRED contract today, not a setup.
    // Both sides are YYYY-MM-DD, so lexicographic compare is date compare.
    if (opts?.todayYmd && r.expiry && r.expiry.slice(0, 10) < opts.todayYmd) continue;
    const prem = r.premium;
    if (!(prem > 0)) continue;

    const agg =
      byTicker.get(ticker) ??
      ({
        call: 0,
        put: 0,
        callAggr: 0,
        putAggr: 0,
        aggrWeighted: 0,
        knownAskPrem: 0,
        sweep: 0,
        gross: 0,
        prints: 0,
        strikes: new Map(),
        underlying: null,
        underlyingSeen: null,
        firstSeen: null,
        lastSeen: null,
        minDte: SETUP_MAX_DTE,
        stamps: [],
        flowPrints: [],
      } as Agg);

    const isCall = (r.option_type ?? "").toLowerCase().startsWith("c");
    const w = aggressionWeight(r.ask_pct);
    if (isCall) {
      agg.call += prem;
      agg.callAggr += prem * w;
    } else {
      agg.put += prem;
      agg.putAggr += prem * w;
    }
    agg.aggrWeighted += prem * w;
    if (r.ask_pct != null && Number.isFinite(r.ask_pct)) agg.knownAskPrem += prem;
    agg.gross += prem;
    agg.prints += 1;
    const isSweep = (r.alert_rule ?? "").toLowerCase().includes("sweep");
    if (isSweep) agg.sweep += prem;
    // Feed the flow-quality engine the SAME print that drove the aggregation above, in its
    // own shape. Timestamp non-finite when alerted_at is missing — computeFlowQuality's
    // persistence/momentum reads tolerate it (they filter to finite stamps internally).
    agg.flowPrints.push({
      premiumUsd: prem,
      askPct: r.ask_pct ?? null,
      isSweep,
      strike: r.strike,
      expiryYmd: (r.expiry ?? "").slice(0, 10),
      side: isCall ? "call" : "put",
      tsMs: r.alerted_at ? Date.parse(r.alerted_at) : Number.NaN,
      // `size` (contracts traded) intentionally omitted — the row carries OI, not
      // traded size, and the institutional read keys off block PREMIUM anyway.
    });
    // Rows arrive premium-ordered, not time-ordered — last-write-wins here used to
    // pin `underlying` to whatever print happened to be processed last (often hours
    // stale), skewing the fib/level annotations. Keep the freshest print's mark.
    if (r.underlying_price && r.underlying_price > 0) {
      if (!agg.underlyingSeen || (r.alerted_at && r.alerted_at > agg.underlyingSeen)) {
        agg.underlying = r.underlying_price;
        agg.underlyingSeen = r.alerted_at ?? agg.underlyingSeen;
      }
    }
    agg.minDte = Math.min(agg.minDte, dte);
    const key = `${r.strike}|${r.expiry}|${isCall ? "c" : "p"}`;
    const cur = agg.strikes.get(key) ?? { prem: 0, premAggr: 0, strike: r.strike, expiry: Date.parse(r.expiry) || 0, isCall, fillPrem: 0, fillW: 0, contracts: 0, oi: 0, fillEntries: [] };
    cur.prem += prem;
    // Same at-the-ask aggression weight the ticker-level callAggr/putAggr use to decide
    // direction — the top strike must be chosen by the SAME conviction measure that won
    // the side, not by raw dollar premium (which can crown a mostly-SOLD/bid-side strike
    // even though the buying pressure that actually determined "long" lived elsewhere).
    cur.premAggr += prem * w;
    // Premium-weighted per-contract fill — "what did the flow actually pay here".
    if (r.fill_price && r.fill_price > 0) {
      cur.fillPrem += r.fill_price * prem;
      cur.fillW += prem;
      // Implied contracts traded (premium / (fill × 100)) vs the strike's OI —
      // flow bigger than existing OI is OPENING positioning, not closing.
      cur.contracts += prem / (r.fill_price * 100);
      // Kept alongside the running fillPrem/fillW sum so avgFill can prefer a RECENT
      // window over the whole multi-hour lookback (2026-08-27 QQQ/NVDA finding: a single
      // large, hours-stale print dominated the premium-weighted average and priced the
      // ledger 2-4x away from what the contract actually traded at by flag time).
      cur.fillEntries.push({ ts: r.alerted_at ? Date.parse(r.alerted_at) : Number.NaN, price: r.fill_price, prem });
    }
    if (r.open_interest && r.open_interest > 0) cur.oi = Math.max(cur.oi, r.open_interest);
    agg.strikes.set(key, cur);
    if (r.alerted_at) {
      if (!agg.firstSeen || r.alerted_at < agg.firstSeen) agg.firstSeen = r.alerted_at;
      if (!agg.lastSeen || r.alerted_at > agg.lastSeen) agg.lastSeen = r.alerted_at;
      const ts = Date.parse(r.alerted_at);
      if (Number.isFinite(ts)) agg.stamps.push([ts, prem]);
    }
    byTicker.set(ticker, agg);
  }

  // "Now" for the spike window: caller-supplied, else the newest print observed —
  // keeps the function pure/deterministic and naturally cools spikes off as the
  // tape ages past the window.
  const nowMs =
    opts?.nowMs ??
    Math.max(0, ...Array.from(byTicker.values()).flatMap((a) => a.stamps.map(([ts]) => ts)));
  const SPIKE_WINDOW_MS = 30 * 60 * 1000;

  const setups: ZeroDteSetup[] = [];
  for (const [ticker, agg] of Array.from(byTicker.entries())) {
    if (agg.gross < SETUP_MIN_GROSS) {
      opts?.rejections?.push({
        ticker,
        gate_failed: "min_gross",
        threshold: SETUP_MIN_GROSS,
        gross_premium: agg.gross,
        aggression: null,
        side_dominance: null,
        otm_pct: null,
        direction: null,
        prints: agg.prints,
        first_seen: agg.firstSeen,
        last_seen: agg.lastSeen,
      });
      continue;
    }
    // Aggressor filter: direction is read from AT-THE-ASK premium only. A tape of
    // sold premium (low aggressive share) is harvesting, not conviction — skip it.
    // 9-1: the aggression share is only trustworthy if real aggressor metadata backs it.
    // When (almost) every print lacks ask_pct, `aggression` is the ~0.5 neutral default
    // and would clear the share gate with no evidence — fail that closed.
    const aggrTotal = agg.callAggr + agg.putAggr;
    const aggression = agg.gross > 0 ? agg.aggrWeighted / agg.gross : 0;
    const knownAggrFrac = agg.gross > 0 ? agg.knownAskPrem / agg.gross : 0;
    if (
      aggrTotal <= 0 ||
      aggression < SETUP_MIN_AGGR_SHARE ||
      knownAggrFrac < SETUP_MIN_KNOWN_AGGR_FRAC
    ) {
      opts?.rejections?.push({
        ticker,
        gate_failed: "min_aggr_share",
        threshold: SETUP_MIN_AGGR_SHARE,
        gross_premium: agg.gross,
        aggression: Math.round(aggression * 100) / 100,
        side_dominance: null,
        otm_pct: null,
        direction: null,
        prints: agg.prints,
        first_seen: agg.firstSeen,
        last_seen: agg.lastSeen,
      });
      continue;
    }
    const dominantCall = agg.callAggr >= agg.putAggr;
    const winning = dominantCall ? agg.callAggr : agg.putAggr;
    const dominance = winning / aggrTotal;
    if (dominance < SETUP_MIN_DOMINANCE) {
      opts?.rejections?.push({
        ticker,
        gate_failed: "min_dominance",
        threshold: SETUP_MIN_DOMINANCE,
        gross_premium: agg.gross,
        aggression: Math.round(aggression * 100) / 100,
        side_dominance: Math.round(dominance * 100) / 100,
        otm_pct: null,
        direction: dominantCall ? "long" : "short",
        prints: agg.prints,
        first_seen: agg.firstSeen,
        last_seen: agg.lastSeen,
      });
      continue;
    }

    // Dominant strike on the winning side — ranked by aggression-weighted premium
    // (premAggr), the SAME measure that decided dominantCall/direction above. Raw
    // premium (prem) can crown a strike that's mostly SOLD (bid-side) premium even
    // when the buying conviction that actually made this side "dominant" concentrated
    // at a different strike — see docs/audit/FINDINGS.md.
    let top: { prem: number; premAggr: number; strike: number; expiry: number; fillPrem: number; fillW: number; contracts: number; oi: number; fillEntries: Array<{ ts: number; price: number; prem: number }> } | null = null;
    let topExpiry = "";
    for (const [key, s] of Array.from(agg.strikes.entries())) {
      if (s.isCall !== dominantCall) continue;
      if (!top || s.premAggr > top.premAggr) {
        top = s;
        topExpiry = key.split("|")[1] ?? "";
      }
    }
    if (!top) {
      opts?.rejections?.push({
        ticker,
        gate_failed: "no_dominant_strike",
        threshold: null,
        gross_premium: agg.gross,
        aggression: Math.round(aggression * 100) / 100,
        side_dominance: Math.round(dominance * 100) / 100,
        otm_pct: null,
        direction: dominantCall ? "long" : "short",
        prints: agg.prints,
        first_seen: agg.firstSeen,
        last_seen: agg.lastSeen,
      });
      continue;
    }
    // Prefer a RECENT-window average fill over the whole multi-hour lookback (same
    // SPIKE_WINDOW_MS the sudden-flow-spike read already uses above). Root cause of the
    // 2026-08-27 QQQ/NVDA mispricing: top.fillPrem/top.fillW is a premium-weighted average
    // across the ENTIRE query window (up to 7h), so one large, hours-stale print (e.g. an
    // early-session fill at a price the contract hasn't traded at since) can dominate the
    // average and diverge 2-4x from what the contract trades at by flag time. Falls back to
    // the full-window average when nothing in this strike's tape is recent (rather than
    // going null), so a genuinely quiet/aged strike is unaffected.
    const recentFillEntries = top.fillEntries.filter(
      (e) => Number.isFinite(e.ts) && nowMs - e.ts <= SPIKE_WINDOW_MS
    );
    const recentFillW = recentFillEntries.reduce((sum, e) => sum + e.prem, 0);
    const avgFill =
      recentFillW > 0
        ? Math.round((recentFillEntries.reduce((sum, e) => sum + e.price * e.prem, 0) / recentFillW) * 100) / 100
        : top.fillW > 0
          ? Math.round((top.fillPrem / top.fillW) * 100) / 100
          : null;

    // Moneyness: deep-ITM top strike = stock replacement, not a directional 0DTE
    // bet — excluded outright (the fake-out class live-caught on day one). This
    // gate needs a real underlying price to evaluate. P0 FIX: this used to be
    // `if (agg.underlying && agg.underlying > 0) { ...check...}` with NO else —
    // when every print for a ticker's tape came back missing underlying_last/
    // underlying_price/stock_price (a real UW payload gap, not hypothetical), the
    // whole moneyness gate was silently SKIPPED and the candidate fell through to
    // `setups.push(...)` below with `otm_pct: null`, i.e. a deep-ITM stock-
    // replacement print (the exact SNDK 1880p-at-1723 class this gate exists to
    // catch) could reach the live board completely ungated. Worse, a live
    // underlying price is available moments later in scan.ts's attachContractPlans
    // (`snap?.underlyingPrice`) but was never fed back to re-check this gate. Since
    // this product has NO independent verifier (unlike SPX Slayer/Heat Maps), a
    // fail-open gate here is invisible in production. Fixed to fail CLOSED, like
    // every other gate in this function: unknown moneyness is now a rejection, not
    // a free pass.
    if (!(agg.underlying && agg.underlying > 0)) {
      opts?.rejections?.push({
        ticker,
        gate_failed: "no_underlying_price",
        threshold: null,
        gross_premium: agg.gross,
        aggression: Math.round(aggression * 100) / 100,
        side_dominance: Math.round(dominance * 100) / 100,
        otm_pct: null,
        direction: dominantCall ? "long" : "short",
        prints: agg.prints,
        first_seen: agg.firstSeen,
        last_seen: agg.lastSeen,
      });
      continue;
    }
    const raw = ((top.strike - agg.underlying) / agg.underlying) * 100;
    const otmPct = Math.round((dominantCall ? raw : -raw) * 100) / 100;
    if (otmPct < -SETUP_MAX_ITM_PCT) {
      opts?.rejections?.push({
        ticker,
        gate_failed: "max_itm_pct",
        threshold: -SETUP_MAX_ITM_PCT,
        gross_premium: agg.gross,
        aggression: Math.round(aggression * 100) / 100,
        side_dominance: Math.round(dominance * 100) / 100,
        otm_pct: otmPct,
        direction: dominantCall ? "long" : "short",
        prints: agg.prints,
        first_seen: agg.firstSeen,
        last_seen: agg.lastSeen,
      });
      continue;
    }
    // Far-OTM lotto cap (Phase 0 firewall): mirror of the ITM gate on the OTM side. The
    // ITM gate catches stock-replacement; this catches the egregious-lotto tail (a huge
    // far-OTM 0DTE stack that clears the premium/dominance gates on size alone but whose
    // strike is nowhere near a same-day move). Same rejection plumbing, its own code.
    // Generous default (SETUP_MAX_OTM_PCT) so ordinary slightly-OTM momentum is untouched.
    if (otmPct > SETUP_MAX_OTM_PCT) {
      opts?.rejections?.push({
        ticker,
        gate_failed: "max_otm_pct",
        threshold: SETUP_MAX_OTM_PCT,
        gross_premium: agg.gross,
        aggression: Math.round(aggression * 100) / 100,
        side_dominance: Math.round(dominance * 100) / 100,
        otm_pct: otmPct,
        direction: dominantCall ? "long" : "short",
        prints: agg.prints,
        first_seen: agg.firstSeen,
        last_seen: agg.lastSeen,
      });
      continue;
    }
    // New money: implied contracts traded on the top strike exceed its OI.
    const newMoney = top.contracts > 0 && top.oi > 0 && top.contracts > top.oi;

    const sweepPct = agg.gross > 0 ? agg.sweep / agg.gross : 0;

    // Sudden flow spike: at least half the ticker's tape (and 4+ prints total)
    // landed inside the last 30 minutes — someone is loading NOW, not drip-buying.
    const recent30 = agg.stamps.reduce(
      (sum, [ts, prem]) => (nowMs - ts <= SPIKE_WINDOW_MS ? sum + prem : sum),
      0
    );
    const spike = agg.prints >= 4 && agg.gross > 0 && recent30 / agg.gross >= 0.5;

    // Evidence score: premium tiers (0-40) + dominance (0-25) + sweeps (0-20) + prints (0-15)
    // + spike urgency (0-5).
    let score = 0;
    if (agg.gross >= 10_000_000) score += 40;
    else if (agg.gross >= 5_000_000) score += 32;
    else if (agg.gross >= 2_000_000) score += 24;
    else if (agg.gross >= 1_000_000) score += 16;
    else score += 8;
    score += Math.round(((dominance - 0.5) / 0.5) * 25);
    score += Math.round(sweepPct * 20);
    score += Math.min(15, agg.prints);
    if (spike) score += 5;
    // Conviction quality: heavy at-the-ask share and opening (new-money) flow.
    score += Math.round(Math.max(0, aggression - 0.5) * 20); // 0-10
    if (newMoney) score += 5;

    const flowQuality = computeFlowQuality(agg.flowPrints);
    const calibratedScore = calibrateFlowEvidenceScore(score, flowQuality, agg.gross);

    setups.push({
      ticker,
      direction: dominantCall ? "long" : "short",
      // Flow candidates are ALWAYS directional single-contract plays — the condor is only
      // ever routed from a PIN candidate (condor.ts), never from flow. Stamped explicitly so
      // the flag-off board is byte-for-byte unchanged and no flow print can become a condor.
      play_type: "DIRECTIONAL",
      // FLOW-origin provenance: this setup came from the whale-option-print discovery source.
      // A ticker also surfaced by the breakout source has "BREAKOUT" unioned in at merge time
      // (scan.ts / breakout-source.ts), never collapsed.
      discovery_origin: ["FLOW"],
      top_strike: top.strike,
      top_strike_avg_fill: avgFill,
      expiry: topExpiry,
      dte: agg.minDte,
      // Flow candidates are ZERO_DTE/ONE_DTE BY CONSTRUCTION — deriveZeroDteSetups already gates
      // every print to dte ≤ SETUP_MAX_DTE (=4), so agg.minDte is 0-4 and the horizon is
      // always same-day. Stamped from the real dte for uniformity with the breakout/pin/condor
      // sites (deriveContractHorizon would return WEEKLY_FALLBACK only for an impossible dte>4 here).
      contract_horizon: deriveContractHorizon(agg.minDte),
      actual_dte_at_commit: agg.minDte,
      grading_policy: gradingPolicyForHorizon(deriveContractHorizon(agg.minDte)),
      net_premium: Math.round(agg.callAggr - agg.putAggr),
      gross_premium: agg.gross,
      prints: agg.prints,
      sweep_pct: Math.round(sweepPct * 100) / 100,
      side_dominance: Math.round(dominance * 100) / 100,
      // Round the raw UW underlying at the data layer (repo-wide "round at the data layer" rule) so a
      // 178.36000000001-style float can't reach the member/ledger or the otm math (9-misc float honesty).
      underlying_price: agg.underlying == null ? agg.underlying : Math.round(agg.underlying * 100) / 100,
      // The mark's TRUE as-of — the `alerted_at` of the freshest surviving print above. This used
      // to be computed into agg.underlyingSeen purely to win the last-write-wins race and then
      // DISCARDED, so a mark that could be hours old left the function looking exactly like a live
      // one. Carried through now so scan.ts can refresh it and any consumer can degrade honestly.
      underlying_price_as_of: agg.underlying == null ? null : agg.underlyingSeen,
      underlying_price_source: agg.underlying == null ? null : "flow_print",
      score: Math.max(0, Math.min(100, calibratedScore)),
      aggression: Math.round(aggression * 100) / 100,
      otm_pct: otmPct,
      new_money: newMoney,
      recent_premium_30m: recent30,
      spike,
      first_seen: agg.firstSeen,
      last_seen: agg.lastSeen,
      flow_quality: flowQuality,
    });
  }

  return setups.sort((a, b) => b.score - a.score).slice(0, maxSetups);
}

// ── Dossier enrichment (the "very strong" layer) ─────────────────────────────────
// The top setups get the FULL Night Hawk dossier treatment — the same enrichment +
// direction-correct deterministic scorer the evening edition uses: flow streaks,
// strike stacks, Polygon technicals (breakouts/MA stacks/RSI/rel-vol), dark pool,
// OI change, skew, news/catalysts, analyst PT, congress/institutional, fundamentals.
// This function is the PURE merge of a fetched dossier onto a flow setup, so it is
// unit-testable with a fake dossier; the route does the (cached) fetching.

import { computeFibLevels, nearestFibNote, type FibNote } from "./fib";
// Runtime import is safe: ./iron-condor is pure geometry (no providers, no cycle back
// into this module) — it adds nothing to board.ts's provider load graph.
import { selectIronCondor, type IronCondorLegs } from "./iron-condor";
// Runtime import is safe: ./flow-quality is pure (no providers) — it turns the setup's
// own tape (the prints that formed the aggregation) into a 0-100 flow-quality read.
import { computeFlowQuality, type FlowPrint, type FlowQuality } from "./flow-quality";
import type { ContractPlan } from "./plan";
import type { IntradayRead } from "./intraday";
// Type-only (erased at compile time — no runtime cycle with ./gates, which imports
// only types back from this module).
import type { ZeroDteGateVerdict } from "./gates";
// Type-only for the same reason: ./cortex-gate's runtime deps (the Cortex barrel)
// never enter this module's load graph.
import type { ZeroDteCortexAssessment } from "./cortex-gate";

/** Structural subset of TickerDossier the enrichment reads (keeps this module
 *  provider-import-free and the merge testable with plain objects). */
export type SetupDossierView = {
  tech?: {
    price: number;
    trend: string;
    setup_tags: string[];
    breakout_zones: string[];
    support_levels: number[];
    resistance_levels: number[];
    weekly: { high: number | null; low: number | null };
    prior_day: { high: number | null; low: number | null; close: number | null };
    rsi14: number | null;
    rel_volume: number | null;
    atr14: number | null;
    vwap: number | null;
  } | null;
  dark_pool?: { total_premium?: number; bias?: string } | null;
  /** Dealer positioning on the name (Thermal-class data via the dossier). */
  positioning?: { gex_king_strike?: number | null; gamma_regime?: string; gamma_flip?: number | null } | null;
  flow_streak?: { streak_days: number; direction: "long" | "short" | "mixed" } | null;
  scored?: {
    score: number;
    direction: "long" | "short";
    conviction: string;
    flow_score: number;
    tech_score: number;
    pos_score: number;
    news_score: number;
    smart_money_score: number;
    catalyst_flags?: string[];
    // 9-8: fetchTickerDossier (dossier.ts) always assigns the FULL ScoredCandidate
    // (scorer.ts) here — this local view type had only ever declared the five fields above,
    // so these six real, always-populated components had no typed path into factor_breakdown
    // even though the runtime object carried them. Kept optional (matching ScoredCandidate's
    // own optionality) rather than widened to the full ScoredCandidate type, since this view
    // is deliberately narrower than the scorer's internal shape (e.g. no regime_multiplier,
    // no fundamental_block/flags) — only what a consumer here actually needs.
    fundamental_score?: number;
    catalyst_score?: number;
    short_interest_score?: number;
    wall_proximity_score?: number;
    vex_alignment_score?: number;
    skew_score?: number;
  } | null;
  /** Benzinga analyst price-target one-liner (e.g. "PT raised to $210 at MS"). */
  price_target?: string | null;
  trading_halt?: boolean;
};

export type EarningsFlag = {
  when: "premarket" | "afterhours";
  report_date: string | null;
  expected_move_pct: number | null;
};

export type NewsHeat = {
  title: string;
  published: string | null;
  url: string | null;
  minutes_ago: number;
};

export type EnrichedZeroDteSetup = ZeroDteSetup & {
  /** Full deterministic dossier score (0-100) + conviction from the audited scorer. */
  dossier_score: number | null;
  conviction: string | null;
  /** Whether the dossier's flow-lane direction agrees with the live-tape read. */
  direction_confirmed: boolean | null;
  /**
   * Per-component score contribution, in POINTS, keyed by component.
   *
   * A MAP rather than a fixed five-field record, because the components differ by discovery
   * origin and pinning one lane's vocabulary into the type is what kept the other lanes out of
   * it. FLOW rows carry flow/tech/positioning/news/smart_money; BREAKOUT rows carry
   * breakout_core/dollar_volume/screen_base (see breakoutScoreBreakdown). No consumer reads a
   * named key — the deck panel iterates entries and labels them through FB_LABELS — so widening
   * costs nothing and lets a lane explain itself in its own terms.
   */
  factor_breakdown: Record<string, number> | null;
  trend: string | null;
  tech_tags: string[];
  breakout_zones: string[];
  /** Nearest chart levels around price: up to 2 supports below, 2 resistances above. */
  key_supports: number[];
  key_resistances: number[];
  vwap: number | null;
  atr14: number | null;
  rsi14: number | null;
  rel_volume: number | null;
  streak_days: number | null;
  dark_pool_bias: string | null;
  /** Dealer gamma king node + regime for the name (from the dossier's positioning). */
  gex_king_strike: number | null;
  gamma_regime: string | null;
  /** Defined-risk 0DTE IRON-CONDOR geometry (./iron-condor.ts) — the high-win-rate
   *  premium-SELLING counterpart to this directional setup, computed for every name:
   *  short strikes at a target-80 width FLOOR, pushed beyond the nearest chart wall
   *  (key_resistances above / key_supports below, gex_king as fallback) so we sell
   *  where price rarely goes. CALIBRATION-FIRST EVIDENCE ONLY — attached to every
   *  setup, gated by nothing, traded by nothing; the graded ledger measures the real
   *  per-ticker win rate before it ever becomes an actionable play. `est_win_rate` is
   *  the index-ETF measured-table estimate (exact for SPY/QQQ/IWM, approximate for a
   *  single name — the honest number comes from the ledger). Null when spot is unknown. */
  condor: IronCondorLegs | null;
  /** PRICED, tradeable condor plan (Phase 4) — present ONLY on a `play_type: "CONDOR"` setup
   *  built by the flag-gated condor router (condor.ts): the four legs off the live chain, the
   *  net credit, defined max loss, and the breach (short-strike) levels the grader scores. This
   *  is the ORDER STRUCTURE (distinct from the `condor` field above, which is calibration-only
   *  geometry attached to every directional setup). Null on every DIRECTIONAL setup. */
  condor_plan?: import("./condor").CondorPlan | null;
  /** Today's minute-bar read (session VWAP, opening range, 5m trend) — scan-attached. */
  intraday: IntradayRead | null;
  /** Hard intraday conflict: wrong side of VWAP AND short-term trend against — A-tier disqualifier. */
  intraday_conflict: boolean;
  /** Play direction vs the SPY tape right now (null = unknown/flat market). */
  market_aligned: boolean | null;
  /** Time-of-day window note (prime window / lunch chop), when one applies. */
  tod_label: string | null;
  catalyst_flags: string[];
  analyst_note: string | null;
  /** Fib annotation vs the weekly swing, when price sits at a level. */
  fib_note: FibNote | null;
  /** Entry/exit contract plan (premium band + exits) — attached by the scan when a
   *  live quote or real fill exists; null = evidence only, never a guessed plan. */
  plan: ContractPlan | null;
  /** Hard-gate verdict for a FRESH find (./gates.ts): BLOCKED setups stay visible
   *  as WATCH/SKIP cards with every failing gate's reason (+ unlock time when the
   *  block is clock-based). Null = not evaluated (already-committed ticker, or the
   *  gate context couldn't be built — persist fails closed on that). */
  gate: ZeroDteGateVerdict | null;
  /** Night Hawk Cortex assessment (./cortex-gate.ts) — evaluated ONLY for a fresh
   *  find that survived the hard gate stack. Null = Cortex never ran for this
   *  setup this cycle (gate-blocked before the Cortex layer, or an
   *  already-committed refresh ticker) — never a fabricated neutral. */
  cortex: ZeroDteCortexAssessment | null;
  halted: boolean;
  /** Reports today/next session — a 0DTE into an earnings print is a different trade. */
  earnings: EarningsFlag | null;
  /** Fresh headline (<2h) naming this ticker. */
  news_hot: NewsHeat | null;
  /** Multi-day flow-accumulation read (the "stacked hits over days" memory) — whether today's 0DTE
   *  direction is confirmed by (or fights) multi-day stacked positioning, + the magnet strike being
   *  built. Attached by the scan from a multi-day flow window. EVIDENCE ONLY (calibration-first):
   *  present on the card + persisted for the graded ledger, but it does not move the score or gate
   *  the board yet. Null = no multi-day signal for this name. See flow-accumulation-context.ts. */
  flow_accumulation?: import("./flow-accumulation-context").ZeroDteFlowAccumulation | null;
  /** Confluence read (calibration-first): how many independent confirmations — post-open timing,
   *  price vs VWAP, market/SPY alignment — AGREE with the setup's direction, + a tier. The graded
   *  edge is the VWAP+market "double" bucket (+15.9% EV, docs/audit/0DTE-RESEARCH.md); "triple" gilds
   *  it. Evidence only — does not gate/score the board yet. See confluence.ts. */
  confluence?: import("./confluence").ZeroDteConfluence | null;
  /** Opposing-direction co-discovery (design Q1) — set by the origin merge when a second
   *  source found this ticker in the OPPOSITE direction. Evidence only: surfaced + persisted
   *  so the graded origin band can measure opposing-co-discovery outcomes; it does not change
   *  what commits. Absent = no conflict (same-direction corroboration or single origin). */
  origin_direction_conflict?: OriginDirectionConflict | null;
  /** Thesis-first pipeline snapshot (ZERODTE_THESIS_FIRST_SHADOW) — independent per-rail
   *  scores, archetype classification, and gate verdict. Shadow by default; does not gate
   *  commits until ZERODTE_THESIS_FIRST=1. See thesis/scan-shadow.ts. */
  thesis_first?: import("./thesis/types").ThesisPipelineResult | null;
  /** Pre-gate block codes when ZERODTE_THESIS_FIRST=1 (thesis/archetype fail-closed). */
  thesis_gate_blocks?: string[];
  /** WS-06: per-origin (direction, score) recorded at merge time — the raw material buildOriginMaps
   *  freezes onto the committed row. Populated in-place by recordOriginContributionsOnMerge for a
   *  multi-source ticker; absent for a single-origin setup (buildOriginMaps seeds those from the
   *  setup itself). Evidence only — never read by any gate/grader. */
  origin_contributions?: Partial<Record<DiscoveryOrigin, OriginContribution>>;
  /** Regime Plane snapshot at gate time (Wave A) — pinned onto committed rows via entry_context. */
  regime_plane?: import("./regime-plane").RegimePlaneSnapshot | null;
  /** NH-R4 (weekend/holiday gap risk): count of non-trading calendar days the selected contract's
   *  hold spans between today and expiry (0 = normal overnight, 2 = plain weekend, 3+ = holiday
   *  weekend) — see `tradingSessionGapDays` above. EVIDENCE ONLY (calibration-first, same role as
   *  `flow_accumulation`/`confluence`): surfaced + persisted for the graded ledger so a future
   *  calibration item can measure whether a weekend/holiday ONE_DTE hold underperforms a normal
   *  overnight; it does NOT gate or score the board today. Null = not computed (e.g. same-day
   *  0DTE with no overnight to measure, or malformed today/expiry inputs) — never fabricated. */
  session_gap_days?: number | null;
};

// ── Stage 4 audit trail (alert_audit_log) ─────────────────────────────────────────
// Shape matches the alert_audit_log columns in src/lib/db.ts. Defined here (not in
// db.ts) so the row-building logic is a pure function of a setup + session date —
// unit-testable with fixture setups, no database required.

export type ZeroDteAuditRow = {
  alert_type: "zerodte";
  source_table: "zerodte_setup_log";
  source_key: { session_date: string; ticker: string };
  ticker: string;
  direction: "long" | "short";
  confidence_score: number | null;
  confidence_label: string | null;
  trigger_reason: string;
  decision_trace: Array<{ check: string; passed: boolean; value: unknown; threshold: unknown }>;
  input_snapshot: Record<string, unknown>;
  final_output: Record<string, unknown> | null;
};

/** Build the audit-trail row for a setup's FIRST flag. Every setup reaching this
 *  function already cleared the four gates in deriveZeroDteSetups — this only
 *  records that fact (real gate values vs their real thresholds), it never
 *  invents a check that wasn't actually applied. */
export function buildZeroDteAuditRow(setup: EnrichedZeroDteSetup, sessionDate: string): ZeroDteAuditRow {
  return {
    alert_type: "zerodte",
    source_table: "zerodte_setup_log",
    source_key: { session_date: sessionDate, ticker: setup.ticker },
    ticker: setup.ticker,
    direction: setup.direction,
    confidence_score: setup.dossier_score ?? setup.score,
    confidence_label: setup.conviction,
    trigger_reason: setup.spike ? "flow spike (30m surge)" : "dominant aggressor flow",
    decision_trace: [
      { check: "gross_premium_min", passed: setup.gross_premium >= SETUP_MIN_GROSS, value: setup.gross_premium, threshold: SETUP_MIN_GROSS },
      { check: "aggression_share_min", passed: (setup.aggression ?? 0) >= SETUP_MIN_AGGR_SHARE, value: setup.aggression, threshold: SETUP_MIN_AGGR_SHARE },
      { check: "side_dominance_min", passed: setup.side_dominance >= SETUP_MIN_DOMINANCE, value: setup.side_dominance, threshold: SETUP_MIN_DOMINANCE },
      // P0 fix: previously `setup.otm_pct == null || ...` — a null reading (unknown
      // underlying price) was recorded as PASSED. deriveZeroDteSetups now rejects
      // those candidates outright (no_underlying_price), so a setup should never
      // reach this function with a null otm_pct — but the audit trail fails CLOSED
      // on it too, defense-in-depth, rather than assuming that invariant holds.
      { check: "max_itm_pct", passed: setup.otm_pct != null && setup.otm_pct >= -SETUP_MAX_ITM_PCT, value: setup.otm_pct, threshold: -SETUP_MAX_ITM_PCT },
      { check: "intraday_conflict", passed: !setup.intraday_conflict, value: setup.intraday_conflict, threshold: false },
    ],
    input_snapshot: {
      score: setup.score,
      dossier_score: setup.dossier_score,
      gross_premium: setup.gross_premium,
      net_premium: setup.net_premium,
      sweep_pct: setup.sweep_pct,
      prints: setup.prints,
      new_money: setup.new_money,
      spike: setup.spike,
      underlying_price: setup.underlying_price,
      top_strike: setup.top_strike,
      expiry: setup.expiry,
      intraday_conflict: setup.intraday_conflict,
      direction_confirmed: setup.direction_confirmed,
    },
    final_output: setup.plan ? ({ ...setup.plan } as unknown as Record<string, unknown>) : null,
  };
}

/** Tickers reporting on `today` or `nextDay` → earnings flag (per-ticker, first match). */
export function matchEarnings(
  items: Array<{
    ticker: string;
    when: "premarket" | "afterhours";
    report_date: string | null;
    expected_move_pct: number | null;
  }>,
  dates: { today: string; nextDay: string }
): Map<string, EarningsFlag> {
  const out = new Map<string, EarningsFlag>();
  for (const it of items) {
    const ticker = it.ticker?.toUpperCase();
    if (!ticker || out.has(ticker)) continue;
    if (it.report_date !== dates.today && it.report_date !== dates.nextDay) continue;
    out.set(ticker, {
      when: it.when,
      report_date: it.report_date,
      expected_move_pct: it.expected_move_pct,
    });
  }
  return out;
}

/** Freshest headline (within `windowMinutes`) per mentioned ticker. */
export function matchHotNews(
  articles: Array<{ title?: string; published?: string; tickers?: string[]; url?: string }>,
  nowMs: number,
  windowMinutes = 120
): Map<string, NewsHeat> {
  const out = new Map<string, NewsHeat>();
  for (const a of articles) {
    if (!a.title || !a.published || !Array.isArray(a.tickers)) continue;
    const ts = Date.parse(a.published);
    if (!Number.isFinite(ts)) continue;
    const ageMin = (nowMs - ts) / 60_000;
    if (ageMin < 0 || ageMin > windowMinutes) continue;
    for (const t of a.tickers) {
      const ticker = String(t).toUpperCase();
      if (!ticker) continue;
      const prev = out.get(ticker);
      if (!prev || ageMin < prev.minutes_ago) {
        out.set(ticker, {
          title: a.title,
          published: a.published,
          url: a.url ?? null,
          minutes_ago: Math.round(ageMin),
        });
      }
    }
  }
  return out;
}

export function enrichSetup(
  setup: ZeroDteSetup,
  dossier: SetupDossierView | null,
  extras?: { earnings?: EarningsFlag | null; news_hot?: NewsHeat | null }
): EnrichedZeroDteSetup {
  const scored = dossier?.scored ?? null;
  const tech = dossier?.tech ?? null;

  // Weekly-swing fibs, oriented by the setup direction: a long retraces the up-swing
  // (dip-buy levels); a short retraces the down-swing (pop-short levels).
  let fibNote: FibNote | null = null;
  const price = setup.underlying_price ?? tech?.price ?? null;
  if (price && tech?.weekly.high && tech.weekly.low) {
    const levels = computeFibLevels(
      tech.weekly.low,
      tech.weekly.high,
      setup.direction === "long" ? "up" : "down"
    );
    fibNote = nearestFibNote(price, levels);
  }

  // Nearest structure around price: the 2 highest supports below, 2 lowest
  // resistances above — the levels that actually matter for a same-day trade.
  const keySupports =
    price != null
      ? (tech?.support_levels ?? []).filter((l) => l > 0 && l < price).sort((a, b) => b - a).slice(0, 2)
      : [];
  const keyResistances =
    price != null
      ? (tech?.resistance_levels ?? []).filter((l) => l > price).sort((a, b) => a - b).slice(0, 2)
      : [];

  // Defined-risk iron-condor geometry for the name (calibration-first evidence — see the
  // `condor` field doc). Push short strikes beyond the nearest chart wall on each side;
  // the dealer king node is the fallback wall when a same-side chart level is absent. The
  // module already takes the FURTHER of (target-80 width) and (wall), so a wall INSIDE the
  // width is ignored — we never sell tighter than the width floor.
  const gexKing = dossier?.positioning?.gex_king_strike ?? null;
  const condorCallWall = keyResistances[0] ?? (gexKing != null && price != null && gexKing > price ? gexKing : null);
  const condorPutWall = keySupports[0] ?? (gexKing != null && price != null && gexKing < price ? gexKing : null);
  const condor =
    price != null && price > 0
      ? selectIronCondor({ spot: price, targetWinRate: 80, callWall: condorCallWall, putWall: condorPutWall })
      : null;

  return {
    ...setup,
    dossier_score: scored?.score ?? null,
    conviction: scored?.conviction ?? null,
    direction_confirmed: scored ? scored.direction === setup.direction : null,
    // 9-8: scoreCandidate (scorer.ts) always folds ALL of flow/tech/pos/news/smart_money PLUS
    // fundamental/catalyst/short_interest/wall_proximity/vex_alignment/skew into `score`/
    // `dossier_score` — this file only ever surfaced the first five, so the "Why this play was
    // picked" panel for every FLOW/PIN setup silently omitted up to 6 of 11 real scoring inputs
    // (measured live 2026-09-02: NVDA showed 5 factors summing to 22.4 against a dossier_score of
    // 35 and a displayed score of 69 — the missing 6 accounted for more of the score than what was
    // shown). Mirrors the identical, already-shipped mapping in deterministic-edition.ts (Night
    // Hawk Edition's two `factor_breakdown` builders) so the same `ScoredCandidate` renders the
    // same breakdown on both surfaces — this file had simply drifted out of sync with that
    // established pattern, not implemented a different one on purpose. Conditional spreads (not a
    // flat 0 fallback) keep an inapplicable dimension OUT of the breakdown entirely, exactly as
    // deterministic-edition.ts already does — a real 0 (dimension scored, contributed nothing) and
    // an absent input (dimension never scored) are different facts and must not collapse into the
    // same rendered "0" bar.
    factor_breakdown: scored
      ? {
          flow: scored.flow_score,
          tech: scored.tech_score,
          positioning: scored.pos_score,
          news: scored.news_score,
          smart_money: scored.smart_money_score,
          ...(scored.fundamental_score != null ? { fundamental: scored.fundamental_score } : {}),
          ...(scored.catalyst_score != null ? { catalyst: scored.catalyst_score } : {}),
          ...(scored.short_interest_score != null ? { short_interest: scored.short_interest_score } : {}),
          ...(scored.wall_proximity_score != null ? { wall_proximity: scored.wall_proximity_score } : {}),
          ...(scored.vex_alignment_score != null ? { vex: scored.vex_alignment_score } : {}),
          ...(scored.skew_score != null ? { skew: scored.skew_score } : {}),
        }
      : null,
    trend: tech?.trend ?? null,
    tech_tags: tech?.setup_tags ?? [],
    breakout_zones: tech?.breakout_zones ?? [],
    key_supports: keySupports,
    key_resistances: keyResistances,
    vwap: tech?.vwap ?? null,
    atr14: tech?.atr14 ?? null,
    rsi14: tech?.rsi14 ?? null,
    rel_volume: tech?.rel_volume ?? null,
    streak_days: dossier?.flow_streak?.streak_days ?? null,
    dark_pool_bias: dossier?.dark_pool?.bias ?? null,
    gex_king_strike: gexKing,
    gamma_regime: dossier?.positioning?.gamma_regime ?? null,
    condor,
    intraday: null,
    intraday_conflict: false,
    market_aligned: null,
    tod_label: null,
    catalyst_flags: scored?.catalyst_flags ?? [],
    analyst_note: dossier?.price_target ?? null,
    fib_note: fibNote,
    plan: null,
    gate: null,
    cortex: null,
    halted: dossier?.trading_halt === true,
    earnings: extras?.earnings ?? null,
    news_hot: extras?.news_hot ?? null,
  };
}

// ── Ledger grading (pure) ─────────────────────────────────────────────────────────
// The scanner logs every flagged setup with the underlying price AT FIRST FLAG; after
// the session, each row is graded against the official close. Pure math here so the
// hit-rate arithmetic is unit-tested — the honesty of the ledger depends on it.

export type LedgerGrade = {
  close_price: number | null;
  /** Signed % move from flag → close, positive = moved WITH the setup's direction. */
  move_pct: number | null;
  direction_hit: boolean | null;
};

export function computeLedgerGrade(
  direction: "long" | "short",
  underlyingAtFlag: number | null,
  closePrice: number | null
): LedgerGrade {
  if (!(underlyingAtFlag != null && underlyingAtFlag > 0) || !(closePrice != null && closePrice > 0)) {
    // No flag price or no close — ungradeable, stamped as such rather than guessed.
    return { close_price: closePrice ?? null, move_pct: null, direction_hit: null };
  }
  const raw = ((closePrice - underlyingAtFlag) / underlyingAtFlag) * 100;
  const signed = direction === "long" ? raw : -raw;
  return {
    close_price: closePrice,
    move_pct: Math.round(signed * 100) / 100,
    // Three-way, not a boolean: a flat close (signed exactly 0 — close == flag) is a
    // BREAKEVEN, not a directional miss. `signed > 0` alone booked every dead-flat
    // session as a `direction_hit:false` loss, biasing the underlying-move honesty
    // ledger down (asymmetric with the SPX 3-way win/loss/breakeven partition). null
    // = "no directional edge either way", excluded from hit/miss just like the
    // ungradeable branch above — the row is still stamped graded (real close present).
    direction_hit: signed > 0 ? true : signed < 0 ? false : null,
  };
}
