// 0DTE EXIT ENGINE — the sync-path wiring (IO half of ./exit-engine.ts, same
// pure-core/IO-shell split as cortex-gate.ts vs the cortex barrel). scan.ts's
// syncLedgerLiveState calls evaluateLedgerRowExit once per still-open row AFTER
// derivePlayStatus has had its pass — the plan's own latched stop/target/time-stop
// machinery stays exactly as it was; the engine only ADDS exits (ratchet floors,
// thesis break, flat timeout, fresh-mark stop/target breaches) on top of it.
//
// Discipline mirrors the rest of the directory:
//  - FRESHEST MARK WINS: the ~1s live-marks lane mark is preferred when fresh
//    (isZeroDteMarkStale, the same 5s staleness rule every renderer applies); the
//    sync pass's own snapshot mark is the fallback. No mark → no exit (the engine
//    holds on missing data by contract).
//  - CORTEX BOUNDED + FAIL-SOFT: evidence for open plays reuses the entry stack
//    (fetchCortexInputs → composeCortexEvidence), cached ~30s per (ticker,
//    direction) across pollers/replicas and soft-deadlined, so the ~2-min cron sync
//    and the board's 5s build can never stack provider fan-outs. Any failure →
//    evidence null → the thesis-break check is skipped and every other rule still
//    runs. The engine NEVER exits on missing data.
//  - NEVER THROWS: a bug here must not be able to break the ledger sync — worst
//    case is "no engine exit this tick", and the plan's own stop/time-stop rules
//    still stand.

import { dbConfigured, stampZeroDteExitContext, type ZeroDteSetupLogRow } from "@/lib/db";
import { todayEt } from "@/features/nighthawk/lib/session";
import { withServerCache } from "@/lib/server-cache";
import { composeCortexEvidence } from "@/lib/nighthawk/cortex/compose";
import { fetchCortexInputs } from "@/lib/nighthawk/cortex/fetch";
import type { EvidenceItem } from "@/lib/nighthawk/cortex/types";
import {
  buildExitContext,
  evaluateExitState,
  trimTranchesArmed,
  DEFAULT_EXIT_MODE,
  type ExitDecision,
  type ZeroDteExitContext,
  type ZeroDteExitMode,
  type ZeroDteRegime,
} from "./exit-engine";
import { getZeroDteLiveMark, type ZeroDteLiveMark } from "./live-marks";
import { isZeroDteMarkStale, pinnedLivePnlPct } from "./marks-math";
import { PLAN_RULES } from "./plan";
import type { ResolvedExitPolicy } from "./strategy-version";
import { gexQualityDegradedForExit, type RegimeGexQuality } from "./regime-plane";

/** Evidence cache TTL — one Cortex fan-out per (ticker, direction) per ~30s across
 *  every sync caller, not per row per tick. */
const EXIT_EVIDENCE_TTL_MS = 30_000;
/** Soft deadline on the whole evidence read (fetchCortexInputs is itself per-source
 *  time-budgeted at 2.5s; this bounds the worst case at the call site too). */
const EXIT_EVIDENCE_WAIT_MS = 4_000;

/** Await `p` for at most `ms`, else null — same semantics as scan.ts's within();
 *  duplicated (7 lines) rather than imported because scan.ts imports THIS module,
 *  and importing back would create a require cycle (entry-context.ts precedent). */
function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      }
    );
  });
}

/**
 * Bounded, cached, fail-soft Cortex evidence for an OPEN play's own direction.
 * Returns the verdict's full item list (vetoes + opposes + supports, decayed
 * weights) or null when the Cortex could not see — the engine treats null as
 * "thesis check skipped", never as an exit signal.
 */
async function fetchExitEvidence(ticker: string, direction: "long" | "short"): Promise<EvidenceItem[] | null> {
  const key = `zerodte:exit-cortex:${ticker.toUpperCase()}:${direction}:${todayEt()}`;
  return within(
    withServerCache<EvidenceItem[]>(key, EXIT_EVIDENCE_TTL_MS, async () => {
      const inputs = await fetchCortexInputs(ticker, direction, { now: new Date() });
      const verdict = composeCortexEvidence(inputs);
      return [...verdict.vetoes, ...verdict.opposes, ...verdict.supports];
    }),
    EXIT_EVIDENCE_WAIT_MS
  );
}

