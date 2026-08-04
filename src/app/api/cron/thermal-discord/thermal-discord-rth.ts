/**
 * Thermal Discord posts default to cash RTH only (9:30 AM–4:00 PM ET, early-close aware).
 * Opt out with THERMAL_DISCORD_RTH_ONLY=0 for 24/7 off-hours snapshots (not recommended).
 */
export function thermalDiscordRthOnly(): boolean {
  const v = process.env.THERMAL_DISCORD_RTH_ONLY?.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "no") return false;
  return true;
}
