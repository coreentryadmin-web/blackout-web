/**
 * Regular-trading-hours (09:30–16:00 ET) gate for Vector's session-ANCHORED studies (session VWAP,
 * HOD/LOD, Opening Range, and "Fib (HOD→LOD)" which is derived from HOD/LOD). Vector's chart seeds/
 * streams a ticker's WHOLE trading day (`vector-seed-bars.ts` → `fetchStockMinuteBars`/
 * `fetchIndexMinuteBars` in `src/lib/providers/polygon.ts`), which Polygon returns INCLUDING pre-
 * market/after-hours prints for equities. `vector-ticker.ts` allows any optionable symbol — not
 * just the index set (SPX/NDX/RUT/DJI/VIX), which has no real extended session — so for any real
 * equity ticker with genuine extended-hours volume, a session study with no time-of-day gate can
 * silently include those prints: an Opening Range measured from ~04:00 ET instead of 09:30, or a
 * VWAP anchored to the first premarket print instead of the 09:30 open (2026-08-05 audit finding).
 *
 * Mirrors `src/lib/providers/spx-session.ts`'s `filterRthBars` (same 09:30–16:00 window, same
 * Intl-based ET hour/minute extraction) but works on Vector's bar shape — epoch-SECONDS `time`,
 * not Polygon's raw ms `t` field — so it's a separate small pure module rather than a reuse of that
 * function directly.
 */

const ET_HOUR_MINUTE = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "numeric",
  minute: "numeric",
  hour12: false,
});

const ET_YMD = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** US equity extended session windows (ET minutes-of-day). */
export const ET_PREMARKET_START_MIN = 4 * 60;
export const ET_RTH_OPEN_MIN = 9 * 60 + 30;
export const ET_RTH_CLOSE_MIN = 16 * 60;
export const ET_AFTERHOURS_END_MIN = 20 * 60;

/** ET calendar date `YYYY-MM-DD` for an epoch-seconds instant. */
export function etYmdFromBarSec(sec: number): string {
  return ET_YMD.format(new Date(sec * 1000));
}

/** Minutes past ET midnight for an epoch-seconds instant. */
export function etMinutesOfDayFromBarSec(sec: number): number {
  const parts = ET_HOUR_MINUTE.formatToParts(new Date(sec * 1000));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

/**
 * Epoch-seconds for an ET wall-clock minute on a calendar day. One correction pass handles DST
 * without hard-coding UTC offsets.
 */
export function etEpochForYmdMinutes(ymd: string, minutesOfDay: number): number {
  const [y, m, d] = ymd.split("-").map(Number);
  let guess = Math.floor(Date.UTC(y!, m! - 1, d!, 12, 0, 0) / 1000);
  const deltaMin = minutesOfDay - etMinutesOfDayFromBarSec(guess);
  guess += deltaMin * 60;
  const drift = minutesOfDay - etMinutesOfDayFromBarSec(guess);
  if (drift !== 0) guess += drift * 60;
  return guess;
}

export type ExtendedHoursShadeBand = {
  fromSec: number;
  toSec: number;
  kind: "premarket" | "afterhours";
};

/** TradingView-style pre/post-market vertical bands for days that carry extended prints. */
export function extendedHoursShadeBands(bars: readonly { time: number }[]): ExtendedHoursShadeBand[] {
  const daysWithExtended = new Set<string>();
  for (const bar of bars) {
    if (Number.isFinite(bar.time) && !isRthBarSec(bar.time)) {
      daysWithExtended.add(etYmdFromBarSec(bar.time));
    }
  }
  if (!daysWithExtended.size) return [];

  const bands: ExtendedHoursShadeBand[] = [];
  for (const ymd of daysWithExtended) {
    bands.push({
      kind: "premarket",
      fromSec: etEpochForYmdMinutes(ymd, ET_PREMARKET_START_MIN),
      toSec: etEpochForYmdMinutes(ymd, ET_RTH_OPEN_MIN),
    });
    bands.push({
      kind: "afterhours",
      fromSec: etEpochForYmdMinutes(ymd, ET_RTH_CLOSE_MIN),
      toSec: etEpochForYmdMinutes(ymd, ET_AFTERHOURS_END_MIN),
    });
  }
  return bands.sort((a, b) => a.fromSec - b.fromSec);
}

/** True when an epoch-SECONDS bar time falls within 09:30 (inclusive) – 16:00 (exclusive) ET. */
export function isRthBarSec(sec: number): boolean {
  if (!Number.isFinite(sec)) return false;
  const parts = ET_HOUR_MINUTE.formatToParts(new Date(sec * 1000));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const mins = hour * 60 + minute;
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

/** Filter bars to RTH only, by their epoch-SECONDS `time`. Order-preserving. */
export function filterRthBarsSec<T extends { time: number }>(bars: readonly T[]): T[] {
  return bars.filter((b) => isRthBarSec(b.time));
}
