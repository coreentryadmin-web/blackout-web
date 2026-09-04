## 2026-09-04 — [P2, CI/test-suite reliability] `cron-registry.test.ts`'s coverage check broke on `main` after PR #3668 shipped a second, unregistered `logCronRun` key — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Severity** | P2 — broke `verify` on `main` and on every PR whose branch merged `main` after the fact; not a production runtime defect |
| **Found by** | DISCOVERY lane, investigating a `verify` failure surfaced while merging `main` into an unrelated open PR (#3664) |
| **Status** | FIXED |

### Root cause

PR #3668 (`fix(cron): persist cron-staleness-watchdog self-heal outcome durably`, merged earlier
today) made `cron-staleness-watchdog`'s route write a SECOND, distinctly-keyed `cron_job_runs` row —
`cron-staleness-watchdog-self-heal` — once its background self-heal work settles, so a failed
re-warm gets the same Discord alert every other cron failure gets. That is a real, working fix for
the outcome-visibility bug it targeted.

What it missed: `src/lib/cron-registry.test.ts`'s own coverage check (`"every cron key a route logs
under has a health-registry entry"`) scans every `src/app/api/cron/*/route.ts` for `logCronRun(...)`
call sites and asserts each key is either in `CRON_JOBS` or in the test's own
`INTENTIONALLY_UNREGISTERED` exemption map. `cron-staleness-watchdog-self-heal` is neither — so the
new key orphaned itself the same way ten other jobs already had (the test file's own header
describes that exact prior incident). Since this test runs as part of the ordinary `npm test`/CI
`verify` job, PR #3668 landed on `main` with `verify` red on every subsequent commit and every PR
that merged `main` afterward — including two unrelated open PRs (#3664, #3667) whose own diffs never
touched cron code at all.

### Evidence

- Confirmed via `git log`: `origin/main` at `8fce57a4f` (post-#3668, post-#3657) already carries the
  gap — this is not something introduced by merging `main` into a downstream branch, it is `main`
  itself failing its own `verify`.
- RED: `node --import tsx --experimental-test-module-mocks --test src/lib/cron-registry.test.ts` on
  `origin/main` → `AssertionError [ERR_ASSERTION]`, `actual: ['cron-staleness-watchdog-self-heal
  (logged by src/app/api/cron/cron-staleness-watchdog/route.ts)']` vs `expected: []` (1 fail / 2
  pass, file `src/lib/cron-registry.test.ts:2:3107`).
- GREEN after the fix: same command, 3/3 pass.
- `npx tsc --noEmit` clean.

### Fix

Added `cron-staleness-watchdog-self-heal` to `INTENTIONALLY_UNREGISTERED` (not `CRON_JOBS`) — this
key is not a standalone scheduled job in blackout-infra's `cron-jobs.json`; it is a conditional
follow-up write from the ALREADY-registered `cron-staleness-watchdog` cron, fired only when self-heal
actually dispatches a re-warm (rare by design). Giving it its own `CRON_JOBS` entry with a
`stale_after_min` would false-alarm on any quiet stretch with no self-heal incident — the exact
failure mode the file's own header comment warns against ("a monitor permanently stuck on one
reading is worse than no monitor"). The reason string documents why: `logCronRun`'s own failure path
already fires the standard Discord alert on a failed re-warm; the health board's staleness watch
stays scoped to the parent cron's real 5-minute schedule.

### Blast radius

Single test file (`cron-registry.test.ts`), one exemption-map entry. No production code changed —
`cron-staleness-watchdog`'s route (`route.ts`) and its self-heal logic (from #3668) are untouched;
this only teaches the coverage check about a key that route already, correctly, writes.

### Fix rationale

`INTENTIONALLY_UNREGISTERED` over a `CRON_JOBS` entry, matching the existing pattern for keys that
are real and correct but not independently schedulable (the file's own docstring: "Jobs deliberately
outside the health board... unscheduled in blackout-infra's cron-jobs.json"). Did not touch #3668's
route logic — its self-heal outcome tracking is exactly what it should be; only the registry test's
own coverage list was stale.

### What was deliberately left unchanged

Nothing in `cron-staleness-watchdog/route.ts` or the self-heal dispatch logic — this is purely a
registry/test-coverage fix for a key that was already being written correctly.
