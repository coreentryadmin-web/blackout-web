/**
 * Server side of Meridian sector cohorts: turn a list of tickers into SIC classifications.
 *
 * ── WHY PER-TICKER CALLS ARE ACCEPTABLE HERE ─────────────────────────────────────────
 * `sic_code` is only on Polygon's ticker DETAIL response — the list endpoint
 * (`/v3/reference/tickers?market=stocks`) does not carry it, verified live. So there is no bulk
 * shortcut; it is one call per name. Two things make that fine:
 *
 *   1. The earnings lane is already filtered to OPTIONABLE names, which cuts a ~200-name raw
 *      calendar week to a few dozen actionable ones.
 *   2. A company's SIC code effectively never changes. A long cache means each name costs one
 *      call per WEEK, not one per page view — so the steady-state cost is a handful of calls a
 *      day, not a fan-out on every request.
 *
 * ── FAILURE POSTURE ──────────────────────────────────────────────────────────────────
 * Unclassified, never wrong. A name whose detail call fails is returned with a null
 * classification and simply does not join a cohort; it is not guessed into one from its name or
 * silently dropped from the lane. And a failed lookup is NOT cached — caching it would freeze a
 * transient upstream blip into a week of "unclassified" for that name.
 */

import { withServerCache } from "@/lib/server-cache";
import { classifySic, type SectorClassification } from "./meridian-sector-core";

/** SIC codes are static in practice; a week is short next to "never" and long next to a page view. */
const CLASSIFY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Cap on how many detail calls one build may make. Not a silent truncation: the caller is told
 * how many names went unclassified because of it, so a lane that outgrows this shows up as a
 * number to raise rather than as cohorts that quietly got smaller.
 */
const MAX_LOOKUPS_PER_BUILD = 120;

export type SectorClassifyResult = {
  byTicker: Record<string, SectorClassification>;
  /** Names skipped because MAX_LOOKUPS_PER_BUILD was reached. Reported, never hidden. */
  skipped: string[];
  /** Names whose upstream lookup failed. Distinct from "has no SIC code". */
  failed: string[];
};

async function classifyOne(ticker: string): Promise<SectorClassification | null> {
  try {
    const { fetchPolygonTickerDetails } = await import("@/lib/providers/polygon-largo");
    const res = (await fetchPolygonTickerDetails(ticker)) as
      | { results?: Record<string, unknown> }
      | null;
    const r = res?.results;
    // A 200 with no results object is an upstream failure wearing a success code — treat it as
    // one, so it stays out of the cache and gets retried, rather than being cached as "this
    // company has no sector".
    if (!r || typeof r !== "object") return null;
    return classifySic(r.sic_code, r.sic_description);
  } catch {
    return null;
  }
}

/**
 * Classify a set of tickers, caching each one independently.
 *
 * Per-ticker cache keys rather than one key for the whole set: the lane's membership changes
 * every day as prints roll off, and a set-keyed cache would miss on every one of those changes
 * and re-fetch every name. Keyed per name, yesterday's forty lookups are still warm today.
 */
export async function classifyTickerSectors(
  tickers: readonly string[]
): Promise<SectorClassifyResult> {
  const unique = Array.from(
    new Set(
      (tickers ?? [])
        .map((t) => String(t ?? "").trim().toUpperCase())
        .filter((t) => /^[A-Z][A-Z0-9.]{0,9}$/.test(t))
    )
  );

  const take = unique.slice(0, MAX_LOOKUPS_PER_BUILD);
  const skipped = unique.slice(MAX_LOOKUPS_PER_BUILD);

  const byTicker: Record<string, SectorClassification> = {};
  const failed: string[] = [];

  const settled = await Promise.all(
    take.map(async (ticker) => {
      try {
        // withServerCache does not store on throw, so a rejected loader leaves the slot empty
        // and the next request retries — which is exactly what we want for a transient failure.
        const cls = await withServerCache(`meridian:sic:v1:${ticker}`, CLASSIFY_TTL_MS, async () => {
          const c = await classifyOne(ticker);
          if (!c) throw new Error("sector lookup failed");
          return c;
        });
        return { ticker, cls };
      } catch {
        return { ticker, cls: null as SectorClassification | null };
      }
    })
  );

  for (const { ticker, cls } of settled) {
    if (cls) byTicker[ticker] = cls;
    else failed.push(ticker);
  }

  return { byTicker, skipped, failed };
}
