#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { appendEvent, readAgentState, writeAgentState } from "./lib/state.mjs";
import { expireStaleLocksSync, readLock } from "./lib/locks.mjs";
import { LOCKS_DIR } from "./lib/paths.mjs";
import { existsSync, readdirSync } from "node:fs";
import { ghSpawn } from "./lib/gh.mjs";

function ghJson(args) {
  const r = ghSpawn(args);
  if (r.status !== 0) return null;
  try {
    return JSON.parse(r.stdout || "[]");
  } catch {
    return null;
  }
}

export function syncContext() {
  const expired = expireStaleLocksSync();
  const state = readAgentState();

  const shaR = spawnSync("git", ["rev-parse", "origin/main"], { encoding: "utf8" });
  if (shaR.status === 0) state.deploy.last_main_sha = shaR.stdout.trim();

  const deployRuns = ghJson(["run", "list", "--branch", "main", "--workflow", "ecr-push-production.yml", "--limit", "1", "--json", "status,conclusion,headSha,updatedAt,url"]);
  if (deployRuns?.[0]) {
    state.deploy.last_deploy_status = deployRuns[0].conclusion ?? deployRuns[0].status;
    state.deploy.last_deploy_at = deployRuns[0].updatedAt;
    state.deploy.last_deploy_url = deployRuns[0].url;
    state.deploy.last_deploy_sha = deployRuns[0].headSha;
  }

  const openPrs = ghJson(["pr", "list", "--state", "open", "--limit", "30", "--json", "number,title,headRefName,author,isDraft,statusCheckRollup,updatedAt"]);
  state.open_prs = (openPrs ?? []).map((pr) => {
    const verify = (pr.statusCheckRollup ?? []).find((c) => c.name === "verify");
    const authorLogin = pr.author?.login ?? "unknown";
    const agent = pr.headRefName?.startsWith("claude/")
      ? "claude"
      : pr.headRefName?.startsWith("cursor/")
        ? "cursor"
        : pr.headRefName?.startsWith("fix/") || pr.headRefName?.startsWith("docs/")
          ? "agent"
          : "human";
    return { number: pr.number, title: pr.title, branch: pr.headRefName, author: authorLogin, agent, draft: pr.isDraft, verify: verify ? `${verify.status}/${verify.conclusion ?? "pending"}` : "unknown", updated_at: pr.updatedAt };
  });

  const activeLocks = {};
  if (existsSync(LOCKS_DIR)) {
    for (const file of readdirSync(LOCKS_DIR)) {
      if (!file.endsWith(".lock")) continue;
      const taskId = file.replace(/\.lock$/, "");
      const lock = readLock(taskId);
      if (lock && Date.parse(lock.lease_until) > Date.now()) {
        activeLocks[taskId] = lock;
        state.tasks[taskId] = { ...(state.tasks[taskId] ?? {}), ...lock };
      }
    }
  }

  appendEvent(state, { type: "context_sync", expired_locks: expired, open_pr_count: state.open_prs.length });
  writeAgentState(state);
  return { state, expired, activeLocks };
}

if (process.argv[1]?.endsWith("sync-context.mjs")) {
  const { state, expired, activeLocks } = syncContext();
  console.log(JSON.stringify({ ok: true, main_sha: state.deploy.last_main_sha, deploy: state.deploy.last_deploy_status, open_prs: state.open_prs?.length ?? 0, expired_locks: expired, active_locks: Object.keys(activeLocks) }, null, 2));
}
