/**
 * Thermal Discord session-close recap scheduling (~4:05 PM ET on 15-minute cron grid).
 */
import { isEtCashRth } from "@/lib/et-market-hours";
import { todayEt } from "@/lib/et-date";
import { sharedCacheSetNx } from "@/lib/shared-cache";

/** After cash close until 4:30 PM ET — wide enough for 4:00 / 4:15 EventBridge ticks. */
export function isThermalEodRecapDue(now = new Date()): boolean {
  if (isEtCashRth(now)) return false;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? NaN);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? NaN);
  return hour === 16 && minute >= 0 && minute <= 30;
}

export function thermalEodRecapDedupKey(sessionDate: string = todayEt()): string {
  return `thermal-discord:eod:${sessionDate}`;
}

export async function claimThermalEodRecap(sessionDate: string, bypass = false): Promise<boolean> {
  if (bypass) return true;
  return sharedCacheSetNx(
    thermalEodRecapDedupKey(sessionDate),
    { at: new Date().toISOString() },
    20 * 60 * 60
  );
}
