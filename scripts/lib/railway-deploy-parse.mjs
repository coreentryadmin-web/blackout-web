/**
 * Parse Railway `deployment list` output for validate-deploy.
 * Exported for unit tests — do not duplicate row parsing elsewhere.
 */

/** @typedef {{ id: string, status: string, startedAt: Date, raw: string }} RailwayDeployRow */

const ROW_RE = /^([0-9a-f-]+)\s+\|\s*(\w+)\s+\|\s*(.+)$/i;

/**
 * @param {string} output
 * @returns {RailwayDeployRow[]}
 */
export function parseRailwayDeploymentRows(output) {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => ROW_RE.test(line))
    .map((line) => {
      const [, id, status, ts] = line.match(ROW_RE);
      return { id, status: status.toUpperCase(), startedAt: new Date(ts.trim()), raw: line };
    });
}

/**
 * @param {RailwayDeployRow[]} rows
 */
export function partitionRailwayDeployments(rows) {
  const ignored = rows.filter((r) => r.status === "SKIPPED" || r.status === "REMOVED");
  const actionable = rows.filter((r) => r.status !== "SKIPPED" && r.status !== "REMOVED");
  const latest = actionable[0] ?? null;
  const lastSuccess = rows.find((r) => r.status === "SUCCESS") ?? null;
  return { latest, lastSuccess, ignored, actionable };
}

/**
 * Railway occasionally leaves a deploy in BUILDING after healthcheck succeeds while
 * the prior SUCCESS replica set keeps serving. Treat as warn (not fail) when stale.
 *
 * @param {{ latest: RailwayDeployRow | null, lastSuccess: RailwayDeployRow | null, serviceStatus?: string, now?: number, staleBuildingMin?: number }}
 */
export function assessStaleBuildingDeploy({
  latest,
  lastSuccess,
  serviceStatus = "",
  now = Date.now(),
  staleBuildingMin = 15,
}) {
  if (!latest) return { stale: false };
  const inFlight = /^(BUILDING|DEPLOYING|QUEUED)$/i.test(latest.status);
  if (!inFlight) return { stale: false };

  const ageMin = (now - latest.startedAt.getTime()) / 60_000;
  if (ageMin < staleBuildingMin) return { stale: false, ageMin };

  const serving =
    /Online/i.test(serviceStatus) &&
    /\d+\/\d+\s+running/i.test(serviceStatus) &&
    !/Failed/i.test(serviceStatus);

  if (!lastSuccess || !serving) return { stale: false, ageMin };

  return {
    stale: true,
    ageMin,
    lastSuccessId: lastSuccess.id,
    buildingId: latest.id,
  };
}
