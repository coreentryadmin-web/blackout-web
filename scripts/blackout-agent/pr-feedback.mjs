#!/usr/bin/env node
/**
 * PR webhook handler — triage every PR event and post/update structured feedback.
 *
 * Usage:
 *   GITHUB_EVENT_NAME= pull_request GITHUB_PR_NUMBER=123 node scripts/blackout-agent/pr-feedback.mjs
 *   node scripts/blackout-agent/pr-feedback.mjs --pr=123 --event=synchronize [--dry-run]
 */
import { spawnSync } from "node:child_process";
import { appendEvent, readAgentState, writeAgentState } from "./lib/state.mjs";
import { withStateLock } from "./lib/state-lock.mjs";

function parseArgs(argv) {
  const out = {
    agent: process.env.BLACKOUT_REVIEW_AGENT ?? "cursor",
    dry_run: false,
    event: process.env.GITHUB_EVENT_NAME ?? "manual",
    pr: Number(process.env.GITHUB_PR_NUMBER ?? process.env.PR_NUMBER ?? 0),
  };
  for (const arg of argv.slice(2)) {
    if (arg === "--dry-run") out.dry_run = true;
    else if (arg.startsWith("--")) {
      const [k, v] = arg.slice(2).split("=");
      out[k.replace(/-/g, "_")] = v ?? true;
    }
  }
  if (typeof out.pr === "string") out.pr = Number(out.pr);
  return out;
}

function ghJson(args) {
  const r = spawnSync("gh", args, { encoding: "utf8" });
  if (r.status !== 0) return null;
  try {
    return JSON.parse(r.stdout || "null");
  } catch {
    return null;
  }
}

function ghRun(args) {
  const r = spawnSync("gh", args, { encoding: "utf8" });
  return { ok: r.status === 0, stdout: r.stdout, stderr: r.stderr, status: r.status };
}

export function classifyBranch(headRef) {
  if (!headRef) return "human";
  if (headRef.startsWith("cursor/")) return "cursor";
  if (headRef.startsWith("claude/")) return "claude";
  if (headRef.startsWith("fix/")) return "agent";
  if (headRef.startsWith("dependabot/")) return "dependabot";
  return "human";
}

export function reviewerForBranch(headRef) {
  const who = classifyBranch(headRef);
  if (who === "claude" || who === "agent") return "cursor";
  if (who === "cursor") return "claude";
  return null;
}

export function isOwnPr(agent, headRef) {
  if (agent === "cursor") return headRef?.startsWith("cursor/");
  if (agent === "claude") return headRef?.startsWith("claude/");
  return false;
}

export function markerFor(pr, headSha) {
  return `<!-- blackout-pr-webhook:pr-${pr}:head-${headSha?.slice(0, 12) ?? "unknown"} -->`;
}

export function buildFeedback({ pr, event, prData, checks, priorReview }) {
  const head = prData.headRefOid;
  const branch = prData.headRefName;
  const author = prData.author?.login ?? "unknown";
  const agent = classifyBranch(branch);
  const peer = reviewerForBranch(branch);
  const verify = checks.find((c) => c.name === "verify");
  const verifyLine = verify ? `${verify.state}/${verify.conclusion ?? "pending"}` : "unknown";
  const draft = prData.isDraft;
  const files = prData.files?.length ?? 0;
  const additions = prData.additions ?? 0;
  const deletions = prData.deletions ?? 0;

  const issues = [];
  const ok = [];

  if (draft) issues.push("PR is **draft** — peer review queue skips drafts until marked ready.");
  else ok.push("PR is **ready for review** (not draft).");

  if (verify?.conclusion === "success") ok.push("`verify` CI is **green**.");
  else if (verify?.conclusion === "failure") issues.push("`verify` CI **failed** — do not merge.");
  else issues.push("`verify` CI **pending or missing** — wait before approving.");

  if (agent === "dependabot") issues.push("Dependabot PR — manual major-version policy applies.");
  if (peer) ok.push(`Peer reviewer: **${peer}** (builder: ${agent}).`);
  if (priorReview?.head_sha === head && priorReview?.safe_to_merge) {
    ok.push(`Recorded review at this HEAD: **${priorReview.verdict}**.`);
  } else if (priorReview && priorReview.head_sha !== head) {
    issues.push(`HEAD changed since last review (\`${priorReview.head_sha?.slice(0, 7)}\` → \`${head?.slice(0, 7)}\`) — **re-review required**.`);
  } else if (peer && !draft && verify?.conclusion === "success") {
    issues.push(`**Peer review pending** from ${peer} at CURRENT HEAD.`);
  }

  const docsOnly =
    Array.isArray(prData.files) &&
    prData.files.length > 0 &&
    prData.files.every((f) => f.path.startsWith("docs/") || f.path.endsWith(".md"));
  if (docsOnly) issues.push("Docs-only diff — automerge policy may skip (by design).");

  let verdict = "👀 **TRIAGE** — needs attention";
  if (issues.length === 0 && verify?.conclusion === "success" && priorReview?.safe_to_merge) {
    verdict = "✅ **LOOKS GOOD** — green CI + peer approval at current HEAD";
  } else if (verify?.conclusion === "failure") {
    verdict = "❌ **BLOCKED** — fix CI first";
  } else if (issues.some((i) => i.includes("Peer review pending"))) {
    verdict = "🔄 **AWAITING PEER REVIEW**";
  }

  const body = `${markerFor(pr, head)}
## BLACKOUT Autopilot — PR feedback

**Event:** \`${event}\` · **PR:** #${pr} · **HEAD:** \`${head?.slice(0, 12)}\`
**Branch:** \`${branch}\` · **Author:** @${author} · **Builder:** ${agent}
**Stats:** ${files} files (+${additions}/-${deletions})

### Verdict
${verdict}

### ✅ OK
${ok.length ? ok.map((l) => `- ${l}`).join("\n") : "- _none yet_"}

### ⚠️ Notes
${issues.length ? issues.map((l) => `- ${l}`).join("\n") : "- _none_"}

---
_Autopilot webhook · updated ${new Date().toISOString()}_`;

  return { body, head, agent, peer, verdict, verifyLine, issues, ok };
}

