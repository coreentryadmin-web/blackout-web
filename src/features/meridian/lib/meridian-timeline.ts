import type { MacroEvent } from "@/lib/providers/macro-events";
import type { MeridianEventKind, MeridianImpact, MeridianTimelineItem } from "./meridian-types";
import { impactFromEarningsImportance } from "@/lib/meridian/meridian-benzinga-earnings-core";

export type MacroTimelineInput = Pick<MacroEvent, "event" | "date" | "time" | "impact" | "estimate">;
export type EarningsTimelineInput = {
  ticker: string;
  name: string;
  report_date: string;
  when?: "premarket" | "afterhours";
  expected_move_pct: number | null;
  report_time?: string | null;
  date_status?: string | null;
  importance?: number | null;
  is_printed?: boolean;
  eps_method?: string | null;
  revenue_method?: string | null;
  estimated_eps?: number | null;
  source?: "earnings_calendar" | "chain_iv" | null;
  /** 2-digit SIC major group — the sector-cohort key. Absent when the name is unclassified. */
  sic_major_group?: string | null;
  /** Display name for that cohort, e.g. "Semis & Electronics". */
  sector_label?: string | null;
};
export type FdaTimelineInput = {
  ticker: string;
  date: string;
  drug: string | null;
  indication: string | null;
  event_label: string | null;
};

