/** Per-minute log returns from session bars — feeds pin forecaster trend degrade. */

export type MinuteCloseBar = { c: number };

/** Last N per-minute log returns from ascending session bars (newest at end). */
export function logReturnsFromMinuteBars(
  bars: readonly MinuteCloseBar[],
  maxLen = 30
): number[] {
  const out: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1]!.c;
    const curr = bars[i]!.c;
    if (prev > 0 && curr > 0) out.push(Math.log(curr / prev));
  }
  return out.slice(-Math.max(1, maxLen));
}
