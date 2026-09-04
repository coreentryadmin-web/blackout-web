#!/usr/bin/env node
/**
 * Build Cursor agent dispatch payload for deep PR peer review.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { reviewerForBranch, classifyBranch } from "./pr-feedback.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

function parseArgs(argv) {
  const out = {
    pr: Number(process.env.GITHUB_PR_NUMBER ?? 0),
    event: process.env.GITHUB_EVENT_NAME ?? "manual",
    agent: "cursor",
  };
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
  console.error("Usage: pr-review-dispatch.mjs --pr=123 --event=synchronize");
  process.exit(1);
}

const prView = spawnSync("gh", ["pr", "view", String(pr), "--json", "headRefName,title,url,isDraft"], {
  encoding: "utf8",
});
const prData = prView.status === 0 ? JSON.parse(prView.stdout) : {};
const branch = prData.headRefName ?? "";
const builder = classifyBranch(branch);
const reviewer = reviewerForBranch(branch) ?? args.agent;

const bootstrap = spawnSync("node", ["scripts/blackout-agent/dispatch-prompt.mjs", `--agent=${reviewer}`], {
  encoding: "utf8",
  cwd: repoRoot,
});

const extra = `
PR WEBHOOK — DEEP PEER REVIEW REQUIRED

Event: ${args.event}
PR: #${pr} ${prData.title ?? ""}
URL: ${prData.url ?? ""}
Branch: ${branch} (builder: ${builder})
Your role: ${reviewer} peer reviewer — NOT the implementer.

MANDATORY STEPS:
1. npm run blackout:session -- --agent=${reviewer}
2. gh pr diff ${pr} — read FULL diff at CURRENT HEAD
3. gh pr checks ${pr} — confirm CI state
4. Post a GitHub PR comment with concrete feedback (issues + what looks good)
5. If genuinely satisfied at CURRENT HEAD:
   npm run blackout:review -- --agent=${reviewer} --pr=${pr} --verdict="APPROVED — safe to merge"
   and comment: APPROVED — safe to merge
6. If issues found: comment CHANGES REQUESTED with specifics; do NOT approve
7. npm run blackout:handoff -- --agent=${reviewer} --summary="Reviewed PR #${pr}"

Never approve your own PR. Any new commit invalidates prior approval.`;

const prompt = `${bootstrap.stdout}\n\n${extra}`;
process.stdout.write(prompt);
