/**
 * Resolve the near-term expiry axis for heatmap INV-2 cell re-sum audits.
 * Must match heatmap-verifier.ts / gex-cross-validation-core.ts — prefer the engine-emitted
 * `near_term_expiries` (pre-far-merge axis). A bare `expiries.slice(0, 8)` false-flags when
 * NEAR_TERM_EXPIRY_COUNT is 15 (SPX) or when thin chains pad with far-dated columns.
 */
export function resolveNearTermExpiriesForAudit(hm, legacySliceCount = 8) {
  if (hm?.near_term_expiries?.length) {
    return new Set(hm.near_term_expiries);
  }
  return new Set([...(hm?.expiries ?? [])].sort().slice(0, legacySliceCount));
}
