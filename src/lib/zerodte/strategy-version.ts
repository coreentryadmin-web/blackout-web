/**
 * STRATEGY VERSION MANIFEST + config hash (design decision Q12 — INTEGRITY).
 *
 * THE PROBLEM this closes: calibration (calibration.ts) aggregates GRADED plays into
 * win-rate/PnL bands and graduates gates/signals on that evidence. But when the score
 * formula, a gate, the Cortex, the governor, the contract selector, the exit policy,
 * or the grader CHANGES, the plays graded under the OLD logic are no longer the same
 * experiment as plays graded under the NEW logic. Blending them in one band silently
 * corrupts the evidence — a gate can "graduate" (or fail to) on a population that is
 * really two different strategies stapled together. There was NO version stamp on any
 * ledger row (grep-confirmed at Q12), so this class of corruption was invisible.
 *
 * THE FIX: freeze a small manifest of subsystem version strings onto EVERY committed
 * setup (entry_context + feature vector) at commit time, plus a short deterministic
 * hash of the whole manifest (`strategy_config_hash`). Calibration then defaults to
 * aggregating ONLY rows whose hash matches the CURRENT manifest — cross-version
 * blending must be an explicit opt-in, never automatic. A committed row's stamp is
 * frozen with the play: bumping a constant here later never rewrites an existing row
 * (the ledger upsert COALESCE-pins entry_context/feature_vector at first flag).
 *
 * ── HOW TO USE IT (the deliberate act) ────────────────────────────────────────────
 * Each constant below is a short version string that a REVIEWER BUMPS BY HAND when —
 * and only when — that subsystem's LOGIC changes in a way that makes old graded
 * outcomes non-comparable to new ones. Bumping a constant is the DELIBERATE act that
 * PARTITIONS calibration: the moment you change (say) the scorer's formula, bump
 * SCORER_VERSION in the same PR. From that commit forward, new plays carry a new
 * `strategy_config_hash`, calibration keeps them in a fresh cohort, and the old cohort
 * stops accreting — its evidence stays intact and interpretable instead of being
 * diluted by plays the new formula would have scored differently. Do NOT bump for a
 * pure refactor, a comment, or a change that cannot move a graded outcome — an
 * unnecessary bump needlessly splits the population and slows every gate's graduation.
 *
 * PURE & deterministic: no IO, no clock, no crypto import. The hash is a small in-file
 * FNV-1a over the sorted `key=value` manifest string, so it is stable across key order
 * and reproducible anywhere (lib, sim, test) without a dependency.
 */

import { DEFAULT_EXIT_MODE, EXIT_RULES, TRIM_SCALE_RULES, type ZeroDteExitMode } from "./exit-engine";
import { FEATURE_VECTOR_VERSION } from "./feature-vector";
import { PLAN_RULES } from "./plan";

// ── The manifest constants (bump BY HAND when the named subsystem's logic changes) ──
// Start at "v1" except FEATURE_SCHEMA_VERSION and EXIT_POLICY, which are derived from
// the existing sources of truth so the manifest can never drift from them.

/** Whole-engine version — the board assembly / candidate→setup pipeline shape. Bump on
 *  a structural change to how a setup is built that isn't already covered by a finer
 *  constant below (a coarse catch-all so a broad rewrite still partitions). */
export const ENGINE_VERSION = "v1";
/** Discovery layer (which independent sources surface a candidate + their cuts). Bump
 *  when the discovery origins / top-N cuts / accumulation feed change materially.
 *  v3 (2026-07-28): merge v2 + momentum rank + NH no-exclude + wider caps/FLOW floors.
 *  v4 (2026-07-29): BREAKOUT price cap $400→$2500 + walk-until-built (stop FLOW-only
 *  starvation when momentum-top names lack same-day options).
 *  v5 (2026-08-06): 0DTE→Day-Trade admission ceiling widened dte≤1→dte≤4 (ZERODTE_MAX_DTE,
 *  horizons.ts) across FLOW/BREAKOUT/PIN + the real-time event trigger — partitions
 *  pre/post-widening "ONE_DTE" rows into separate calibration cohorts. See FINDINGS.md. */
export const DISCOVERY_VERSION = "v5";
/** Score formula — the evidence score the gate stack judges. Bump on ANY change to the
 *  scoring math or its weights (the F-2 / F-5 forensic bands are read per this).
 *  v2 (2026-07-28): BREAKOUT/PIN rescaled so real movers clear G-3. */
