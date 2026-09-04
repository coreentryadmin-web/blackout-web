import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyBranch,
  reviewerForBranch,
  isOwnPr,
  buildFeedback,
  shouldDispatchDeepReview,
  markerFor,
  analyzeDiff,
  deriveDirective,
  summarizeChecks,
  resolveGithubRepo,
} from "./pr-feedback.mjs";

test("classifyBranch", () => {
  assert.equal(classifyBranch("cursor/foo"), "cursor");
  assert.equal(classifyBranch("claude/bar"), "claude");
  assert.equal(classifyBranch("fix/baz"), "agent");
  assert.equal(classifyBranch("docs/thermal-stubs"), "agent");
  assert.equal(classifyBranch("dependabot/npm"), "dependabot");
  assert.equal(
    classifyBranch("feature/foo", { body: "Generated with [Claude Code](https://claude.com/claude-code)" }),
    "claude"
  );
});

test("reviewerForBranch — cursor reviews all non-cursor PRs", () => {
  assert.equal(reviewerForBranch("claude/x"), "cursor");
  assert.equal(reviewerForBranch("cursor/x"), "claude");
  assert.equal(reviewerForBranch("fix/x"), "cursor");
  assert.equal(reviewerForBranch("docs/x"), "cursor");
  assert.equal(reviewerForBranch("feature/human"), "cursor");
});

test("isOwnPr blocks self-review", () => {
  assert.equal(isOwnPr("cursor", "cursor/foo"), true);
  assert.equal(isOwnPr("cursor", "claude/foo"), false);
});

test("analyzeDiff flags risks and docs-only", () => {
  const a = analyzeDiff([
    { path: "docs/foo.md" },
    { path: "docs/bar.md" },
  ]);
  assert.equal(a.docsOnly, true);

  const b = analyzeDiff([{ path: ".github/workflows/ci.yml" }, { path: "src/lib/auth/foo.ts" }]);
  assert.ok(b.risks.some((r) => r.includes("Workflow")));
  assert.ok(b.risks.some((r) => r.includes("Sensitive")));
});

test("deriveDirective says FIX on red CI", () => {
  const d = deriveDirective({
    agent: "claude",
    draft: false,
    verify: { conclusion: "failure" },
    priorReview: null,
    head: "abc",
    issues: [],
    analysis: { docsOnly: false },
  });
  assert.equal(d.action, "FIX");
  assert.match(d.instruction, /@claude/);
  assert.match(d.instruction, /do not merge/i);
});

test("deriveDirective says MERGE when approved at HEAD", () => {
  const d = deriveDirective({
    agent: "claude",
    draft: false,
    verify: { conclusion: "success" },
    priorReview: { head_sha: "abc123", safe_to_merge: true },
    head: "abc123",
    issues: [],
    analysis: { docsOnly: false },
  });
  assert.equal(d.action, "MERGE");
  assert.match(d.instruction, /go ahead/i);
});

test("buildFeedback includes directive and analysis", () => {
  const { body, directive } = buildFeedback({
    pr: 99,
    event: "synchronize",
    prData: {
      title: "fix: test",
      headRefOid: "abc123def456",
      headRefName: "claude/test",
      author: { login: "bot" },
      isDraft: false,
      files: [{ path: "src/foo.ts" }],
      additions: 10,
      deletions: 2,
    },
    checks: [{ name: "verify", state: "COMPLETED", conclusion: "success" }],
    priorReview: null,
  });
  assert.match(body, /blackout-pr-webhook:pr-99/);
  assert.match(body, /### Directive/);
  assert.match(body, /### Analysis/);
  assert.ok(directive);
});

test("shouldDispatchDeepReview for claude PR", () => {
  const prData = { headRefName: "claude/test", isDraft: false };
  const checks = [{ name: "verify", conclusion: "success" }];
  assert.equal(
    shouldDispatchDeepReview({ event: "synchronize", prData, checks, agent: "claude", reviewingAgent: "cursor" }),
    true
  );
  assert.equal(
    shouldDispatchDeepReview({ event: "synchronize", prData, checks, agent: "claude", reviewingAgent: "claude" }),
    false
  );
});

test("shouldDispatchDeepReview includes drafts", () => {
  assert.equal(
    shouldDispatchDeepReview({
      event: "opened",
      prData: { headRefName: "claude/x", isDraft: true },
      checks: [],
      agent: "claude",
      reviewingAgent: "cursor",
    }),
    true
  );
});

test("shouldDispatchDeepReview for human PRs", () => {
  assert.equal(
    shouldDispatchDeepReview({
      event: "opened",
      prData: { headRefName: "feature/foo", isDraft: false },
      checks: [],
      agent: "human",
      reviewingAgent: "cursor",
    }),
    true
  );
});

test("markerFor is stable per head", () => {
  assert.match(markerFor(1, "abcdef123456"), /head-abcdef123456/);
});

test("summarizeChecks finds failures", () => {
  const s = summarizeChecks([
    { name: "verify", conclusion: "failure" },
    { name: "lint", conclusion: "success" },
  ]);
  assert.equal(s.failed.length, 1);
  assert.equal(s.verify.conclusion, "failure");
});

test("resolveGithubRepo falls back to gh when env unset", () => {
  const prev = process.env.GITHUB_REPOSITORY;
  delete process.env.GITHUB_REPOSITORY;
  try {
    const repo = resolveGithubRepo();
    assert.ok(repo, "expected gh repo view to resolve nameWithOwner");
    assert.match(repo, /\//, "expected owner/name slug");
  } finally {
    if (prev !== undefined) process.env.GITHUB_REPOSITORY = prev;
  }
});
