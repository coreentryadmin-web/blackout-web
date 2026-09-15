> **kind:** FINDING

## Night Hawk Legacy calendar tile diluted its premium average with stock-only nulls — FIXED

| **Status** | FIXED (PR pending) |
|---|---|

**Root cause:** `legacyBoardCalendarBuckets` (`src/features/nighthawk/lib/legacy-board-table-utils.ts`)
computed the day tile's "Net premium" as
`resolved.reduce((s,r) => s + (r.premiumPct ?? 0), 0) / resolved.length` — a stock-only Legacy play
(no resolvable option contract) carries `premiumPct: null` by design (`overlayLegacyQuotes`
fail-closes rather than reporting the underlying's move as an option return — see that file's own
MU-$880C comment). The `?? 0` coalesce meant a null premium (no data at all) was blended into the
average as if it were an ACHIEVED 0% return, silently diluting a real winner/loser toward zero on a
mixed day, and on an all-stock-only day reading the tile as a flat "+0%" even while the underlying
is up double digits.

**Evidence:** live, 2026-09-15 ~14:37 UTC — VNCE (stock-only, no options data), today's only play,
up +10-12% on the underlying and near its target — the calendar tile for today read "+0%" pre-fix.
Traced the arithmetic directly: with VNCE as the sole play, `resolved.length` was 1 but the one
row's `premiumPct` was null, so `net = 0`, producing a tile that reads identically to a
genuinely-flat/no-op day.

**Fix:** only rows with a REAL (non-null) `premiumPct` participate in the blended average — a
stock-only play no longer contributes a phantom 0. A day with zero real premium data points still
reports 0 (same as today, no visible regression for the current single-stock-only-play case),
matching this same function's existing never-fabricate-a-result discipline for the pulled-play case
immediately above it in the file.

**Blast radius:** `legacyBoardCalendarBuckets` only — confirmed the shared `vectorBoardScorecard`
(`vector-board-row-utils.ts`) does not average `premiumPct` the same way (it counts winner/runner
booleans, not an average), so this dilution pattern is isolated to this one Legacy-only function,
not a cross-lane shared-type issue.

**Verified:** git-stash RED→GREEN proof (1/13 new+existing tests in
`legacy-board-table-utils.test.ts` fails with the fix reverted — the new dilution test — 13/13 pass
with it restored), `npx tsc --noEmit` clean, full `npm test` on Node 20 — 14300 pass / 0 fail /
3 skipped.

**Note:** a separate, related cosmetic question — whether an all-null day should render "N/A"/"—"
instead of "+0%" — needs a `VectorBoardCalendarBucket` type change shared with other lanes' boards
(0DTE/Swings), which is outside this fix's scope and outside Legacy's ownership boundary; flagged
separately in `docs/audit/nighthawk-legacy-live-journal.json`'s
`knownOpenItems.legacyCalendarTileNullPremiumAsZero_2026-09-15` for operator/Cursor review rather
than bundled into this fix.
