import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

test("claimLock: first claim succeeds", async () => {
  const { claimLock, releaseLock } = await import("./lib/locks.mjs");
  const r = claimLock("BO-TEST-0001", "cursor", { phase: "IMPLEMENTING", leaseMs: 60_000 });
  assert.equal(r.ok, true);
  releaseLock("BO-TEST-0001", "cursor");
});

test("claimLock: second agent blocked", async () => {
  const { claimLock, releaseLock } = await import("./lib/locks.mjs");
  claimLock("BO-TEST-0002", "claude", { leaseMs: 60_000 });
  const second = claimLock("BO-TEST-0002", "cursor", { leaseMs: 60_000 });
  assert.equal(second.ok, false);
  assert.equal(second.reason, "leased_by_other");
  releaseLock("BO-TEST-0002", "claude");
});

test("claimLock: expired lease reclaimed", async () => {
  const { claimLock, releaseLock } = await import("./lib/locks.mjs");
  const { writeJsonAtomic } = await import("./lib/state.mjs");
  const { heartbeatPath } = await import("./lib/paths.mjs");
  // Stale heartbeat so expired lease can be reclaimed (committed HEARTBEAT/*.json may be fresh).
  writeJsonAtomic(heartbeatPath("claude"), {
    agent: "claude",
    last_seen: "2020-01-01T00:00:00.000Z",
    healthy: false,
  });
  claimLock("BO-TEST-0003", "claude", { leaseMs: 1 });
  await new Promise((r) => setTimeout(r, 10));
  const second = claimLock("BO-TEST-0003", "cursor", { leaseMs: 60_000 });
  assert.equal(second.ok, true);
  releaseLock("BO-TEST-0003", "cursor");
});

test("claimLock: expired lease NOT reclaimed when owner heartbeat is fresh", async () => {
  const { claimLock, releaseLock } = await import("./lib/locks.mjs");
  const { writeJsonAtomic } = await import("./lib/state.mjs");
  const { heartbeatPath } = await import("./lib/paths.mjs");
  writeJsonAtomic(heartbeatPath("claude"), {
    agent: "claude",
    last_seen: new Date().toISOString(),
    healthy: true,
  });
  claimLock("BO-TEST-0004", "claude", { leaseMs: 1 });
  await new Promise((r) => setTimeout(r, 5));
  const second = claimLock("BO-TEST-0004", "cursor", { leaseMs: 60_000 });
  assert.equal(second.ok, false);
  assert.equal(second.reason, "lease_expired_owner_alive");
  releaseLock("BO-TEST-0004", "claude");
});

test("dispatch-prompt includes coordination rules", () => {
  const r = spawnSync("node", ["scripts/blackout-agent/dispatch-prompt.mjs", "--agent=cursor"], { encoding: "utf8", cwd: repoRoot });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /BLACKOUT AUTOPILOT/);
  assert.match(r.stdout, /Never approve your own PR/);
  assert.match(r.stdout, /CONTINUOUS WORK LOOP/);
});

test("hourly-checklist includes autonomous wake questions", () => {
  const r = spawnSync("node", ["scripts/blackout-agent/hourly-checklist.mjs"], { encoding: "utf8", cwd: repoRoot });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /HOURLY AUTONOMOUS WAKE/);
  assert.match(r.stdout, /ops:collect/);
  assert.match(r.stdout, /Do not prompt the user/);
  assert.match(r.stdout, /pattern scan/);
});

