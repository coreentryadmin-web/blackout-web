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
 * silently dropped from the lane.
 *
 * Two failure shapes, two different cache answers (fixed 2026-10-08, see FINDINGS): most
 * failures (network error, 5xx, a circuit-breaker-open throw) are NOT cached — caching one would
 * freeze a transient upstream blip into a week of "unclassified" for that name, which is why
 * `classifyOne` returns bare `null` for them and the caller retries next build. But a CONFIRMED
 * `HTTP 404` from `/v3/reference/tickers/{t}` means Polygon's reference index has no detail
 * record for that ticker at all — a fact as stable as a present `sic_code` is, not a blip — so
 * that one case is cached as the same "unclassifiable" `SectorClassification` a 200-with-no-code
 * response already gets, for the same week-long TTL. Live-measured 2026-10-08: WBS/SOND (both
 * real, actively-traded tickers with real price data, just missing a reference-detail record)
 * 404'd 426 times across 7 days of CloudWatch logs with zero chance of ever succeeding, because
 * the uncached path retried them on every single Meridian earnings-lane build.
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

/** The one `classifySic`-shaped "no sector" value, reused so a confirmed-absent ticker is
 *  indistinguishable from a 200 response that genuinely carries no `sic_code`. */
const UNCLASSIFIABLE: SectorClassification = {
  majorGroup: null,
  label: null,
  sicCode: null,
  sicDescription: null,
};

async function classifyOne(ticker: string): Promise<SectorClassification | null> {
  try {
    // Relative specifier, not the "@/..." alias — tsx's alias rewrite only applies to
    // statically-parsed top-level `import ... from` statements, not a dynamic `import()` call
    // (confirmed the hard way in flow-gex-enrichment.test.ts: a `@/...` dynamic import resolves
    // fine under Next's real bundler but is silently unmockable, and sometimes unresolvable,
    // under this repo's tsx test runner). Relative resolves identically under both.
    const { fetchPolygonTickerDetails } = await import("../providers/polygon-largo");
    let failureReason: string | null = null;
    const res = (await fetchPolygonTickerDetails(ticker, undefined, (reason) => {
      failureReason = reason;
    })) as { results?: Record<string, unknown> } | null;
    const r = res?.results;
    if (!r || typeof r !== "object") {
      // A confirmed upstream "HTTP 404" means Polygon's reference-tickers index has no detail
      // record for this ticker AT ALL — distinct from a transient network error or a 5xx, which
      // stay as `null` (uncached, retried next build). Measured live 2026-10-08: WBS and SOND
      // both 404 on `/v3/reference/tickers/{t}` on EVERY call, on both the primary (massive.com)
      // and fallback (polygon.io) providers, despite both carrying real price/aggregates data
      // (i.e. they are real, actively-traded tickers — Polygon's reference index is just missing
      // their detail record) — 426 repeat failures in 7 days of CloudWatch logs, every one an
      // upstream call that was never going to succeed. A 404 is as stable a fact as a present
      // `sic_code` is (the file-level comment above already banks on SIC codes "effectively never
      // changing" for a week-long cache), so treat it the same way: a real, cacheable
      // classification of "unclassifiable" rather than a failure to retry forever.
      if (failureReason === "HTTP 404") return UNCLASSIFIABLE;
      return null;
    }
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
