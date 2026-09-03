import { fetchPlaybookPromotionReport } from "@/lib/admin-playbook-promotion";
import { etStamp } from "@/lib/largo/temporal/bar-session-date";

export async function spxPlaybookPromotionEvidenceForLargo(opts?: { since_date?: string }) {
  const sinceDate = opts?.since_date?.trim() || undefined;
  const report = await fetchPlaybookPromotionReport(
    sinceDate ? { since_date: sinceDate } : undefined
  );

  if (!report.available) {
    return report;
  }

  return {
    ...report,
    as_of_et: etStamp(Date.now()),
    note:
      "Admin-only OOS promotion analytics — same evaluation as /api/admin/playbook/promotion-report. Train window excluded via PLAYBOOK_TRAIN_CUTOFF_DATE; rows are out-of-sample instances with gate evaluation and closed-outcome rollup.",
  };
}
