import { classifyPrintTiming } from "@/lib/meridian/meridian-reaction-core";

export type UwEarningsRow = Record<string, unknown>;

export type MeridianReactionStamp = {
  reaction_pct: number | null;
  reaction_basis: string | null;
  reaction_measure: string | null;
  reaction_settled: boolean | null;
};

export const MERIDIAN_REACTION_AUTHORITY =
  "Prefer meridian_reaction_pct for print reactions — timing-aware BMO/AMC anchor. UW reaction_pct is close-to-close on the report session only.";

export function rowTicker(row: UwEarningsRow): string {
  return String(row.ticker ?? row.symbol ?? "").trim().toUpperCase();
}

export function rowReportDate(row: UwEarningsRow): string | null {
  const d = String(row.report_date ?? row.date ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

export function rowReportTime(row: UwEarningsRow): string | null {
  const t = String(row.report_time ?? row.time ?? "").trim();
  return t || null;
}

export function printKeysFromUwRows(rows: readonly UwEarningsRow[]) {
  const keys: Array<{ ticker: string; ymd: string; timing: ReturnType<typeof classifyPrintTiming> }> = [];
  for (const row of rows) {
    const ticker = rowTicker(row);
    const ymd = rowReportDate(row);
    if (!ticker || !ymd) continue;
    keys.push({ ticker, ymd, timing: classifyPrintTiming(rowReportTime(row)) });
  }
  return keys;
}

export function groupPrintKeysByTicker(
  keys: ReadonlyArray<{ ticker: string; ymd: string; timing: ReturnType<typeof classifyPrintTiming> }>
) {
  const byTicker = new Map<string, Array<{ ymd: string; timing: ReturnType<typeof classifyPrintTiming> }>>();
  for (const k of keys) {
    const list = byTicker.get(k.ticker) ?? [];
    list.push({ ymd: k.ymd, timing: k.timing });
    byTicker.set(k.ticker, list);
  }
  return byTicker;
}

export function stampMeridianReactionOnRow(
  row: UwEarningsRow,
  rx: MeridianReactionStamp | undefined
): UwEarningsRow {
  if (!rx) return row;
  return {
    ...row,
    meridian_reaction_pct: rx.reaction_pct,
    meridian_reaction_basis: rx.reaction_basis,
    meridian_reaction_measure: rx.reaction_measure,
    meridian_reaction_settled: rx.reaction_settled,
    reaction_authority: MERIDIAN_REACTION_AUTHORITY,
  };
}

export function stampMeridianReactionsOnUwRows(
  rows: readonly UwEarningsRow[],
  reactionsByTickerDate: ReadonlyMap<string, ReadonlyMap<string, MeridianReactionStamp>>
): UwEarningsRow[] {
  return rows.map((row) => {
    const ticker = rowTicker(row);
    const ymd = rowReportDate(row);
    if (!ticker || !ymd) return row;
    return stampMeridianReactionOnRow(row, reactionsByTickerDate.get(ticker)?.get(ymd));
  });
}
