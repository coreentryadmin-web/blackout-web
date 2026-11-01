/**
 * Detect Cloudflare edge block/challenge HTML (WAF, bot fight) vs an app-level error body.
 * Used by deploy validation when GitHub Actions egress is blocked but ECS may be healthy.
 */

export function isCloudflareEdgeBlock(status, text) {
  if (status !== 403 && status !== 503) return false;
  const sample = String(text ?? "").slice(0, 12_000);
  return (
    /cf-error-details/i.test(sample) ||
    /you have been blocked/i.test(sample) ||
    /Attention Required! \| Cloudflare/i.test(sample)
  );
}

/** Exit code: validation impossible from this network (not a static-asset mismatch). */
export const EXIT_EDGE_BLOCKED = 2;
