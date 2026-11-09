/**
 * TICKER FUNDAMENTALS BUNDLE (task #62 — Polygon data arsenal aggregator).
 *
 * A single governed, cached, TICKER-FILTERED reader that composes the fundamentals + short-positioning
 * signals the synthesis engine (Track A's #59) needs about one name, so a consumer makes ONE call
 * instead of fanning out to five providers and re-deriving the merge. Every underlying reader already
 * exists in src/lib/providers/polygon.ts (financial ratios, the three statements → derived signals,
 * the Benzinga analyst price target, short-interest/days-to-cover, and the short-volume ratio); this
 * module only orchestrates + caches them behind one typed shape. Nothing new is fetched that a reader
 * didn't already expose.
 *
 * WHY here (src/lib/bie/) not a composer: the coordinator's Track-A/Track-B split — this is a READER
 * aggregator, explicitly allowed as a new src/lib/bie file. It does NOT touch ecosystem-context.ts,
 * composers.ts, or the router (Track A wires this bundle into synthesis + the shared context).
 *
 * HONESTY: every field is null when its source has no data — nothing is fabricated. Each underlying
 * fetch is independently defensive (a single provider outage nulls only its own slice, never the whole
 * bundle). Cached on the 1h REFERENCE tier: fundamentals/short-interest change slowly (statements
 * quarterly, short-interest bi-monthly settlement), so a per-name 1h cache is fresh at near-zero cost.
 */
import { serverCache, TTL } from "@/lib/server-cache";
import {
  fetchPolygonFinancialRatios,
  fetchPolygonIncomeStatements,
  fetchPolygonBalanceSheets,
  fetchPolygonCashFlowStatements,
  computeFundamentalSignals,
  fetchBenzingaPriceTarget,
  fetchShortInterest,
  fetchShortInterestResult,
  fetchShortVolumeResult,
  type PolygonFinancialRatios,
  type FundamentalSignals,
  type BenzingaPriceTarget,
} from "@/lib/providers/polygon";
import { polygonConfigured } from "@/lib/providers/config";

/** Normalized short-interest slice (source coerces missing numerics to 0; we keep dates as the
 *  freshness anchor). */
export type ShortInterestSlice = {
  settlement_date: string | null;
  short_interest: number | null;
  avg_daily_volume: number | null;
  days_to_cover: number | null;
};

export type TickerFundamentalsBundle = {
  ticker: string;
  /** Freshest observation date across the slices (ratios → signals → short-interest → short-volume). */
  as_of: string | null;
  ratios: PolygonFinancialRatios | null;
  signals: FundamentalSignals | null;
  price_target: BenzingaPriceTarget | null;
  short_interest: ShortInterestSlice | null;
  /** Latest daily short-volume ratio (0–1) for the most recent session, or null. */
  short_volume_ratio: number | null;
  short_volume_date: string | null;
  /**
   * BUG FIX (2026-11-09, Ask Largo standing mandate -- sibling of the earnings-leg fix, PR #7584
   * / commit 7df37da25): non-null ONLY when the live short-interest fetch itself FAILED this pass
   * (a 403/timeout/rate-limit -- e.g. the documented, currently-open real-time Polygon/Massive
   * entitlement outage, CLAUDE.md's "ENTITLEMENT REGRESSED 2026-11-07" note) -- never set on a
   * genuine "no series for this ticker" miss. Before this field existed, `fetchShortInterest`'s
   * catch-and-return-null contract made a failed fetch indistinguishable from a real absence, and
   * `ecosystem-context.ts`'s fundamentals/short-interest leg took that collapse as confident proof
   * of permanent structural absence. Threaded additively: `short_interest` above is UNCHANGED
   * (still null on either a clean miss or a failure) -- this is purely a second, honest channel.
   */
  short_interest_error: string | null;
  /** Same shape/rationale as `short_interest_error`, for the sibling short-volume-ratio fetch. */
  short_volume_error: string | null;
};

type ShortVolumeRow = { date: string; short_volume: number; total_volume: number; short_volume_ratio: number };

/** Polygon short_volume_ratio is documented 0–1 but sometimes arrives as 0–100; normalize to fraction. */
export function normalizeShortVolumeRatio(raw: number): number | null {
  if (!Number.isFinite(raw) || raw <= 0) return null;
  const fraction = raw > 1 ? raw / 100 : raw;
  return fraction > 1 ? null : fraction;
}

/** Pure: pick the most-recent short-volume row's ratio + date (freshest by ISO date, not trusting sort). */
export function summarizeShortVolume(
  rows: ShortVolumeRow[]
): { short_volume_ratio: number | null; short_volume_date: string | null } {
  let best: ShortVolumeRow | null = null;
  for (const r of rows) {
    if (!r?.date) continue;
    if (!best || r.date > best.date) best = r;
  }
  if (!best) return { short_volume_ratio: null, short_volume_date: null };
  const ratio = normalizeShortVolumeRatio(best.short_volume_ratio);
  return { short_volume_ratio: ratio, short_volume_date: best.date || null };
}

