/** Whether a published Legacy edition with plays is locked against force overwrites. */

export function editionHasLockedPlays(plays: unknown[] | null | undefined): boolean {
  return Array.isArray(plays) && plays.length > 0;
}

export type EditionLockDecision =
  | { action: "build" }
  | { action: "skip"; reason: string; plays_count: number };

/**
 * Force/cron re-runs must NOT swap a member-visible playbook unless overwrite=true.
 * Recap-only rows (plays=[]) remain rebuildable so the evening cron can fill a thin night.
 */
export function decideEditionForceLock(params: {
  existingPlayCount: number;
  overwrite: boolean;
}): EditionLockDecision {
  if (params.existingPlayCount <= 0) {
    return { action: "build" };
  }
  if (params.overwrite) {
    return { action: "build" };
  }
  return {
    action: "skip",
    plays_count: params.existingPlayCount,
    reason:
      `Edition locked — ${params.existingPlayCount} play(s) already published for this session. ` +
      `Pass overwrite=1 (admin) to replace the book.`,
  };
}
