# 2026-10-31 closedDeckSourcesFromChains: entryTrigger/invalidation underlying px, exitAt, committedAt, firstSeenAt still leaked the terminal leg's own values onto the worst leg's card (5th site of the same bug class)

> **kind:** FINDING

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P2 — confirmed live, misleading trade-manager coaching on closed roll-chain positions |

## Root cause

`closedDeckSourcesFromChains()` (`src/lib/swing/closed-plays.ts`) builds the CLOSED-tab/Ask Largo
card for a multi-leg swing roll chain. When the chain's WORST-performing leg is not the same leg
as its TERMINAL (last) leg, the card must show the **worst leg's own** contract/price/outcome
(the "preserved-loss invariant" — `record.ts`), not the terminal leg's. Four prior fixes already
re-pointed one field each at the worst leg's own row (`worstLegRow`) instead of the terminal leg's
(`src`, from `closedDeckSourceFromRow(terminal)`):

- **2026-10-11** — `contract` identity (strike/right/expiry/occ)
- **2026-10-18** — `contract.mid`/`contract.delta` (the quote, not just identity)
- **2026-10-21** — `entryPremium`/`peakPremium`/`troughPremium`
- **2026-10-22** — `positionId`

Each fix comment independently re-discovered the same root cause: the initial `...src` spread at
the top of the pushed object carries the TERMINAL leg's values for every field, and whoever wrote
the override object after it only re-pointed the specific field they were fixing that day.

This fix is the 5th site of the identical class: the spread also carries
`entryTriggerUnderlyingPx`, `invalidationUnderlyingPx`, `exitAt`, `committedAt`, and `firstSeenAt`
straight from the terminal leg, and none of the four prior fixes touched them. All five are
genuine per-leg columns on `swing_positions` (`entry_underlying_px`/`thesis_invalidation_px`/
`closed_at`/`graded_at`/`committed_at`/`first_seen_at` — `SwingPositionRow`, `src/lib/db.ts`), the
exact same class as `entry_premium`/`contract_delta`, which the 2026-10-21/2026-10-18 fixes
already borrow from the worst leg's row — there was never a "no per-leg equivalent" gap here
either.

## Evidence

Live repro cited by the operator's audit (AMZN, root leg 44 -> terminal leg 48): leg 44 was the
worst leg at -27.67%, terminal leg 48 closed at +72.41%. The composite card correctly showed leg
44's contract/premium/-27.67% outcome (prior fixes), but narrated against leg 48's own
entry-trigger/invalidation underlying prices (247.45/241.58) instead of leg 44's own.

Two consumers pair these fields with other already-worst-leg-sourced fields, so the mismatch is a
real, checkable, cross-leg contradiction, not just an unused data gap:

1. `closedCoaching` (`src/lib/swing/play-brief-narrative-coaching.ts`, ~line 1717-1754) — for a
   `closedReason === "stopped"` play (and `closedReason` above is ALREADY the worst leg's own
   composite reason), renders `"**Stop fired** (stopped) — entry **X** vs invalidation **Y**, a
   **Z%** cushion at commit"` using `entryTriggerUnderlyingPx`/`invalidationUnderlyingPx`. Pairing
   leg 44's real stop with leg 48's entry/invalidation levels produces a specific, false "cushion
   at commit" claim about a trade that was never leg 44's.
2. `closedSection` (`src/lib/swing/play-brief.ts`, ~line 1046-1067) renders one connected "Outcome"
   block: `"Exit P&L: **-27.67%** / Reason: **stopped** / Closed: **<exitAt>**"`. `exitPnlPct` and
   `closedReason` are already the worst leg's own; leaving `exitAt` as the terminal leg's own close
   date pairs the worst leg's loss/reason with a date describing a different event (when the whole
   chain finally finished, not when leg 44 itself exited/rolled away).
   `playPrimaryEvent`/`playTriggeredEvent` (`play-card-lifecycle.ts`) confirm the same intent —
   `exitAt` is the row's own "Closed" timestamp, and `firstFlaggedAt`/`committedAt` is documented
   there as "when the trade started" for a closed row, which must mean the leg whose outcome is
   actually being shown.

