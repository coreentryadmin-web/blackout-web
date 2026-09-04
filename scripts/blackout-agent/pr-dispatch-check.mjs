#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { shouldDispatchDeepReview, classifyBranch, reviewerForBranch } from "./pr-feedback.mjs";

function parseArgs(argv) {
  const out = {
    agent: "cursor",
    pr: Number(process.env.GITHUB_PR_NUMBER ?? 0),
    event: process.env.GITHUB_EVENT_NAME ?? "manual",
  };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--")) {
      const [k, v] = arg.slice(2).split("=");
      out[k.replace(/-/g, "_")] = v ?? true;
    }
  }
  return out;
}

function ghJson(args) {
  const r = spawnSync("gh", args, { encoding: "utf8" });
  if (r.status !== 0) return null;
  return JSON.parse(r.stdout);
}

const args = parseArgs(process.argv);
const pr = Number(args.pr);
if (!pr) {
  console.error(JSON.stringify({ dispatch: false, reason: "no_pr" }));
  process.exit(0);
}

const prData = ghJson(["pr", "view", String(pr), "--json", "headRefOid,headRefName,isDraft,body"]);
// gh pr checks --json only exposes name/state/bucket — not conclusion (CheckRun API field).
const checksRaw = ghJson(["pr", "checks", String(pr), "--json", "name,state,bucket"]);
const checks = Array.isArray(checksRaw) ? checksRaw : checksRaw?.checks ?? [];

const dispatch = shouldDispatchDeepReview({
  event: args.event,
  prData,
  checks,
  agent: classifyBranch(prData?.headRefName, prData),
  reviewingAgent: args.agent,
});

console.log(
  JSON.stringify({
    dispatch,
    pr,
    event: args.event,
    branch: prData?.headRefName,
    builder: classifyBranch(prData?.headRefName, prData),
    reviewer: reviewerForBranch(prData?.headRefName, prData),
    draft: prData?.isDraft,
  })
);
