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
  checkConclusion,
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

test("summarizeChecks normalizes gh pr checks state field", () => {
  const s = summarizeChecks([
    { name: "verify", state: "SUCCESS", bucket: "pass" },
    { name: "CodeQL", state: "SUCCESS" },
    { name: "auto-merge", state: "SKIPPED", bucket: "skipping" },
  ]);
  assert.equal(s.verify.conclusion, "success");
  assert.equal(s.failed.length, 0);
  assert.equal(s.pending.length, 0);
});

test("checkConclusion maps gh and API shapes", () => {
  assert.equal(checkConclusion({ state: "SUCCESS" }), "success");
  assert.equal(checkConclusion({ conclusion: "failure" }), "failure");
  assert.equal(checkConclusion({ state: "IN_PROGRESS" }), "pending");
  assert.equal(checkConclusion({ bucket: "skipping" }), "skipped");
});

test("buildFeedback recognizes green verify from gh state-only checks", () => {
  const { body, directive } = buildFeedback({
    pr: 1,
    event: "synchronize",
    prData: {
      title: "fix: test",
      headRefOid: "abc123def456",
      headRefName: "claude/test",
      author: { login: "bot" },
      isDraft: false,
      files: [{ path: "scripts/blackout-agent/pr-feedback.mjs" }],
      additions: 5,
      deletions: 1,
    },
    checks: [{ name: "verify", state: "SUCCESS", bucket: "pass" }],
    priorReview: null,
  });
  assert.equal(directive.action, "REVIEW");
  assert.match(body, /`verify`: SUCCESS\/success/);
  assert.doesNotMatch(body, /`verify`: missing/);
  assert.doesNotMatch(directive.headline, /CI pending/);
});

test("resolveGithubRepo prefers GITHUB_REPOSITORY when set", () => {
  const prev = process.env.GITHUB_REPOSITORY;
  process.env.GITHUB_REPOSITORY = "coreentryadmin-web/blackout-web";
  try {
    assert.equal(resolveGithubRepo(), "coreentryadmin-web/blackout-web");
  } finally {
    if (prev !== undefined) process.env.GITHUB_REPOSITORY = prev;
    else delete process.env.GITHUB_REPOSITORY;
  }
});

// gh repo view is unavailable in GitHub Actions verify (no gh auth in the test job), so the
// fallback path is exercised locally/dev only — same pattern as other gh-spawn integration tests.
test(
  "resolveGithubRepo falls back to gh when env unset",
  { skip: process.env.CI ? "gh repo view needs local checkout auth" : false },
  () => {
    const prev = process.env.GITHUB_REPOSITORY;
    delete process.env.GITHUB_REPOSITORY;
    try {
      const repo = resolveGithubRepo();
      assert.ok(repo, "expected gh repo view to resolve nameWithOwner");
      assert.match(repo, /\//, "expected owner/name slug");
    } finally {
      if (prev !== undefined) process.env.GITHUB_REPOSITORY = prev;
    }
  }
);
