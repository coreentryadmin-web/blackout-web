/**
 * Singleton claim for swing-active-refresh — prevents overlapping cron invocations from
 * racing ROLL vs CLOSE on the same position (deep-dive Q37).
 *
 * Discovery uses per-(day, phase) claims; active-refresh uses one global "running" key because
 * there is only one refresh cadence (15m RTH) and overlapping background passes are pure loss.
 */

/** Matches swing-active-refresh route maxDuration (seconds). */
export const SWING_ACTIVE_REFRESH_MAX_MS = 180_000;

/** Buffer past maxDuration before a stale claim may be ignored by a new acquirer. */
export const SWING_ACTIVE_REFRESH_CLAIM_BUFFER_MS = 15_000;

export const SWING_ACTIVE_REFRESH_CLAIM_KEY = "swing:active-refresh:running";

export type SwingActiveRefreshClaim = {
  status: "running";
  at: number;
};

export function activeRefreshClaimTtlSec(): number {
  return Math.ceil(
    (SWING_ACTIVE_REFRESH_MAX_MS + SWING_ACTIVE_REFRESH_CLAIM_BUFFER_MS) / 1000,
  );
}

/** True when an existing claim is still plausibly owned by a live refresh pass. */
export function isActiveRefreshClaimLive(
  claim: SwingActiveRefreshClaim | null | undefined,
  nowMs: number,
  remainingTtlSec: number,
): boolean {
  if (!claim || claim.status !== "running" || remainingTtlSec <= 0) return false;
  const ageMs = nowMs - (Number.isFinite(claim.at) ? claim.at : 0);
  return ageMs < SWING_ACTIVE_REFRESH_MAX_MS + SWING_ACTIVE_REFRESH_CLAIM_BUFFER_MS;
}
