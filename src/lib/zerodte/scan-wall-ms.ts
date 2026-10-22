/** Cron warm-path ceiling — must stay below `critical_stale` (10m) on zerodte_scan_heartbeat.
 *  `within()` does not cancel the scan; this only unblocks the warm tick + watchdog. */
export function zerodteScanWallMs(): number {
  const n = Number(process.env.ZERODTE_SCAN_WALL_MS);
  return Number.isFinite(n) && n > 0 ? n : 9 * 60 * 1000;
}
