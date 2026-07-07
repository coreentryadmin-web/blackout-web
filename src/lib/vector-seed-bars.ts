import type { UTCTimestamp } from "lightweight-charts";
import { formatEtDate, previousTradingDayEt } from "@/lib/nighthawk/session";
import { fetchIndexMinuteBars } from "@/lib/providers/polygon";

export type VectorSeedBar = {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
};

type AggBar = { t?: number; o: number; h: number; l: number; c: number };

function mapMinuteBars(bars: AggBar[]): VectorSeedBar[] {
  return bars
    .filter((b) => typeof b.t === "number" && b.o > 0)
    .map((b) => ({
      time: Math.floor((b.t as number) / 1000) as UTCTimestamp,
      open: b.o,
      high: b.h,
      low: b.l,
      close: b.c,
    }));
}

/**
 * Seed bars for the Vector chart: today's session first, then walk back through prior
 * trading days until Polygon returns data. Off-hours / pre-market on a new calendar day
 * therefore still paints the last completed session instead of a blank canvas.
 */
export async function fetchVectorSeedBars(
  now = new Date(),
  fetchBars: typeof fetchIndexMinuteBars = fetchIndexMinuteBars
): Promise<{
  bars: VectorSeedBar[];
  sessionYmd: string;
}> {
  const today = formatEtDate(now);
  let ymd = today;
  for (let i = 0; i < 12; i++) {
    const bars = await fetchBars("I:SPX", ymd, ymd).catch(() => []);
    const mapped = mapMinuteBars(bars);
    if (mapped.length > 0) return { bars: mapped, sessionYmd: ymd };
    ymd = previousTradingDayEt(ymd);
  }
  return { bars: [], sessionYmd: today };
}
