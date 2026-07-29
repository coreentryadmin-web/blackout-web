/**
 * Pure helpers for thermal-discord cron idempotency.
 * Kept out of `route.ts` — Next.js rejects non-route exports from App Router route modules.
 */

/** Just under the 15-minute schedule so the next tick can claim cleanly. */
export const THERMAL_DISCORD_DEDUP_TTL_SEC = 14 * 60;
export const THERMAL_DISCORD_DEDUP_KEY = "thermal-discord:posted";

/** `force=1` alone still dedupes; only `force=1&allow_dup=1` bypasses the claim. */
export function thermalDiscordBypassesDedup(force: boolean, allowDup: boolean): boolean {
  return force && allowDup;
}
