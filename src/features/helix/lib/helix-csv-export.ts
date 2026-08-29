import type { FlowAlert } from "@/lib/api";
import { helixScoreContextForPrint, helixScoreDistribution } from "./helix-score-context";

export type HelixCsvExportMeta = {
  rowCount: number;
  filterSummary?: string;
};

function csvEscape(value: unknown): string {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Serialize visible tape rows to CSV — includes session score tier when enough samples exist.
 */
export function helixTapeToCsv(alerts: readonly FlowAlert[], filterSummary?: string): string {
  const dist = helixScoreDistribution(alerts.map((a) => a.score));
  const header = [
    "Ticker",
    "Type",
    "Strike",
    "Expiry",
    "Premium",
    "Fill",
    "Spot",
    "Ask%",
    "OI",
    "IV",
    "OTM%",
    "DTE",
    "Score",
    "ScoreTier",
    "ScorePctile",
    "Route",
    "AlertRule",
    "AlertedAt",
  ].join(",");

  const meta = filterSummary ? `# filters: ${filterSummary}\n` : "";

  const rows = alerts
    .map((a) => {
      const ctx = helixScoreContextForPrint(a.score, dist);
      return [
        a.ticker,
        a.option_type,
        a.strike,
        a.expiry,
        a.premium,
        a.fill_price ?? "",
        a.underlying_price ?? "",
        a.ask_pct ?? "",
        a.open_interest ?? "",
        a.implied_volatility ?? "",
        a.otm_pct ?? "",
        a.dte ?? "",
        a.score ?? "",
        ctx.tier,
        ctx.percentile ?? "",
        a.route ?? "",
        a.alert_rule ?? "",
        a.alerted_at,
      ]
        .map(csvEscape)
        .join(",");
    })
    .join("\n");

  return meta + header + "\n" + rows;
}

export function downloadHelixCsv(alerts: readonly FlowAlert[], filterSummary?: string): HelixCsvExportMeta {
  const csv = helixTapeToCsv(alerts, filterSummary);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `helix-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  return { rowCount: alerts.length, filterSummary };
}

export function helixTapeToJson(alerts: readonly FlowAlert[]): string {
  const dist = helixScoreDistribution(alerts.map((a) => a.score));
  const rows = alerts.map((a) => ({
    ...a,
    score_context: helixScoreContextForPrint(a.score, dist),
  }));
  return JSON.stringify(rows, null, 2);
}
