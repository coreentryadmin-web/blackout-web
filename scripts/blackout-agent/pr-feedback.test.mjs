import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyBranch,
  reviewerForBranch,
  isOwnPr,
  buildFeedback,
  shouldDispatchDeepReview,
  markerFor,
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

test("reviewerForBranch peers", () => {
  assert.equal(reviewerForBranch("claude/x"), "cursor");
  assert.equal(reviewerForBranch("cursor/x"), "claude");
  assert.equal(reviewerForBranch("fix/x"), "cursor");
  assert.equal(reviewerForBranch("docs/x"), "cursor");
  assert.equal(reviewerForBranch("main"), null);
});

test("isOwnPr blocks self-review", () => {
  assert.equal(isOwnPr("cursor", "cursor/foo"), true);
  assert.equal(isOwnPr("cursor", "claude/foo"), false);
});

test("buildFeedback marks awaiting peer review", () => {
  const { body, verdict } = buildFeedback({
    pr: 99,
    event: "synchronize",
    prData: {
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
  assert.match(verdict, /PEER REVIEW/);
});

test("shouldDispatchDeepReview for claude PR with green verify", () => {
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

test("shouldDispatchDeepReview skips drafts", () => {
  assert.equal(
    shouldDispatchDeepReview({
      event: "opened",
      prData: { headRefName: "claude/x", isDraft: true },
      checks: [],
      agent: "claude",
      reviewingAgent: "cursor",
    }),
    false
  );
});

test("markerFor is stable per head", () => {
  assert.match(markerFor(1, "abcdef123456"), /head-abcdef123456/);
});
