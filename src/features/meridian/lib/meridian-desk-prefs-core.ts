/**
 * Meridian desk preferences — pure parse/validate for localStorage-backed defaults.
 *
 * URL state still wins when present (per-session share links). These prefs apply only when the
 * reader lands on a bare `/meridian` or opens a new event without a filter in the query string.
 */

import type { EarningsTab } from "@/features/meridian/components/MeridianEarningsTabs";

export const MERIDIAN_EARNINGS_TAB_PREF_KEY = "meridian:pref:earnings-tab:v1";
export const MERIDIAN_FILTER_PREF_KEY = "meridian:pref:filter:v1";

export type MeridianFilterPref =
  | "all"
  | "macro"
  | "earnings"
  | "opex"
  | "fda"
  | "watchlist"
  | "board"
  | "mega_cap";

const EARNINGS_TABS = new Set<EarningsTab>([
  "summary",
  "report",
  "estimates",
  "positioning",
  "history",
]);

const FILTER_KINDS = new Set<MeridianFilterPref>([
  "all",
  "macro",
  "earnings",
  "opex",
  "fda",
  "watchlist",
  "board",
  "mega_cap",
]);

export function parseSavedEarningsTab(raw: string | null | undefined): EarningsTab | null {
  const s = String(raw ?? "").trim().toLowerCase();
  return EARNINGS_TABS.has(s as EarningsTab) ? (s as EarningsTab) : null;
}

export function parseSavedFilter(raw: string | null | undefined): MeridianFilterPref | null {
  const s = String(raw ?? "").trim().toLowerCase();
  return FILTER_KINDS.has(s as MeridianFilterPref) ? (s as MeridianFilterPref) : null;
}