/** The entry's committed Cortex score off the pinned entry_context blob (the margin
 *  the thesis-break opposing cluster must beat). Null when the row predates the
 *  wire-in, the Cortex abstained, or the blob is malformed. */
export function entryCortexScoreOf(entryContext: Record<string, unknown> | null): number | null {
  const cortex = entryContext?.cortex as Record<string, unknown> | undefined;
  if (!cortex || cortex.abstained === true) return null;
  const score = cortex.score;
  return typeof score === "number" && Number.isFinite(score) ? score : null;
}

/**
 * Live exit-mode selector — the CONFIG flag lives in the IO shell so the pure engine
 * (exit-engine.ts) never reads an env or a clock. Defaults to the shipped ratchet;
 * `ZERODTE_EXIT_MODE=trim_scale` flips the board to the E5 ⅓@+25% / ⅓@+50% / run
 * scale-out for an operator A/B. DEFAULT-OFF: unset ⇒ ratchet ⇒ live behavior is
 * byte-for-byte unchanged (this is the "keep the old ratchet behind a flag" the change
 * requires). The trim graduates on the live-ledger grader — this env is the operator's
 * post-sign-off switch, not an auto-flip.
 */
export function resolveExitMode(env: NodeJS.ProcessEnv = process.env): ZeroDteExitMode {
  return env.ZERODTE_EXIT_MODE === "trim_scale" ? "trim_scale" : DEFAULT_EXIT_MODE;
}

/**
 * Tier-aware exit-mode resolver (CTO audit E5 graduation). The E5 study proved
 * trim-scale dominates ratchet in EVERY backtest window — it is now the DEFAULT for
 * A-tier and B-tier plays. C-tier plays stay on the conservative ratchet (their signal
 * quality doesn't justify the looser partial-trim runway). The env override
 * `ZERODTE_EXIT_MODE=ratchet` can force ALL tiers back to ratchet (operator kill-switch).
 *
 * @param tier - The play's assigned merit tier (A/B/C or null for untiered)
 * @param env  - Process env (for the operator override)
 */
export function resolveExitModeForTier(
  tier: "A" | "B" | "C" | null | undefined,
  env: NodeJS.ProcessEnv = process.env
): ZeroDteExitMode {
  // Explicit env override takes precedence — the operator can force ratchet on all tiers.
  if (env.ZERODTE_EXIT_MODE === "ratchet") return "ratchet";
  // Explicit trim_scale env also forces all tiers (backwards-compat with the old knob).
  if (env.ZERODTE_EXIT_MODE === "trim_scale") return "trim_scale";
  // DEFAULT tier-based policy (E5 graduation): A/B get trim-scale, C stays on ratchet.
  // Untiered plays (null — tier assignment failed soft) default to ratchet (conservative).
  if (tier === "A" || tier === "B") return "trim_scale";
  return "ratchet";
}

/**
 * FROZEN exit archetype for an already-committed row (design Q13 — INTEGRITY). scan.ts
 * pins the ACTIVE exit mode onto every committed row's entry_context.exit_policy_at_commit
 * at first flag. Reading it here — in preference to the live env — means an open play
 * always exits under the policy it was COMMITTED with: a mid-session `ZERODTE_EXIT_MODE`
 * flip can no longer retroactively change how a live position is managed (dumping a
 * trim_scale runner as a ratchet, or vice-versa, at whatever the env happens to be when
 * the sync tick fires). Returns null for a legacy/pre-Q13 row (no pin) so those fall back
 * to resolveExitMode() — the exact prior behavior, never a fabricated mode.
 */
export function readFrozenExitMode(
  entryContext: Record<string, unknown> | null | undefined
): ZeroDteExitMode | null {
  const v = entryContext?.exit_policy_at_commit;
  return v === "ratchet" || v === "trim_scale" ? v : null;
}

/**
 * WS-02 — the FULLY-RESOLVED exit-policy SNAPSHOT frozen on a committed row
 * (entry_context.exit_policy_snapshot, buildResolvedExitPolicy). Unlike readFrozenExitMode
 * (only the mode NAME), this carries the actual NUMERIC thresholds — hard stop %, target %,
 * trim ladder, time-stop, collision rule — as they were AT COMMIT. The exit engine and both
 * graders prefer these numbers so a later numeric edit in code can NEVER retroactively
 * re-grade a historical play. Returns null for a legacy/pre-WS-02 row (no snapshot) so those
 * fall back to current-code PLAN_RULES — the exact prior behavior, never a fabricated policy.
 * Validated structurally (finite stop/target + a hash string) so a malformed blob reads as
 * absent rather than as a partial policy.
 */
