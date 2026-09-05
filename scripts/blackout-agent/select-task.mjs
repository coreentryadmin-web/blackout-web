#!/usr/bin/env node
/**
 * Select highest-priority non-conflicting task from WORK_QUEUE.md + active locks.
 * When the explicit queue is empty, discover standing work (open PRs, deploy drift).
 */
import { readFileSync, existsSync } from "node:fs";
import { MARKDOWN_FILES } from "./lib/paths.mjs";
import { readLock } from "./lib/locks.mjs";
import { syncContext } from "./sync-context.mjs";
import { acceptPriorReview, classifyBranch, reviewerForBranch } from "./pr-feedback.mjs";

function parseArgs(argv) {
  const out = { agent: process.env.BLACKOUT_AGENT ?? "cursor" };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--")) {
      const [k, v] = arg.slice(2).split("=");
      out[k.replace(/-/g, "_")] = v ?? true;
    }
  }
  return out;
}

const PRI = { P0: 0, P1: 1, P2: 2, P3: 3 };

function parseQueue(md) {
  const rows = [];
  for (const line of md.split("\n")) {
    const m = line.match(/^\|\s*(BO-P\d+-\d+)\s*\|\s*(P\d)\s*\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|/);
    if (!m) continue;
    rows.push({ id: m[1], priority: m[2], title: m[3].trim(), owner: m[4].trim(), status: m[5].trim() });
  }
  return rows.sort((a, b) => PRI[a.priority] - PRI[b.priority]);
}

/** Standing work discovered when explicit queue tasks are all DONE. */
export function discoverStandingWork(agent, state) {
  const discovered = [];
  const reviews = state.reviews ?? {};

  for (const pr of state.open_prs ?? []) {
    if (pr.draft) continue;
    if (pr.verify?.includes("FAILURE")) continue;

    const isOwnPr =
      (agent === "cursor" && (pr.branch?.startsWith("cursor/") || pr.agent === "cursor")) ||
      (agent === "claude" && (pr.branch?.startsWith("claude/") || pr.agent === "claude"));
    if (isOwnPr) continue;

    const reviewKey = `pr-${pr.number}`;
    const branchAgent = pr.agent ?? classifyBranch(pr.branch);
    const peer = reviewerForBranch(pr.branch);
    const reviewed = acceptPriorReview(reviews[reviewKey], branchAgent, peer);
    const verifyGreen = pr.verify?.includes("SUCCESS");
    if (reviewed?.safe_to_merge && verifyGreen) continue;

    discovered.push({
      id: "BO-P1-0100",
      priority: "P1",
      title: `Peer review #${pr.number}: ${pr.title}`,
      owner: agent,
      status: "QUEUED (standing)",
      source: "discover",
      pr: pr.number,
      verify: pr.verify,
    });
  }

  const mainSha = state.deploy?.last_main_sha;
  const deploySha = state.deploy?.last_deploy_sha;
  if (mainSha && deploySha && mainSha !== deploySha) {
    discovered.push({
      id: "BO-P1-0101",
      priority: "P1",
      title: `Deploy verification — main ${mainSha.slice(0, 8)} ahead of deploy ${deploySha.slice(0, 8)}`,
      owner: "unassigned",
      status: "QUEUED (standing)",
      source: "discover",
    });
  }

  return discovered.sort((a, b) => PRI[a.priority] - PRI[b.priority]);
}

function runSelect(args) {
  const { state, activeLocks } = syncContext();

  if (!existsSync(MARKDOWN_FILES.workQueue)) {
    console.log(JSON.stringify({ ok: false, reason: "no_work_queue" }));
    process.exit(1);
  }

  const queue = parseQueue(readFileSync(MARKDOWN_FILES.workQueue, "utf8"));
  const candidates = [];

  for (const item of queue) {
    if (item.status.startsWith("DONE") || item.status.startsWith("CANCELLED")) continue;
    const lock = readLock(item.id) ?? activeLocks[item.id];
    if (lock && Date.parse(lock.lease_until) > Date.now() && lock.owner !== args.agent) {
      continue;
    }
    if (item.owner && item.owner !== args.agent && item.owner !== "unassigned" && item.status === "IN_PROGRESS") {
      const l = readLock(item.id);
      if (l && l.owner !== args.agent && Date.parse(l.lease_until) > Date.now()) continue;
    }
    candidates.push({ ...item, leased: !!lock, lock_owner: lock?.owner ?? null, source: "queue" });
  }

  if (candidates.length === 0) {
    const discovered = discoverStandingWork(args.agent, state);
    for (const item of discovered) {
      const lock = readLock(item.id) ?? activeLocks[item.id];
      if (lock && Date.parse(lock.lease_until) > Date.now() && lock.owner !== args.agent) continue;
      candidates.push({ ...item, leased: !!lock, lock_owner: lock?.owner ?? null });
    }
  }

  const selected = candidates[0] ?? null;
  console.log(
    JSON.stringify(
      { ok: !!selected, agent: args.agent, selected, candidates: candidates.slice(0, 8), discovered: candidates.some((c) => c.source === "discover") },
      null,
      2
    )
  );
  process.exit(selected ? 0 : 3);
}

if (process.argv[1]?.endsWith("select-task.mjs")) {
  runSelect(parseArgs(process.argv));
}
