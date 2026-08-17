import type { BenzingaStructuredEarnings } from "@/lib/providers/polygon";
import type {
  MeridianEarningsCalendarRow,
  MeridianStreetEstimate,
} from "@/features/meridian/lib/meridian-types";
import type { EarningsTimelineInput } from "@/features/meridian/lib/meridian-timeline";

/** Map Benzinga HH:MM:SS → premarket / afterhours bucket for timeline chips. */
export function earningsWhenFromTime(time: string | null): "premarket" | "afterhours" | null {
  if (!time) return null;
  const hour = Number(time.slice(0, 2));
  if (!Number.isFinite(hour)) return null;
  return hour < 12 ? "premarket" : "afterhours";
}

export function benzingaToCalendarRow(row: BenzingaStructuredEarnings): MeridianEarningsCalendarRow {
  return {
    date: row.date,
    time: row.time,
    date_status: row.date_status,
    fiscal_period: row.fiscal_period,
    fiscal_year: row.fiscal_year,
    importance: row.importance,
    estimated_eps: row.estimated_eps,
    actual_eps: row.actual_eps,
    eps_surprise_pct: row.eps_surprise_pct,
    estimated_revenue: row.estimated_revenue,
    actual_revenue: row.actual_revenue,
    revenue_surprise_pct: row.revenue_surprise_pct,
    previous_eps: row.previous_eps,
    previous_revenue: row.previous_revenue,
  };
}

export function benzingaToStreetEstimate(row: BenzingaStructuredEarnings): MeridianStreetEstimate {
  const period =
    row.fiscal_period && row.fiscal_year != null
      ? `${row.fiscal_period} FY${String(row.fiscal_year).slice(-2)}`
      : row.fiscal_period ?? row.date;
  return {
    period,
    eps_estimate: row.estimated_eps,
    revenue_estimate: row.estimated_revenue,
    source: "earnings_calendar",
  };
}

/** Merge Benzinga structured rows into timeline inputs — grid/UW rows win on date conflicts. */
export function mergeBenzingaTimelineRows(
  existing: Map<string, EarningsTimelineInput>,
  benzingaRows: BenzingaStructuredEarnings[]
): Map<string, EarningsTimelineInput> {
  const out = new Map(existing);
  for (const row of benzingaRows) {
    const ticker = row.ticker.trim().toUpperCase();
    if (!ticker || !row.date) continue;
    const key = ticker;
    const when = earningsWhenFromTime(row.time);
    const existingRow = out.get(key);
    if (existingRow) {
      if (existingRow.report_date === row.date) {
        out.set(key, {
          ...existingRow,
          name:
            existingRow.name && existingRow.name !== ticker
              ? existingRow.name
              : row.company_name?.trim() || existingRow.name,
          when: existingRow.when ?? when ?? undefined,
        });
      }
      continue;
    }
    out.set(key, {
      ticker,
      name: row.company_name?.trim() || ticker,
      report_date: row.date,
      when: when ?? "afterhours",
      expected_move_pct: null,
    });
  }
  return out;
}

/** Prefer Benzinga street estimates when present; append UW rows for periods Benzinga missed. */
export function mergeStreetEstimates(
  benzingaRows: BenzingaStructuredEarnings[],
  uwRows: MeridianStreetEstimate[]
): MeridianStreetEstimate[] {
  const fromBenzinga = benzingaRows
    .filter((r) => r.estimated_eps != null || r.estimated_revenue != null)
    .slice(0, 4)
    .map(benzingaToStreetEstimate);
  if (!fromBenzinga.length) return uwRows.slice(0, 4);
  const periods = new Set(fromBenzinga.map((r) => r.period));
  const tail = uwRows.filter((r) => r.period && !periods.has(r.period)).slice(0, 2);
  return [...fromBenzinga, ...tail].slice(0, 6);
}

export function pickEarningsCalendarRow(
  rows: BenzingaStructuredEarnings[],
  eventDate: string | null | undefined
): MeridianEarningsCalendarRow | null {
  if (!eventDate) return null;
  const match = rows.find((r) => r.date === eventDate) ?? rows[0] ?? null;
  return match ? benzingaToCalendarRow(match) : null;
}