export function readFrozenExitPolicy(
  entryContext: Record<string, unknown> | null | undefined
): ResolvedExitPolicy | null {
  const snap = entryContext?.exit_policy_snapshot;
  if (!snap || typeof snap !== "object") return null;
  const s = snap as Record<string, unknown>;
  if (
    typeof s.hard_stop_pct === "number" &&
    Number.isFinite(s.hard_stop_pct) &&
    typeof s.target_pct === "number" &&
    Number.isFinite(s.target_pct) &&
    typeof s.config_hash === "string"
  ) {
    return s as unknown as ResolvedExitPolicy;
  }
  return null;
}

/** Injectable IO seams (cortex-gate.ts's CortexCommitDeps idiom) so the wiring is
 *  unit-testable without module mocks or a live platform. */
export type ExitSyncDeps = {
  readLaneMark?: (occ: string) => ZeroDteLiveMark | undefined;
  fetchEvidence?: (ticker: string, direction: "long" | "short") => Promise<EvidenceItem[] | null>;
  stampExit?: ((sessionDate: string, ticker: string, exit: Record<string, unknown>) => Promise<void>) | null;
  nowMs?: number;
  /** Exit family override (tests / A-B). Omitted → the row's FROZEN exit_policy_at_commit
   *  (design Q13), then resolveExitMode() reads the env for legacy/unpinned rows. */
  exitMode?: ZeroDteExitMode;
  /** Day regime for the trim_scale schedule (trim_scale only). Omitted → "neutral". */
  regime?: ZeroDteRegime | null;
};

export type ZeroDteRowExit = {
  /** The mark the engine exited at — becomes the row's frozen last_mark. */
  mark: number;
  decision: ExitDecision;
  exitContext: ZeroDteExitContext;
};

/**
 * Evaluate the exit engine for one STILL-OPEN ledger row (the caller has already
 * run derivePlayStatus and skips rows it closed). Returns the exit to apply, or
 * null for anything else — HOLD/RAISE_FLOOR/TRIM decisions change nothing here
 * (TRIM is already derived + persisted by the peak latch; the engine's TRIM can
 * only agree with it). On EXIT the counterfactual record is stamped into the row's
 * entry_context.exit (first-write-wins, best-effort) before the caller persists
 * the CLOSED state.
 */
