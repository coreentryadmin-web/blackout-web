/**
 * POLYGON MACRO BACKDROP READER (task #62 — Polygon data arsenal).
 *
 * Governed, cached, deterministic readers for the two macro series the synthesis engine most needs
 * to color a verdict: the Treasury yield curve (`/fed/v1/treasury-yields`) and headline CPI
 * (`/fed/v1/inflation`). Both were live-confirmed under the Polygon key (see
 * scratchpad/polygon-arsenal.log). Market-wide (no ticker), so a single shared cache entry serves
 * every consumer.
 *
 * WHY a NEW provider file (not an edit to the huge polygon.ts): mirrors the standalone
 * polygon-options-gex.ts pattern — own BASE/KEY + the SAME governed request path
 * (polygonTrackedFetch: cluster rate-limiter + circuit breaker + api-usage tracking) + serverCache.
 * Governance stays in-path; nothing bypasses the limiter. No composer/ecosystem-context edits here
 * (that wiring is Track A's) — this file only exposes typed reader functions to consume.
 *
 * HONESTY: every field is null when the upstream omits it; nothing is fabricated or interpolated.
 * The one derived value (the 10y−1y curve spread) is pure arithmetic on two real yields and is null
 * whenever either leg is missing.
 */
import { polygonTrackedFetch } from "./polygon-rate-limiter";
import { polygonConfigured } from "./config";
import { serverCache, TTL } from "@/lib/server-cache";

const BASE = (process.env.POLYGON_API_BASE ?? "https://api.massive.com").replace(/\/$/, "");
const KEY = process.env.POLYGON_API_KEY ?? "";