export const SCORER_VERSION = "v2";
/** Gate stack (G-1…G-n thresholds + calibration/enforce modes). Bump when a gate's
 *  threshold moves or a gate flips calibration↔enforce (it changes what commits).
 *  v4 (2026-07-28): G-15 not_zero_dte — fresh commits require ZERO_DTE contract horizon.
 *  v5 (2026-07-29): G-15 removed — ONE_DTE commits allowed (Monday equity starvation fix).
 *  v6 (2026-07-29): precision harden — confluence floor 2, BREAKOUT/PIN score floor 65.
 *  v7 (2026-07-29): G-9 quote age uses observation clock (not stale exchange last_updated). */
export const GATE_VERSION = "v7";
/** Night Hawk Cortex evidence vector + weighting. Bump when the Cortex composition or
 *  its veto/abstain logic changes (it changes which plays survive to commit).
 *  v2 (2026-07-29): veto-blind fail-closed restored for fresh commits. */
export const CORTEX_VERSION = "v2";
/** Portfolio governor (concentration / contradiction / same-direction caps). Bump when
 *  a governor rule changes which of a day's candidates actually commit.
 *  v2 (2026-07-29): concurrent open-play ceiling 6→100 (env ZERODTE_MAX_CONCURRENT). */
export const GOVERNOR_VERSION = "v2";
/** Contract selector (strike/expiry pick — pickChainContract & horizon clamp). Bump
 *  when the selected contract for the same signal would change (a different graded basis).
 *  v2 (2026-08-06): horizon clamp widened dte≤1→dte≤4 (ZERODTE_MAX_DTE) — the SAME flow/
 *  breakout/pin signal can now resolve to a farther, different contract than before. */
export const CONTRACT_SELECTOR_VERSION = "v2";
/** Default profit-management mode ("ratchet" | "trim_scale") — the exit engine's shipped
 *  default, used when a caller doesn't pass the ACTIVE mode. The live board passes the
 *  RESOLVED mode (resolveExitMode, design Q13) into buildStrategyManifest so the config
 *  hash actually partitions ratchet vs trim_scale cohorts (a different exit family grades
 *  the SAME entry to a different outcome); this constant is only the fallback. */
export const EXIT_POLICY: ZeroDteExitMode = DEFAULT_EXIT_MODE;
/** Exit-rule VERSION within the active policy (the numeric thresholds — arm/lock/trim
 *  levels, time-stop). Bump when those move even if the POLICY name is unchanged. */
export const EXIT_VERSION = "v3";
/** Grader — how a committed play is turned into a WIN/LOSS + PnL (−50/+100 directional,
 *  condor breach, time-stop rules). Bump when the grading rule changes (it re-labels
 *  the very outcomes calibration counts). */
export const GRADER_VERSION = "v1";
/** Feature-vector schema — derived from FEATURE_VECTOR_VERSION so the manifest tracks
 *  the persisted vector's shape without a second hand-maintained number. */
export const FEATURE_SCHEMA_VERSION = `v${FEATURE_VECTOR_VERSION}`;

/** The frozen manifest — every field a short version string (or the active exit mode).
 *  Flat + JSON-serializable on purpose: it rides in entry_context and hashes cleanly. */
export interface StrategyManifest {
  engine: string;
  discovery: string;
  scorer: string;
  gate: string;
  cortex: string;
  governor: string;
  contract_selector: string;
  /** The ACTIVE exit mode ("ratchet" | "trim_scale"). */
  exit_policy: ZeroDteExitMode;
  exit: string;
  grader: string;
  feature_schema: string;
}

/** Assemble the current manifest from the constants above. PURE — the single source
 *  of truth every persist/calibration site reads, so the stamp and the calibration
 *  cohort key can never disagree. `opts.exitPolicy` lets the caller supply the ACTIVE
 *  resolved exit mode (design Q13) instead of the shipped default, so the config hash
 *  partitions ratchet vs trim_scale cohorts; omitted → EXIT_POLICY (still pure). */
export function buildStrategyManifest(opts: { exitPolicy?: ZeroDteExitMode } = {}): StrategyManifest {
  return {
    engine: ENGINE_VERSION,
    discovery: DISCOVERY_VERSION,
    scorer: SCORER_VERSION,
    gate: GATE_VERSION,
    cortex: CORTEX_VERSION,
    governor: GOVERNOR_VERSION,
    contract_selector: CONTRACT_SELECTOR_VERSION,
    exit_policy: opts.exitPolicy ?? EXIT_POLICY,
    exit: EXIT_VERSION,
    grader: GRADER_VERSION,
    feature_schema: FEATURE_SCHEMA_VERSION,
  };
}

