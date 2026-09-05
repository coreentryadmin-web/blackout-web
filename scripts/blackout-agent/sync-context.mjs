#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { appendEvent, readAgentState, writeAgentState } from "./lib/state.mjs";
import { expireStaleLocksSync, readLock } from "./lib/locks.mjs";
import { LOCKS_DIR } from "./lib/paths.mjs";
import { existsSync, readdirSync } from "node:fs";

function ghJson(args) {
  const r = spawnSync("gh", args, { encoding: "utf8" });
  if (r.status !== 0) return null;
  try {
    return JSON.parse(r.stdout || "[]");
  } catch {
    return null;
  }
}

export function resolveGithubRepo() {
  const env = process.env.GITHUB_REPOSITORY?.trim();
  if (env) return env;
  const fromGh = ghJson(["repo", "view", "--json", "nameWithOwner"])?.nameWithOwner;
  if (fromGh) return fromGh;
  const remote = spawnSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" });
  if (remote.status !== 0) return null;
  const url = remote.stdout.trim();
  const ssh = url.match(/github\.com[:/](.+?)(?:\.git)?$/);
  if (ssh) return ssh[1];
  return null;
}

/** Map a branch prefix to the owning agent lane for peer-review routing. */
export function agentFromBranch(headRefName) {
  if (headRefName?.startsWith("claude/")) return "claude";
  if (headRefName?.startsWith("cursor/")) return "cursor";
  if (headRefName?.startsWith("fix/") || headRefName?.startsWith("docs/")) return "agent";
  return "human";
}

/** Normalize verify check status from GraphQL rollup or REST check-runs. */
export function formatVerifyStatus(check) {
  if (!check) return "unknown";
  const status = check.status ?? "unknown";
  const conclusion = check.conclusion ?? "pending";
  return `${status}/${conclusion}`;
}

function verifyFromRestCheckRuns(checkRuns) {
  const verify = (checkRuns ?? []).find((c) => c.name === "verify");
  return verify ? formatVerifyStatus(verify) : "unknown";
}

function mapRestPull(pr, verify = "unknown") {
  const authorLogin = pr.user?.login ?? "unknown";
  const branch = pr.head?.ref ?? "unknown";
  return {
    number: pr.number,
    title: pr.title,
    branch,
    author: authorLogin,
    agent: agentFromBranch(branch),
    draft: Boolean(pr.draft),
    verify,
    updated_at: pr.updated_at,
  };
}

/**
 * Last-resort open-PR sync when authenticated `gh` calls are rate-limited. Public repo metadata
 * is readable without a token on a separate (lower) unauthenticated budget — enough for agent
 * routing when the shared PAT/GraphQL pool is exhausted.
 */
export async function fetchOpenPrsViaPublicApi(repo) {
  if (!repo) return [];
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/pulls?state=open&per_page=30`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "blackout-autopilot-sync" },
    });
    if (!res.ok) return [];
    const pulls = await res.json();
    if (!Array.isArray(pulls)) return [];
    return pulls.map((pr) => mapRestPull(pr));
  } catch {
    return [];
  }
}

/**
 * Fetch open PRs for agent state. GraphQL (`gh pr list`) is preferred but exhausts
 * its budget quickly when the fleet is busy; REST (`/pulls`) uses a separate pool.
 * Returns `{ ok, prs }` where `ok` means an authenticated gh path answered (even if zero PRs).
 */
export function fetchOpenPrs() {
  const graphql = ghJson([
    "pr",
    "list",
    "--state",
    "open",
    "--limit",
    "30",
    "--json",
    "number,title,headRefName,author,isDraft,statusCheckRollup,updatedAt",
  ]);
  if (Array.isArray(graphql)) {
    return {
      ok: true,
      prs: graphql.map((pr) => {
        const verify = (pr.statusCheckRollup ?? []).find((c) => c.name === "verify");
        const authorLogin = pr.author?.login ?? "unknown";
        return {
          number: pr.number,
          title: pr.title,
          branch: pr.headRefName,
          author: authorLogin,
          agent: agentFromBranch(pr.headRefName),
          draft: pr.isDraft,
          verify: formatVerifyStatus(verify),
          updated_at: pr.updatedAt,
        };
      }),
    };
  }

  const repo = resolveGithubRepo();
  if (!repo) return { ok: false, prs: [] };

  const rest = ghJson(["api", `repos/${repo}/pulls?state=open&per_page=30`]);
  if (Array.isArray(rest)) {
    return {
      ok: true,
      prs: rest.map((pr) => {
        const headSha = pr.head?.sha;
        let verify = "unknown";
        if (headSha) {
          const checks = ghJson(["api", `repos/${repo}/commits/${headSha}/check-runs?per_page=30`]);
          verify = verifyFromRestCheckRuns(checks?.check_runs);
        }
        return mapRestPull(pr, verify);
      }),
    };
  }

  return { ok: false, prs: [] };
}

/** Async variant — includes unauthenticated public API fallback after gh paths fail. */
export async function fetchOpenPrsAsync() {
  const { ok, prs } = fetchOpenPrs();
  if (ok) return prs;
  const repo = resolveGithubRepo();
  return fetchOpenPrsViaPublicApi(repo);
}

export async function syncContext() {
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

  state.open_prs = await fetchOpenPrsAsync();

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
  syncContext().then(({ state, expired, activeLocks }) => {
    console.log(JSON.stringify({ ok: true, main_sha: state.deploy.last_main_sha, deploy: state.deploy.last_deploy_status, open_prs: state.open_prs?.length ?? 0, expired_locks: expired, active_locks: Object.keys(activeLocks) }, null, 2));
  });
}
