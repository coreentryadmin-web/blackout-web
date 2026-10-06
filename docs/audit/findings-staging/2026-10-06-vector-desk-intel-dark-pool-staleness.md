> **kind:** FINDING

## Vector `vector-desk-intel.ts` served stale dark-pool levels as current — FIXED

| **Status** | FIXED |
|---|---|
| **Area** | Vector / BIE (`src/lib/bie/vector-desk-intel.ts`) |
| **Severity** | P2 (data-correctness — stale data presented as current, no crash) |
| **Mandate** | Ask Largo × Night Hawk Swings standing ownership mandate (CLAUDE.md) — this is the documented mirror fix following #5608 |

### Root cause

PR #5608 (merged, `f08c1cd99`) fixed the identical gap for swing's play-brief construction
sites: the dark-pool cache (`vector-dark-pool-cache.ts`) is warmed on its own ~10min cadence
with a 25min TTL, deliberately looser than the 120s `VECTOR_STALE_MS` the rest of the Vector
snapshot uses, and the compute-recency `asOf` on the surrounding state says nothing about this
ONE field's own cache age (`darkPoolAsOf`). So a `VectorFullState` computed fresh seconds ago can
still carry dark-pool levels last fetched 20+ minutes earlier, presented with no distinction from
a current read.

#5608 fixed this for `src/lib/swing/play-brief*.ts` (via `vector-absent-sections.ts`'s
`DARK_POOL_STALE_MS`/`dark_pool_stale` + swing's own `darkPoolStale()` helper in
`play-brief-absence.ts`), and was left as a documented follow-up for a SECOND consumer of the
same `darkPoolLevels` field: `src/lib/bie/vector-desk-intel.ts`'s `darkPoolBriefLine()` and
`knownVectorNumbers()`, both of which read `state.darkPoolLevels` directly with no staleness
check at all.

### Fix

`vector-desk-intel.ts` is deliberately "deterministic, no LLM, no network" per its own file
header — it reads purely off the passed-in `VectorFullState` rather than the read-context fields
(`dark_pool_stale`, attached only on the way out of `fetchVectorFullState` via `withReadContext`).
So rather than depending on callers to have passed the enriched read-context object, it computes
staleness itself from the two raw fields every `VectorFullState` carries: `asOf` (when the state
was measured) and `darkPoolAsOf` (when the dark-pool cache entry was actually fetched), using the
same `DARK_POOL_STALE_MS` (20min) constant #5608 defined in `vector-absent-sections.ts`.

Both call sites now omit (not disclose-as-stale) when stale:
- `darkPoolBriefLine()` returns `null` instead of formatting a `DARK POOL …` line.
- `knownVectorNumbers()` skips adding the dark-pool strike/pct numbers to the grounded-number set,
  so a stale number can never be quoted even if some other caller bypasses `darkPoolBriefLine`'s
  own gate — this file's own "GROUNDING CONTRACT" discipline (every `{{…}}` number must trace back
  to `knownVectorNumbers`) requires both mechanisms to agree.

Omission (not a "stale — last synced HH:MM" disclosure) was the deliberate choice: this module has
no `unavailableSources`/absence-note channel of its own the way swing's play-brief does — it is a
pure formatter, not a composer with an absence-reporting contract — so silence is the honest move
rather than inventing a disclosure mechanism out of scope for this fix.

### Blast radius

Both consumers of `vector-desk-intel.ts`'s dark-pool functions are fixed by this one change:
`vector-desk-brief.ts`'s `composeVectorDeskBrief` (via `darkPoolBriefLine`) and
`vector-pulse-brief.ts`'s pulse intel (via `knownVectorNumbers`). No other file reads
`state.darkPoolLevels` directly outside `vector-desk-intel.ts` and the already-fixed swing
construction sites (confirmed via repo-wide grep).

### Test evidence

Added regression tests to `vector-desk-intel.test.ts`:
- `darkPoolBriefLine`: null (omitted) when stale vs `asOf`; still renders when fresh.
- `knownVectorNumbers`: omits the dark-pool strike/pct (24% share) when stale.

Also corrected `vector-full-state-fixture.ts`'s shared `darkPoolAsOf` fixture value, which was
(coincidentally, pre-dating this fix) set almost 6 months stale relative to its own `asOf` — it
had never been exercised by a staleness check before, so nothing caught it. Updated to a fresh
value (5 min before `asOf`) so the shared fixture exercises the common non-stale path by default;
the new staleness tests construct their own stale override.

RED→GREEN proof (git-stash the fix, re-run):
- Pre-fix: 2 test failures (`darkPoolBriefLine` stale-omission test, `knownVectorNumbers`
  stale-omission test).
- Post-fix: `vector-desk-intel.test.ts` 22/22 pass.
- Full related-file sweep (`vector-desk-brief`, `scenario-read`, `ecosystem-context`,
  `vector-full-state-fit`, `vector-full-state-cache`, `vector-absent-sections`): 100/100 pass.
- `npx tsc --noEmit`: clean.
