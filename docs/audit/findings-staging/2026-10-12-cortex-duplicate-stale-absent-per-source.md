> **kind:** FINDING

## Cortex `absent[]` double-counts a source that emits multiple stale items — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Area** | Night Hawk 0DTE — Cortex evidence composer (`src/lib/nighthawk/cortex/compose.ts`) |
| **Severity** | P3 (deterministic code-logic bug, confirmed by reading source — not a gate-calibration claim, no 3-instance threshold needed) |

### Root cause

`composeCortexEvidence` (`compose.ts`) iterates every `EvidenceItem` a source's
`deriveXEvidence` function returns and, for each item individually, decides whether it
has decayed past `ABSENT_AFTER_HALF_LIVES` (3 half-lives) and should self-silence. When
it has, the loop pushes `"<source>: evidence stale (older than 3 half-lives) — self-
silenced"` onto the `absent: string[]` array — **once per item**, not once per source.

Several sources can legitimately return more than one `EvidenceItem` from a single read.
`gex-walls` (`sources/gex-walls.ts`) is the clearest case: `deriveGexWallsEvidence` can
emit a wall-path veto/support item AND a separate regime-style oppose item
(`regimePosture === "long"`) from the *same* GEX snapshot — both items share the exact
same `asOf` and `halfLifeSec` (`const base = { source, halfLifeSec, asOf: gex.asOf }`).
Because both items decay identically, if the snapshot is stale beyond 3 half-lives,
**both** independently trip the staleness branch and push the byte-identical absence
string twice.

This is not just a cosmetic duplicate line. `src/lib/zerodte/tiers.ts` reads
`verdict.absent.length` directly in two places:
- `cortexAbsentCount = Array.isArray(c.absent) ? c.absent.length : null;` (line 476)
- `CORTEX_THIN_EVIDENCE_MAX_ABSENT = 6` — "6+ absent means ≤2 answered" — caps a play
  at Tier B regardless of score once `absent >= 6` (line 165/334).

A source that duplicates its own absence inflates this count by +1 per extra duplicate
item, which can push a borderline play over the 6-source thin-evidence threshold earlier
than the real "N of 8 sources answered" picture warrants — a genuine (if narrow) risk to
the A/B tier assignment, not merely a display nit.

### Evidence

Found live on a real committed play: `IONQ` short, flagged 10:28 ET 2026-10-12, Tier A,
score 79. `GET /api/market/zerodte/record?days=1`'s `entry_context.cortex.absent` for
that row listed:
```
"gex-walls: evidence stale (older than 3 half-lives) — self-silenced"
"gex-walls: evidence stale (older than 3 half-lives) — self-silenced"
```
— the identical string twice, for a single source, among only 5 total entries (4
distinct sources: gex-walls, wall-trend, catalyst-news, darkpool-confluence). On this
particular row the distinct-vs-raw count (4 vs 5) didn't cross the 6-source
`CORTEX_THIN_EVIDENCE_MAX_ABSENT` threshold either way, so the tier outcome happened to
be unaffected here — but the mechanism that could push a different, more-borderline row
across that threshold is real and was confirmed by reading `gex-walls.ts`'s `wallPathCheck`
(a veto wall and a regime-style oppose can both fire from one read) and `compose.ts`'s
per-item (not per-source) loop.

Regression test added and proven RED→GREEN: `src/lib/nighthawk/cortex/compose.test.ts`
— `"a source whose evidence emits multiple stale items self-silences ONCE, not once per
item"`. Feeds a `gex` slice with a stale `asOf` (50 min, > 3×15min half-life), a blocking
call wall, AND `regimePosture: "long"` (both a veto and a regime-oppose item from one
source). Before the fix: `v.absent.filter(a => a.startsWith("gex-walls:"))` had length 2.
After: length 1.

### Fix

`compose.ts`'s per-source loop now tracks pushed absence strings in a `Set<string>`
scoped to that source's iteration (`pushedForSource`/`pushAbsentOnce`) and only pushes a
given exact message once per source, regardless of how many items from that source
independently trip the same absence condition (no valid `asOf`, stale beyond 3
half-lives, or an explicit `stance: "absent"` item). This matches the design intent
stated in the source's own comment: "the honest statement 'this source cannot answer
right now'" is a per-source fact, not a per-item one.

### Blast radius

Every Cortex source is affected in principle (the loop is shared), but only sources that
can emit >1 `EvidenceItem` from a single read are exposed in practice. Confirmed
`gex-walls` can (veto/support wall + regime-style oppose, or even all three
simultaneously). Did not find another source with the same multi-item-per-read shape in
this pass (`flow-quality`, `sector-heat`, `catalyst-news`, `opening-harvest`, `vex-charm`,
`darkpool-confluence`, `wall-trend` each return a single item per the registry's typical
shape), but the fix is general — it dedupes by exact string per source regardless of
which source structurally triggers it, so no other source needs its own fix even if one
is later found to also multi-emit.

### Fix rationale

Dedup at the point of construction (compose.ts) rather than downstream in `tiers.ts` (the
consumer) — the composer is the one place that knows "this is the same source speaking
twice", and every downstream reader of `verdict.absent` (tiers.ts, pane.ts's narrative
text, any future consumer) benefits automatically rather than needing its own dedup
logic. Left `gex-walls.ts` itself unchanged — returning multiple distinct evidence items
per read is correct and intentional (a veto and a regime-oppose are genuinely different
claims when the data is fresh); the bug was only in how the composer's absence rollup
degenerates when all of a source's items share one clock.

### Verification

- `npx tsx --experimental-test-module-mocks --test src/lib/nighthawk/cortex/compose.test.ts` — 16/16 pass (new test proven RED pre-fix, GREEN post-fix via git-stash).
- Full `src/lib/nighthawk/cortex/*.test.ts` + `src/lib/nighthawk/cortex/sources/*.test.ts` — 129/129 pass.
- Downstream consumers `src/lib/zerodte/tiers.test.ts` (27/27), `cortex-gate.test.ts` (36/36), `pane.test.ts` (29/29) — all pass, no regressions.
- `npx tsc --noEmit -p .` — clean.
- Full `npm test` run in progress at time of writing (background), Node 20.