/** FNV-1a 32-bit over a string → 8-hex. `Math.imul` keeps the multiply in 32-bit; the
 *  `>>> 0` normalizes to unsigned before hex. Deterministic, dependency-free, and
 *  well-mixed enough for a config fingerprint (collision risk on a handful of manifest
 *  variants is negligible — this is an equality key, not a security hash). */
function fnv1a32(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * Short deterministic hash of a manifest — the `strategy_config_hash` stamped on every
 * committed row and used as calibration's cohort key. Built over the manifest's entries
 * SORTED BY KEY and joined `key=value;…`, so it is STABLE ACROSS KEY ORDER (two
 * manifests with the same field values hash identically regardless of construction
 * order) and CHANGES whenever ANY field value changes. Prefixed `cfg-` for readability
 * in blobs/logs. Pure.
 */
export function strategyConfigHash(manifest: StrategyManifest): string {
  const canonical = Object.entries(manifest)
    .map(([k, v]) => [k, String(v)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join(";");
  return `cfg-${fnv1a32(canonical)}`;
}

/** Convenience: the CURRENT manifest's hash. The value every fresh commit stamps and
 *  the default cohort key calibration aggregates on. */
export function currentStrategyConfigHash(): string {
  return strategyConfigHash(buildStrategyManifest());
}

// ── WS-02: immutable exit-policy SNAPSHOT (fully-resolved numeric exit params) ───────
// THE PROBLEM this closes: at commit we froze only the exit MODE NAME
// (entry_context.exit_policy_at_commit) + the EXIT_VERSION string. The actual NUMERIC
// thresholds that decide a graded outcome — the −50% stop, +100% target, the ⅓/⅓/⅓
// trim ladder, the ratchet arm/lock floors, the 15:30 time-stop, the stop-before-target
// same-bar collision rule — lived ONLY in code (PLAN_RULES / EXIT_RULES / TRIM_SCALE_RULES).
// So a grader replaying a historical row re-derived them from CURRENT code: a later
// numeric edit silently re-graded every past play under the new numbers, corrupting the
// very calibration cohort the strategy hash exists to protect. (EXIT_VERSION was meant to
// be bumped by hand on such an edit, but nothing MEASURED the numbers, so a forgotten
// bump was invisible.)
//
// THE FIX: buildResolvedExitPolicy(mode) resolves the WHOLE policy from the real sources
// of truth into one flat, JSON-serializable object with its own `config_hash`. scan.ts
// freezes it into entry_context.exit_policy_snapshot at commit; the exit engine and BOTH
// graders (gradePlanFromBars, gradeCondorFromBars) PREFER the snapshot's numbers when
// present and fall back to current code ONLY for legacy rows without it. The drift-guard
// test (exit-policy-snapshot.test.ts) pins the resolved config_hash to a committed golden
// so a silent numeric edit that isn't accompanied by an EXIT_VERSION bump trips CI.
//
// PURE: no IO, no clock — same discipline as the manifest above.

/** One profit-taking tranche in the resolved ladder. `fraction` is the share of the
 *  ORIGINAL position banked at `trigger_pct` peak P&L. */
export type ResolvedExitTrimLevel = { trigger_pct: number; fraction: number };

/** The fully-resolved, immutable exit policy frozen onto a row at commit. Every numeric
 *  exit param that can move a graded outcome is a field here (or encoded in
 *  `trailing_rule`), so `config_hash` is a faithful fingerprint of the exit math. */
export interface ResolvedExitPolicy {
  /** The active exit family ("ratchet" | "trim_scale"). */
  policy: ZeroDteExitMode;
  /** EXIT_VERSION at commit — the hand-bumped version of the numeric thresholds. */
  version: string;
  /** Hard stop as % of entry premium (−50 = cut at half). PLAN_RULES.stop_pct. */
  hard_stop_pct: number;
  /** Profit target as % of entry premium (+100 = double). PLAN_RULES.target_pct. */
  target_pct: number;
  /** Profit-taking tranches (mode-specific): the plan-target half-trim in ratchet mode,
   *  the ⅓@+25% / ⅓@+50% ladder in trim_scale mode. */
  trim_levels: ResolvedExitTrimLevel[];
  /** Fraction of the original position left running after the trims (the runner). */
  runner_fraction: number;
  /** Human/parse-stable encoding of the trailing/floor rule and every constant it uses —
   *  the ratchet arm/lock/runner floors + flat-timeout in ratchet mode; the regime tranche
   *  table + "no trailing stop" in trim_scale mode. Embedded in the hash so ANY numeric edit
   *  to those constants changes config_hash even though they have no dedicated field. */
  trailing_rule: string;
  /** Same-day hard time-stop, ET "H:MM" (15:30). Derived from PLAN_RULES.time_stop_et_minutes. */
  time_stop_et: string;
  /** How a same-bar stop+target collision is resolved by the grader (stop wins — the
   *  conservative intrabar order gradePlanFromBars/gradeCondorFromBars apply). */
  collision_rule: string;
  /** fnv1a32 over the sorted policy object (sans this field), prefixed `exitcfg-`. */
  config_hash: string;
}

/** ET "H:MM" for minutes-since-midnight (15*60+30 → "15:30"). */
function formatEtMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

/** Deterministic stringify with recursively-sorted object keys — so the config_hash is
 *  stable across key order (same discipline as strategyConfigHash's sorted join). Arrays
 *  keep their order (meaningful for trim_levels); objects are key-sorted. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const body = Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",");
  return `{${body}}`;
}

/**
 * Resolve the FULL numeric exit policy for `mode` from the real sources of truth
 * (PLAN_RULES + EXIT_RULES / TRIM_SCALE_RULES). PURE. The returned object's `config_hash`
 * fingerprints every exit constant that can move a graded outcome — the drift-guard test
 * pins it to a golden, so a silent numeric edit without an EXIT_VERSION bump fails CI.
 */
export function buildResolvedExitPolicy(mode: ZeroDteExitMode = EXIT_POLICY): ResolvedExitPolicy {
  const time_stop_et = formatEtMinutes(PLAN_RULES.time_stop_et_minutes);
  const collision_rule = "stop_before_target_same_bar";

  let trim_levels: ResolvedExitTrimLevel[];
  let runner_fraction: number;
  let trailing_rule: string;
  if (mode === "trim_scale") {
    const r = TRIM_SCALE_RULES.tranches_by_regime;
    // The shipped/base schedule is the neutral regime; trend/range are encoded in
    // trailing_rule so a numeric edit to ANY regime's tranches trips the hash.
    trim_levels = r.neutral.map((trigger_pct) => ({ trigger_pct, fraction: TRIM_SCALE_RULES.tranche_fraction }));
    runner_fraction = TRIM_SCALE_RULES.tranche_fraction; // the last third runs to the rails
    trailing_rule =
      `trim_scale:no_trailing_stop;tranche_fraction=${TRIM_SCALE_RULES.tranche_fraction};` +
      `tranches trend=[${r.trend.join(",")}] neutral=[${r.neutral.join(",")}] range=[${r.range.join(",")}]`;
  } else {
    // ratchet: bank half at the plan target, then run under the monotonic floor.
    trim_levels = [{ trigger_pct: PLAN_RULES.target_pct, fraction: 0.5 }];
    runner_fraction = 0.5;
    trailing_rule =
      `ratchet:early@+${EXIT_RULES.ratchet_early_arm_pnl_pct}%->floor+${EXIT_RULES.ratchet_early_arm_floor_pct}%,` +
      `arm@+${EXIT_RULES.ratchet_arm_pnl_pct}%->floor+${EXIT_RULES.ratchet_arm_floor_pct}%,` +
      `lock@+${EXIT_RULES.ratchet_lock_pnl_pct}%->floor+${EXIT_RULES.ratchet_lock_floor_pct}%,` +
      `runner_floor+${EXIT_RULES.runner_floor_pct}%;` +
      `flat_timeout=${EXIT_RULES.flat_timeout_min}min@±${EXIT_RULES.flat_band_pct}%`;
  }

  const core = {
    policy: mode,
    version: EXIT_VERSION,
    hard_stop_pct: PLAN_RULES.stop_pct,
    target_pct: PLAN_RULES.target_pct,
    trim_levels,
    runner_fraction,
    trailing_rule,
    time_stop_et,
    collision_rule,
  };
  return { ...core, config_hash: `exitcfg-${fnv1a32(stableStringify(core))}` };
}

/** The grader-facing numeric subset of a resolved policy — stop/target %, and the ET
 *  time-stop parsed back to minutes-since-midnight — so the pure graders (plan.ts /
 *  condor.ts) take plain numbers and never import ResolvedExitPolicy (plan.ts is a leaf
 *  strategy-version.ts imports, so the reverse would cycle). */
export function exitPolicyGraderParams(
  policy: Pick<ResolvedExitPolicy, "hard_stop_pct" | "target_pct" | "time_stop_et">
): { hard_stop_pct: number; target_pct: number; time_stop_et_minutes: number } {
  const [h, m] = policy.time_stop_et.split(":").map((n) => Number(n));
  const minutes = (Number.isFinite(h) ? h * 60 : 0) + (Number.isFinite(m) ? m : 0);
  return { hard_stop_pct: policy.hard_stop_pct, target_pct: policy.target_pct, time_stop_et_minutes: minutes };
}
