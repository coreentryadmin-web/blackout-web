import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(__dirname, "../../..");
export const AGENT_ROOT = join(REPO_ROOT, ".blackout-agent");
export const LOCKS_DIR = join(AGENT_ROOT, "LOCKS");
export const HEARTBEAT_DIR = join(AGENT_ROOT, "HEARTBEAT");
export const RUN_HISTORY_DIR = join(AGENT_ROOT, "RUN_HISTORY");

export const STATE_FILES = {
  agentState: join(AGENT_ROOT, "AGENT_STATE.json"),
  coverage: join(AGENT_ROOT, "COVERAGE.json"),
  regressions: join(AGENT_ROOT, "REGRESSIONS.json"),
  productState: join(AGENT_ROOT, "PRODUCT_STATE.json"),
  productionHealth: join(AGENT_ROOT, "PRODUCTION_HEALTH.json"),
};

export const MARKDOWN_FILES = {
  activeWork: join(AGENT_ROOT, "ACTIVE_WORK.md"),
  workQueue: join(AGENT_ROOT, "WORK_QUEUE.md"),
  roadmap: join(AGENT_ROOT, "ROADMAP.md"),
  findings: join(AGENT_ROOT, "FINDINGS.md"),
  lastHandoff: join(AGENT_ROOT, "LAST_HANDOFF.md"),
  decisions: join(AGENT_ROOT, "DECISIONS.md"),
};

export function heartbeatPath(agent) {
  return join(HEARTBEAT_DIR, `${agent}.json`);
}

export function lockPath(taskId) {
  return join(LOCKS_DIR, `${taskId}.lock`);
}

export function runHistoryDir(agent) {
  return join(RUN_HISTORY_DIR, agent);
}
