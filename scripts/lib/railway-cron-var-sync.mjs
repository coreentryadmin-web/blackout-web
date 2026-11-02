/**
 * Pure decision logic for `scripts/railway-audit-apply.mjs`'s step 4
 * ("Sync CRON_SECRET + internal base on each cron trigger").
 *
 * Kept in a sibling, side-effect-free module so it can be unit tested with the
 * plain node test runner — the caller script does real `railway variable set` /
 * `railway variables --json` network calls inline and has no test harness of
 * its own.
 *
 * `setVar` in the caller either successfully applies a variable write or calls
 * `process.exit(1)` on failure — so by the time control returns from applying
 * every update this module names for a given service, that service IS in sync,
 * regardless of whether it started out that way. `computeCronVarSyncPlan`
 * counts a service toward `syncedCount` once its plan is produced (i.e. once
 * the caller is about to carry it out), never gated on its PRE-sync state.
 */

/**
 * @param {{ key: string, serviceName: string, serviceExists: boolean, vars: Record<string, string> }[]} entries
 * @param {string} cronSecret
 * @param {string} internalBase
 * @returns {{
 *   syncedCount: number,
 *   updates: { key: string, serviceName: string, variable: "CRON_SECRET" | "CRON_TARGET_BASE_URL", value: string }[],
 *   missing: string[],
 * }}
 */
export function computeCronVarSyncPlan(entries, cronSecret, internalBase) {
  let syncedCount = 0;
  const updates = [];
  const missing = [];

  for (const { key, serviceName, serviceExists, vars } of entries) {
    if (!serviceExists) {
      missing.push(key);
      continue;
    }
    const existing = vars ?? {};
    if (existing.CRON_SECRET !== cronSecret) {
      updates.push({ key, serviceName, variable: "CRON_SECRET", value: cronSecret });
    }
    if (existing.CRON_TARGET_BASE_URL !== internalBase) {
      updates.push({ key, serviceName, variable: "CRON_TARGET_BASE_URL", value: internalBase });
    }
    // Every update pushed above for this service will be applied by the
    // caller before it moves on — so this service counts as "in sync" for
    // the summary regardless of whether it needed 0, 1, or 2 updates.
    syncedCount += 1;
  }

  return { syncedCount, updates, missing };
}
