## Ask Largo play-brief: WATCH candidates never get the "other concurrent position(s)" sibling disclosure, even when a real committed sibling exists — FIXED

> **kind:** `FINDING`

| **Status** | FIXED |
|---|---|

**Root cause (two independent gaps, same bucket, found in the same deep-dive that fixed #6023's
`ownContractExpiry` gap).** `siblingPositionsNote` (`src/lib/swing/play-brief.ts`) discloses "this
ticker carries N concurrent live position(s)" so a member doesn't silently miss an existing position
on the same underlying — but it was unreachable for a pre-entry WATCH candidate in two separate ways:

1. **The function itself early-returned** `if (play.entry == null || !Number.isFinite(play.entry))
   return null;` before doing anything else. `TerminalPlay.entry` is pnl-anchor-only, populated
   starting at commit (the same fact #6023's `ownContractExpiry` doc comment already established for
   the sibling helper in `play-brief-narrative-coaching.ts`) — so it is *always* null for a WATCH row,
   and this guard made the whole function a no-op for every WATCH candidate regardless of what was in
   `ctx.laneRows`.
2. **`composeSwingPlayBrief`'s call site never even invoked the function for WATCH rows at all** —
   `siblingPositionsNote(ctx)` was only called inside the `bucket === "open"` branch; the
   `bucket === "watch"` branch built only the "Entry" section. So fixing gap (1) alone would still
   have done nothing without also fixing (2) — confirmed by running the new regression test against
   each fix independently (see Evidence).
   The companion `envelope.evidence[]` feeder for the same claim (further down in `play-brief.ts`)
   had a **third**, narrower version of gap (1): `statusBucket(ctx.play) === "open" && ctx.play.entry
   != null` — stricter than the section's own gating even after fix (1), which would have let the
   section fire for WATCH while its evidence-array twin stayed silent, violating this file's own
   Largo C7 rule ("evidence must carry a matching entry, never disagree with what the member reads in
   the section body").

Neither early-return/gate was needed for correctness: a WATCH row can never itself appear in
`ctx.laneRows` with `liveStatus` set (it isn't committed yet), so there is no "self" for the
entry-premium proximity self-test to accidentally exclude — a plain same-ticker + `liveStatus` match
is already a safe, genuine sibling test for a pre-entry play.

**Evidence.** No ticker currently overlaps between a live WATCH candidate and a committed position
(checked live via `GET /api/market/nighthawk/horizons?view=swings`, 2026-10-15 ~02:03 UTC: WATCH =
AVGO/CLS/AMD, none of which collide with the 48 unique committed tickers), but the *shape* of the gap
is live and current: 4 committed tickers right now genuinely carry 2-3 concurrent positions each
(ETSY #1774/#1595, SOXS #1771/#1648/#1572, MRNA #1770/#1745, MUZ #1695/#1613) — i.e. the exact
scenario this disclosure exists for happens routinely on this ledger; it is only a matter of time
before a WATCH candidate lands on one of those tickers (or a new one) while a sibling is already
live, and until this fix the brief would have said nothing.

Git-stash RED→GREEN on the new regression test
(`src/lib/swing/play-brief.test.ts`, "composeSwingPlayBrief: a WATCH candidate (no entry premium yet)
with a same-ticker live sibling still discloses it"): stashing just the two `.ts` fixes (not the
test) and re-running `npx tsx --experimental-test-module-mocks --test src/lib/swing/play-brief.test.ts`
reproduces `130 pass / 1 fail` (the new test fails — no "Other concurrent position(s)" section and no
matching evidence entry); popping the stash restores `131 pass / 0 fail`. Applying only gap-(1)'s fix
(function body) without gap-(2)'s fix (the watch-branch call site) still fails the same test, which
is what caught that the call-site gap was a second, independent defect rather than a side-effect of
the first.

**Blast radius.** `siblingPositionsNote` has exactly one call site per bucket branch (now two: watch
and open) plus its one `evidence[]` twin — no other consumer reads this disclosure. The fix is
additive: every existing OPEN-bucket sibling test (APPS, AMD positionId 51/52) is untouched and still
passes, because `hasOwnEntry` is `true` for those fixtures and the self-test logic is byte-identical
to before in that branch. CLOSED rows are unaffected (the call site for the "Outcome" branch was
never touched).

**Fix rationale.** Three coordinated, minimal changes, each the smallest change that removes its own
gap without changing behavior for any row that already worked correctly:
- `siblingPositionsNote`: replace the early return with a `hasOwnEntry` flag used only to decide
  whether the positionId/premium self-test applies; when `false` (no entry premium — a WATCH row),
  skip straight to "every live same-ticker row is a genuine sibling" since self cannot appear in the
  candidate set.
- `composeSwingPlayBrief`'s `bucket === "watch"` branch: call `siblingPositionsNote(ctx)` through the
  same `safeCompose` the open branch already uses, pushing the section when non-null — identical
  pattern, no new composition primitive needed.
- The `evidence[]` feeder: relax `=== "open"` to `!== "closed"` (matching the book-overlap gate three
  lines above it in the same function, which already includes WATCH) and apply the same
  `hasOwnEntry` logic, so the evidence array can never disagree with the section it is supposed to
  back (Largo C7).

**Evidence of no regression.** `npx tsc --noEmit`: clean. Full `src/lib/swing/*.test.ts`: `1746 pass
/ 0 fail` (25 suites). Full `npm test` (Node 20, `scripts/run-tests.mjs`): see companion run-log entry
for the exact count.
