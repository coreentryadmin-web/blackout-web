> **kind:** FINDING

## `banger-live-sync` silently drops live quote updates for one of two positions sharing an option contract — FIXED

| **Status** | FIXED |
|---|---|

**Root cause.** `banger-live-sync/route.ts`'s quote-fields carriage (FINDINGS 2026-10-09 / migration 017)
built `occToId = new Map<string, number>()` keyed by `contract_occ`, populated by a plain
`occToId.set(r.contract_occ, r.id)` loop over every open `banger_positions` row. Two **different**
open positions can legitimately reference the **identical** `contract_occ` — e.g. two separate
entries into the same strike/expiry on different session days. A `Map<string, number>` can only
hold one value per key, so the second row's `.set()` call silently overwrote the first — whichever
position was iterated last "won," and its sibling's id was gone from the map entirely. The
quote-write loop then read `occToId.get(occ)` once and updated only that one surviving id; the
other position's `bid`/`ask`/`openInterest`/greeks fields were never touched again, leaving them
stuck at their fabricated `null`/`0` defaults forever (this is a best-effort, additive-only
carriage — nothing re-backfills a row once the cron stops reaching it).

**Evidence.** Live repro, ticker MUZ, contract `O:MUZ261016C00008000`: position id 1613 correctly
carried `bid 0.75 / ask 0.90 / openInterest 557`, while position id 1695 — the second open row on
the exact same contract — showed `openInterest: 0` and all-null greeks, despite both positions
being fetched in the same `fetchOpenBangerPositions()` call and both their occs being requested in
the same `fetchOptionsUnifiedSnapshot(occs)` batch. The snapshot data was available for both; only
the id-tracking map silently dropped one.

**Blast radius.** Single call site — the quote-fields write loop inside the `fetchMarks` callback
in `route.ts`. No other consumer reads `occToId`/`occToIds` (it's local to this route, not exported
previously). The decision-making engine (`runBangerLiveSync`/`live-sync.ts`'s scale-out logic) is
untouched — it keys off `contract_occ` directly via its own typed `Map<occ, mark>` contract, which
this carriage was always careful not to change (see the route's own pre-existing comment). Only the
best-effort live-quote-field carriage onto the DB row was affected.

**Fix.** Added an exported pure function `occToPositionIds(rows): Map<string, number[]>` that groups
ALL ids sharing an occ into an array instead of overwriting. Renamed the local map `occToId` →
`occToIds` (now populated via this function, not a manual clear+loop). Changed the write site from a
single `if (positionId != null)` to `for (const positionId of positionIds)`, so every position
sharing a contract gets the same live snapshot applied. No other behavior changed — RTH gating,
auth, the kill-switch, and the decision-engine call are byte-identical.

**Why this fix, not an alternative.** Keeping the id→array grouping local and pure (rather than,
say, changing `fetchOptionsUnifiedSnapshot` or `live-sync.ts`'s contract) keeps the fix scoped to
exactly the carriage logic that was wrong, with zero risk to the scale-out decision engine's
existing signature or tests — the same discipline the original migration-017 carriage used.

**Tests.** `route.test.ts` gained: 4 pure-function tests for `occToPositionIds` (two positions
sharing a contract — using the exact live repro ids 1613/1695 — distinct contracts, three positions
on one contract, and an absent-occ lookup), plus a source-scan regression test asserting the new
write-loop pattern exists and the old single-value `occToId.set(r.contract_occ, r.id)` pattern is
gone. RED→GREEN proven: `git stash` of the `route.ts` fix dropped 5/7 tests to failing (4 on the
missing `occToPositionIds` export, 1 on the missing write-loop pattern); restoring the fix brought
all 7 back to green. `tsc --noEmit` clean on Node 20.
