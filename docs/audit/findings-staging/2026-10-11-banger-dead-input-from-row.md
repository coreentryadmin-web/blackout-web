## Banger `bangerInputFromRow` — dead export, `live-sync.ts` hand-builds the same shape inline — FIXED

> **kind:** `FINDING`

| **Status** | Fixed in PR (fix/banger-dead-input-from-row) |
|---|---|

**Symptom:** none live — pure dead code found during a routine DISCOVERY-lane sweep, not a
production defect.

**Root cause:** `bangerInputFromRow` (`src/lib/banger/discord-trade-notify.ts`) maps a
`BangerPositionRow` (the DB ledger row) into the `BangerTradeDiscordInput` shape the Chief Trade
Discord embed builder consumes. Its sibling `bangerInputFromInsert` (same file, same shape, built
from the commit-time insert instead of the ledger row) IS live-wired — `commit.ts` calls it via
`notifyBangerTradeOpenFromInsert` on a fresh open. But the Row-shaped half of the pair was never
actually called: `live-sync.ts`'s scale-out notify path (`EXIT_RUNNER`/`STOP_OUT`/`TAKE_PARTIAL`)
needs the exact same mapping but hand-builds the object literal inline instead, substituting the
freshly-fetched live `mark` for the function's `row.last_mark` field (the one genuine difference —
not a byte-identical duplicate, but the same structural mapping).

**Evidence:** `grep -rwn "bangerInputFromRow" --include=*.ts --include=*.tsx src scripts docs` →
only the function's own definition and its direct unit test/fixture usages in
`discord-trade-notify.test.ts`. No production call site anywhere (confirmed `live-sync.ts:219-230`
builds the payload inline instead of calling it).

**Fix:** Removed `bangerInputFromRow` and the now-unused `BangerPositionRow` type import from
`discord-trade-notify.ts`. In `discord-trade-notify.test.ts`, the 2 tests that used it purely as a
fixture-builder for `buildBangerTradePayload` now use a local, test-only `inputFromRow` helper
(same mapping, doc-commented as test infrastructure, not a reintroduction of the dead export); the
one test that asserted on the function's own mapping logic directly is removed as redundant with
that helper's own use.

**Fix rationale:** Pure deletion of the production export. Did NOT wire `live-sync.ts` to call a
kept version of this function instead — that would mean folding its own live-mark override into
the shared helper, which is a design choice for the Banger lane to make, not something to do
unilaterally inside a dead-code sweep.

**Blast radius:** `src/lib/banger/discord-trade-notify.ts`,
`src/lib/banger/discord-trade-notify.test.ts` only. `bangerInputFromInsert` and
`buildBangerTradePayload` (the real, live-called exports in the same file) are untouched.

**Regression guard:** `discord-trade-notify.test.ts` — 4/4 pass (Node 20,
`--experimental-test-module-mocks`). `tsc --noEmit` clean.
