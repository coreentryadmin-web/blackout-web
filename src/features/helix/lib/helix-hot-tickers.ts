import type { FlowAlert } from "@/lib/api";

export type HelixHotTicker = {
  ticker: string;
  totalPremium: number;
  printCount: number;
  callPremium: number;
  putPremium: number;
};

export const HELIX_HOT_TICKERS_LIMIT = 8;

/** Top tickers by total premium in the current tape slice. */
export function computeHelixHotTickers(
  flows: ReadonlyArray<FlowAlert>,
  limit: number = HELIX_HOT_TICKERS_LIMIT
): HelixHotTicker[] {
  const map = new Map<string, HelixHotTicker>();

  for (const f of flows) {
    const ticker = String(f.ticker ?? "").toUpperCase();
    const premium = Number(f.premium);
    if (!ticker || !Number.isFinite(premium) || premium <= 0) continue;

    const cur = map.get(ticker) ?? {
      ticker,
      totalPremium: 0,
      printCount: 0,
      callPremium: 0,
      putPremium: 0,
    };
    cur.totalPremium += premium;
    cur.printCount += 1;
    if (f.option_type === "CALL") cur.callPremium += premium;
    else if (f.option_type === "PUT") cur.putPremium += premium;
    map.set(ticker, cur);
  }

  return Array.from(map.values())
    .sort((a, b) => b.totalPremium - a.totalPremium)
    .slice(0, limit);
}
