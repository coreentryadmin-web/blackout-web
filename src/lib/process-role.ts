/**
 * Process role gates which subsystems boot in a given container.
 *
 * - `web`    — HTTP/UI tier; no upstream WebSockets (reads Redis snapshots).
 * - `ingest` — market-data worker; owns WS leaders + RTH warm leader.
 * - `all`    — legacy single-process (Railway / local dev without PROCESS_ROLE).
 */

export type ProcessRole = "web" | "ingest" | "all";

export function processRole(): ProcessRole {
  const raw = process.env.PROCESS_ROLE?.trim().toLowerCase();
  if (raw === "ingest" || raw === "market-worker" || raw === "market_data") {
    return "ingest";
  }
  if (raw === "web") return "web";

  if (process.env.DATA_SOCKETS_ENABLED?.trim() === "0") return "web";
  if (process.env.DATA_SOCKETS_ENABLED?.trim() === "1") return "ingest";

  return "all";
}

export function isWebProcess(): boolean {
  return processRole() === "web";
}

export function isIngestProcess(): boolean {
  return processRole() === "ingest";
}

/** Whether this process should open/maintain upstream market-data WebSockets. */
export function shouldBootDataSockets(): boolean {
  const role = processRole();
  return role === "ingest" || role === "all";
}

/** In-process RTH warm leader runs only on the dedicated ingest worker (or legacy all-in-one). */
export function shouldRunRthWarmLeader(): boolean {
  const role = processRole();
  return role === "ingest" || role === "all";
}
