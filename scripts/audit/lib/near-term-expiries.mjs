/**
 * Authoritative near-term expiry axis for heatmap INV-2 cell re-sum audits.
 * Mirrors src/lib/correctness/heatmap-verifier.ts `resolveNearTermExpiries`.
 */
export function resolveNearTermExpiries(hm) {
  if (hm?.near_term_expiries?.length) {
    return new Set(hm.near_term_expiries);
  }
  // Legacy cached payloads: first 8 ascending expiries.
  return new Set([...(hm?.expiries ?? [])].sort().slice(0, 8));
}
