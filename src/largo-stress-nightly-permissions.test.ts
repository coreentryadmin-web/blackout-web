import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * A WORKFLOW THAT CREATES ISSUES ON FAILURE MUST DECLARE issues: write — this test is the
 * ratchet.
 *
 * largo-stress-nightly.yml's "Open ops issue on failure" step called
 * `github.rest.issues.create` with no `permissions:` block in the file, so the default
 * GITHUB_TOKEN (read-only for issues on this repo) refused the call. The stress run itself was
 * ALSO broken that day (PR #3203 deleted a load-bearing file, fixed in #3219) — so this wasn't
 * just an unused safety net, it was the exact mechanism that should have paged someone and
 * silently didn't. Every nightly run failed with zero alert until a manual sweep of failing
 * scheduled workflows found it.
 *
 * Generalized rather than pinned to one file: ANY workflow that calls `issues.create` must
 * declare `issues: write`, so a future workflow added the same way doesn't repeat this exact
 * silent-failure shape.
 */

const WORKFLOWS_DIR = join(import.meta.dirname, "..", ".github", "workflows");

function workflowsCallingIssuesCreate(): string[] {
  return readdirSync(WORKFLOWS_DIR)
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .filter((f) => readFileSync(join(WORKFLOWS_DIR, f), "utf8").includes("issues.create"));
}

test("every workflow calling github.rest.issues.create declares issues: write", () => {
  const offenders: string[] = [];
  for (const file of workflowsCallingIssuesCreate()) {
    const contents = readFileSync(join(WORKFLOWS_DIR, file), "utf8");
    // A plain string/regex check, not a full YAML parse — matches this repo's existing
    // workflow-guard convention (see automerge-token-recursion.test.ts). Requires the
    // `issues: write` line to appear ANYWHERE at top-level scope (job-level `permissions:`
    // blocks are indented under a job key, so an unindented match is specifically the
    // workflow-level grant this repo's own convention uses, per ops-auto-fix.yml).
    if (!/^permissions:\s*\n(?:.*\n)*?\s*issues:\s*write\s*$/m.test(contents)) {
      offenders.push(file);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `workflow(s) call issues.create without declaring issues: write permission: ${offenders.join(", ")}`
  );
});

test("sanity: this repo has at least one workflow calling issues.create (the guard isn't vacuous)", () => {
  assert.ok(
    workflowsCallingIssuesCreate().length > 0,
    "expected at least one .github/workflows/*.yml calling github.rest.issues.create"
  );
});
