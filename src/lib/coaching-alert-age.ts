/**
 * Pure age/staleness derivation for a `coaching_alerts` row's `generated_at`
 * (Postgres `TIMESTAMPTZ NOT NULL DEFAULT NOW()`, set by the RDS server's own clock).
 * Extracted out of `GET /api/coaching/alerts` so the future-timestamp clamp below is
 * independently testable — see `coaching-alert-age.test.ts`.
 *
 * Root cause this guards: `generated_at` is stamped by the RDS server's clock while this
 * route reads it against `Date.now()` on the ECS app process. Any clock skew (ordinary NTP
 * jitter, or a container whose clock hasn't fully converged) where the DB clock reads even
 * slightly AHEAD of the app clock makes the raw `now - generatedAt` age negative.
 * `Math.floor` on ANY negative number rounds AWAY from zero (`Math.floor(-0.0001) === -1`),
 * so the un-clamped version of this was reachable at a single millisecond of skew, not a
 * full minute — a fresh alert's age silently became "-1 minutes ago" (and grows more
 * negative as skew grows) instead of the correct "just now". Same bug shape as the
 * future-timestamp freshness-badge fixes already made elsewhere in this codebase
 * (`FlowFeed.tsx`, `GexHeatmap.tsx`, `meridian-viz.tsx`) — clamp the DISPLAYED age at zero;
 * never surface a negative "time ago" to a consumer of this SPX coaching-desk feed.
 */
export type CoachingAlertAgeFields = {
  ageMs: number | null;
  ageMinutes: number | null;
  stale: boolean;
};

export function coachingAlertAgeFields(
  generatedAt: string | Date | null | undefined,
  nowMs: number
): CoachingAlertAgeFields {
  if (!generatedAt) return { ageMs: null, ageMinutes: null, stale: false };
  const t = new Date(generatedAt).getTime();
  if (!Number.isFinite(t)) return { ageMs: null, ageMinutes: null, stale: false };
  // Clamp at zero: a future-dated generated_at (clock skew) is "as fresh as possible",
  // never negative.
  const ageMs = Math.max(0, nowMs - t);
  return {
    ageMs,
    ageMinutes: Math.floor(ageMs / 60_000),
    stale: ageMs > 60 * 60 * 1000,
  };
}
