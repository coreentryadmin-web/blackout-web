/**
 * Swing discovery phase-claim helpers — force=1 recovery must not delete a LIVE in-flight scan.
 * Deep-dive Q1: unconditional sharedCacheDel on force=1 can double-open when ops retries mid-scan.
 */

/** Matches swing-discovery route maxDuration (seconds) — upper bound on a healthy scan. */
export const SWING_DISCOVERY_SCAN_MAX_MS = 120_000;

/** Small buffer past max scan time before force=1 may clear a still-`running` claim. */
export const SWING_FORCE_CLEAR_RUNNING_BUFFER_MS = 10_000;

export type SwingDiscoveryPhaseClaim = {
  status: "running" | "done" | string;
  at: number;
};

/**
 * When force=1 would delete a prior claim, refuse if another replica is plausibly mid-scan:
 * status `running`, key still live (positive TTL), and started within maxDuration+buffer.
 */
export function shouldRefuseForceClearRunningClaim(
  claim: SwingDiscoveryPhaseClaim | null | undefined,
  nowMs: number,
  remainingTtlSec: number,
): boolean {
  if (!claim || claim.status !== "running" || remainingTtlSec <= 0) return false;
  const ageMs = nowMs - (Number.isFinite(claim.at) ? claim.at : 0);
  return ageMs < SWING_DISCOVERY_SCAN_MAX_MS + SWING_FORCE_CLEAR_RUNNING_BUFFER_MS;
}
