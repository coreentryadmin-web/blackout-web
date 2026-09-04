#!/usr/bin/env node
/**
 * Build Cursor agent dispatch payload for deep PR peer review.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { reviewerForBranch, classifyBranch, builderLabel } from "./pr-feedback.mjs";

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

const prView = spawnSync(
  "gh",
  ["pr", "view", String(pr), "--json", "headRefName,title,url,isDraft,body,headRefOid"],
  { encoding: "utf8" }
);
const prData = prView.status === 0 ? JSON.parse(prView.stdout) : {};
const branch = prData.headRefName ?? "";
const builder = classifyBranch(branch, prData);
const builderTag = builderLabel(builder);
// reviewerForBranch always returns "claude" or "cursor" now (never null), so a `?? args.agent`
// fallback here was dead code -- CodeQL's "useless conditional" flagged it correctly.
const reviewer = reviewerForBranch(branch, prData);

const bootstrap = spawnSync("node", ["scripts/blackout-agent/dispatch-prompt.mjs", `--agent=${reviewer}`], {
  encoding: "utf8",
  cwd: repoRoot,
});

const mention = builderTag === "claude" ? "@claude" : builderTag === "cursor" ? "@cursor" : "@author";

const extra = `
PR WEBHOOK — MANDATORY PEER REVIEW + DIRECTIVE

Event: ${args.event}
PR: #${pr} ${prData.title ?? ""}
URL: ${prData.url ?? ""}
Branch: ${branch} (builder: ${builder})
HEAD: ${prData.headRefOid?.slice(0, 12) ?? "unknown"}
Your role: ${reviewer} peer reviewer — NOT the implementer.

YOU MUST RESPOND ON THE PR WITH CONCRETE FEEDBACK. Every PR activity gets a response.

MANDATORY STEPS:
1. npm run blackout:session -- --agent=${reviewer}
2. gh pr diff ${pr} — read FULL diff at CURRENT HEAD
3. gh pr checks ${pr} — confirm CI state
4. Post a GitHub PR comment with:
   - **Analysis** — what changed, blast radius, risks
   - **Issues** — bugs, missing tests, policy violations
   - **Fixes** — specific files/lines to change (if any)
   - **Directive to ${mention}** — exactly ONE of:
     - "✅ GO AHEAD MERGE" — green CI, no issues at CURRENT HEAD
     - "🔧 FIX REQUIRED" — list blockers; do NOT merge
     - "⏳ WAIT" — CI pending or draft; say what to wait for
5. Record verdict in shared state:
   - If merge-ready: npm run blackout:review -- --agent=${reviewer} --pr=${pr} --verdict="APPROVED — safe to merge"
   - If not: npm run blackout:review -- --agent=${reviewer} --pr=${pr} --verdict="CHANGES REQUESTED — <summary>"
6. npm run blackout:handoff -- --agent=${reviewer} --summary="Reviewed PR #${pr}: <MERGE|FIX|WAIT>"

Never approve your own PR. Any new commit invalidates prior approval.
Be aggressive — respond to EVERY PR event. Tell ${mention} explicitly to merge or fix.`;

const prompt = `${bootstrap.stdout}\n\n${extra}`;
process.stdout.write(prompt);
