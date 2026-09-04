#!/usr/bin/env node
/**
 * Record PR review state with HEAD sha (approval invalidates on new commits).
 *
 * Usage:
 *   node scripts/blackout-agent/record-review.mjs --agent=cursor --pr=3431 --head=abc123 --verdict=APPROVED
 */
import { spawnSync } from "node:child_process";
import { appendEvent, readAgentState, writeAgentState } from "./lib/state.mjs";
import { withStateLock } from "./lib/state-lock.mjs";

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

const args = parseArgs(process.argv);
const pr = Number(args.pr);
if (!pr) {
  console.error("Usage: record-review.mjs --pr=123 --head=<sha> --verdict=APPROVED|CHANGES_REQUESTED");
  process.exit(1);
}

let head = args.head ?? null;
let headBranch = args.branch ?? null;
if (!head || !headBranch) {
  const r = spawnSync("gh", ["pr", "view", String(pr), "--json", "headRefOid,headRefName,author"], { encoding: "utf8" });
  if (r.status === 0) {
    const j = JSON.parse(r.stdout);
    head = head ?? j.headRefOid;
    headBranch = headBranch ?? j.headRefName;
    const author = j.author?.login ?? "";
    if (author.includes(args.agent)) {
      console.error(JSON.stringify({ ok: false, reason: "cannot_review_own_pr" }));
      process.exit(2);
    }
    if (args.agent === "cursor" && headBranch?.startsWith("cursor/")) {
      console.error(JSON.stringify({ ok: false, reason: "cannot_review_own_pr", branch: headBranch }));
      process.exit(2);
    }
    if (args.agent === "claude" && headBranch?.startsWith("claude/")) {
      console.error(JSON.stringify({ ok: false, reason: "cannot_review_own_pr", branch: headBranch }));
      process.exit(2);
    }
  }
}

const verdict = args.verdict ?? "REVIEWED";
const key = `pr-${pr}`;
const entry = {
  pr,
  head_sha: head,
  reviewer: args.agent,
  verdict,
  reviewed_at: new Date().toISOString(),
  safe_to_merge: verdict === "APPROVED" || verdict === "APPROVED — safe to merge",
};

const locked = withStateLock(() => {
  const state = readAgentState();
  state.reviews[key] = entry;
  appendEvent(state, { type: "pr_review", ...entry });
  writeAgentState(state);
  return entry;
}, { owner: args.agent });

if (!locked.ok) {
  console.error(JSON.stringify(locked, null, 2));
  process.exit(2);
}

console.log(JSON.stringify({ ok: true, review: locked.result }, null, 2));
