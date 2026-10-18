import { isAuthFailureStatus, isTransientOriginError } from "./auth-status.mjs";

/** True when the watchdog HTTP probe should backoff and retry (deploy blip / edge overload). */
export function shouldRetryWatchdogFetch(status) {
  return status === 0 || isTransientOriginError(status);
}

/**
 * Priority for a failed cron-staleness-watchdog HTTP probe.
 * Auth gaps (401/403) and transient origin 5xx are audit-env / deploy noise — not prod cron outages.
 */
export function watchdogHttpPriority(status) {
  if (isAuthFailureStatus(status)) return "P2";
  if (isTransientOriginError(status)) return "P2";
  return "P0";
}

/**
 * Classify GET /api/health for ops:collect. Watchdog 503 stays P2 (deploy blip);
 * a failed health probe is P0 — sustained origin outage, not a single cron route.
 * @returns {{ priority: 'P0'|'P1', id: string, title: string, detail: string } | null}
 */
export function originHealthActionItem(status, bodyOk) {
  if (status === 200 && bodyOk === true) return null;
  if (status === 200) {
    return {
      priority: "P0",
      id: "origin:health",
      title: "Production health check degraded",
      detail: "GET /api/health returned 200 but ok!==true",
    };
  }
  if (status === 502 || status === 503 || status === 504) {
    return {
      priority: "P0",
      id: "origin:health",
      title: "Production origin unreachable",
      detail: `GET /api/health HTTP ${status} (edge/origin — not app JSON)`,
    };
  }
  if (status === 0) {
    return {
      priority: "P1",
      id: "origin:health",
      title: "Production health check failed",
      detail: "GET /api/health network error",
    };
  }
  return {
    priority: "P1",
    id: "origin:health",
    title: "Production health check unexpected status",
    detail: `GET /api/health HTTP ${status}`,
  };
}

/** Parse ops:collect JSON from stdout (stderr may carry postgres-skip info). */
export function parseOpsCollectPayload(stdout, stderr) {
  const blob = `${stdout}\n${stderr}`;
  const jsonLine = blob.split("\n").find((l) => l.trim().startsWith("{"));
  if (!jsonLine) return null;
  try {
    return JSON.parse(jsonLine);
  } catch {
    return null;
  }
}

/** Grid/0DTE post-close: only grid|zerodte|nighthawk|correctness:flags with grid layer items count as FAIL. */
export function gridOpsItems(items) {
  return (items ?? []).filter((i) => {
    if (i.priority !== "P0" && i.priority !== "P1") return false;
    const hay = `${i.id} ${i.title} ${i.detail}`.toLowerCase();
    return /zerodte|0dte|grid|nighthawk/.test(hay) || (i.id === "correctness:flags" && /zerodte|grid/.test(hay));
  });
}

/** SPX post-close: only SPX/GEX/desk-layer P0/P1 items fail the gate. */
export function spxOpsItems(items) {
  return (items ?? []).filter((i) => {
    if (i.priority !== "P0" && i.priority !== "P1") return false;
    const hay = `${i.id} ${i.title} ${i.detail}`.toLowerCase();
    return (
      /spx|gex|heatmap|desk|slayer|thermal/.test(hay) ||
      (i.id === "correctness:flags" && /spx|gex|heatmap|desk/i.test(hay))
    );
  });
}

/**
 * Whether ops should page on a published Night Hawk edition with zero plays.
 * Uses DB-authoritative fields from `GET /api/cron/nighthawk-edition?status=1` — NOT the member
 * edition API, which can return a cached pre-publish emptyEdition shell (available:false,
 * published_at:null, recap_only:false) and false-positive even when plays exist in Postgres.
 */
export function shouldPageNighthawkZeroPlays({
  inWindow,
  jobStatus,
  editionPresent,
  playCount,
  recapOnly,
}) {
  if (!inWindow) return false;
  if (jobStatus !== "published") return false;
  if (!editionPresent) return false;
  if (playCount !== 0) return false;
  if (recapOnly) return false;
  return true;
}
