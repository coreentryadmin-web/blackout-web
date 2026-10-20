// Wiring layer for the RVOL shadow signal (relative-volume.ts) — fetches the REAL trailing data
// that pure module needs and assembles BOTH the baseline (flat proration) and candidate (real
// time-of-day profile) reads side by side, for additive, non-gating attachment onto a committed
// setup's `entry_context.shadow_signals.relative_volume` (scan.ts).
//
// COST DISCIPLINE (this calls Polygon on a live cron path — zerodte-warm, ~every 5 minutes): this
// module is called ONLY for setups that have already cleared every other gate and are about to be
// persisted (a handful per scan pass), never for the whole-market screen. Even so:
//   - avgDailyVolume: ONE daily-bars call per ticker (`fetchStockDailyBars`, ~20 trading days).
//   - the time-of-day profile: the EXPENSIVE part (minute bars across several trailing days) is
//     CACHED per ticker per session day (sharedCacheGet/Set, ~20h TTL) so it is computed from a
//     live fetch at most ONCE per ticker per day, not once per scan pass that commits that ticker.
//   - today's cumulative volume: ONE minute-bars call for today only.
// Every fetch is wrapped so a failure degrades to a null shadow read — this signal must NEVER delay
// or fail a real commit. `attachRelativeVolumeShadow` never throws.
//
// LOOKBACK WINDOW BOUND: the profile fetch asks Polygon for `PROFILE_LOOKBACK_CALENDAR_DAYS`
// calendar days of 1-minute bars in ONE call. `fetchStockMinuteBars` passes a hardcoded
// limit=5000 — at ~390 RTH bars/trading day, this window (12 calendar days ≈ 8-9 trading days,
// ≈3200-3500 bars) stays safely under that cap. Widening this window without re-checking the limit
// would reproduce the exact "Polygon aggregate limit MUST be derived from window" bug class this
// codebase has hit before (CLAUDE.md, ma-math/meridian-reaction-core) — don't widen it blind.
import { fetchStockDailyBars, fetchStockMinuteBars } from "../providers/polygon";
import { sharedCacheGetWithTtl, sharedCacheSet } from "../shared-cache";
import {
  buildTimeOfDayVolumeProfile,
  computeRelativeVolume,
  RVOL_PROFILE_MIN_DAYS,
  type RelativeVolumeRead,
  type TimeOfDayVolumeProfile,
} from "./relative-volume";

const AVG_DAILY_VOLUME_LOOKBACK_CALENDAR_DAYS = 30; // ~20 real trading days after weekends/holidays
const PROFILE_LOOKBACK_CALENDAR_DAYS = 12; // ~8-9 real trading days — see the file header's cap note
const PROFILE_CACHE_TTL_SEC = 20 * 60 * 60; // one profile fetch per ticker per session day, not per scan pass

export type RelativeVolumeShadowRead = {
  /** Flat-proration read — the ORIGINAL (2026-10-19 PR #6287) method, kept as the baseline. */
  baseline: RelativeVolumeRead;
  /** Real time-of-day-profile read — null fields throughout when no profile could be built (e.g.
   *  a newly-listed or thinly-covered ticker with <RVOL_PROFILE_MIN_DAYS real trailing days). */
  candidate: RelativeVolumeRead;
  avg_daily_volume: number | null;
  profile_days_used: number | null;
};

const RTH_SESSION_MINUTES = 390;

function toYmd(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Groups a flat minute-bar list into one real per-RTH-minute volume array per calendar date,
 *  keyed by the bar's OWN UTC date (bars already come from the exchange's real session, so this
 *  is a real trading-day grouping, not an assumption). Days with fewer than a usable number of
 *  bars (holiday/weekend noise, or a half session) are left as whatever real bars exist — the
 *  profile builder itself treats missing minutes as real zero-volume, never as absence. */
function groupMinuteBarsByDate(bars: Array<{ t: number; v: number }>): Map<string, number[]> {
  const byDate = new Map<string, number[]>();
  for (const b of bars) {
    const date = toYmd(b.t);
    const d = new Date(b.t);
    const utcMin = d.getUTCHours() * 60 + d.getUTCMinutes();
    // RTH 13:30-20:00 UTC (EDT) / 14:30-21:00 UTC (EST) both map safely into a single generous
    // window; minutes outside real RTH for either offset are extended-hours noise, excluded here
    // the same way board.ts's own RTH filters exclude them elsewhere in this codebase.
    if (utcMin < 13 * 60 + 30 || utcMin >= 21 * 60) continue;
    const dayArr = byDate.get(date) ?? new Array(RTH_SESSION_MINUTES).fill(0);
    // Index by minutes-since-13:30-UTC, clamped — a DST-mismatched index still lands inside the
    // array rather than throwing; exactness here only affects the profile's SHAPE, never crosses
    // into a gating decision.
    const idx = Math.min(RTH_SESSION_MINUTES - 1, Math.max(0, utcMin - 13 * 60 - 30));
    dayArr[idx] += Number.isFinite(b.v) ? b.v : 0;
    byDate.set(date, dayArr);
  }
  return byDate;
}

