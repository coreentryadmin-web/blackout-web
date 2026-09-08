> **kind:** `FINDING`

## `adapters.test.ts`'s two "STILL BUY / still_buy" tests hardcoded absolute committedAt timestamps — a wall-clock date-bomb — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | `src/features/nighthawk/command-deck/adapters.test.ts` (Night Hawk Swings command-deck adapter tests) |
| **PR** | (pending — `fix/swing-entry-adapter-test-date-bomb`) |

### Symptom

Discovered while driving PR #4588 (`fix/cron-health-runs-24h-global-row-cap`) to green — its
`verify` CI run failed on a test entirely unrelated to that PR's diff:

```
not ok 1646 - horizon adapter: live OPEN + enterable geometry → STILL BUY action + swingEntryAction
Expected values to be strictly equal:
+ actual - expected
+ null
- 'still_buy'
```

Confirmed this reproduces identically on a clean `origin/main` checkout with none of #4588's
changes present (`npx tsx --test src/features/nighthawk/command-deck/adapters.test.ts`) — the
failure is pre-existing on `main`, not caused by that PR.

### Root cause

`terminalPlayFromHorizon()` (`adapters.ts:784-798`) forwards `committedAt` straight into
`evaluateSwingEntryEnterability()` (`src/lib/swing/entry-enterability.ts`) as `anchoredAt`, with
no way to inject an override `nowMs` — production always compares against the real `Date.now()`
(correct behavior). `evaluateSwingEntryEnterability` enforces `DEFAULT_ENTRY_VALIDITY_DAYS = 3`:
past `anchoredAt + 3 days`, `pastEntryDeadline()` returns true and the row's action degrades from
`'still_buy'` to `null`.

The test at line 1066 hardcoded `committedAt: "2026-09-05T14:00:00.000Z"` — a fixed absolute
timestamp, not one computed relative to the actual test-run time. `2026-09-05T14:00Z + 3 days =
2026-09-08T14:00Z`. CI ran this suite at `2026-09-08T14:35Z` — 35 minutes past the deadline — so
the row had already silently aged out of its own test's "still enterable" assumption. This is a
pure wall-clock date-bomb: the test passed for exactly as long as "today" stayed before
2026-09-08 14:00 UTC, and was always going to fail once it didn't, regardless of any code change.

### Blast radius

A second test three tests down ("rolled child at AT_TRIGGER → still_buy", line ~1093) carried the
identical bug with a later trigger time (`committedAt: "2026-09-05T15:00:00.000Z"`, one hour later
+ deadline 2026-09-08T15:00Z) — it was still passing only because CI happened to run 25 minutes
before its own deadline. Left unfixed, this would have started failing as its own separate,
confusing-looking CI break within the hour. Fixed both in the same pass rather than leaving a
second bomb sitting next to the first. Its `firstSeenAt` (also a fixed 2026-09-01 date, unrelated
to the entry-validity window but still an unnecessary absolute date) was made relative too, for
the same reason.

No production code changed — `evaluateSwingEntryEnterability`'s real-clock behavior in
`terminalPlayFromHorizon` is correct; only the two tests' fixture dates were wrong.

### Fix

Both tests now compute `committedAt` as `new Date(Date.now() - 60 * 60 * 1000).toISOString()`
("committed one hour ago" — always inside the 3-day window regardless of when the suite runs);
the rolled-child test's `firstSeenAt` similarly uses `Date.now() - 7 * 24 * 60 * 60 * 1000`
("first seen a week ago"). No assertions changed — same expected `'still_buy'` outcome, now on a
fixture date that can never silently expire.

### Verify

```
export PATH=/opt/node20/bin:$PATH
npx tsx --test src/features/nighthawk/command-deck/adapters.test.ts
```
141/141 pass (was 1 fail pre-fix, reproduced against `origin/main`). `npx tsc --noEmit`: clean.
Full suite (Node 20): **13299 pass / 0 fail / 3 skipped**.

### Note

Per `CLAUDE.md`'s self-authored-PR carve-out, this PR holds for Cursor's explicit
`✅ GO AHEAD MERGE` sign-off before merging — not self-merged.
