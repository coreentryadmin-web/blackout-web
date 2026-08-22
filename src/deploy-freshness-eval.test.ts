import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error -- plain .mjs audit helper, no type declarations by design.
import {
  commitIsMemberFacing,
  commitTriggersDeploy,
  evaluateDeployFreshness,
  isDeployPath,
  isMemberFacing,
} from "../scripts/audit/lib/deploy-freshness-eval.mjs";

const C = (sha: string, isoDate: string, files: string[]) => ({ sha, isoDate, files });
const R = (createdAt: string, headSha = "deadbee") => ({ createdAt, headSha });

test("deploy paths match the workflow filter, prefixes and exact files alike", () => {
  assert.equal(isDeployPath("src/lib/largo/run-tool.ts"), true);
  assert.equal(isDeployPath("public/images/diagrams/what-is-gex.svg"), true);
  assert.equal(isDeployPath("package.json"), true);
  assert.equal(isDeployPath("next.config.mjs"), true);
  // Not deploy paths — an audit script or a doc must NOT be read as a missed deploy.
  assert.equal(isDeployPath("scripts/audit/agent-pr-sweep.mjs"), false);
  assert.equal(isDeployPath("docs/audit/FINDINGS.md"), false);
  assert.equal(isDeployPath("CLAUDE.md"), false);
  // Guards against a sloppy prefix test matching a sibling directory.
  assert.equal(isDeployPath("srcignore/thing.ts"), false);
  assert.equal(isDeployPath(""), false);
  assert.equal(isDeployPath(undefined as unknown as string), false);
});

test("a commit triggers a deploy when ANY of its files matches", () => {
  assert.equal(commitTriggersDeploy(["docs/audit/FINDINGS.md", "src/lib/x.ts"]), true);
  assert.equal(commitTriggersDeploy(["docs/audit/FINDINGS.md"]), false);
  assert.equal(commitTriggersDeploy([]), false);
});

test("docs-only commits after the last deploy are OK, not behind", () => {
  // This is the case that would make the check cry wolf and get it switched off.
  const r = evaluateDeployFreshness({
    commits: [C("a", "2026-08-22T01:00:00Z", ["docs/audit/RUN-LOG.md"])],
    deployRuns: [R("2026-08-22T00:00:00Z")],
  });
  assert.equal(r.verdict, "ok");
});

test("the real incident is reported as behind", () => {
  // Measured 2026-08-22: three deploy-path commits, last deploy created 23:36Z, none since.
  const r = evaluateDeployFreshness({
    commits: [
      C("cb764fec", "2026-08-22T00:59:32Z", ["src/app/desk-app.css", "src/features/meridian/a.tsx"]),
      C("abb9962f", "2026-08-22T00:45:10Z", ["src/lib/meridian/b.ts"]),
      C("b979329c", "2026-08-22T00:36:24Z", ["public/images/diagrams/what-is-gex.svg"]),
      C("dbb3a94f", "2026-08-22T00:35:54Z", ["scripts/audit/lib/clerk-audit-user.mjs"]),
    ],
    deployRuns: [R("2026-08-21T23:36:30Z")],
    nowIso: "2026-08-22T03:44:00Z",
  });
  assert.equal(r.verdict, "behind");
  assert.equal(r.undeployed.length, 3, "the audit-script commit must NOT be counted");
  assert.ok(r.ageMin && r.ageMin > 180, `oldest undeployed commit age should exceed 3h, got ${r.ageMin}`);
});

test("a deploy created AFTER the commit clears it, even while still queued", () => {
  // Created, not completed: a queued run proves the push was seen, which is what is being checked.
  const r = evaluateDeployFreshness({
    commits: [C("a", "2026-08-22T01:00:00Z", ["src/x.ts"])],
    deployRuns: [R("2026-08-22T01:00:30Z")],
  });
  assert.equal(r.verdict, "ok");
});

test("missing input is UNKNOWN, never ok — absence is not health", () => {
  assert.equal(evaluateDeployFreshness({ commits: [], deployRuns: [] }).verdict, "unknown");
  assert.equal(
    evaluateDeployFreshness({ commits: [C("a", "2026-08-22T01:00:00Z", ["src/x.ts"])] }).verdict,
    "unknown",
  );
});

test("no deploy runs at all with a deploy-worthy commit is behind, not unknown", () => {
  const r = evaluateDeployFreshness({
    commits: [C("a", "2026-08-22T01:00:00Z", ["src/x.ts"])],
    deployRuns: [],
  });
  assert.equal(r.verdict, "behind");
  assert.equal(r.newestDeployAt, null);
});

test("an unparseable commit date is skipped rather than counted as behind", () => {
  const r = evaluateDeployFreshness({
    commits: [C("a", "not-a-date", ["src/x.ts"])],
    deployRuns: [R("2026-08-22T00:00:00Z")],
  });
  assert.equal(r.verdict, "ok");
});

// The cry-wolf case, found by the check's OWN first live run: `src/**` matches the workflow
// filter, so a test file legitimately triggers a deploy — but it cannot change what a member is
// served. Reporting that as "production is behind" is true of the workflow and false of
// production. Severity is split rather than suppressed: a deploy that does not fire is still a
// fault, it is just not an outage.
test("a test-only deploy-path commit is BEHIND but graded test-only", () => {
  const r = evaluateDeployFreshness({
    commits: [C("fe642703", "2026-08-22T04:47:42Z", ["src/meridian-invariants.test.ts", "docs/audit/FINDINGS.md"])],
    deployRuns: [R("2026-08-22T04:38:34Z")],
    nowIso: "2026-08-22T06:42:00Z",
  });
  assert.equal(r.verdict, "behind");
  assert.equal(r.severity, "test-only");
  assert.equal(r.memberFacing.length, 0);
  assert.match(r.reason, /test-only/);
});

test("a commit mixing a test file and real source is graded member-facing", () => {
  const r = evaluateDeployFreshness({
    commits: [C("a", "2026-08-22T01:00:00Z", ["src/x.test.ts", "src/x.ts"])],
    deployRuns: [R("2026-08-22T00:00:00Z")],
  });
  assert.equal(r.severity, "member-facing");
  assert.equal(r.memberFacing.length, 1);
});

test("isMemberFacing excludes test files and __tests__ dirs, keeps real source", () => {
  assert.equal(isMemberFacing("src/lib/x.ts"), true);
  assert.equal(isMemberFacing("public/images/a.svg"), true);
  assert.equal(isMemberFacing("src/lib/x.test.ts"), false);
  assert.equal(isMemberFacing("src/lib/__tests__/x.ts"), false);
  assert.equal(isMemberFacing("docs/audit/FINDINGS.md"), false);
  assert.equal(commitIsMemberFacing(["src/a.test.ts"]), false);
  assert.equal(commitIsMemberFacing(["src/a.test.ts", "src/a.ts"]), true);
});
