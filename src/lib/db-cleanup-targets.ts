/**
 * Allow-list of cleanup targets. Keys are table names; values are the set of
 * timestamp columns valid for that table's retention window. SQL identifiers
 * CANNOT be parameterized, so they must be validated against this list.
 */
export const CLEANUP_TARGETS: Readonly<Record<string, readonly string[]>> = {
  api_telemetry_events: ["at"],
  flow_alerts: ["inserted_at"],
  cron_job_runs: ["started_at"],
  spx_signal_log: ["created_at"],
  nighthawk_dossiers_staging: ["created_at"],
  nighthawk_job_log: ["created_at"],
  admin_audit_log: ["created_at"],
};

/**
 * Pure, alias-free predicate: is (table, column) a known cleanup target?
 * hasOwnProperty guard blocks prototype-pollution keys (constructor/__proto__).
 */
export function isAllowedCleanupTarget(table: string, column: string): boolean {
  if (!Object.prototype.hasOwnProperty.call(CLEANUP_TARGETS, table)) return false;
  return CLEANUP_TARGETS[table].includes(column);
}
