> **kind:** `FINDING`

## `main` was red: cron-staleness-watchdog's new self-heal log key had no health-registry entry — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P1 (broke `main`'s test suite, standing repo-wide ratchet) |
| **File** | `src/lib/cron-registry.test.ts` |
| **Found by** | CI failure on a downstream PR's rebase, investigated immediately since it surfaced a red `main` |

### Root cause

PR #3668 (`fix(cron): persist cron-staleness-watchdog self-heal outcome durably`, merged earlier this
sweep) made `cron-staleness-watchdog/route.ts` write a SECOND, distinctly-keyed `cron_job_runs` row —
`cron-staleness-watchdog-self-heal` — once a backgrounded self-heal re-warm settles, so the real
per-job outcome becomes durably queryable instead of always reading `self_healed: []`/`ok:true`.

`src/lib/cron-registry.test.ts`'s own standing ratchet ("every cron key a route logs under has a
health-registry entry") scans every `src/app/api/cron/*/route.ts` for `logCronRun(...)` calls and
requires each distinct key to be either a `CRON_JOBS` entry or a named `INTENTIONALLY_UNREGISTERED`
exemption. The new `cron-staleness-watchdog-self-heal` key was neither — #3668 shipped the write
site but never updated this test's own lists, so the very next CI run anywhere in the repo
(discovered here on an unrelated PR's rebase onto `main`) failed with `# fail 1`, and `main` itself
was confirmed red via a direct local run against `origin/main`.

### Why `INTENTIONALLY_UNREGISTERED`, not a `CRON_JOBS` entry

Every `CRON_JOBS` entry requires a `stale_after_min` (minutes without a run before the health board
marks it stale). This new row has no fixed cadence by design — it is written ONLY when a self-heal
re-warm actually dispatches, which the watchdog's own comments describe as a rare RTH-incident path
that can legitimately go days without firing. Registering it in `CRON_JOBS` with any `stale_after_min`
would make the health board report it "stale" on every ordinary day it doesn't fire — precisely the
"a monitor permanently stuck on one reading is worse than no monitor" failure mode this same test
file's docstring names as case 2 (the historical `welcome-sequence` bug). The watchdog's own scheduled
run already has its own `CRON_JOBS` key and is health-board-covered; only the synthetic follow-up row
needed the exemption.

### Fix

Added `cron-staleness-watchdog-self-heal` to `INTENTIONALLY_UNREGISTERED` with a reason explaining
why it's exempt (event-driven, no fixed cadence, would false-alarm if registered), matching the
pattern the file's own docstring requires ("every one of them is unscheduled... for a real reason").

### Evidence

`node --import tsx --experimental-test-module-mocks --test src/lib/cron-registry.test.ts` against
`origin/main` (detached HEAD, no other changes): `# fail 1` — the exact orphan-key assertion.
After the fix: `3/3 pass`. `npx tsc --noEmit` clean.

### Blast radius

Single test file, single new entry. No production code changed — the self-heal durability fix from
#3668 itself is untouched and correct; this only teaches the coverage ratchet about the new key it
introduced.

### What was deliberately left unchanged

Did not touch `CRON_JOBS` or add a fake cadence to force registry coverage — that would recreate the
exact false-alarm bug this file exists to prevent.
