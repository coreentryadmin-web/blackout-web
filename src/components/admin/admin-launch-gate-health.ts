/** Minimal shape this module needs from `LaunchStatusSnapshot` (src/lib/tool-access.ts) —
 *  kept structural (not imported) so this stays alias-free + trivially unit-testable, same
 *  pattern as admin-store-age.ts / admin-time-ago.ts in this folder. */
export type LaunchGateStatus = {
  open_count: number;
  total_count: number;
  locked_keys: readonly string[];
};

/**
 * Is the premium launch gate in a healthy state?
 *
 * Healthy means either everything is launched, or the ONLY locked tool is
 * "largo" — that single padlock is deliberate product design (tool-access.ts:
 * "Largo stays gated behind a padlock until its launch — that gate is
 * deliberate, not a bug"), not degradation.
 *
 * Deliberately does NOT hardcode an expected `open_count`. `total_count` is
 * `TOOLS.length` in tool-access.ts, which grows every time a new tool ships
 * (e.g. Meridian was added as TOOLS[7] in #2250/#2251) — any check pinned to
 * a specific open_count goes stale the next time a tool is added, exactly
 * the way AdminOperationsDashboard.tsx's old inline `open_count === 5` check
 * did: it was correct when written (6 tools total, 5 open + largo locked),
 * then silently wrong after Meridian became the 7th tool (6 open + largo
 * locked is now the healthy default, and 6 !== 5). Comparing against
 * `locked_keys` instead is correct at any tool count.
 */
export function launchGateHealthy(status: LaunchGateStatus): boolean {
  if (status.open_count === status.total_count) return true;
  return status.locked_keys.length === 1 && status.locked_keys[0] === "largo";
}
