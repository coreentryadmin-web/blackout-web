import type { PostType } from "./x-content-types";
import { isTradingDayEt } from "@/features/nighthawk/lib/session";
import { todayEt } from "@/lib/et-date";

/** Even ET hours 8–20 = one post every 2 hours.
 * NOTE: The EventBridge cron schedule fires at UTC times [12,14,16,18,20,22,0] daily.
 * These convert to ET hours differently across DST:
 * - EDT (UTC-4): UTC times → ET [8,10,12,14,16,18,20] ✓ (summer, Mar-Nov)
 * - EST (UTC-5): UTC times → ET [7,9,11,13,15,17,19] (winter, Nov-Mar)
 * To maintain the same post times in both seasons, isPostWindow() detects DST
 * and applies the correct ET hour set for the current date.
 */
export const POST_HOURS_ET = [8, 10, 12, 14, 16, 18, 20] as const;

// Weekend posts ride the SAME fixed-UTC EventBridge schedule as weekdays, so they need the
// SAME DST-aware ET-hour shift the weekday branch already applies via isDST() below — see the
// NOTE at the top of this file. Under EDT the cron's weekend-relevant UTC fires land on ET
// 10/14 (the intended 10am/2pm slots); under EST the same UTC times land one hour earlier, at
// ET 9/13. A single fixed [10, 14] array (the pre-fix form of this constant) only ever matched
// the EDT case, so every actual EST firing — which is what happens on every real winter
// Saturday/Sunday cron invocation — missed both hours and `isPostWindow` returned false at
// every one of them. The symptom is silent: no error, no log, the cron still runs 7x/day on
// schedule, it just never recognizes any of those times as a post window, so `weekend_desk`
// posts stop appearing entirely from the November DST changeover through the March one, then
// resume automatically once DST starts again — exactly the seasonal, self-healing-then-
// regressing shape `cron-dst-audit.mjs`'s own header describes for its "ET-GATED" bug class.
const EDT_WEEKEND_POST_HOURS = [10, 14] as const;
const EST_WEEKEND_POST_HOURS = [9, 13] as const;

// Under EDT (UTC-4), these hours receive posts
const EDT_HOUR_TO_TYPE: Record<number, PostType> = {
  8: "desk_open",
  10: "desk_flow",
  12: "desk_ai",
  14: "desk_matrix",
  16: "desk_midday",
  18: "desk_close",
  20: "desk_evening",
};

// Under EST (UTC-5), the same UTC times map to different ET hours
// UTC [0,12,14,16,18,20,22,0] → ET [7,9,11,13,15,17,19] (shifted earlier by 1 hour)
const EST_HOUR_TO_TYPE: Record<number, PostType> = {
  7: "desk_open",
  9: "desk_flow",
  11: "desk_ai",
  13: "desk_matrix",
  15: "desk_midday",
  17: "desk_close",
  19: "desk_evening",
};

/** Detect if a date is in EDT (Daylight Saving Time) in America/New_York.
 * Returns true if DST is in effect (EDT, UTC-4), false if EST (UTC-5).
 * DST transitions on:
 * - 2nd Sunday of March at 2:00 AM EST (transition to EDT)
 * - 1st Sunday of November at 2:00 AM EDT (transition to EST)
 */
function isDST(date: Date): boolean {
  const year = date.getFullYear();
  const month = date.getMonth(); // 0-11

  // Quick check: EDT is definitely March (2) through October (9)
  if (month > 2 && month < 10) return true;
  if (month < 2 || month === 11) return false; // Definitely EST

  // March: check if on or after 2nd Sunday
  if (month === 2) {
    let secondSunday = 8; // At earliest 8th
    let sundayCount = 0;
    for (let d = 1; d <= 14; d++) {
      if (new Date(year, 2, d).getDay() === 0) {
        sundayCount++;
        if (sundayCount === 2) {
          secondSunday = d;
          break;
        }
      }
    }
    return date.getDate() >= secondSunday;
  }

  // November: check if before 1st Sunday
  if (month === 10) {
    for (let d = 1; d <= 7; d++) {
      if (new Date(year, 10, d).getDay() === 0) {
        return date.getDate() < d;
      }
    }
  }

  return false;
}

export function isPostWindow(nowEt: Date): boolean {
  const h = nowEt.getHours();
  const dow = nowEt.getDay();
  if (dow === 0 || dow === 6) {
    const weekendHours = isDST(nowEt) ? EDT_WEEKEND_POST_HOURS : EST_WEEKEND_POST_HOURS;
    return (weekendHours as readonly number[]).includes(h);
  }
  // Weekday EventBridge fires on NYSE holidays too — no desk-cycle posts on a closed tape.
  if (!isTradingDayEt(todayEt(nowEt))) return false;
  // Under EDT, fire at ET [8,10,12,14,16,18,20]
  // Under EST, fire at ET [7,9,11,13,15,17,19] (same UTC times, different ET hours)
  const postHours = isDST(nowEt)
    ? ([8, 10, 12, 14, 16, 18, 20] as const)
    : ([7, 9, 11, 13, 15, 17, 19] as const);
  return (postHours as readonly number[]).includes(h);
}

export function selectPostType(nowEt: Date): PostType | null {
  if (!isPostWindow(nowEt)) return null;
  const h = nowEt.getHours();
  const dow = nowEt.getDay();
  if (dow === 0 || dow === 6) return "weekend_desk";
  const hourToType = isDST(nowEt) ? EDT_HOUR_TO_TYPE : EST_HOUR_TO_TYPE;
  return hourToType[h] ?? null;
}

// SCHEDULE represents the EDT posting times (POST_HOURS_ET is EDT-based).
// During EST, the same UTC cron fires at different ET hours, which isPostWindow() handles.
export const SCHEDULE = POST_HOURS_ET.map((h) => ({
  type: EDT_HOUR_TO_TYPE[h]!,
  hours: [h, h + 2] as [number, number],
}));