export function shouldDispatchDeepReview({ event, prData, checks, agent, reviewingAgent }) {
  if (isOwnPr(reviewingAgent, prData.headRefName)) return false;
  if (prData.isDraft) return false;
  if (classifyBranch(prData.headRefName) === "dependabot") return false;
  const verify = checks.find((c) => c.name === "verify");
  const peer = reviewerForBranch(prData.headRefName);
  if (peer !== reviewingAgent) return false;

  const deepEvents = new Set([
    "opened",
    "reopened",
    "ready_for_review",
    "synchronize",
    "submitted",
    "workflow_dispatch",
  ]);
  if (!deepEvents.has(event)) return false;

  // Deep review when verify is green (or just turned green on synchronize)
  if (verify?.conclusion === "success") return true;
  if (event === "opened" || event === "ready_for_review") return true;
  return false;
}

function findExistingComment(pr, headSha) {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) return null;
  const [owner, name] = repo.split("/");
  const comments = ghJson(["api", `repos/${owner}/${name}/issues/${pr}/comments`, "--paginate"]);
  if (!Array.isArray(comments)) return null;
  const short = headSha?.slice(0, 12);
  return (
    comments.find((c) => typeof c.body === "string" && c.body.includes(`blackout-pr-webhook:pr-${pr}:head-${short}`)) ??
    null
  );
}

function postOrUpdateComment(pr, body, headSha, dryRun) {
  if (dryRun) return { action: "dry_run", body_preview: body.slice(0, 200) };

  const existing = findExistingComment(pr, headSha);
  const repo = process.env.GITHUB_REPOSITORY;
  const [owner, name] = repo.split("/");

  if (existing?.id) {
    const r = ghRun([
      "api",
      "-X",
      "PATCH",
      `repos/${owner}/${name}/issues/comments/${existing.id}`,
      "-f",
      `body=${body}`,
    ]);
    return { action: "updated", comment_id: existing.id, ok: r.ok };
  }

  const r = ghRun(["pr", "comment", String(pr), "--repo", repo, "--body", body]);
  return { action: "created", ok: r.ok, stderr: r.stderr };
}

export function handlePrWebhook(opts) {
  const pr = Number(opts.pr);
  if (!pr) throw new Error("PR number required");

  const prData = ghJson([
    "pr",
    "view",
    String(pr),
    "--json",
    "number,title,headRefOid,headRefName,author,isDraft,additions,deletions,files,state,url",
  ]);
  if (!prData) throw new Error(`Could not load PR #${pr}`);

  const checks = ghJson(["pr", "checks", String(pr), "--json", "name,state,conclusion,bucket"]) ?? [];
  const checkList = Array.isArray(checks) ? checks : checks.checks ?? [];

  const state = readAgentState();
  const priorReview = state.reviews?.[`pr-${pr}`] ?? null;

  const feedback = buildFeedback({
    pr,
    event: opts.event,
    prData,
    checks: checkList,
    priorReview,
  });

  const commentResult = postOrUpdateComment(pr, feedback.body, feedback.head, opts.dry_run);

  const dispatch = shouldDispatchDeepReview({
    event: opts.event,
    prData,
    checks: checkList,
    agent: feedback.agent,
    reviewingAgent: opts.agent,
  });

  if (!opts.dry_run) {
    withStateLock(() => {
      const s = readAgentState();
      s.pr_activity = s.pr_activity ?? {};
      s.pr_activity[`pr-${pr}`] = {
        last_event: opts.event,
        last_head: feedback.head,
        last_feedback_at: new Date().toISOString(),
        verdict: feedback.verdict,
        comment_action: commentResult.action,
      };
      appendEvent(s, {
        type: "pr_webhook",
        pr,
        event: opts.event,
        head: feedback.head,
        verdict: feedback.verdict,
        dispatch,
      });
      writeAgentState(s);
      return s;
    }, { owner: opts.agent });
  }

  return { feedback, commentResult, dispatch, prData };
}

if (process.argv[1]?.endsWith("pr-feedback.mjs")) {
  const args = parseArgs(process.argv);
  try {
    const result = handlePrWebhook(args);
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    process.exit(0);
  } catch (e) {
    console.error(JSON.stringify({ ok: false, error: String(e?.message ?? e) }, null, 2));
    process.exit(1);
  }
}
