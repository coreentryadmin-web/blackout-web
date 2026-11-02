> **kind:** FINDING

## `evaluateDeployFreshness` treats a FAILED deploy run identically to a successful one — FIXED

| | |
|---|---|
| **Status** | Fixed |
| **Severity** | P2 (operational — the "is production behind main" audit check can report a clean bill of health while the only deploy attempt for a commit actually failed) |
| **File** | `scripts/audit/lib/deploy-freshness-eval.mjs` (`evaluateDeployFreshness`), consumed by `scripts/audit/deploy-freshness.mjs` |
| **Regression test** | `src/deploy-freshness-eval.test.ts` — "a deploy run created after a commit but that FAILED does not count as coverage" + 3 companion cases (cancelled/timed_out/action_required/stale, successful-still-clears, in-progress-still-clears) |

### Root cause

`scripts/audit/deploy-freshness.mjs` exists specifically to answer "is there a deploy-worthy
commit on `main` with no deploy run created after it" (see its own header: merging is loud,
deploying silently is not). It fetches each `ecr-push-production.yml` run from the GitHub API and
carries `status`/`conclusion` on every run object it builds:

```js
const deployRuns = runs?.workflow_runs?.map((r) => ({
  createdAt: r.created_at,
  headSha: r.head_sha,
  status: r.status,
  conclusion: r.conclusion,
}));
```

But `evaluateDeployFreshness` — the pure function that actually decides the verdict — never reads
either field. It computes "the newest deploy run" purely from `createdAt`, across **every** run
regardless of outcome:

```js
const times = deployRuns.map((r) => Date.parse(r.createdAt)).filter((t) => Number.isFinite(t));
const newestDeploy = times.length ? Math.max(...times) : null;
// A commit is covered when a deploy run was CREATED at or after it.
```

A GitHub Actions run's `headSha`/`createdAt` are stamped the instant the workflow is **triggered**
and never change regardless of whether it later succeeds, fails, is cancelled, or times out. So a
run that was created for a commit and then **failed** looks, by `createdAt` alone, byte-identical
to one that actually shipped that commit — and the function reports `verdict: "ok"` either way.

This is the sibling of the already-fixed `discoverStandingWork` bug in
`scripts/blackout-agent/select-task.mjs` (same root cause — `headSha`/`createdAt` don't change on
failure — different mechanism: that function compares SHAs, this one compares timestamps against
commit dates) but a genuinely separate file, separate consumer, and separate code path; fixing one
did not touch the other.

### Evidence

Before the fix (`scripts/audit/lib/deploy-freshness-eval.mjs` as it stood on `main`):

```js
evaluateDeployFreshness({
  commits: [{ sha: "a", isoDate: "2026-08-22T01:00:00Z", files: ["src/x.ts"] }],
  deployRuns: [{ createdAt: "2026-08-22T01:00:30Z", headSha: "a", status: "completed", conclusion: "failure" }],
});
// => { verdict: "ok", undeployed: [], reason: "every deploy-worthy commit has a later deploy run" }
```

A deploy that is *known to have failed* for this exact commit is reported as "every deploy-worthy
commit has a later deploy run" — the audit's own headline claim is false in this case.

`git stash` on just `scripts/audit/lib/deploy-freshness-eval.mjs` against the new test file
reproduces this live: 2 of the 15 tests in `src/deploy-freshness-eval.test.ts` fail
("...FAILED does not count as coverage" and the cancelled/timed_out/action_required/stale
companion), both passing once the fix is restored (`npx tsx --experimental-test-module-mocks
--test src/deploy-freshness-eval.test.ts` → 15/15).

### Blast radius

`evaluateDeployFreshness` has exactly one production consumer,
`scripts/audit/deploy-freshness.mjs` (the "is production behind `main`" CLI check) — no other file
imports it. The fetch call there already carries `status`/`conclusion` through from the GitHub API
(it was collecting the data correctly all along), so no plumbing change was needed there; only the
pure evaluator that silently discarded those two fields needed the fix.

### Fix rationale

Added a narrow allow-list of GitHub Actions `conclusion` values that mean a run did **not** ship
the commit it was triggered for (`failure`, `cancelled`, `timed_out`, `action_required`, `stale`
— mirroring the allow-list already used by the sibling `discoverStandingWork` fix, for
consistency) and excluded any such run from the "newest deploy" computation that decides coverage.
Deliberately kept a run with `conclusion == null` (still queued/in-progress) counting as coverage,
preserving the function's existing, documented "created, not completed" design: an in-flight run
proves the push was seen and may still succeed, and is not the same failure mode as a run that has
already reached a failed conclusion — a second regression test pins this so the fix cannot
over-fire on every in-progress CI run. Left `scripts/audit/deploy-freshness.mjs`'s GitHub-API
plumbing untouched — the data was already being fetched correctly; only the function consuming it
ignored two of its fields.
