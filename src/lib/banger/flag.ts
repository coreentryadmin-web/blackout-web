/**
 * ENGINE B kill-switch — a pure OPERATIONAL off-switch, not a trading cap.
 *
 * `BANGER_ENGINE_ENABLED` defaults ON (unset = enabled). Set to "0"/"false"/"off" to no-op BOTH the
 * discovery/commit cron (commit.ts) and the live-sync cron (live-sync.ts) — each checks this FIRST and
 * returns a skipped result without touching Polygon, the DB, or banger_positions in any way. This is the
 * one deliberately-included cap on this launch: zero position/capital/daily-commit limits per direct
 * operator instruction (2026-08-04), but a same-day way to pull the plug if the whole surface needs to
 * go dark (bad data, a provider outage, a bug) without a code deploy.
 */
export function isBangerEngineEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.BANGER_ENGINE_ENABLED ?? "").trim().toLowerCase();
  if (raw === "") return true; // default ON
  return !["0", "false", "off", "no"].includes(raw);
}
