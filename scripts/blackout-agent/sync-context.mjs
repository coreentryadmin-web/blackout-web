#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { appendEvent, readAgentState, writeAgentState } from "./lib/state.mjs";
import { expireStaleLocksSync, readLock } from "./lib/locks.mjs";
import { withStateLock } from "./lib/state-lock.mjs";
import { LOCKS_DIR } from "./lib/paths.mjs";
import { ghJson } from "./lib/gh.mjs";
import { existsSync, readdirSync } from "node:fs";

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

/**
 * Normalize verify check status from GraphQL rollup or REST check-runs.
 *
 * GraphQL's `statusCheckRollup` enums are UPPERCASE ("COMPLETED"/"SUCCESS"); GitHub's
 * REST `/check-runs` endpoint returns the SAME information lowercase
 * ("completed"/"success") -- the two data sources this function is explicitly
 * documented to accept disagree on case. Every downstream consumer of the resulting
 * string (select-task.mjs's `discoverStandingWork`, bootstrap.mjs's `review_queue`)
 * matches it with a case-sensitive `.includes("SUCCESS")` / `.includes("FAILURE")`
 * check, so a REST-sourced value must be uppercased here or it silently satisfies
 * neither check -- a green PR never reads as safe to merge, and a failing PR is never
 * skipped. This matters most exactly when the REST fallback is used: when GraphQL's
 * shared rate-limit budget is exhausted because the fleet is busy (see fetchOpenPrs's
 * own comment), which is precisely when peer-review visibility matters most.
 */
export function formatVerifyStatus(check) {
  if (!check) return "unknown";
  const status = String(check.status ?? "unknown").toUpperCase();
  const conclusion = check.conclusion != null ? String(check.conclusion).toUpperCase() : "pending";
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

  // Everything above/below this comment is read-only gathering — `gh`/network calls that can
  // easily run several seconds (the REST fallback in `fetchOpenPrsAsync` issues one extra
  // `check-runs` call PER open PR). None of it touches shared state yet.
  const shaR = spawnSync("git", ["rev-parse", "origin/main"], { encoding: "utf8" });
  const mainSha = shaR.status === 0 ? shaR.stdout.trim() : null;

  const deployRuns = ghJson(["run", "list", "--branch", "main", "--workflow", "ecr-push-production.yml", "--limit", "1", "--json", "status,conclusion,headSha,updatedAt,url"]);

  const openPrs = await fetchOpenPrsAsync();

  const activeLocks = {};
  if (existsSync(LOCKS_DIR)) {
    for (const file of readdirSync(LOCKS_DIR)) {
      if (!file.endsWith(".lock")) continue;
      const taskId = file.replace(/\.lock$/, "");
      const lock = readLock(taskId);
      if (lock && Date.parse(lock.lease_until) > Date.now()) {
        activeLocks[taskId] = lock;
      }
    }
  }

  // BUG FIX (round 354): the merge-and-write used to run against a `state` object read at the
  // TOP of this function, before the several-second `gh`/network round trip above — then written
  // back unconditionally with no lock at all. `claim-task.mjs`/`record-review.mjs` already
  // wrap their shared-state writes in `withStateLock`, but a lock only protects writers that
  // participate in it: this function's unlocked, stale-snapshot write could (and in this
  // sandbox's own live `.blackout-agent/AGENT_STATE.json`, did — see this fix's companion
  // `release-task.mjs`/`handoff.mjs` changes) silently erase a `claimLock`/`releaseLock` that
  // landed on disk during the gap. Reading state FRESH inside a short, lock-protected critical
  // section — after all the slow I/O is already done — closes that window without holding the
  // lock for the whole multi-second fetch.
  const locked = withStateLock(() => {
    const state = readAgentState();
    if (mainSha) state.deploy.last_main_sha = mainSha;
    if (deployRuns?.[0]) {
      state.deploy.last_deploy_status = deployRuns[0].conclusion ?? deployRuns[0].status;
      state.deploy.last_deploy_at = deployRuns[0].updatedAt;
      state.deploy.last_deploy_url = deployRuns[0].url;
      state.deploy.last_deploy_sha = deployRuns[0].headSha;
    }
    state.open_prs = openPrs;
    for (const [taskId, lock] of Object.entries(activeLocks)) {
      state.tasks[taskId] = { ...(state.tasks[taskId] ?? {}), ...lock };
    }
    appendEvent(state, { type: "context_sync", expired_locks: expired, open_pr_count: openPrs.length });
    writeAgentState(state);
    return state;
  }, { owner: "sync-context" });

  // Lock contention here means another writer is mid-update right now — best-effort: skip this
  // cycle's write rather than block or race it; the caller still gets a current (if momentarily
  // unmerged-with-this-sync) read, and the next sync/claim/release retries normally.
  const state = locked.ok ? locked.result : readAgentState();
  return { state, expired, activeLocks };
}

if (process.argv[1]?.endsWith("sync-context.mjs")) {
  syncContext().then(({ state, expired, activeLocks }) => {
    console.log(JSON.stringify({ ok: true, main_sha: state.deploy.last_main_sha, deploy: state.deploy.last_deploy_status, open_prs: state.open_prs?.length ?? 0, expired_locks: expired, active_locks: Object.keys(activeLocks) }, null, 2));
  });
}
