/**
 * NEXT EARNINGS DATE READER (task #62 — data arsenal).
 *
 * Benzinga structured calendar first (`loadNextEarningsFromBenzinga`); UW REST fallback when
 * Benzinga has no future row. Cached on the 1h REFERENCE tier.
 */
import { fetchUwTickerNextEarnings } from "./unusual-whales";
import { todayEtYmd } from "./spx-session";
import { serverCache, TTL } from "@/lib/server-cache";

export type EarningsReportTime = "premarket" | "afterhours" | "unknown";

export type NextEarnings = {
  ticker: string;
  /** Next expected earnings date (YYYY-MM-DD), or null when none is known. */
  earnings_date: string | null;
  /** Whole calendar days from today (ET) to the report; 0 = today, negative never returned (future only). */
  days_until: number | null;
  /** Session the print lands in, when UW discloses it. */
  report_time: EarningsReportTime | null;
  /** True when UW marks the date confirmed (vs estimated); null when the flag is absent. */
  is_confirmed: boolean | null;
};

function firstString(row: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/** Map UW's free-form timing hints (bmo/amc/before/after/pre/post) to a session bucket. */
export function parseReportTime(raw: string | null): EarningsReportTime | null {
  if (!raw) return null;
  const w = raw.toLowerCase();
  if (/bmo|before|pre[-\s]?market|pre\b|morning|am\b/.test(w)) return "premarket";
  if (/amc|after|post|pm\b|evening|close/.test(w)) return "afterhours";
  return "unknown";
}

/** Whole calendar days between two YYYY-MM-DD strings (toYmd − fromYmd). Null on unparseable input. */
export function daysBetweenYmd(fromYmd: string, toYmd: string): number | null {
  const a = Date.parse(`${fromYmd}T00:00:00Z`);
  const b = Date.parse(`${toYmd}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

function parseConfirmed(row: Record<string, unknown>): boolean | null {
  for (const k of ["is_confirmed", "confirmed", "is_date_confirmed"]) {
    const v = row[k];
    if (typeof v === "boolean") return v;
    if (v === "true" || v === 1) return true;
    if (v === "false" || v === 0) return false;
  }
  return null;
}

/**
 * Pure: turn a UW earnings row (the first future row from fetchUwTickerNextEarnings) into the typed
 * NextEarnings shape, computing days_until relative to `todayYmd`. Returns a null-date result when the
 * row is missing or carries no parseable future date.
 */
export function parseNextEarnings(
  ticker: string,
  row: Record<string, unknown> | null,
  todayYmd: string
): NextEarnings {
  const sym = ticker.toUpperCase();
  const empty: NextEarnings = {
    ticker: sym,
    earnings_date: null,
    days_until: null,
    report_time: null,
    is_confirmed: null,
  };
  if (!row) return empty;

  const rawDate = firstString(row, ["earnings_date", "report_date", "date", "expected_report_date"]);
  const date = rawDate ? rawDate.slice(0, 10) : null;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return empty;

  const days = daysBetweenYmd(todayYmd, date);
  // Guard against a stale row that slipped through as "future": only surface today-or-later.
  if (days != null && days < 0) return empty;

  return {
    ticker: sym,
    earnings_date: date,
    days_until: days,
    report_time: parseReportTime(firstString(row, ["report_time", "time", "timing", "when"])),
    is_confirmed: parseConfirmed(row),
  };
}

/**
 * Fetch the next expected earnings for a ticker. Benzinga structured calendar first; UW REST fallback.
 * Cached per-name on the 1h REFERENCE tier.
 */
export async function fetchNextEarningsDate(ticker: string): Promise<NextEarnings | null> {
  const sym = ticker.toUpperCase();
  return serverCache<NextEarnings | null>(`next-earnings:v2:${sym}`, TTL.REFERENCE, async () => {
    const { loadNextEarningsFromBenzinga } = await import("@/lib/meridian/meridian-benzinga-earnings");
    const bz = await loadNextEarningsFromBenzinga(sym).catch(() => null);
    if (bz?.earnings_date) return bz;

    const row = await fetchUwTickerNextEarnings(sym).catch(() => null);
    const parsed = parseNextEarnings(sym, (row as Record<string, unknown> | null) ?? null, todayEtYmd());
    return parsed.earnings_date ? parsed : null;
  });
}
