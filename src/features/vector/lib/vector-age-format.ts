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

/** Past this age the shared universe snapshot (rebuilt by a 5-minute cron) is old enough to call
 *  out — two missed cron cycles — shared by every consumer of `useVectorUniverseSnapshot` so the
 *  staleness threshold can't drift between them (extracted 2026-08-27 when the second consumer,
 *  VectorTickerComparisonStrip, needed the same disclosure VectorScanner already had). */
export const VECTOR_UNIVERSE_STALE_MS = 10 * 60 * 1000;
