/**
 * Minimal deterministic A/B bucketing — docs/marketing/SEO-GROWTH.md finding #8.
 * No rollout/feature-flag primitive existed anywhere in the codebase before this;
 * the closest precedent (tool-access.ts's LAUNCHED_TOOLS) is a binary env allowlist,
 * not a percentage bucketer. Pure functions here, cookie/GA4 plumbing in client.ts.
 */

/** FNV-1a — fast, well-distributed, deterministic. Not cryptographic; doesn't need to be. */
function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * A subject's stable percentile in [0, 100) for one experiment. The SAME subjectId +
 * experimentKey always yields the SAME percentile — that's what makes bucketing sticky
 * across page loads without needing server-side session state.
 */
export function bucketPercentile(subjectId: string, experimentKey: string): number {
  return hashString(`${experimentKey}:${subjectId}`) % 100;
}

/**
 * Assign one of `variants` by weight (defaults to an even split; weights need not sum
 * to 100 — they're normalized). Deterministic: same subjectId + experimentKey + variant
 * list always returns the same variant, so a user never flips between variants mid-test.
 */
export function assignVariant(
  subjectId: string,
  experimentKey: string,
  variants: readonly string[],
  weights?: readonly number[]
): string {
  if (variants.length === 0) {
    throw new Error("assignVariant: variants must be non-empty");
  }
  if (variants.length === 1) return variants[0];
  if (weights && weights.length !== variants.length) {
    throw new Error("assignVariant: weights.length must match variants.length");
  }

  const w = weights ?? variants.map(() => 1);
  const total = w.reduce((a, b) => a + b, 0);
  if (total <= 0) {
    throw new Error("assignVariant: weights must sum to a positive number");
  }

  const pct = bucketPercentile(subjectId, experimentKey);
  let cumulative = 0;
  for (let i = 0; i < variants.length; i++) {
    cumulative += (w[i] / total) * 100;
    if (pct < cumulative) return variants[i];
  }
  // Floating-point rounding can leave pct just past the last boundary — fall back to
  // the final variant rather than falling through with nothing (never undefined).
  return variants[variants.length - 1];
}
