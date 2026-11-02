> **kind:** FINDING

## `formatVerifyStatus` emits inconsistent case between its GraphQL and REST code paths, silently breaking every downstream `.includes("SUCCESS")` / `.includes("FAILURE")` check — FIXED

**Status:** FIXED (`fix/verify-status-case-mismatch`)

### Root cause

`scripts/blackout-agent/sync-context.mjs`'s `formatVerifyStatus(check)` composes a
`"${status}/${conclusion}"` string from whichever upstream source answered
`fetchOpenPrs()`:

- **GraphQL** (`gh pr list --json ...statusCheckRollup`, the preferred path) returns
  `CheckStatusState`/`CheckConclusionState` GraphQL enums, which are **UPPERCASE**
  (`"COMPLETED"`, `"SUCCESS"`, `"FAILURE"`, …).
- **REST** (`gh api repos/{repo}/pulls` + `/commits/{sha}/check-runs`, the fallback
  used — per the function's own neighboring comment — "when authenticated `gh` calls
  are rate-limited... exactly when the fleet is busy") returns GitHub's REST Check
  Runs `status`/`conclusion` fields, which are **lowercase** (`"completed"`,
  `"success"`, `"failure"`, …).

`formatVerifyStatus` passed both straight through with no case normalization, so the
resulting `pr.verify` string's case silently depended on which of the two paths
happened to answer that call.

Every downstream consumer of `pr.verify` matches it with a **case-sensitive**
substring check for the literal uppercase tokens `"SUCCESS"` / `"FAILURE"`:

- `scripts/blackout-agent/select-task.mjs`'s `discoverStandingWork` —
  `if (pr.verify?.includes("FAILURE")) continue;` (skip genuinely-failing PRs) and
  `const verifyGreen = pr.verify?.includes("SUCCESS");` (treat a PR as mergeable-once-
  reviewed).
- `scripts/blackout-agent/bootstrap.mjs`'s `review_queue` —
  `pr.verify.includes("SUCCESS")` (decide which open PRs are surfaced to the agent as
  needing peer review in its own bootstrap report).

When `fetchOpenPrs()` fell back to REST, `pr.verify` came back lowercase
(`"completed/success"` / `"completed/failure"`), which matches **neither**
`"SUCCESS"` nor `"FAILURE"`. Concretely, for a REST-sourced PR:

- A genuinely **failing** PR was never skipped by the `includes("FAILURE")` guard and
  was instead pushed onto the standing-work queue as if it needed a peer review (it
  does not — it needs a fix, and should never have been queued at all).
- A genuinely **green**, already peer-approved PR never satisfied `verifyGreen`, so
  `discoverStandingWork` kept re-queuing it as "needs peer review" forever, and
  `bootstrap.mjs`'s `review_queue` never listed it even though CI was green — hiding
  exactly the PRs the operating model (CLAUDE.md's peer-review/"never sit idle"
  discipline) depends on agents seeing.

This bug could not be triggered via the GraphQL path (its enums are already
uppercase) and only manifests once the REST fallback is exercised — i.e. precisely
when GitHub's shared GraphQL rate-limit budget is under load, which is also when an
accurate, visible review queue matters most.

### Evidence

- `gh pr checks --help` / GitHub REST API docs confirm `/check-runs` `status` and
  `conclusion` values are lowercase (`"completed"`, `"queued"`, `"in_progress"` /
  `"success"`, `"failure"`, `"neutral"`, `"cancelled"`, `"skipped"`, `"timed_out"`,
  `"action_required"`, `"stale"`), while GraphQL's `CheckStatusState` /
  `CheckConclusionState` enums are uppercase by GraphQL convention
  (`"COMPLETED"`/`"SUCCESS"`/…).
- The pre-existing unit test `"formatVerifyStatus normalizes GraphQL and REST check
  shapes"` (`scripts/blackout-agent/blackout-agent.test.mjs`) claimed to cover both
  shapes in its name but in fact only ever fed it GraphQL-shaped (already-uppercase)
  input — the REST shape was never exercised, which is exactly how this shipped
  unnoticed.
- Live ambient evidence from this very sandbox's `.blackout-agent/AGENT_STATE.json`
  (written by `sync-context.mjs` runs from concurrent agent sessions while this fix
  was being developed) shows both shapes coexisting for different PRs at the same
  instant: some entries `"verify": "COMPLETED/SUCCESS"` (GraphQL-sourced) and others
  `"verify": "completed/failure"` (REST-sourced, dependabot PRs #5545-#5547/#4477) —
  direct proof the two code paths really do disagree on case in production, not just
  in theory.
- New regression tests added in this PR (RED before the fix, GREEN after, proven via
  `git stash`/`git stash pop`):
  - `formatVerifyStatus` fed a REST-shaped (`{status:"completed", conclusion:"success"}`
    / `{status:"completed", conclusion:"failure"}`) object now returns
    `"COMPLETED/SUCCESS"` / `"COMPLETED/FAILURE"` and satisfies the same
    `.includes("SUCCESS")` / `.includes("FAILURE")` checks the GraphQL shape already
    did.
  - An end-to-end `discoverStandingWork` test proves a REST-sourced, already-approved
    green PR is no longer endlessly re-queued, and a REST-sourced failing PR is
    correctly skipped rather than queued for peer review.

### Blast radius

Both documented call sites of `pr.verify` are affected identically (same root cause,
same shared helper):
- `select-task.mjs`'s `discoverStandingWork` (standing-work discovery when the
  explicit `WORK_QUEUE.md` is empty).
- `bootstrap.mjs`'s `review_queue` (what a session's bootstrap report tells the agent
  still needs peer review).

No other consumer of `formatVerifyStatus`'s output does a case-sensitive match
(`pr-feedback.mjs`'s own CI summarization reads structured `gh pr checks --json`
objects through a separate `checkConclusion` normalizer, not through
`formatVerifyStatus`/`pr.verify` strings, so it was not affected).

### Fix rationale

Normalize case inside `formatVerifyStatus` itself — the single shared seam both the
GraphQL and REST paths already funnel through (`sync-context.mjs`'s
`fetchOpenPrs`/`verifyFromRestCheckRuns`) — rather than patching each downstream
`.includes(...)` call site to be case-insensitive. This fixes the mismatch exactly
once, for every current and future consumer of `pr.verify`, and keeps the existing
`"IN_PROGRESS/pending"`-style literal-lowercase "pending" fallback untouched (nothing
in the codebase matches on that token, so there was no reason to change it).
Deliberately left unchanged: `checkConclusion` in `pr-feedback.mjs`, which already
normalizes its own, separate `gh pr checks --json` shape correctly and does not share
this helper.
