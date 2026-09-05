#!/usr/bin/env node
/**
 * PR webhook handler — triage every PR event and post/update structured feedback.
 *
 * Usage:
 *   GITHUB_EVENT_NAME=opened GITHUB_PR_NUMBER=123 node scripts/blackout-agent/pr-feedback.mjs
 *   node scripts/blackout-agent/pr-feedback.mjs --pr=123 --event=synchronize [--dry-run]
 */
import { spawnSync } from "node:child_process";
import { appendEvent, readAgentState, writeAgentState } from "./lib/state.mjs";
import { withStateLock } from "./lib/state-lock.mjs";

function parseArgs(argv) {
  const out = {
    agent: process.env.BLACKOUT_REVIEW_AGENT ?? "cursor",
    dry_run: false,
    lenient: false,
    event: process.env.GITHUB_EVENT_NAME ?? "manual",
    pr: Number(process.env.GITHUB_PR_NUMBER ?? process.env.PR_NUMBER ?? 0),
  };
  for (const arg of argv.slice(2)) {
    if (arg === "--dry-run") out.dry_run = true;
    else if (arg === "--lenient") out.lenient = true;
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

/** GITHUB_REPOSITORY is set in Actions; local agents resolve via gh. */
export function resolveGithubRepo() {
  const env = process.env.GITHUB_REPOSITORY?.trim();
  if (env) return env;
  return ghJson(["repo", "view", "--json", "nameWithOwner"])?.nameWithOwner ?? null;
}

const CLAUDE_BODY_MARKERS = [/generated with \[claude code\]/i, /claude\.ai\/code\/session/i];
const CURSOR_TEXT_MARKERS = [/cursor agent/i];
// Exact hostnames a PR body's own links are checked against -- never a bare substring regex on
// the raw body text. `cursor.com/agents` as an unanchored regex matches ANYWHERE, including
// inside a different, unrelated host (e.g. `https://evil.example/cursor.com/agents` or
// `https://cursor.com.attacker.net/agents`), so a crafted PR body could spoof which agent this
// classifies as the builder. Same discipline api-tracked-fetch.ts uses for the identical class
// of problem: parse candidate URLs out of the body and check the ACTUAL parsed hostname.
const CURSOR_URL_HOSTS = new Set(["cursor.com"]);

function bodyLinksToHost(body, hosts) {
  const urls = body.match(/https?:\/\/[^\s)>"']+/g) ?? [];
  return urls.some((u) => {
    try {
      return hosts.has(new URL(u).hostname);
    } catch {
      return false;
    }
  });
}

const SENSITIVE_PATH_RE = /(auth|payment|billing|stripe|whop|clerk|password|secret|token|0dte|gex|nighthawk)/i;
const WORKFLOW_PATH_RE = /^\.github\/workflows\//;

export function detectBuilderFromBody(body) {
  if (!body || typeof body !== "string") return null;
  if (CLAUDE_BODY_MARKERS.some((re) => re.test(body))) return "claude";
  if (CURSOR_TEXT_MARKERS.some((re) => re.test(body)) || bodyLinksToHost(body, CURSOR_URL_HOSTS)) return "cursor";
  return null;
}

export function classifyBranch(headRef, prData = null) {
  if (!headRef) return detectBuilderFromBody(prData?.body) ?? "human";
  if (headRef.startsWith("cursor/")) return "cursor";
  if (headRef.startsWith("claude/")) return "claude";
  if (headRef.startsWith("fix/")) return "agent";
  if (headRef.startsWith("docs/")) return "agent";
  if (headRef.startsWith("dependabot/")) return "dependabot";
  return detectBuilderFromBody(prData?.body) ?? "human";
}

/** Cursor reviews all non-cursor PRs; Claude reviews cursor PRs. */
export function reviewerForBranch(headRef, prData = null) {
  const who = classifyBranch(headRef, prData);
  if (who === "cursor") return "claude";
  return "cursor";
}

/**
 * HARD MERGE GATE — only the assigned peer reviewer's AGENT_STATE record counts.
 * Cursor self-approvals on cursor/* PRs (and Claude on claude/*) must not yield MERGE.
 */
export function acceptPriorReview(priorReview, agent, peer) {
  if (!priorReview) return null;
  const reviewer = priorReview.reviewer;
  if (reviewer && reviewer !== peer) return null;
  if (agent === "cursor" && reviewer === "cursor") return null;
  if (agent === "claude" && reviewer === "claude") return null;
  return priorReview;
}

export function builderLabel(agent) {
  if (agent === "claude" || agent === "agent") return "claude";
  if (agent === "cursor") return "cursor";
  return "author";
}

export function isOwnPr(agent, headRef) {
  if (agent === "cursor") return headRef?.startsWith("cursor/");
  if (agent === "claude") return headRef?.startsWith("claude/");
  return false;
}

export function markerFor(pr, headSha) {
  return `<!-- blackout-pr-webhook:pr-${pr}:head-${headSha?.slice(0, 12) ?? "unknown"} -->`;
}

export function analyzeDiff(files) {
  const paths = (files ?? []).map((f) => f.path);
  const categories = { src: 0, docs: 0, tests: 0, workflows: 0, scripts: 0, other: 0 };
  const risks = [];
  const highlights = [];

  for (const p of paths) {
    if (p.startsWith("src/")) categories.src++;
    else if (p.startsWith("docs/") || p.endsWith(".md")) categories.docs++;
    else if (/test|spec|__tests__/.test(p)) categories.tests++;
    else if (WORKFLOW_PATH_RE.test(p)) {
      categories.workflows++;
      risks.push(`Workflow change: \`${p}\``);
    } else if (p.startsWith("scripts/")) categories.scripts++;
    else categories.other++;

    if (SENSITIVE_PATH_RE.test(p)) risks.push(`Sensitive lane: \`${p}\``);
    if (p.startsWith("src/lib/largo/") || p.startsWith("src/features/")) {
      highlights.push(`Trading lane: \`${p}\``);
    }
  }

  const docsOnly =
    paths.length > 0 && paths.every((p) => p.startsWith("docs/") || p.endsWith(".md"));

  return { paths, categories, risks: [...new Set(risks)], highlights: [...new Set(highlights)].slice(0, 8), docsOnly };
}

/** Valid `gh pr checks --json` fields (no `conclusion` — gh CLI rejects it). */
export const GH_PR_CHECKS_JSON_FIELDS = "name,state,bucket";

/** Normalize gh `pr checks --json` (state/bucket) and CheckRun API (conclusion) shapes. */
export function checkConclusion(check) {
  if (!check) return null;
  const raw = check.conclusion ?? check.state ?? check.bucket ?? "";
  const v = String(raw).toLowerCase();
  if (v === "success" || v === "pass") return "success";
  if (v === "failure" || v === "fail") return "failure";
  if (v === "cancelled" || v === "canceled") return "cancelled";
  if (v === "skipped" || v === "skipping" || v === "neutral") return "skipped";
  if (v === "pending" || v === "in_progress" || v === "queued") return "pending";
  return v || null;
}

export function summarizeChecks(checks) {
  const list = Array.isArray(checks) ? checks : checks?.checks ?? [];
  const normalized = list.map((c) => ({ ...c, conclusion: checkConclusion(c) }));
  const verify = normalized.find((c) => c.name === "verify");
  const failed = normalized.filter((c) => c.conclusion === "failure" || c.conclusion === "cancelled");
  const pending = normalized.filter((c) => c.conclusion === "pending");
  return { verify, failed, pending, total: normalized.length };
}

export function deriveDirective({ agent, draft, verify, priorReview, head, issues, analysis, peer }) {
  const builder = builderLabel(agent);
  const mention = builder === "claude" ? "@claude" : builder === "cursor" ? "@cursor" : "@author";
  const effectiveReview = acceptPriorReview(priorReview, agent, peer ?? reviewerForBranch(agent === "cursor" ? "cursor/x" : "claude/x"));

  if (draft) {
    return {
      action: "WAIT",
      headline: "⏸️ **WAIT** — still draft",
      instruction: `${mention} finish work, then mark **Ready for review**. Autopilot will re-triage immediately.`,
    };
  }

  if (verify?.conclusion === "failure") {
    return {
      action: "FIX",
      headline: "🔧 **FIX** — CI is red",
      instruction: `${mention} **do not merge**. Fix failing checks, push, and wait for green \`verify\`.`,
    };
  }

  if (!verify || verify.conclusion !== "success") {
    return {
      action: "WAIT",
      headline: "⏳ **WAIT** — CI pending",
      instruction: `${mention} hold — \`verify\` still running. Autopilot will update when CI completes.`,
    };
  }

  if (effectiveReview?.head_sha === head && effectiveReview?.safe_to_merge) {
    return {
      action: "MERGE",
      headline: "✅ **MERGE** — approved at current HEAD",
      instruction: `${mention} **go ahead and merge** (or enable auto-merge). Green CI + peer approval at this HEAD.`,
    };
  }

  if (effectiveReview && effectiveReview.head_sha !== head) {
    return {
      action: "REVIEW",
      headline: "🔄 **REVIEW** — HEAD changed since last approval",
      instruction: `${mention} wait for peer re-review at new HEAD before merging.`,
    };
  }

  if (analysis.docsOnly && issues.length === 0 && agent !== "cursor") {
    return {
      action: "MERGE",
      headline: "✅ **MERGE** — docs-only, green CI",
      instruction: `${mention} **go ahead and merge** — docs-only change with green \`verify\`, low risk.`,
    };
  }

  if (issues.some((i) => i.includes("Peer review pending") || i.includes("re-review"))) {
    return {
      action: "REVIEW",
      headline: "👀 **REVIEW** — peer sign-off required",
      instruction: `${mention} wait for peer review. Cursor will post MERGE or FIX after reading the full diff.`,
    };
  }

  return {
    action: "REVIEW",
    headline: "👀 **REVIEW** — CI green, needs peer sign-off",
    instruction: `${mention} CI is green. Peer reviewer analyzing diff — will reply MERGE or FIX shortly.`,
  };
}

export function buildFeedback({ pr, event, prData, checks, priorReview }) {
  const head = prData.headRefOid;
  const branch = prData.headRefName;
  const author = prData.author?.login ?? "unknown";
  const agent = classifyBranch(branch, prData);
  const peer = reviewerForBranch(branch, prData);
  const checkSummary = summarizeChecks(checks);
  const verify = checkSummary.verify;
  const draft = prData.isDraft;
  const files = prData.files ?? [];
  const additions = prData.additions ?? 0;
  const deletions = prData.deletions ?? 0;
  const analysis = analyzeDiff(files);

  const issues = [];
  const ok = [];
  const fixes = [];

  if (draft) issues.push("PR is **draft** — merge blocked until marked ready.");
  else ok.push("PR is **ready for review** (not draft).");

  if (verify?.conclusion === "success") ok.push("`verify` CI is **green**.");
  else if (verify?.conclusion === "failure") {
    issues.push("`verify` CI **failed** — merge blocked.");
    fixes.push("Fix failing `verify` job — run `gh pr checks` and read logs.");
  } else issues.push("`verify` CI **pending** — wait before merging.");

  for (const f of checkSummary.failed) {
    if (f.name === "verify") continue;
    issues.push(`Check **${f.name}** failed.`);
    fixes.push(`Investigate \`${f.name}\` check failure.`);
  }

  if (agent === "dependabot") issues.push("Dependabot PR — manual major-version policy applies.");
  ok.push(`Peer reviewer: **${peer}** (builder: ${agent}).`);

  const effectiveReview = acceptPriorReview(priorReview, agent, peer);

  if (effectiveReview?.head_sha === head && effectiveReview?.safe_to_merge) {
    ok.push(`Peer review at this HEAD: **${effectiveReview.verdict}**.`);
  } else if (priorReview?.head_sha === head && priorReview?.safe_to_merge && priorReview?.reviewer === agent) {
    issues.push(`**Self-review ignored** — ${peer} GitHub/AGENT_STATE approval required (HARD MERGE GATE).`);
  } else if (effectiveReview && effectiveReview.head_sha !== head) {
    issues.push(
      `HEAD changed since last review (\`${priorReview.head_sha?.slice(0, 7)}\` → \`${head?.slice(0, 7)}\`) — **re-review required**.`
    );
    fixes.push("Request fresh peer review after new commits.");
  } else if (!draft && verify?.conclusion === "success") {
    issues.push(`**Peer review pending** from ${peer} at CURRENT HEAD.`);
  }

  if (analysis.docsOnly) ok.push("Docs-only diff — low blast radius.");
  if (analysis.risks.length) {
    for (const r of analysis.risks) issues.push(`Risk: ${r}`);
  }

  const directive = deriveDirective({ agent, draft, verify, priorReview, head, issues, analysis, peer });

  let verdict = directive.headline;
  if (directive.action === "FIX") verdict = "❌ **BLOCKED** — fix CI first";
  else if (directive.action === "MERGE") verdict = directive.headline;

  const catLine = Object.entries(analysis.categories)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k}:${n}`)
    .join(", ");

  const fileList =
    analysis.paths.length > 0
      ? analysis.paths
          .slice(0, 12)
          .map((p) => `- \`${p}\``)
          .join("\n") + (analysis.paths.length > 12 ? `\n- _…and ${analysis.paths.length - 12} more_` : "")
      : "- _no files listed_";

  const body = `${markerFor(pr, head)}
## BLACKOUT Autopilot — PR feedback

**Event:** \`${event}\` · **PR:** #${pr} · **HEAD:** \`${head?.slice(0, 12)}\`
**Title:** ${prData.title ?? "(no title)"}
**Branch:** \`${branch}\` · **Author:** @${author} · **Builder:** ${agent}
**Stats:** ${files.length} files (+${additions}/-${deletions}) · **Areas:** ${catLine || "n/a"}

### Directive
${directive.headline}

> ${directive.instruction}

### Analysis
${analysis.highlights.length ? analysis.highlights.map((h) => `- ${h}`).join("\n") : "- _No high-signal lane changes detected._"}
${analysis.risks.length ? `\n**Risks flagged:**\n${analysis.risks.map((r) => `- ${r}`).join("\n")}` : ""}

### Files touched
${fileList}

### CI
- \`verify\`: ${verify ? `${verify.state ?? "unknown"}/${verify.conclusion ?? "pending"}` : "missing"}
${checkSummary.failed.length ? `- **Failed:** ${checkSummary.failed.map((c) => c.name).join(", ")}` : "- No failed checks (besides verify)."}
${checkSummary.pending.length ? `- **Pending:** ${checkSummary.pending.slice(0, 5).map((c) => c.name).join(", ")}${checkSummary.pending.length > 5 ? "…" : ""}` : ""}

### ✅ OK
${ok.length ? ok.map((l) => `- ${l}`).join("\n") : "- _none yet_"}

### ⚠️ Issues
${issues.length ? issues.map((l) => `- ${l}`).join("\n") : "- _none_"}

### 🔧 Fixes needed
${fixes.length ? fixes.map((l) => `- ${l}`).join("\n") : "- _none — awaiting peer review or merge_"}

---
_Autopilot webhook · ${directive.action} · updated ${new Date().toISOString()}_`;

  return { body, head, agent, peer, verdict, directive, analysis, issues, ok, fixes };
}

const DISPATCH_EVENTS = new Set([
  "opened",
  "reopened",
  "ready_for_review",
  "synchronize",
  "edited",
  "submitted",
  "dismissed",
  "issue_comment",
  "workflow_dispatch",
  "ci_completed",
  "sweep",
  "converted_to_draft",
]);

export function shouldDispatchDeepReview({ event, prData, checks, agent, reviewingAgent }) {
  if (isOwnPr(reviewingAgent, prData.headRefName)) return false;
  if (classifyBranch(prData.headRefName, prData) === "dependabot") return false;

  const peer = reviewerForBranch(prData.headRefName, prData);
  if (peer !== reviewingAgent) return false;
  if (!DISPATCH_EVENTS.has(event)) return false;

  const { verify, failed } = summarizeChecks(checks);

  // Always dispatch on new activity — agent reads diff and posts MERGE or FIX.
  if (event === "opened" || event === "reopened" || event === "ready_for_review") return true;
  if (event === "synchronize" || event === "ci_completed") return true;
  if (verify?.conclusion === "success") return true;
  if (failed.length > 0) return true;

  return true;
}

function findExistingComment(pr, headSha) {
  const repo = resolveGithubRepo();
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
  const repo = resolveGithubRepo();
  if (!repo) return { action: "skipped", ok: false, error: "GITHUB_REPOSITORY unavailable" };
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
    "number,title,headRefOid,headRefName,author,isDraft,additions,deletions,files,state,url,body",
  ]);
  if (!prData) throw new Error(`Could not load PR #${pr}`);

  const checks = ghJson(["pr", "checks", String(pr), "--json", GH_PR_CHECKS_JSON_FIELDS]) ?? [];
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
        directive: feedback.directive?.action,
        comment_action: commentResult.action,
      };
      appendEvent(s, {
        type: "pr_webhook",
        pr,
        event: opts.event,
        head: feedback.head,
        verdict: feedback.verdict,
        directive: feedback.directive?.action,
        dispatch,
      });
      writeAgentState(s);
      return s;
    }, { owner: opts.agent });
  }

  return { feedback, commentResult, dispatch, prData };
}

export function sweepOpenPrs(opts = {}) {
  const agent = opts.agent ?? "cursor";
  const dryRun = opts.dry_run ?? false;
  const prs = ghJson(["pr", "list", "--state", "open", "--limit", "40", "--json", "number,headRefName,isDraft"]);
  const results = [];
  for (const pr of prs ?? []) {
    try {
      results.push({
        pr: pr.number,
        ...handlePrWebhook({ pr: pr.number, event: "sweep", agent, dry_run: dryRun }),
      });
    } catch (e) {
      results.push({ pr: pr.number, ok: false, error: String(e?.message ?? e) });
    }
  }
  return results;
}

if (process.argv[1]?.endsWith("pr-feedback.mjs")) {
  const args = parseArgs(process.argv);
  try {
    const result = args.sweep ? sweepOpenPrs(args) : handlePrWebhook(args);
    console.log(JSON.stringify({ ok: true, result }, null, 2));
    process.exit(0);
  } catch (e) {
    console.error(JSON.stringify({ ok: false, error: String(e?.message ?? e) }, null, 2));
    process.exit(args.lenient ? 0 : 1);
  }
}