/** Governed GET — identical rate-limiter/breaker/tracking path as polygon.ts's private polygonGet. */
async function macroGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  if (!polygonConfigured()) throw new Error("POLYGON_API_KEY not set");
  const qs = new URLSearchParams({ ...params, apiKey: KEY });
  const res = await polygonTrackedFetch(path, `${BASE}${path}?${qs}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (res.status === 429) throw new Error(`Polygon ${path} → 429 (rate limited)`);
  if (!res.ok) throw new Error(`Polygon ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export type TreasuryYields = {
  /** Observation date of the latest curve (YYYY-MM-DD), or null when unavailable. */
  date: string | null;
  yield_1_year: number | null;
  yield_5_year: number | null;
  yield_10_year: number | null;
  /**
   * 10-year minus 1-year yield, in percentage points. NEGATIVE = inverted curve — the classic
   * recession/risk-off signal a synthesis verdict should weigh. Null whenever either leg is missing
   * (never guessed from a single point).
   */
  curve_10y_1y_spread: number | null;
};

export type InflationReading = {
  /** Observation date of the latest CPI print (YYYY-MM-DD), or null. */
  date: string | null;
  /** Headline CPI index level (not YoY %). Null when unavailable. */
  cpi: number | null;
};

export type PolygonMacroBackdrop = {
  /** Freshest observation date across the two series (treasury preferred), or null when both empty. */
  as_of: string | null;
  treasury: TreasuryYields;
  inflation: InflationReading;
};

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Pick the freshest row by its date field. The upstream should return newest-first when sent
 * `sort=date.desc`, but we do NOT trust that — we select the lexicographically-max ISO date
 * (YYYY-MM-DD sorts chronologically), so a mis-sorted or multi-row response still yields the latest.
 */
export function pickLatestByDate(
  rows: Array<Record<string, unknown>>,
  dateField = "date"
): Record<string, unknown> | null {
  let best: Record<string, unknown> | null = null;
  let bestDate = "";
  for (const row of rows) {
    const d = typeof row?.[dateField] === "string" ? (row[dateField] as string) : "";
    if (d && d > bestDate) {
      bestDate = d;
      best = row;
    }
  }
  // If no row carried a usable date, fall back to the first row (so numeric-only payloads still parse).
  return best ?? rows[0] ?? null;
}

/** Pure: build TreasuryYields (incl. the derived 10y−1y spread) from raw `/fed/v1/treasury-yields` rows. */
export function parseTreasuryYields(rows: Array<Record<string, unknown>>): TreasuryYields {
  const row = pickLatestByDate(rows);
  if (!row) {
    return { date: null, yield_1_year: null, yield_5_year: null, yield_10_year: null, curve_10y_1y_spread: null };
  }
  const y1 = num(row.yield_1_year);
  const y5 = num(row.yield_5_year);
  const y10 = num(row.yield_10_year);
  const spread = y1 != null && y10 != null ? Number((y10 - y1).toFixed(4)) : null;
  return {
    date: typeof row.date === "string" ? row.date : null,
    yield_1_year: y1,
    yield_5_year: y5,
    yield_10_year: y10,
    curve_10y_1y_spread: spread,
  };
}

/** Pure: build InflationReading from raw `/fed/v1/inflation` rows. */
export function parseInflation(rows: Array<Record<string, unknown>>): InflationReading {
  const row = pickLatestByDate(rows);
  if (!row) return { date: null, cpi: null };
  return {
    date: typeof row.date === "string" ? row.date : null,
    cpi: num(row.cpi),
  };
}

/** Pure: assemble the full backdrop from the two raw result arrays. */
export function buildMacroBackdrop(
  treasuryRows: Array<Record<string, unknown>>,
  inflationRows: Array<Record<string, unknown>>
): PolygonMacroBackdrop {
  const treasury = parseTreasuryYields(treasuryRows);
  const inflation = parseInflation(inflationRows);
  return {
    as_of: treasury.date ?? inflation.date ?? null,
    treasury,
    inflation,
  };
}

/**
 * Fetch the current macro backdrop (latest Treasury curve + CPI). Market-wide, cached on the 1h
 * REFERENCE tier (yields update daily, CPI monthly — 1h is fresh with near-zero upstream cost). Returns
 * null only when Polygon is unconfigured, EITHER leg's fetch genuinely failed, or BOTH series
 * legitimately came back empty (none of these are cached, so the next call re-tries); a partial
 * read where a leg's fetch actually SUCCEEDED but legitimately returned no rows (e.g. CPI not yet
 * printed this period) IS returned and cached with that leg nulled.
 *
 * BUG FIX (2026-11-09): the per-leg `.catch(() => ({ results: [] }))` below swallowed a genuine
 * fetch failure (macroGet throws on any non-2xx status, including 429/5xx, or a network-level
 * exception) into the IDENTICAL shape a leg that legitimately has no rows this period produces.
 * The only gate on caching was "are BOTH series empty" — so a one-sided transient outage (e.g.
 * /fed/v1/inflation 500s while /fed/v1/treasury-yields succeeds) got treated as "CPI legitimately
 * has nothing to report" and pinned in the shared 1h cache with that leg falsely nulled, for every
 * consumer (BIE's ecosystem-context + verdict builders), for up to an hour — long enough that a
 * retry moments later (which would very likely have succeeded) never happened. Fixed by tracking
 * whether each leg's fetch itself threw (vs returned a genuine empty/throw-free result) and
 * refusing to cache when either one did, same as the existing "both legitimately empty" guard.
 */
export async function fetchPolygonMacroBackdrop(): Promise<PolygonMacroBackdrop | null> {
  if (!polygonConfigured()) return null;
  try {
    return await serverCache<PolygonMacroBackdrop>("polygon:macro-backdrop:v1", TTL.REFERENCE, async () => {
      let treasuryFetchFailed = false;
      let inflationFetchFailed = false;
      const [treasury, inflation] = await Promise.all([
        macroGet<{ results?: Array<Record<string, unknown>> }>("/fed/v1/treasury-yields", {
          limit: "1",
          sort: "date.desc",
        }).catch(() => {
          treasuryFetchFailed = true;
          return { results: [] as Array<Record<string, unknown>> };
        }),
        macroGet<{ results?: Array<Record<string, unknown>> }>("/fed/v1/inflation", {
          limit: "1",
          sort: "date.desc",
        }).catch(() => {
          inflationFetchFailed = true;
          return { results: [] as Array<Record<string, unknown>> };
        }),
      ]);
      // A genuine fetch failure (429/5xx/network error) on EITHER leg must never be cached as
      // that leg's confirmed-empty state — throw so serverCache stores nothing and the next
      // caller re-tries both legs fresh, same as the pre-existing "total miss" guard below.
      if (treasuryFetchFailed || inflationFetchFailed) {
        throw new Error(
          `polygon-macro: fetch failed (treasury=${treasuryFetchFailed ? "failed" : "ok"}, ` +
            `inflation=${inflationFetchFailed ? "failed" : "ok"})`
        );
      }
      const backdrop = buildMacroBackdrop(treasury.results ?? [], inflation.results ?? []);
      // Don't cache a total miss (both series genuinely empty — now known NOT to be a fetch
      // failure, since that case already threw above): likely both series simply have nothing to
      // report yet.
      if (backdrop.treasury.date == null && backdrop.inflation.date == null && backdrop.inflation.cpi == null) {
        throw new Error("polygon-macro: no treasury or inflation data returned");
      }
      return backdrop;
    });
  } catch {
    return null;
  }
}
