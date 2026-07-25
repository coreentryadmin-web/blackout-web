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

import { DEFAULT_EXIT_MODE, type ZeroDteExitMode } from "./exit-engine";
import { FEATURE_VECTOR_VERSION } from "./feature-vector";

// ── The manifest constants (bump BY HAND when the named subsystem's logic changes) ──
// Start at "v1" except FEATURE_SCHEMA_VERSION and EXIT_POLICY, which are derived from
// the existing sources of truth so the manifest can never drift from them.

/** Whole-engine version — the board assembly / candidate→setup pipeline shape. Bump on
 *  a structural change to how a setup is built that isn't already covered by a finer
 *  constant below (a coarse catch-all so a broad rewrite still partitions). */
export const ENGINE_VERSION = "v1";
/** Discovery layer (which independent sources surface a candidate + their cuts). Bump
 *  when the discovery origins / top-N cuts / accumulation feed change materially. */
export const DISCOVERY_VERSION = "v1";
/** Score formula — the evidence score the gate stack judges. Bump on ANY change to the
 *  scoring math or its weights (the F-2 / F-5 forensic bands are read per this). */
export const SCORER_VERSION = "v1";
/** Gate stack (G-1…G-n thresholds + calibration/enforce modes). Bump when a gate's
 *  threshold moves or a gate flips calibration↔enforce (it changes what commits). */
export const GATE_VERSION = "v1";
/** Night Hawk Cortex evidence vector + weighting. Bump when the Cortex composition or
 *  its veto/abstain logic changes (it changes which plays survive to commit). */
export const CORTEX_VERSION = "v1";
/** Portfolio governor (concentration / contradiction / same-direction caps). Bump when
 *  a governor rule changes which of a day's candidates actually commit. */
export const GOVERNOR_VERSION = "v1";
/** Contract selector (strike/expiry pick — pickChainContract & horizon clamp). Bump
 *  when the selected contract for the same signal would change (a different graded basis). */
export const CONTRACT_SELECTOR_VERSION = "v1";
/** ACTIVE profit-management mode ("ratchet" | "trim_scale"). Derived from the exit
 *  engine's shipped default so a live mode flip is reflected in the hash automatically
 *  (a different exit family grades the SAME entry to a different outcome). */
export const EXIT_POLICY: ZeroDteExitMode = DEFAULT_EXIT_MODE;
/** Exit-rule VERSION within the active policy (the numeric thresholds — arm/lock/trim
 *  levels, time-stop). Bump when those move even if the POLICY name is unchanged. */
export const EXIT_VERSION = "v1";
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
 *  cohort key can never disagree. */
export function buildStrategyManifest(): StrategyManifest {
  return {
    engine: ENGINE_VERSION,
    discovery: DISCOVERY_VERSION,
    scorer: SCORER_VERSION,
    gate: GATE_VERSION,
    cortex: CORTEX_VERSION,
    governor: GOVERNOR_VERSION,
    contract_selector: CONTRACT_SELECTOR_VERSION,
    exit_policy: EXIT_POLICY,
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
