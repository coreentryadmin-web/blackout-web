import type { UTCTimestamp } from "lightweight-charts";
import { formatEtDate, previousTradingDayEt } from "@/lib/nighthawk/session";
import { fetchIndexMinuteBars } from "@/lib/providers/polygon";

export type VectorSeedBar = {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
  /** SPY 1m share volume aligned to this bar (standard SPX proxy). */
  volume?: number;
};

type AggBar = { t?: number; o: number; h: number; l: number; c: number; v?: number };

function mapMinuteBars(bars: AggBar[], volumeByTime?: Map<number, number>): VectorSeedBar[] {
  return bars
    .filter((b) => typeof b.t === "number" && b.o > 0)
    .map((b) => {
      const time = Math.floor((b.t as number) / 1000) as UTCTimestamp;
      const volume = volumeByTime?.get(time);
      return {
        time,
        open: b.o,
        high: b.h,
        low: b.l,
        close: b.c,
        ...(volume != null && volume > 0 ? { volume } : {}),
      };
    });
}

function volumeMapFromSpyBars(spyBars: AggBar[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const b of spyBars) {
    if (typeof b.t !== "number" || b.v == null || b.v <= 0) continue;
    map.set(Math.floor(b.t / 1000), b.v);
  }
  return map;
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
    const [spxBars, spyBars] = await Promise.all([
      fetchBars("I:SPX", ymd, ymd).catch(() => []),
      fetchBars("SPY", ymd, ymd).catch(() => []),
    ]);
    const mapped = mapMinuteBars(spxBars, volumeMapFromSpyBars(spyBars));
    if (mapped.length > 0) return { bars: mapped, sessionYmd: ymd };
    ymd = previousTradingDayEt(ymd);
  }
  return { bars: [], sessionYmd: today };
}
