export const TRACK_RECORD_POLL_MS = 60_000;

/**
 * Minimum resolved sample before ratio stats (win rate, profit factor) render as
 * numbers instead of "Collecting data"/"Building" copy. One threshold for BOTH
 * products: SPX already gated at 30 while Night Hawk showed raw percentages from
 * any sample (audit MEDIUM — a 2-win window rendered "Avg winner 44.3%" as if it
 * meant something). Counts (total/wins/losses) stay visible at any sample — they
 * are honest raw facts; it's the ratios that lie when N is small.
 */
export const TRACK_RECORD_MIN_SAMPLE = 30;

// height must clear the rendered card (>300px tall — audit caught the old 200 clipping it).
export const TRACK_RECORD_EMBED_SNIPPET = `<iframe src="https://blackouttrades.com/embed/track-record" width="400" height="420" frameborder="0" style="border-radius:12px;overflow:hidden;" />`;

export function fmtPct(n: number | null | undefined, suffix = "%"): string {
  if (n == null) return "—";
  return `${n}${suffix}`;
}

export function profitFactorTone(pf: number | null): string {
  if (pf == null) return "text-mute";
  if (pf >= 2) return "text-cyan-400";
  if (pf >= 1) return "text-sky-300";
  return "text-bear-text";
}

export function formatAge(from: Date, nowMs: number): string {
  const s = Math.max(0, Math.floor((nowMs - from.getTime()) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}
