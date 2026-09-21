> **kind:** `FINDING`

## Swing play-brief: `expectedMoveCoaching`/`wallIntegrityCoaching` still sampled `Date.now()` instead of `ctx.readMs` — FIXED

| **Status** | FIXED |
|---|---|

**Context.** This session's readMs sweep (#5334/#5336/#5341/#5345/#5351/#5353/#5355/#5356) has
been incrementally threading `ctx.readMs` (the single request-wide staleness anchor
`composeSwingPlayBrief` samples once) through `play-brief-narrative-coaching.ts`. #5356's own
commit message explicitly named the next two remaining call sites: *"the remaining ~10 Date.now()
call sites in this file (expectedMoveCoaching, wallIntegrityCoaching, ...) still don't currently
take ctx and would need the same optional-readMs-param signature change confluenceCoaching
established in #5351 — left as the next follow-up."* (magnetCoaching/crossDeskCoaching/
shortInterestCoaching were fixed in that same #5356 — this finding does NOT touch them, and this
PR was rebased on top of #5356 to avoid re-doing that work.)

**Root cause.** In `composeCoachingBullets`'s single `push()` block, `expectedMoveCoaching` and
`wallIntegrityCoaching` sit immediately next to `confluenceCoaching` (already anchored) and
`magnetCoaching` (already anchored as of #5356), all reading the same `vec` snapshot in the same
compose pass — but neither ever had a `readMs` parameter at all, so each called `Date.now()`
directly inside its own `vectorSnapshotStale` check.

**Why it matters.** Same live-repro class every prior fix in this chain describes: two sections
judging the SAME Vector snapshot at two different real clock instants can straddle the 120s
`VECTOR_STALE_MS` window and disagree about whether identical data is fresh — one bullet renders,
its sibling silently drops, for no reason a member could see.

**Fix.** Added an optional trailing `readMs?: number` param to both functions (default
`Date.now()` for backward compatibility with existing callers/tests), mirroring
`confluenceCoaching`'s existing shape exactly. `composeCoachingBullets` now threads
`ctx.readMs ?? undefined` into both calls.

**Blast radius.** Scoped to these two functions + their one call site; no other call sites exist
repo-wide (grepped).

**Evidence (RED→GREEN).** Added 2 tests mirroring `confluenceCoaching`'s existing anchor test
(same vec/asOf fixture; an anchor 60s after `asOf` reads FRESH, no anchor falls back to the real
wall clock — decades past the fixture — and reads STALE/null). RED confirmed pre-fix via
`git stash` isolating only the source change (both new tests fail, nothing else regresses). GREEN
post-fix: full `play-brief-narrative-coaching.test.ts` suite passes. `npx tsc --noEmit -p .` clean.

**Scope note (this cycle, market-open, 2026-09-21):** ran the standard 5-engine health check +
CloudWatch sweep alongside this fix; no other new defects found this cycle (0DTE board coherence
pass under real RTH opening-window gating, live swing ticker sampling on 3 fresh tickers — see
coordinator handback for detail).
