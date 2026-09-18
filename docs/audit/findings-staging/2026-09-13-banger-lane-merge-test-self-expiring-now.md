## banger-lane-merge.test.ts silently broke on `main` once real time crossed its fixture's date

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | Swing Command / Bangers (Engine B) — test tooling only, no production behavior change |
| **Severity** | P2 (blocks CI for every future PR until fixed; not a production defect) |

### Symptom

`src/lib/swing/banger-lane-merge.test.ts` failed on `main` itself as of 2026-09-13 — 2 of 12
tests: `mergeBangerPositionsIntoSwingPlays replaces pre-entry row on same ticker` (expected
`'COMMIT'`, got `'WATCH'`) and `mergeBangerPositionsIntoSwingPlays replaces discovery COMMIT (no
ledger) with open banger` (expected `'BANGER'`, got `undefined`). First surfaced as an unrelated
`verify` failure on PR #4899 (`fix(audit): Legacy healthcheck marks verdict false-GREENs on null
bid/ask`), which does not touch this file at all — reproduced identically against local `main`
with no PR changes applied, confirming it was not that PR's fault.

### Root cause

`mergeBangerPositionsIntoSwingPlays(plays, bangerRows, now = new Date())` and
`horizonPlayFromBangerPosition(row, now = new Date())` both default `now` to the real wall clock
when the caller omits it. Two test cases called `mergeBangerPositionsIntoSwingPlays` with only two
arguments (no `now`), relying on the real clock — while the shared `bangerRow()` fixture hardcodes
`contract_expiry: "2026-09-12"`. `horizonPlayFromBangerPosition` correctly nulls out an expired
contract (`dte < 0`, per its own "still excludes an already-expired contract" test), so once real
time crossed into 2026-09-13, the fixture's contract went from `dte=8` (2026-09-04 baseline) to
negative dte, the banger row silently dropped out of `bangerPlays`, and the merge became a no-op —
the WATCH row never got replaced, the discovery-COMMIT row never got tagged BANGER. Every other
test in the file already passes an explicit fixed `now` (e.g.
`new Date("2026-09-04T16:00:00-04:00")`); these two were the only omissions.

This is a self-expiring test fixture, not a production defect: production always calls these
functions with the real current time against real, live (non-expired) contracts — the bug only
exists in the test's silent reliance on the default matching a fixture frozen months in the past.

### Fix

Pass the same explicit `new Date("2026-09-04T16:00:00-04:00")` used by every sibling test in the
file to all three `mergeBangerPositionsIntoSwingPlays([...], [bangerRow()])` call sites (the two
that failed, plus a third — "keeps canonical swing OPEN when banger also open on ticker" — that
happened to still pass today only because its assertion is indifferent to whether the banger row
survives, equally fragile and fixed for consistency rather than left as a second latent copy of
the same bug).

### Blast radius

Test-file only (`src/lib/swing/banger-lane-merge.test.ts`) — no change to
`src/lib/swing/banger-lane-merge.ts` or any production code path. No other test file in the repo
calls `mergeBangerPositionsIntoSwingPlays`/`horizonPlayFromBangerPosition` without an explicit
`now` (checked via grep).

### Evidence

RED confirmed on `main` before the fix (`npx tsx --experimental-test-module-mocks --test
src/lib/swing/banger-lane-merge.test.ts` → 2 fail / 10 pass). GREEN after the fix (12/12 pass).
`tsc --noEmit` clean.
