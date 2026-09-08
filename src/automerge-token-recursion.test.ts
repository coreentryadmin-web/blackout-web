import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * GITHUB_TOKEN MERGES ARE INVISIBLE TO DOWNSTREAM WORKFLOWS — this test is the ratchet.
 *
 * GitHub's anti-recursion rule means an event created by the default GITHUB_TOKEN inside a
 * workflow run never triggers ANY other workflow — not push-triggered CI, not CodeQL, not
 * ecr-push-production.yml. `automerge.yml`'s merge step used to run `gh pr merge` under
 * GITHUB_TOKEN, so every PR it auto-merged landed on `main` with zero re-verification and
 * zero deploy, silently: no red check, no error, no complaint. Measured twice same-day on
 * the same lane (#2783, #2796) before the coordinator caught it by comparing the merge sha
 * against the deploy workflow's last-run sha rather than trusting the merge itself.
 *
 * The fix is a PAT (`AGENT_RELEASE_TOKEN`, already used elsewhere for the same "GITHUB_TOKEN
 * is refused this" reason) for the merge step specifically, falling back to GITHUB_TOKEN so a
 * missing optional secret doesn't hard-fail the whole workflow.
 */

const REPO_ROOT = join(import.meta.dirname, "..");

test("automerge.yml's merge step does not rely solely on GITHUB_TOKEN", () => {
  const workflow = readFileSync(join(REPO_ROOT, ".github/workflows/automerge.yml"), "utf8");

  const mergeStepMatch = /Enable auto-merge[\s\S]*?run:\s*\|\s*\n\s*gh pr merge/.exec(workflow);
  assert.ok(mergeStepMatch, "expected an 'Enable auto-merge' step invoking `gh pr merge`");

  const mergeStep = mergeStepMatch[0];
  assert.match(
    mergeStep,
    /GH_TOKEN:\s*\$\{\{\s*secrets\.AGENT_RELEASE_TOKEN\s*\|\|\s*secrets\.GITHUB_TOKEN\s*\}\}/,
    "the merge step must prefer a PAT (AGENT_RELEASE_TOKEN) over the default GITHUB_TOKEN, " +
      "or its merges silently never trigger CI/CodeQL/deploy on main"
  );
});

test("automerge.yml does not enable auto-merge for cursor/* (HARD MERGE GATE)", () => {
  const workflow = readFileSync(join(REPO_ROOT, ".github/workflows/automerge.yml"), "utf8");

  const jobIfMatch = /enable-automerge:[\s\S]*?if:\s*\$\{\{([^}]+)\}\}/.exec(workflow);
  assert.ok(jobIfMatch, "expected enable-automerge job with an `if` condition");

  const jobIf = jobIfMatch[1];
  assert.match(jobIf, /startsWith\(github\.head_ref, 'claude\/'\)/, "claude/* should remain eligible");
  assert.doesNotMatch(
    jobIf,
    /startsWith\(github\.head_ref, 'cursor\/'\)/,
    "cursor/* must not be auto-merge eligible — Claude GitHub review required at CURRENT HEAD"
  );
});