test("discoverStandingWork finds open PRs needing peer review", async () => {
  const { discoverStandingWork } = await import("./select-task.mjs");
  const state = {
    open_prs: [
      { number: 99, title: "fix example", branch: "fix/example", agent: "agent", draft: false, verify: "COMPLETED/SUCCESS" },
      { number: 100, title: "cursor own", branch: "cursor/foo", agent: "cursor", draft: false, verify: "COMPLETED/SUCCESS" },
    ],
    reviews: {},
    deploy: { last_main_sha: "abc", last_deploy_sha: "abc" },
  };
  const found = discoverStandingWork("cursor", state);
  assert.equal(found.length, 1);
  assert.equal(found[0].pr, 99);
  assert.match(found[0].title, /Peer review #99/);
});

test("discoverStandingWork ignores cursor self-review on cursor PRs (HARD MERGE GATE)", async () => {
  const { discoverStandingWork } = await import("./select-task.mjs");
  const state = {
    open_prs: [
      { number: 101, title: "cursor feature", branch: "cursor/foo", agent: "cursor", draft: false, verify: "COMPLETED/SUCCESS" },
    ],
    reviews: {
      "pr-101": { head_sha: "abc", safe_to_merge: true, reviewer: "cursor" },
    },
    deploy: { last_main_sha: "abc", last_deploy_sha: "abc" },
  };
  const found = discoverStandingWork("claude", state);
  assert.equal(found.length, 1);
  assert.equal(found[0].pr, 101);
});

test("discoverStandingWork flags deploy drift", async () => {
  const { discoverStandingWork } = await import("./select-task.mjs");
  const state = {
    open_prs: [],
    reviews: {},
    deploy: { last_main_sha: "abc123", last_deploy_sha: "def456" },
  };
  const found = discoverStandingWork("cursor", state);
  assert.equal(found.length, 1);
  assert.equal(found[0].id, "BO-P1-0101");
});

test("select-task returns highest-priority P1 task for cursor", async () => {
  // select-task.mjs reads WORK_QUEUE.md from a hardcoded absolute path (lib/paths.mjs), not from
  // cwd or an env override — so this test previously ran against whatever the LIVE queue happened
  // to contain. That queue is edited by every autopilot handoff PR, so this assertion (hardcoded
  // to expect a P1 task) broke repeatedly whenever a PR marked all P1 tasks DONE and left only a
  // lower-priority task queued (e.g. #3441, #3447, #3449) — a real, recurring CI failure caused by
  // this test's lack of fixture isolation, not by those PRs' own logic being wrong.
  const { MARKDOWN_FILES } = await import("./lib/paths.mjs");
  const original = readFileSync(MARKDOWN_FILES.workQueue, "utf8");
  try {
    // IDs must match select-task.mjs's parser regex (`BO-P\d+-\d+`) — a descriptive suffix like
    // "BO-TEST-P1-FIXTURE" silently fails to parse and yields zero candidates, not a match failure.
    writeFileSync(
      MARKDOWN_FILES.workQueue,
      "# Work Queue (test fixture)\n\n" +
        "| ID | Pri | Title | Owner | Status |\n" +
        "|----|-----|-------|-------|--------|\n" +
        "| BO-P1-9901 | P1 | fixture task for select-task test | cursor | QUEUED |\n" +
        "| BO-P2-9902 | P2 | lower-priority fixture task | cursor | QUEUED |\n"
    );
    const r = spawnSync("node", ["scripts/blackout-agent/select-task.mjs", "--agent=cursor"], { encoding: "utf8", cwd: repoRoot });
    assert.equal(r.status, 0);
    const j = JSON.parse(r.stdout);
    assert.equal(j.selected?.id, "BO-P1-9901", `expected the fixture's P1 task, got ${j.selected?.id}`);
  } finally {
    writeFileSync(MARKDOWN_FILES.workQueue, original);
  }
});

test("dispatch-guard allows when no active session", () => {
  const r = spawnSync("node", ["scripts/blackout-agent/dispatch-guard.mjs"], { encoding: "utf8", cwd: repoRoot });
  assert.equal(r.status, 0);
  const j = JSON.parse(r.stdout);
  assert.ok("ok" in j);
});

test("dispatch-guard always allows push to main", () => {
  const r = spawnSync("node", ["scripts/blackout-agent/dispatch-guard.mjs"], {
    encoding: "utf8",
    cwd: repoRoot,
    env: { ...process.env, GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/main" },
  });
  assert.equal(r.status, 0);
  const j = JSON.parse(r.stdout);
  assert.equal(j.reason, "main_push_always_dispatch");
});

test("session-start sets heartbeat", () => {
  const r = spawnSync("node", ["scripts/blackout-agent/session-start.mjs", "--agent=cursor"], { encoding: "utf8", cwd: repoRoot });
  assert.equal(r.status, 0);
  const j = JSON.parse(r.stdout);
  assert.ok(j.run_id);
  assert.equal(j.heartbeat.agent, "cursor");
});

test("watchdog runs without error", () => {
  const r = spawnSync("node", ["scripts/blackout-agent/watchdog.mjs"], { encoding: "utf8", cwd: repoRoot });
  assert.equal(r.status, 0);
});

test("agentFromBranch maps lane prefixes for peer review", async () => {
  const { agentFromBranch } = await import("./sync-context.mjs");
  assert.equal(agentFromBranch("claude/fix-foo"), "claude");
  assert.equal(agentFromBranch("cursor/cq-fix-pass-batch1"), "cursor");
  assert.equal(agentFromBranch("fix/polygon-snapshot"), "agent");
  assert.equal(agentFromBranch("feature/human-pr"), "human");
});

test("formatVerifyStatus normalizes GraphQL and REST check shapes", async () => {
  const { formatVerifyStatus } = await import("./sync-context.mjs");
  assert.equal(formatVerifyStatus({ status: "COMPLETED", conclusion: "SUCCESS" }), "COMPLETED/SUCCESS");
  assert.equal(formatVerifyStatus({ status: "IN_PROGRESS", conclusion: null }), "IN_PROGRESS/pending");
  assert.equal(formatVerifyStatus(null), "unknown");
});
