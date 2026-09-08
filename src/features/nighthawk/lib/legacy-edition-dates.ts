import { nextTradingDayEt, todayEt } from "@/features/nighthawk/lib/session";

/**
 * Edition dates that may hold open Legacy playbook rows right now.
 *
 * Night Hawk publishes the evening edition with `edition_for = nextTradingDayEt(today)`.
 * During that evening (before the session opens), live-sync must look at tomorrow's key —
 * not today's ET calendar date — or it finds zero rows and never posts BTO backfills.
 *
 * During RTH the active book is `todayEt()`; including `nextTradingDayEt` also covers the
 * handoff window right after publish.
 */
export function activeLegacyEditionDates(now: Date = new Date()): string[] {
  const today = todayEt(now);
  const next = nextTradingDayEt(today);
  return today === next ? [today] : [today, next];
}
