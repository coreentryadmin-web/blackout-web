"use client";

import type { EarningsTab } from "@/features/meridian/components/MeridianEarningsTabs";
import {
  MERIDIAN_EARNINGS_TAB_PREF_KEY,
  MERIDIAN_FILTER_PREF_KEY,
  parseSavedEarningsTab,
  parseSavedFilter,
  type MeridianFilterPref,
} from "./meridian-desk-prefs-core";

export function readMeridianEarningsTabPref(): EarningsTab | null {
  if (typeof window === "undefined") return null;
  try {
    return parseSavedEarningsTab(window.localStorage.getItem(MERIDIAN_EARNINGS_TAB_PREF_KEY));
  } catch {
    return null;
  }
}

export function writeMeridianEarningsTabPref(tab: EarningsTab): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MERIDIAN_EARNINGS_TAB_PREF_KEY, tab);
  } catch {
    /* quota / private mode — preference is nice-to-have */
  }
}

export function readMeridianFilterPref(): MeridianFilterPref | null {
  if (typeof window === "undefined") return null;
  try {
    return parseSavedFilter(window.localStorage.getItem(MERIDIAN_FILTER_PREF_KEY));
  } catch {
    return null;
  }
}

export function writeMeridianFilterPref(filter: MeridianFilterPref): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MERIDIAN_FILTER_PREF_KEY, filter);
  } catch {
    /* quota / private mode */
  }
}
