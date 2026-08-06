/**
 * ENGINE B — OTM WEEKLY CONTRACT SELECTION.
 * ============================================================================
 * Ports `inc`/`probeWeekly` from scripts/audit/market-banger-scan.mjs into production TypeScript so the
 * live commit path and the research backtest pick contracts the same way. Reuses the repo's existing
 * OCC-symbol builder (`buildOcc`, src/lib/ws/options-socket.ts) rather than duplicating that logic —
 * SPX/index root-mapping (SPX -> SPXW) and the OCC strike-padding math live in exactly one place.
 */

import { buildOcc } from "@/lib/ws/options-socket";
import { fetchAggBars, type AggBar } from "@/lib/providers/polygon-largo";

/** Strike increment for a given spot — faithful port of `inc` in market-banger-scan.mjs. */
export function strikeIncrement(spot: number): number {
  if (spot < 25) return 0.5;
  if (spot < 100) return 1;
  if (spot < 250) return 2.5;
  return 5;
}

export type BangerContractPick = {
  ticker: string;
  expiry: string;
  strike: number;
  occ: string;
  /** Entry premium read off the probed daily bar (first close on/after the scan session). */
  entryPremium: number;
  /** Unix-ms of the entry bar used for the premium read. */
  entryBarT: number;
};

export type FetchBarsFn = (
  occSymbol: string,
  multiplier: number,
  timespan: "minute" | "hour" | "day" | "week",
  from: string,
  to: string,
  limit?: string,
) => Promise<AggBar[]>;

/** OTM multiples tried in order, matching market-banger-scan.mjs's probeWeekly (5%, 7%, 10%, 3% OTM). */
const OTM_MULTIPLES = [1.05, 1.07, 1.1, 1.03] as const;

function cleanBars(bars: AggBar[] | null | undefined): AggBar[] {
  return (bars ?? []).filter(
    (b) => [b.h, b.l, b.c].every((n) => typeof n === "number" && Number.isFinite(n)) && b.c > 0,
  );
}

/**
 * Probe a cheap ~5-10% OTM weekly call against real bars, walking the same OTM-multiple ladder as the
 * research tool. Returns null when no probed strike has usable bar data (fail-soft — the caller simply
 * skips the ticker; this never throws for a data miss).
 *
 * `fromDate`/`toDate` bound the daily-bar window read for the entry premium (toDate should be the
 * planned hold window's end so a later live-sync can also read this same contract's path).
 */
export async function pickBangerContract(
  ticker: string,
  spot: number,
  expiry: string,
  fromDate: string,
  toDate: string,
  fetchBars: FetchBarsFn = fetchAggBars,
): Promise<BangerContractPick | null> {
  if (!(spot > 0) || !ticker) return null;
  const step = strikeIncrement(spot);
  const seen = new Set<number>();
  for (const mult of OTM_MULTIPLES) {
    const strike = Math.round((spot * mult) / step) * step;
    if (seen.has(strike)) continue;
    seen.add(strike);
    const occ = buildOcc(ticker, expiry, "call", strike);
    if (!occ) continue;
    let bars: AggBar[];
    try {
      bars = cleanBars(await fetchBars(occ, 1, "day", fromDate, toDate, "60"));
    } catch {
      continue; // fail-soft: a probe miss just tries the next multiple
    }
    if (!bars.length) continue;
    const entryCutoffMs = Date.parse(`${fromDate}T13:00:00Z`);
    const entryBar = bars.find((b) => typeof b.t === "number" && b.t >= entryCutoffMs) ?? bars[0];
    if (entryBar && entryBar.c > 0.02) {
      return {
        ticker: ticker.toUpperCase(),
        expiry,
        strike,
        occ,
        entryPremium: entryBar.c,
        entryBarT: entryBar.t ?? entryCutoffMs,
      };
    }
  }
  return null;
}
