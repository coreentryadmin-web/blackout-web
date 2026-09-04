import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { STATE_FILES } from "./paths.mjs";

function dirnameOf(p) {
  return p.replace(/\/[^/]+$/, "");
}

export function readJson(path, fallback = null) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJsonAtomic(path, data) {
  mkdirSync(dirnameOf(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

export function readAgentState() {
  return readJson(STATE_FILES.agentState, defaultAgentState());
}

export function writeAgentState(state) {
  state.updated_at = new Date().toISOString();
  writeJsonAtomic(STATE_FILES.agentState, state);
  return state;
}

export function defaultAgentState() {
  return {
    schema_version: 1,
    autopilot: "BLACKOUT",
    updated_at: new Date().toISOString(),
    tasks: {},
    reviews: {},
    agents: {
      claude: { status: "unknown", last_seen: null },
      cursor: { status: "unknown", last_seen: null },
    },
    deploy: {
      last_main_sha: null,
      last_deploy_status: null,
      last_deploy_at: null,
    },
    events: [],
  };
}

export function appendEvent(state, event) {
  const entry = { at: new Date().toISOString(), ...event };
  state.events = [...(state.events ?? []).slice(-199), entry];
  return entry;
}