/** Calendar-day distance in ET (today → event date). */
export function daysUntilEt(eventYmd: string, todayYmd: string): number {
  const [y1, m1, d1] = todayYmd.split("-").map(Number) as [number, number, number];
  const [y2, m2, d2] = eventYmd.split("-").map(Number) as [number, number, number];
  const a = Date.UTC(y1, m1 - 1, d1);
  const b = Date.UTC(y2, m2 - 1, d2);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

function impactFromMacro(impact: string): MeridianImpact {
  if (impact === "high") return "high";
  if (impact === "medium") return "medium";
  return "low";
}

function macroId(date: string, event: string): string {
  const slug = event.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
  return `macro:${date}:${slug || "event"}`;
}

function earningsId(ticker: string, date: string): string {
  return `earnings:${ticker.toUpperCase()}:${date}`;
}

function opexId(date: string): string {
  return `opex:${date}`;
}

function fdaId(ticker: string, date: string): string {
  return `fda:${ticker.toUpperCase()}:${date}`;
}

/** Third Friday of a calendar month (US equity monthly OpEx). */
export function thirdFridayYmd(year: number, month1: number): string {
  let fridays = 0;
  for (let day = 1; day <= 31; day++) {
    const d = new Date(Date.UTC(year, month1 - 1, day));
    if (d.getUTCMonth() !== month1 - 1) break;
    if (d.getUTCDay() === 5) {
      fridays += 1;
      if (fridays === 3) {
        return `${year}-${String(month1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      }
    }
  }
  return "";
}

/** Upcoming monthly OpEx dates from `startYmd` through `daysAhead` calendar days. */
export function upcomingOpexDates(startYmd: string, daysAhead: number): string[] {
  const parts = startYmd.split("-").map(Number) as [number, number, number];
  const start = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + Math.max(1, daysAhead));
  const out: string[] = [];
  let y = start.getUTCFullYear();
  let m = start.getUTCMonth() + 1;
  const endY = end.getUTCFullYear();
  const endM = end.getUTCMonth() + 1;
  while (y < endY || (y === endY && m <= endM + 1)) {
    const opex = thirdFridayYmd(y, m);
    if (opex && opex >= startYmd && daysUntilEt(opex, startYmd) <= daysAhead) out.push(opex);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return [...new Set(out)].sort();
}

/** Prior monthly OpEx (third Friday) dates strictly before `beforeYmd`. */
export function priorOpexDates(beforeYmd: string, limit = 6): string[] {
  const parts = beforeYmd.split("-").map(Number) as [number, number, number];
  let y = parts[0];
  let m = parts[1];
  const out: string[] = [];
  for (let i = 0; i < 36 && out.length < limit; i++) {
    m -= 1;
    if (m < 1) {
      m = 12;
      y -= 1;
    }
    const opex = thirdFridayYmd(y, m);
    if (opex && opex < beforeYmd) out.push(opex);
  }
  return out.sort((a, b) => b.localeCompare(a)).slice(0, limit);
}

export function buildMeridianTimeline(input: {
  todayYmd: string;
  daysAhead: number;
  macro: readonly MacroTimelineInput[];
  earnings: readonly EarningsTimelineInput[];
  fda?: readonly FdaTimelineInput[];
  includeOpex?: boolean;
}): MeridianTimelineItem[] {
  const { todayYmd, daysAhead, macro, earnings, fda = [], includeOpex = true } = input;
  const endLimit = daysAhead;
  const items: MeridianTimelineItem[] = [];

  for (const e of macro) {
    const date = e.date?.slice(0, 10) ?? "";
    if (!date || date < todayYmd) continue;
    const du = daysUntilEt(date, todayYmd);
    if (du > endLimit) continue;
    items.push({
      id: macroId(date, e.event),
      kind: "macro",
      title: e.event,
      subtitle: "US macro",
      date,
      time: e.time?.trim() || null,
      impact: impactFromMacro(e.impact),
      days_until: du,
      ticker: null,
    });
  }

  for (const row of earnings) {
    const date = row.report_date?.slice(0, 10) ?? "";
    const ticker = row.ticker?.trim().toUpperCase() ?? "";
    if (!date || !ticker || date < todayYmd) continue;
    const du = daysUntilEt(date, todayYmd);
    if (du > endLimit) continue;
    const em =
      row.expected_move_pct != null && Number.isFinite(row.expected_move_pct)
        ? ` ~${row.expected_move_pct}% implied move`
        : "";
    const statusChip =
      row.date_status === "projected"
        ? " · projected date"
        : row.is_printed
          ? " · printed"
          : row.date_status === "confirmed"
            ? " · confirmed"
            : "";
    const impChip =
      row.importance != null && row.importance >= 4 ? ` · imp ${row.importance}` : "";
    items.push({
      id: earningsId(ticker, date),
      kind: "earnings",
      title: `${ticker} earnings`,
      subtitle: row.name
        ? `${row.name}${em}${statusChip}${impChip}`
        : em
          ? em.slice(3) + statusChip + impChip
          : (row.when ?? null),
      date,
      time: row.report_time ?? (row.when === "premarket" ? "08:00" : row.when === "afterhours" ? "16:20" : null),
      impact: impactFromEarningsImportance(row.importance),
      days_until: du,
      ticker,
      date_status: row.date_status ?? null,
      importance: row.importance ?? null,
      is_printed: row.is_printed ?? false,
      expected_move_pct:
        row.expected_move_pct != null && Number.isFinite(row.expected_move_pct)
          ? row.expected_move_pct
          : null,
      sic_major_group: row.sic_major_group ?? null,
      sector_label: row.sector_label ?? null,
    });
  }

  for (const row of fda) {
    const date = row.date?.slice(0, 10) ?? "";
    const ticker = row.ticker?.trim().toUpperCase() ?? "";
    if (!date || !ticker || date < todayYmd) continue;
    const du = daysUntilEt(date, todayYmd);
    if (du > endLimit) continue;
    const drug = row.drug?.trim() || null;
    items.push({
      id: fdaId(ticker, date),
      kind: "fda",
      title: `${ticker} FDA`,
      subtitle: drug ?? row.event_label ?? row.indication ?? "PDUFA / decision window",
      date,
      time: null,
      impact: "high",
      days_until: du,
      ticker,
    });
  }

  if (includeOpex) {
    for (const date of upcomingOpexDates(todayYmd, daysAhead)) {
      const du = daysUntilEt(date, todayYmd);
      items.push({
        id: opexId(date),
        kind: "opex",
        title: "Monthly OpEx",
        subtitle: "Equity + index options expiry",
        date,
        time: "16:00",
        impact: "high",
        days_until: du,
        ticker: null,
      });
    }
  }

  items.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    const rank: Record<MeridianEventKind, number> = { macro: 0, fda: 1, opex: 2, earnings: 3 };
    return rank[a.kind] - rank[b.kind];
  });

  return items;
}

export function parseMeridianEventId(id: string): {
  kind: MeridianEventKind;
  date: string;
  ticker?: string;
  slug?: string;
} | null {
  const parts = id.split(":");
  if (parts.length < 2) return null;
  const kind = parts[0] as MeridianEventKind;
  if (kind === "macro" && parts.length >= 3) {
    return { kind, date: parts[1]!, slug: parts.slice(2).join(":") };
  }
  if (kind === "earnings" && parts.length >= 3) {
    return { kind, date: parts[2]!, ticker: parts[1]!.toUpperCase() };
  }
  if (kind === "opex" && parts.length >= 2) {
    return { kind, date: parts[1]! };
  }
  if (kind === "fda" && parts.length >= 3) {
    return { kind, date: parts[2]!, ticker: parts[1]!.toUpperCase() };
  }
  return null;
}
