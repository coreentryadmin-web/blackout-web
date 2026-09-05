/** Ordinary clock skew — a future `updatedAt` must not read as infinitely fresh. */
export const WS_TIMESTAMP_FUTURE_TOLERANCE_MS = 5_000;

export function wsUpdatedAtAgeMs(updatedAt: number, now = Date.now()): number {
  return Math.max(0, now - updatedAt);
}

/** Age in seconds from an ISO timestamp — null when missing, invalid, or clock-skewed future. */
export function ageSecFromIso(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  const atMs = new Date(iso).getTime();
  if (!Number.isFinite(atMs)) return null;
  const rawAgeMs = now - atMs;
  if (rawAgeMs < -WS_TIMESTAMP_FUTURE_TOLERANCE_MS) return null;
  return Math.round(Math.max(0, rawAgeMs) / 1000);
}

/** Age in whole minutes from an ISO timestamp — null when age cannot be trusted. */
export function ageMinFromIso(iso: string | null | undefined, now = Date.now()): number | null {
  const sec = ageSecFromIso(iso, now);
  if (sec == null) return null;
  return Math.round(sec / 60);
}

/** Elapsed minutes since an ISO timestamp — null when missing, invalid, or clock-skewed future. */
export function minutesSinceIso(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  const atMs = new Date(iso).getTime();
  if (!Number.isFinite(atMs)) return null;
  const rawAgeMs = now - atMs;
  if (rawAgeMs < -WS_TIMESTAMP_FUTURE_TOLERANCE_MS) return null;
  return Math.max(0, rawAgeMs) / 60_000;
}

/** Elapsed hours since an ISO timestamp — large sentinel when missing/invalid/skewed (filter-out). */
export function ageHoursFromIso(
  iso: string | null | undefined,
  staleHours = 999,
  now = Date.now()
): number {
  if (!iso) return staleHours;
  const atMs = new Date(iso).getTime();
  if (!Number.isFinite(atMs)) return staleHours;
  const rawAgeMs = now - atMs;
  if (rawAgeMs < -WS_TIMESTAMP_FUTURE_TOLERANCE_MS) return staleHours;
  return Math.max(0, rawAgeMs) / 3_600_000;
}

/** True when `updatedAt` is within [−futureTolerance, staleMs) of `now`. */
export function isWsUpdatedAtFresh(
  updatedAt: number | null | undefined,
  staleMs: number,
  now = Date.now(),
  futureToleranceMs = WS_TIMESTAMP_FUTURE_TOLERANCE_MS
): boolean {
  if (updatedAt == null || !Number.isFinite(updatedAt) || updatedAt <= 0) return false;
  const ageMs = now - updatedAt;
  return ageMs >= -futureToleranceMs && ageMs < staleMs;
}
