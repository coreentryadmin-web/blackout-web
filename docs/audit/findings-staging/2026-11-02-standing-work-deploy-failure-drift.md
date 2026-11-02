> **kind:** FINDING

## Autopilot `discoverStandingWork` cannot detect a FAILED production deploy of the current `main` commit — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 (operational — autonomous coordinator blind spot, not a trading-data defect) |
| **File** | `scripts/blackout-agent/select-task.mjs` (`discoverStandingWork`) |
| **Regression test** | `scripts/blackout-agent/blackout-agent.test.mjs` — "discoverStandingWork flags a FAILED deploy even when the deploy SHA matches main" + "...does NOT flag an in-progress deploy...as failed" |

### Root cause

`sync-context.mjs::syncContext()` records two facts about the production deploy pipeline from
the most recent `ecr-push-production.yml` run on `main`:

```js
state.deploy.last_deploy_status = deployRuns[0].conclusion ?? deployRuns[0].status;
state.deploy.last_deploy_sha = deployRuns[0].headSha;
```

`headSha` is the commit the run **attempted** to deploy — it is set the instant the workflow is
triggered, and it is unchanged whether the run later succeeds, fails, times out, or is cancelled.

`discoverStandingWork` (the function the whole autopilot coordinator loop uses, once the explicit
`WORK_QUEUE.md` is empty, to find standing work on its own — per `CLAUDE.md`'s "NEVER SIT IDLE"
and "literally zero work left to do" mandates) only ever compared the two SHAs:

```js
const mainSha = state.deploy?.last_main_sha;
const deploySha = state.deploy?.last_deploy_sha;
if (mainSha && deploySha && mainSha !== deploySha) {
  discovered.push({ id: "BO-P1-0101", title: `Deploy verification — main ... ahead of deploy ...`, ... });
}
```

`last_deploy_status` was read into state by `sync-context.mjs` and surfaced in `handoff.mjs`'s
summary text, but **no code path ever branched on it**. Because a deploy attempt's `headSha`
always equals the commit it was attempting (success or not), a run that **fails** on the current
`main` commit leaves `last_deploy_sha === last_main_sha` — the exact same bit pattern as "already
successfully deployed." The SHA-only check reads that as "no drift," so `discoverStandingWork`
never queues the `BO-P1-0101` "Deploy verification" task, and the coordinator moves on to other
work believing production is current with `main` when it may still be running the PREVIOUS
successful build.

### Evidence

```js
// Before the fix — RED
discoverStandingWork("cursor", {
  open_prs: [],
  reviews: {},
  deploy: { last_main_sha: "abc123", last_deploy_sha: "abc123", last_deploy_status: "failure" },
});
// => [] (no "Deploy verification" task) — yet the one deploy attempt FOR this exact commit failed.
```

`git stash` against the pre-fix `select-task.mjs` reproduces this: the new test
"discoverStandingWork flags a FAILED deploy even when the deploy SHA matches main" fails
(`found.length` is `0`, expected `1`); the companion "does NOT flag an in-progress deploy...as
failed" test already passed before the fix (it only exercises the pre-existing SHA-equality
branch), confirming the new failure branch, not an unrelated change, is what RED isolates.
After the fix: `npx tsx --experimental-test-module-mocks --test
scripts/blackout-agent/blackout-agent.test.mjs` → 21/21 pass, including the pre-existing
"discoverStandingWork flags deploy drift" (SHA-mismatch) case, unchanged.

### Blast radius

`discoverStandingWork` has exactly one caller, `select-task.mjs`'s `runSelect()`, used by
`npm run blackout:select` — the command the dispatch prompt (`dispatch-prompt.mjs`,
`hourly-checklist.mjs`) tells every coordinator session to run once its explicit work queue is
empty. No other file reads `state.deploy.last_deploy_status` for a decision (only `handoff.mjs`
prints it as free text in the handoff summary, which a human/agent may or may not read). So this
was the single, silent gap between "the data needed to detect a failed deploy exists in state"
and "anything acts on it."

### Fix rationale

Added an explicit, narrow allow-list of GitHub Actions `conclusion` values that mean the deploy
attempt did NOT succeed (`failure`, `cancelled`, `timed_out`, `action_required`, `stale`) and flag
`BO-P1-0101` whenever either the SHA differs (pre-existing behavior, unchanged) OR the most recent
attempt for the current SHA ended in one of those states. Deliberately did NOT treat an in-progress
run (`status` of `in_progress`/`queued`, `conclusion` still `null`) as a failure — `last_deploy_status`
falls back to `status` in that case, and a deploy that is still running for the current commit is
not drift, it is work already underway; a second regression test pins this so the fix cannot
over-fire on every run while CI is mid-flight. Left `last_deploy_sha`/`last_main_sha` computation in
`sync-context.mjs` untouched — the data was already correct, only the comparison that consumed it in
`discoverStandingWork` was incomplete.