export async function evaluateLedgerRowExit(
  row: ZeroDteSetupLogRow,
  opts: { syncMark: number | null; status: string; nowEtMinutes?: number },
  deps: ExitSyncDeps = {}
): Promise<ZeroDteRowExit | null> {
  try {
    const nowMs = deps.nowMs ?? Date.now();
    const occ = typeof row.plan_json?.occ === "string" ? (row.plan_json.occ as string) : null;

    // Freshest mark wins: lane mark if fresh (≤5s, the app-wide staleness rule),
    // else this sync pass's own snapshot mark. NEVER the row's stale last_mark —
    // exiting a play at a price nobody just observed is the wrong-number class
    // this whole lane exists to kill. CONTRACT: `opts.syncMark` must itself be a
    // CURRENT mark (this pass just fetched it) — the age of a bare number can't be
    // checked here, so a caller that only has a stale mark must pass null, not the
    // stale value, or the engine could exit off it. The 1s live-marks caller passes
    // its fresh-only `engineMark` (null when >5s old); scan.ts passes its just-
    // fetched snapshot mark.
    const lane = occ ? (deps.readLaneMark ?? getZeroDteLiveMark)(occ) : undefined;
    const laneFresh = lane != null && lane.mark != null && !isZeroDteMarkStale(lane.asOf, nowMs);
    const mark = laneFresh ? lane!.mark : opts.syncMark;

    const entry = row.entry_premium;
    // No mark or no entry → the engine will hold anyway; skip the Cortex spend.
    if (mark == null || entry == null || entry <= 0) return null;

    const evidence = await (deps.fetchEvidence ?? fetchExitEvidence)(row.ticker, row.direction);

    const peak = row.peak_premium != null ? Math.max(row.peak_premium, mark) : mark;
    const ageMinutes = Number.isFinite(Date.parse(row.first_flagged_at))
      ? Math.max(0, (nowMs - Date.parse(row.first_flagged_at)) / 60_000)
      : null;
    // WS-02: when a fresh stop/target premium isn't pinned on the plan, derive it from the
    // FROZEN exit-policy snapshot's numeric params (the numbers this row committed under),
    // falling back to current-code PLAN_RULES ONLY for legacy rows with no snapshot. The
    // pinned plan_json.stop_premium/target_premium (computed from PLAN_RULES at commit) still
    // wins when present — it IS the commit-time number.
    const frozenPolicy = readFrozenExitPolicy(row.entry_context as Record<string, unknown> | null);
    const stopPct = frozenPolicy?.hard_stop_pct ?? PLAN_RULES.stop_pct;
    const targetPct = frozenPolicy?.target_pct ?? PLAN_RULES.target_pct;
    const pinnedStop =
      typeof row.plan_json?.stop_premium === "number" ? (row.plan_json.stop_premium as number) : null;
    const pinnedTarget =
      typeof row.plan_json?.target_premium === "number" ? (row.plan_json.target_premium as number) : null;
    // ENTRY-BASIS COHERENCE (fixed 2026-08-06). The pinned plan_json.stop_premium /
    // target_premium are derived in plan.ts:271-272 from `entry_max` (= flow_avg_fill ?? mark) —
    // the SMART MONEY's own fill. The LEDGER basis (`entry` here, and the basis every P&L,
    // ratchet floor and trim tranche below is denominated in) is resolveLedgerEntryPremium's
    // ACHIEVABILITY FLOOR: entry_max floored UP to the flag-time mark, because a member
    // arriving at flag time pays ~the mark, never a fill that is already gone.
    //
    // When markAtFlag > flow_avg_fill those two bases DIVERGE, and G-8/G-9 permit that
    // divergence all the way to CHASE_PCT (55%) before `MOVED` blocks the play (plan.ts:43,
    // gates.ts). A pinned stop at entry_max×0.5 compared against a mark whose P&L is measured
    // off the (higher) ledger basis is a stop at −50% of a number the member never paid: at
    // the +54.99% boundary the operative stop lands at −67.7% of the ledger basis. That is the
    // ONLY reachable path by which a thesis/flat/plan_stop exit can be stamped worse than the
    // −50% hard stop, and it is REACHABLE — measured LIVE on the prod board 2026-08-06:
    // 8 of 24 candidate setups had mark > entry_max (AVGO vs_flow_pct +35.26% → operative stop
    // −62.92%; NET −53.64%; AMZN −54.49%).
    //
    // Every OTHER stop consumer in the system already uses the ledger basis:
    // gradePlanFromBars (plan.ts:415, stop = entryPremium×(1+stopPct/100) with entryPremium =
    // row.entry_premium) and derivePlayStatus (plan.ts:692/718, trough ≤ entryPremium×0.5).
    // This call site was the sole holdout, and it is the AUTHORITATIVE one: both live callers
    // pass `deferPlanStop: true` (live-marks.ts:535, scan.ts:1671) precisely so the engine
    // gets the first say on the stop.
    //
    // The fix is deliberately SURGICAL: the pinned number still wins whenever the two bases
    // AGREE (which is every row where the mark did not run past the flow fill — 16 of the 24
    // live setups above), so behaviour is byte-identical there. Only on a genuine basis
    // divergence are the rails re-expressed on the ledger basis using the FROZEN percentages,
    // which preserves WS-02's rule that the row manages itself under its commit-time policy.
    //
    // The MEMBER-FACING printed plan (plan_json.entry_max / stop_premium / target_premium) is
    // deliberately left untouched — same boundary resolveLedgerEntryPremium draws. Only the
    // OPERATIVE rails move, and they move to agree with the basis the row is graded on.
    const planEntryMax =
      typeof row.plan_json?.entry_max === "number" ? (row.plan_json.entry_max as number) : null;
    // BOTH directions of basis divergence, not just the FLOOR one this check originally shipped
    // for (2026-08-06, entry > planEntryMax). resolveLedgerEntryPremium's ACHIEVABILITY CEILING
    // (plan.ts, 2026-08-27 / PR #2986) can also move `entry` the OTHER way — capped DOWN below
    // planEntryMax when the flow fill sat far above a live market that never traded there. That
    // case was unreachable when this line was first written (the ceiling didn't exist yet), so
    // `entry > planEntryMax` silently missed it: a divergence with entry BELOW planEntryMax left
    // entryBasisDiverged false, so the STALE pinned stop (computed from the pre-cap, much-higher
    // planEntryMax) kept being used even though `entry` — the basis pnlPct/currentMark are
    // actually measured against below — had already moved. Live 2026-08-28: AMD flow fill $3.8,
    // ledger-capped entry $1.23 (real market never near $3.8), pinned stop 1.9 (=3.8×0.5) sat
    // ABOVE the capped entry, so `mark <= planStop` was true on the FIRST evaluation after
    // commit — both AMD and NVDA closed_reason="stop" within 1-3s of their own flag, at ~0% real
    // P&L, and counted toward the session's stop tally that halted the desk. `!==` (not `<`)
    // because ceiling and floor are now both live paths — either direction of divergence must
    // re-derive the stop from the row's own (correct) ledger basis. A half-cent epsilon absorbs
    // round2() noise between the two independently-rounded numbers.
    const entryBasisDiverged =
      planEntryMax != null && planEntryMax > 0 && Math.abs(entry - planEntryMax) > 0.005;
    const planStop =
      pinnedStop != null && !entryBasisDiverged ? pinnedStop : entry * (1 + stopPct / 100);
    const planTarget =
      pinnedTarget != null && !entryBasisDiverged ? pinnedTarget : entry * (1 + targetPct / 100);

    // Exit family (A/B, default ratchet). In trim_scale mode there is no persisted
    // trim-count column yet (that is the graduation follow-up — FINDINGS 2026-07-23), so
    // derive "thirds already banked" from the MONOTONIC peak: taken == armed keeps the
    // runner's protective/target/thesis/flat exits self-consistent while the two
    // intermediate ⅓ TRIMs stay advisory (this sync path acts only on EXIT, exactly as
    // in ratchet mode). The conservative effect: flipping the env captures the core E5
    // win — never dump the whole runner at breakeven, run it to the target/stop — while
    // the precise per-third banking accounting graduates with the persisted count. In the
    // DEFAULT ratchet mode every field below is ignored by the engine.
    // Exit archetype precedence (design Q13): an explicit test/AB override, else the mode
    // FROZEN on the row at commit, else the live env. So a committed play manages itself
    // under its own commit-time policy — the env flip only steers plays committed AFTER it.
    const exitMode = deps.exitMode ?? readFrozenExitMode(row.entry_context) ?? resolveExitMode();
    const regime = deps.regime ?? null;
    const trimsTaken =
      exitMode === "trim_scale" ? trimTranchesArmed(pinnedLivePnlPct(entry, peak), regime ?? "neutral") : 0;

    const regimePlane = (row.entry_context as Record<string, unknown> | null)?.regime_plane as
      | { gexQuality?: RegimeGexQuality }
      | undefined;
    const gexQualityDegraded = gexQualityDegradedForExit(regimePlane?.gexQuality);

    const decision = evaluateExitState({
      entryPremium: entry,
      currentMark: mark,
      peakPremium: peak,
      ageMinutes,
      cortexEvidence: evidence,
      planStop,
      planTarget,
      status: opts.status,
      // TRIM is sticky via the peak latch, so status alone carries the trim fact.
      trimmed: opts.status === "TRIM",
      entryCortexScore: entryCortexScoreOf(row.entry_context),
      exitMode,
      regime,
      trimsTaken,
      gexQualityDegraded,
    });
    if (decision.action !== "EXIT") return null;

    const exitContext = buildExitContext(decision, entry, mark, peak, nowMs);
    // Persist the floor-honored mark (buildExitContext applies resolveExitMark).
    // Counterfactual record, first-write-wins (the SQL guards re-stamps): the
    // record page can later compute "exit saved X% vs riding to the close" from
    // this + the grader's close_price, with no new table. Best-effort by design —
    // a failed stamp must never block the actual protective exit below.
    const stamp = deps.stampExit === undefined ? (dbConfigured() ? stampZeroDteExitContext : null) : deps.stampExit;
    if (stamp) {
      await stamp(row.session_date, row.ticker, exitContext as unknown as Record<string, unknown>).catch(() => {});
    }
    return { mark: exitContext.mark, decision, exitContext };
  } catch {
    // A bug in the engine wiring must never break the ledger sync: no exit this
    // tick; the plan's own stop/time-stop rules still stand.
    return null;
  }
}

/** Live P&L at an exit mark — re-exported convenience for callers logging exits. */
export { pinnedLivePnlPct };
