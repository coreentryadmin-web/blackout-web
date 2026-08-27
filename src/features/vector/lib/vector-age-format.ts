/**
 * Shared "how long ago" formatter for the small toolbar age chips (GEX/VEX lens, dark-pool
 * toggle). Extracted from VectorLensToggle.tsx's local `formatLensAge` so a second toggle needing
 * the same "· 5m" chip doesn't duplicate the rule — the rounding/threshold choice (seconds under a
 * minute, whole minutes after) is a decision that should live in exactly one place.
 */
export function formatVectorAge(asOf: number | null | undefined, now: number | null): string | null {
  if (asOf == null || now == null || asOf <= 0) return null;
  const s = Math.max(0, Math.floor((now - asOf) / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m`;
}
