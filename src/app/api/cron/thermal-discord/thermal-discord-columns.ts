/**
 * Build the Thermal Discord columns from a per-ticker settled fetch.
 *
 * Route-local helper, same pattern as `thermal-discord-dedup.ts` / `thermal-discord-rth.ts`:
 * the decision is pure and unit-tested here, the route keeps only the I/O.
 */
import type { ThermalCardColumn } from "@/lib/thermal-discord-card";

type Settled<T> = PromiseSettledResult<T>;

/**
 * Map settled per-ticker results onto columns, degrading a REJECTED ticker to a null column
 * instead of letting it abort the whole run.
 *
 * WHY THIS EXISTS. `fetchGexHeatmap` is typed `Promise<GexHeatmap | null>`, but null is only
 * its "not configured / unknown root" answer — it can also reject. The route used to fetch the
 * three tickers in a `for` loop with a bare `await`, so one rejection threw past the entire
 * handler: no snapshot, no EOD recap, and no breach alerts for the two healthy tickers either.
 * `ThermalCardColumn.heatmap` was already `GexHeatmap | null` and every consumer filters on
 * `heatmap != null`, so the degraded path existed and was simply unreachable.
 *
 * `onError` is called for each rejection so the caller can log it. A dropped ticker must never
 * be silent: downstream, a null column is indistinguishable from a cold cache, which would hide
 * a real upstream fault behind a benign-looking gap.
 */
export function thermalColumnsFromSettled<T>(
  tickers: readonly string[],
  settled: readonly Settled<T>[],
  onError?: (ticker: string, reason: unknown) => void
): ThermalCardColumn[] {
  return tickers.map((ticker, i) => {
    const r = settled[i];
    // A missing slot is treated as a failure rather than trusted as `undefined` data — the two
    // arrays are built together, so a length mismatch is a bug, not a data state.
    if (!r || r.status === "rejected") {
      onError?.(ticker, r && r.status === "rejected" ? r.reason : "missing result");
      return { ticker, heatmap: null };
    }
    return { ticker, heatmap: (r.value ?? null) as ThermalCardColumn["heatmap"] };
  });
}