async function buildProfileForTicker(ticker: string, asOfMs: number): Promise<TimeOfDayVolumeProfile | null> {
  const cacheKey = `zerodte:rvol:profile:${ticker}:${toYmd(asOfMs)}`;
  // sharedCacheGetWithTtl (not sharedCacheGet) — a cached "no profile" verdict IS the value null,
  // which plain sharedCacheGet cannot distinguish from a true cache miss (both return bare null).
  // The wrapped {value, remainingTtlSec} shape makes a real cache hit on a null value visible, so
  // a confirmed-no-profile ticker doesn't get re-fetched on every single commit that day.
  const cached = await sharedCacheGetWithTtl<TimeOfDayVolumeProfile | null>(cacheKey).catch(() => null);
  if (cached != null) return cached.value;

  try {
    const to = toYmd(asOfMs);
    const from = toYmd(asOfMs - PROFILE_LOOKBACK_CALENDAR_DAYS * 24 * 60 * 60 * 1000);
    const bars = await fetchStockMinuteBars(ticker, from, to);
    const byDate = groupMinuteBarsByDate(bars as unknown as Array<{ t: number; v: number }>);
    // Exclude TODAY — the profile must be built from COMPLETE prior days only, never a partial
    // in-progress day, or it would silently leak today's own (possibly unusual) pace into its own
    // baseline.
    byDate.delete(toYmd(asOfMs));
    const days = [...byDate.values()];
    const profile = buildTimeOfDayVolumeProfile(days);
    // Cache both a real profile AND a confirmed null (too few real days) — either way this ticker
    // doesn't need re-fetching again today.
    await sharedCacheSet(cacheKey, profile, PROFILE_CACHE_TTL_SEC).catch(() => {});
    return profile;
  } catch {
    return null;
  }
}

async function cumulativeVolumeToday(ticker: string, nowMs: number): Promise<number | null> {
  try {
    const today = toYmd(nowMs);
    const bars = await fetchStockMinuteBars(ticker, today, today);
    let total = 0;
    for (const b of bars as unknown as Array<{ t: number; v: number }>) {
      if (b.t <= nowMs && Number.isFinite(b.v)) total += b.v;
    }
    return total;
  } catch {
    return null;
  }
}

async function avgDailyVolume(ticker: string, nowMs: number): Promise<number | null> {
  try {
    const to = toYmd(nowMs - 24 * 60 * 60 * 1000); // exclude today — only COMPLETE prior sessions
    const from = toYmd(nowMs - AVG_DAILY_VOLUME_LOOKBACK_CALENDAR_DAYS * 24 * 60 * 60 * 1000);
    const bars = await fetchStockDailyBars(ticker, from, to);
    const volumes = (bars as unknown as Array<{ v: number }>)
      .map((b) => b.v)
      .filter((v) => Number.isFinite(v) && v > 0);
    if (volumes.length === 0) return null;
    return volumes.reduce((sum, v) => sum + v, 0) / volumes.length;
  } catch {
    return null;
  }
}

/**
 * Best-effort, NEVER-throwing assembly of the RVOL shadow read for one ticker at commit time.
 * Returns null (never a fabricated read) when the underlying data couldn't be fetched at all —
 * a caller should treat null as "no shadow signal this commit," identical to how `why_now`'s own
 * absence is handled elsewhere in this ledger.
 */
export async function computeRelativeVolumeShadow(
  ticker: string,
  nowMs: number
): Promise<RelativeVolumeShadowRead | null> {
  try {
    const [cumVol, avgVol, profile] = await Promise.all([
      cumulativeVolumeToday(ticker, nowMs),
      avgDailyVolume(ticker, nowMs),
      buildProfileForTicker(ticker, nowMs),
    ]);
    if (cumVol == null || avgVol == null) return null;

    const baseline = computeRelativeVolume({ cumulativeVolumeToday: cumVol, avgDailyVolume: avgVol, nowMs });
    const candidate = computeRelativeVolume({
      cumulativeVolumeToday: cumVol,
      avgDailyVolume: avgVol,
      nowMs,
      timeOfDayProfile: profile,
    });
    return {
      baseline,
      candidate,
      avg_daily_volume: Math.round(avgVol),
      profile_days_used: profile?.days_used ?? null,
    };
  } catch {
    return null;
  }
}
