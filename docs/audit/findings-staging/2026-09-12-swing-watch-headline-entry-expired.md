> **kind:** FINDING

## WATCH board's "WAIT" pill gave no member-facing signal that a setup's entry window had already expired — FIXED

| **Status** | FIXED |
|---|---|

### Root cause

`entry-enterability.ts`'s `evaluateSwingEntryEnterability` already computes, per row, whether the
setup's entry-validity deadline (`entry-model.ts`'s `ENTRY_VALIDITY_DAYS` — TACTICAL 2 days /
STANDARD 3 days / EXTENDED 5 days) has passed — it returns `action: "dont_buy"` with reason
`"Entry-validity window expired — wait for a fresh setup."` But nothing downstream distinguished
this from the setup simply never having triggered yet: `terminalPlayFromHorizon`
(`adapters.ts`) narrowed the computed result down to `swingEntryAction?: "buy" | "still_buy" |
null` — every `dont_buy`/`wait` reason, expiry included, collapsed to `null` — and
`swingActionDisplay` (`play-card-lifecycle.ts`) then rendered the same generic `WAIT` pill for
`null` regardless of cause.

### Live repro (2026-09-12, raised on PR #4076 as comment 5646063107, no reply after 3.5h)

Pulled the live swing WATCH lane (8 candidates, the entire board): **5 of 8 (62.5%) were already
past their own stated entry-validity window**, including MU (49 days stale) and AMD (46 days
stale) against a design window of 2-5 days — both still rendering the identical `WAIT` headline
pill as COIN/GOOGL, which were genuinely fresh (1-2 days old, still enterable). A scanning member
had no way to tell a live setup from one that had been dead for a month and a half without opening
the full brief and reading the Verdict-section text.

### Fix

- `SwingEntryEnterability` (`entry-enterability.ts`) gained an optional `expired?: boolean` field,
  set `true` only in the `pastEntryDeadline` branch — additive, every other branch unaffected.
- `terminalPlayFromHorizon` now also captures `watchEntryExpired = swingEnterability?.expired ===
  true` onto `TerminalPlay` (new optional field, same computation already run for
  `swingEntryAction`, not a second lookup).
- `swingActionDisplay`'s `WATCH` branch now checks `play.watchEntryExpired` before falling through
  to the generic `WAIT` pill, rendering `EXPIRED` instead. This flows straight into
  `composeSwingPlayBrief`'s headline (`play-brief.ts` uses `action?.label` there), so the fix is
  visible in both the command-deck WATCH pill and the Ask Largo play-brief headline with one
  change.

### What was deliberately left unchanged

- The underlying `evaluateSwingEntryEnterability` logic/ordering — only a new field was added to
  its return type.
- Every other `dont_buy`/`wait` reason (invalidated, extended-chase, gate-blocked,
  not-yet-triggered) — all still render the plain `WAIT`/other existing pills; only the
  deadline-expiry case is distinguished, since it's the one case a member can never fix by waiting
  longer.
- Whether/when a stale WATCH row should be actively pruned from the board — that's the
  architecturally-significant half of the original #4076 finding, still open, still held pending
  Cursor's input rather than shipped unilaterally.

### Evidence of testing

- `entry-enterability.test.ts`: new test asserts `expired: true` on the existing "past entry
  deadline" case, plus a new test asserting `expired` is NOT set on invalidated/extended-chase/
  gate-blocked `dont_buy`/`wait` cases. RED pre-fix (`git stash` on the four implementation
  files), GREEN post-fix.
- `play-card-lifecycle.test.ts`: new tests for `swingActionDisplay` — `watchEntryExpired: true` →
  `EXPIRED` pill; `watchEntryExpired: false` → still the plain `WAIT` pill.
- `adapters.test.ts`: new end-to-end test drives `terminalPlayFromHorizon` with a `firstSeenAt` 46
  days in the past (mirrors the live MU repro) and asserts both `watchEntryExpired: true` and
  `swingActionDisplay(...)?.label === "EXPIRED"`; a sibling test with a 1-hour-old `firstSeenAt`
  asserts the row stays `WAIT`. RED confirmed via `git stash` (1 failing test with the
  implementation stashed, tests kept), GREEN after restoring.
- Full affected-file suite (`adapters.test.ts` + `play-card-lifecycle.test.ts` +
  `entry-enterability.test.ts` + `entry-verdict.test.ts`, 216 tests): pass.
- `npx tsc --noEmit`: clean.
- Full `npm test` (Node 20): 13942 pass / 0 fail / 3 skipped.

Found during the Night Hawk Swings standing aggressive-mode improvement-hunt mandate, following up
on an architecturally-significant design question raised earlier the same day (PR #4076 comment
5646063107) by shipping the smaller, presentational half of the proposed remedy — surfacing the
already-known expiry state more prominently — without touching the discovery/serving lifecycle
question (whether to actively prune stale WATCH rows), which remains open pending discussion.