Checked for a plausible counter-case before fixing: `committedAt` is also read by
`evidenceFromContext`'s "Setup score" fact (`play-brief.ts` ~line 1823) as the provenance `asOf`
for `ctx.play.score`. `score`/`scoreWithheld` are NOT re-pointed by any of the five fixes (an
intentionally separate, already-disclosed gap — see `SwingClosedDeckSource.scoreWithheld`'s own
doc comment: a rolled chain's terminal/child leg "reliably" has no `feature_vector` at all, so
`scoreWithheld` is true and that fact is suppressed for almost exactly the population this fix
touches). Re-pointing `committedAt` to the worst leg therefore does not newly mismatch a rendered
score, because the score fact it would mismatch is already gated off in the cases where this fix
changes `committedAt`'s value.

## Blast radius

Single function, single call site (`closedDeckSourcesFromChains`, the chain-composite path used by
`GET /api/market/swing/record`'s closed deck and Ask Largo's closed-play briefs). The single-leg
mapper `closedDeckSourceFromRow` is unaffected — it already sources everything from one row by
construction, no mismatch possible there. `terminalPlayFromClosedSwing` (adapters.ts) forwards
these five fields straight through onto `TerminalPlay` with no transformation, so every downstream
reader of `TerminalPlay.entryTriggerUnderlyingPx`/`invalidationUnderlyingPx`/`exitAt`/
`committedAt`/`firstSeenAt` for a CLOSED swing play inherits the fix automatically.

## Fix

Added `worstLegEntryTriggerUnderlyingPx`/`worstLegInvalidationUnderlyingPx`/`worstLegExitAt`/
`worstLegCommittedAt`/`worstLegFirstSeenAt`, each read off `worstLegRow` (`null` exactly when the
worst leg IS the terminal leg, the same `worstLegRow` every prior fix already resolves), and wired
them into the override object with the same `worstLegIsTerminal ? src.X : worstLegX` gate every
sibling field already uses — no new branch invented, same pattern copied exactly.
`entryTriggerUnderlyingPx`/`invalidationUnderlyingPx` reuse the file's existing `fin()` helper
(matching `closedDeckSourceFromRow`'s own `fin(row.entry_underlying_px)`); `exitAt` reuses the
file's existing `closed_at ?? graded_at` fallback chain (matching `contractBundleFromRow`'s own);
`committedAt`/`firstSeenAt` are straight passthroughs of the per-row columns, which are never null
in practice but typed nullable/optional on `SwingClosedDeckSource` regardless.

Deliberately left unchanged: `score`/`scoreWithheld`/`factors` — a separate, already-disclosed gap
(see Evidence above), out of scope for this fix; changing it would be a new, bigger investigation
into carrying a parent leg's evidence score onto a rolled child, not a leg-pairing bug.

## Verify

- New tests in `src/lib/swing/closed-plays.test.ts`:
  - `"borrows the WORST leg's own entryTriggerUnderlyingPx/invalidationUnderlyingPx/exitAt/
    committedAt/firstSeenAt, not the terminal leg's — live repro AMZN positionId 48/44"` — RED on
    the pre-fix source (`git show HEAD:... > closed-plays.ts`, confirmed failing on
    `entryTriggerUnderlyingPx` with the terminal leg's 247.45 instead of the worst leg's 230.1),
    GREEN after restoring the fix.
  - `"falls back to the terminal leg's own ... when the worst leg IS the terminal leg (no mismatch
    to fix)"` — the no-roll-mismatch case stays unchanged.
- `npx tsx --experimental-test-module-mocks --test src/lib/swing/closed-plays.test.ts` — 34/34
  green.
- `npx tsx --experimental-test-module-mocks --test src/lib/swing/play-brief.test.ts
  src/lib/swing/play-brief-narrative-coaching.test.ts
  src/features/nighthawk/command-deck/adapters.test.ts src/lib/swing/play-brief-intel.test.ts
  src/lib/swing/play-brief-roll-history.test.ts` — 892/892 green, no regressions in consumers.
- `npx tsc --noEmit` — clean.
- Full `npm test` (Node 20.20.2) — green, no regressions.
