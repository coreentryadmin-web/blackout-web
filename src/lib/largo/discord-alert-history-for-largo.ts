import { dbConfigured, fetchAlertAuditRowsForLargo } from "@/lib/db";
import { etStamp } from "@/lib/largo/temporal/bar-session-date";

export async function discordAlertHistoryForLargo(opts?: {
  limit?: number;
  alert_type?: string;
  ticker?: string;
  since_days?: number;
}) {
  if (!dbConfigured()) {
    return { available: false, reason: "database not configured" } as const;
  }

  const limit =
    opts?.limit != null && Number.isFinite(Number(opts.limit)) ? Number(opts.limit) : 40;
  const sinceDays =
    opts?.since_days != null && Number.isFinite(Number(opts.since_days))
      ? Number(opts.since_days)
      : undefined;
  const alertType = opts?.alert_type?.trim() || undefined;
  const ticker = opts?.ticker?.trim().toUpperCase() || undefined;

  const { rows, counts_by_type } = await fetchAlertAuditRowsForLargo({
    limit,
    alert_type: alertType,
    ticker,
    since_days: sinceDays,
  });

  return {
    available: true,
    as_of: new Date().toISOString(),
    as_of_et: etStamp(Date.now()),
    filters: {
      alert_type: alertType ?? null,
      ticker: ticker ?? null,
      since_days: sinceDays ?? null,
      limit,
    },
    counts_by_type,
    count: rows.length,
    alerts: rows.map((row) => ({
      id: row.id,
      alert_type: row.alert_type,
      source_table: row.source_table,
      ticker: row.ticker,
      direction: row.direction,
      fired_at: row.fired_at,
      confidence_score: row.confidence_score,
      confidence_label: row.confidence_label,
      trigger_reason: row.trigger_reason,
      outcome: row.outcome,
      final_output: row.final_output,
    })),
    note:
      rows.length === 0
        ? "No alert_audit_log rows match these filters — outbound Discord posts are written when 0DTE, Night Hawk, or SPX plays fire."
        : "Read-only audit trail — `final_output` is the member-visible payload that accompanied the alert (Discord embed content / trade card). Not internal webhook URLs.",
  };
}