/** Normalize the raw fetchShortInterest object (which coerces missing numerics to 0) into a slice
 *  whose fields are null when there is genuinely no reading (empty settlement date ⇒ no data). */
export function normalizeShortInterest(
  si: Awaited<ReturnType<typeof fetchShortInterest>>
): ShortInterestSlice | null {
  if (!si) return null;
  const date = si.settlement_date || null;
  // Accepts number | null: fetchShortInterest's numeric fields are now null (not a coerced 0)
  // when Polygon omits them — Number.isFinite(null) is false, so the behavior here is unchanged.
  const finiteOrNull = (n: number | null) => (n != null && Number.isFinite(n) && n !== 0 ? n : null);
  const slice: ShortInterestSlice = {
    settlement_date: date,
    short_interest: finiteOrNull(si.short_interest),
    avg_daily_volume: finiteOrNull(si.avg_daily_volume),
    days_to_cover: finiteOrNull(si.days_to_cover),
  };
  // Nothing usable at all → null (no date and no numbers).
  if (slice.settlement_date == null && slice.short_interest == null && slice.days_to_cover == null) {
    return null;
  }
  return slice;
}

/** Pure: assemble the bundle from already-fetched parts (unit-testable with no network). */
export function assembleFundamentalsBundle(
  ticker: string,
  parts: {
    ratios: PolygonFinancialRatios | null;
    signals: FundamentalSignals | null;
    priceTarget: BenzingaPriceTarget | null;
    shortInterest: ShortInterestSlice | null;
    shortVolume: { short_volume_ratio: number | null; short_volume_date: string | null };
    /** Threaded additively -- see `TickerFundamentalsBundle.short_interest_error`'s own doc. */
    shortInterestError?: string | null;
    shortVolumeError?: string | null;
  }
): TickerFundamentalsBundle {
  const as_of =
    parts.ratios?.as_of ??
    parts.signals?.latest_period_end ??
    parts.shortInterest?.settlement_date ??
    parts.shortVolume.short_volume_date ??
    null;
  return {
    ticker: ticker.toUpperCase(),
    as_of,
    ratios: parts.ratios,
    signals: parts.signals,
    price_target: parts.priceTarget,
    short_interest: parts.shortInterest,
    short_volume_ratio: parts.shortVolume.short_volume_ratio,
    short_volume_date: parts.shortVolume.short_volume_date,
    short_interest_error: parts.shortInterestError ?? null,
    short_volume_error: parts.shortVolumeError ?? null,
  };
}

/**
 * Fetch the composed fundamentals + short-positioning bundle for one ticker. Cached per-name on the
 * 1h REFERENCE tier. Returns null only when Polygon is unconfigured; otherwise returns the bundle with
 * whatever slices were available (each null on its own source's miss) — a partial read is honest and
 * still useful to synthesis.
 */
export async function fetchTickerFundamentalsBundle(
  ticker: string
): Promise<TickerFundamentalsBundle | null> {
  if (!polygonConfigured()) return null;
  const sym = ticker.toUpperCase();
  return serverCache<TickerFundamentalsBundle>(`bie:ticker-fundamentals:v2:${sym}`, TTL.REFERENCE, async () => {
    // BUG FIX (2026-11-09, Ask Largo standing mandate): short-interest/short-volume now go through
    // the `*Result` wrappers (fetchShortInterest/fetchShortVolume are UNCHANGED for their other
    // callers) so a FAILED fetch carries its real error forward instead of being swallowed into the
    // same bare miss as a genuine "nothing on file" read -- see TickerFundamentalsBundle's
    // short_interest_error/short_volume_error doc for the full rationale.
    const [ratios, income, balance, cashFlow, priceTarget, shortInterestResult, shortVolumeResult] =
      await Promise.all([
        fetchPolygonFinancialRatios(sym).catch(() => null),
        fetchPolygonIncomeStatements(sym, 6).catch(() => []),
        fetchPolygonBalanceSheets(sym, 6).catch(() => []),
        fetchPolygonCashFlowStatements(sym, 6).catch(() => []),
        fetchBenzingaPriceTarget(sym).catch(() => null),
        fetchShortInterestResult(sym).catch((e: unknown) => ({
          row: null,
          error: String(e instanceof Error ? e.message : e).slice(0, 200),
        })),
        fetchShortVolumeResult(sym, 5).catch((e: unknown) => ({
          rows: [],
          error: String(e instanceof Error ? e.message : e).slice(0, 200),
        })),
      ]);
    const signals = computeFundamentalSignals(income, balance, cashFlow);
    return assembleFundamentalsBundle(sym, {
      ratios,
      signals,
      priceTarget,
      shortInterest: normalizeShortInterest(shortInterestResult.row),
      shortVolume: summarizeShortVolume(shortVolumeResult.rows),
      shortInterestError: shortInterestResult.error,
      shortVolumeError: shortVolumeResult.error,
    });
  });
}
