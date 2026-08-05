/**
 * NH-R3 — live, mechanically-computed data-completeness scoring for a committed 0DTE setup.
 *
 * `docs/audit/NIGHTHAWK-DATA-PROVENANCE.md` §7 is a manually-maintained ledger (dated 2026-07-25)
 * marking each field the pipeline touches as ingested Y/N, fresh TRACKED/BLIND, and basis
 * official/PROXY. It is accurate but STATIC — a one-time audit sweep, never recomputed, and it will
 * silently drift the next time a field gets threaded (or stops being threaded) at the commit site.
 *
 * `computeDataCompletenessScore` turns the "ingested Y/N" half of that ledger into a live signal: it
 * re-derives, MECHANICALLY, what fraction of a committed setup's `SetupFeatureVector` fields are
 * actually populated at runtime — no hand-editing required as fields get threaded over time.
 *
 * Scope, deliberately: this covers ONLY "ingested Y/N" (is the field non-null on this row). The
 * ledger's other two axes — "fresh TRACKED/BLIND" (needs a per-field freshness/asOf timestamp) and
 * "basis official/PROXY" (a documented fact about WHERE a field's value comes from, e.g. `vix` here
 * is day-open VIX standing in for intraday VIX per §7-D) — are NOT derivable from the feature vector's
 * shape alone; the vector doesn't carry per-field timestamps or provenance tags. Faking that
 * distinction from presence alone would be worse than the static doc, not better, so this function
 * does not attempt it. See docs/audit/FINDINGS.md (2026-08-05, NH-R3) for that explicit scope note
 * and the follow-up this leaves on the table.
 *
 * PURE — no IO, no imports beyond the feature-vector types, so it is trivially unit-testable and
 * cheap to call on every commit for a log/telemetry field (EVIDENCE ONLY — nothing gates on this).
 */

import type { SetupFeatureVector } from "./feature-vector";

/** One group per §7-ledger-adjacent concern, so a caller can see WHICH part of the setup is thin. */
export type CompletenessGroup =
  | "dossier"
  | "flow_quality"
  | "regime"
  | "technicals"
  | "positioning"
  | "market"
  | "provenance";

/**
 * The trackable (nullable-at-commit) fields, grouped. Deliberately excludes the always-present core
 * identity/score fields (`v`, `ticker`, `side`, `tod_min`, `evidence_score`) — those are set by
 * construction on every commit (see `buildSetupFeatureVector`), so scoring completeness over them
 * would just dilute the signal toward 100% without telling you anything about what's actually thin.
 */
const COMPLETENESS_FIELDS: Record<CompletenessGroup, ReadonlyArray<keyof SetupFeatureVector>> = {
  dossier: ["dossier_score"],
  flow_quality: [
    "fq_score", "fq_premium_depth", "fq_aggression", "fq_sweep", "fq_persistence",
    "fq_concentration", "fq_momentum", "fq_institutional", "fq_dominance",
    "fq_accelerating", "fq_prem_per_min", "fq_net_prem_slope",
  ],
  regime: ["reg_structure", "reg_gap", "reg_vol", "reg_opex", "reg_quad", "reg_fed"],
  technicals: ["vwap_dist_pct", "or_break", "trend_5m", "rsi14", "rel_volume", "atr14"],
  positioning: ["gamma_regime", "gex_king_dist_pct", "dark_pool_bias"],
  market: ["vix", "spy_bias", "confluence"],
  provenance: [
    "discovery_origin", "contract_horizon", "actual_dte_at_commit",
    "strategy_config_hash", "direction_owner", "merge_policy_version",
  ],
};

/** Flat, ordered list of every field this scorer tracks (used for the overall total). */
export const COMPLETENESS_TRACKED_FIELDS: ReadonlyArray<keyof SetupFeatureVector> = Object.values(
  COMPLETENESS_FIELDS
).flat();

export type CompletenessGroupResult = {
  group: CompletenessGroup;
  /** Fields in this group whose value is non-null on the row. */
  present: string[];
  /** Fields in this group whose value is null (never threaded, or explicitly absent). */
  missing: string[];
  /** present.length / (present.length + missing.length); 1 when the group is empty (vacuously complete). */
  fraction: number;
};

export type DataCompletenessScore = {
  /** Overall fraction of all tracked fields that are non-null, 0..1. */
  score: number;
  total_fields: number;
  present_fields: number;
  missing_fields: number;
  /** Mechanically-derived verdict, same spirit as the §7 legend's "ingested Y/N": COMPLETE only when
   *  every tracked field is present, BLIND only when none are, PARTIAL otherwise. */
  verdict: "COMPLETE" | "PARTIAL" | "BLIND";
  by_group: CompletenessGroupResult[];
  /** Convenience flat list — every missing field across all groups, for a one-line log line. */
  missing_field_names: string[];
};

function isPresent(value: SetupFeatureVector[keyof SetupFeatureVector]): boolean {
  // null is the vector's ONE "not threaded" sentinel (per feature-vector.ts's own convention: "a
  // null feature is honest; a zero is a lie") — so presence is exactly "not null". 0/false/"" are
  // all legitimate real values (e.g. reg_opex: 0, fq_accelerating: 0) and must count as present.
  return value !== null && value !== undefined;
}

/**
 * Mechanically recompute what fraction of a committed setup's feature-vector fields are populated.
 * Deterministic, pure, and O(number of tracked fields) — cheap enough to call on every commit.
 */
export function computeDataCompletenessScore(setup: SetupFeatureVector): DataCompletenessScore {
  const byGroup: CompletenessGroupResult[] = (Object.keys(COMPLETENESS_FIELDS) as CompletenessGroup[]).map(
    (group) => {
      const fields = COMPLETENESS_FIELDS[group];
      const present: string[] = [];
      const missing: string[] = [];
      for (const f of fields) {
        if (isPresent(setup[f])) present.push(f);
        else missing.push(f);
      }
      const total = present.length + missing.length;
      return { group, present, missing, fraction: total === 0 ? 1 : present.length / total };
    }
  );

  const presentFields = byGroup.reduce((n, g) => n + g.present.length, 0);
  const totalFields = COMPLETENESS_TRACKED_FIELDS.length;
  const missingFields = totalFields - presentFields;
  const score = totalFields === 0 ? 1 : presentFields / totalFields;

  const verdict: DataCompletenessScore["verdict"] =
    missingFields === 0 ? "COMPLETE" : presentFields === 0 ? "BLIND" : "PARTIAL";

  return {
    score,
    total_fields: totalFields,
    present_fields: presentFields,
    missing_fields: missingFields,
    verdict,
    by_group: byGroup,
    missing_field_names: byGroup.flatMap((g) => g.missing),
  };
}
