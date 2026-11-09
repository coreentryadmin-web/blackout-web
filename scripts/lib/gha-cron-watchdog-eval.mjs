/**
 * Roll up cron-staleness-watchdog JSON for GitHub Actions RTH audit.
 * Matches ops-collect priorities: RTH-stale crons and critical error spikes are P0;
 * other stale/failed jobs are P1 telemetry, not a failed monitor.
 */
export function cronWatchdogGhaVerdict(json) {
  const rthKeys = [...(json?.rth_stale_keys ?? [])];
  const problemKeys = [...(json?.problem_keys ?? [])];
  const p1Keys = problemKeys.filter((k) => !rthKeys.includes(k));
  const spike = json?.error_spike ?? "none";

  const failures = [];
  if (rthKeys.length > 0) failures.push(`rth-stale: ${rthKeys.join(", ")}`);
  if (spike === "critical") {
    failures.push(`error-spike: ${json?.error_count ?? "?"} in ${json?.error_window_min ?? "?"}m`);
  }

  return {
    fail: failures.length > 0,
    failures,
    warnKeys: p1Keys,
    rthKeys,
    errorSpike: spike,
  };
}
