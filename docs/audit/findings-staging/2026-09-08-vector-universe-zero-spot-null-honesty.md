> **kind:** `FINDING`

## Vector universe row showed spot:0 for a halted/delisted ticker instead of null — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | Vector universe scanner (`vector-universe.ts`'s `buildVectorUniverseRow`) |
| **PR** | (pending — `fix/vector-universe-zero-spot-null-honesty`) |

### Symptom

Found live during the standing Ask Largo/5-engine monitor cycle (2026-09-08),
`GET /api/market/vector/universe`: ticker `KIAN` had `spot: 0` with a fresh `asOf` timestamp while
every other field (`gammaFlip`, `vexFlip`, `topCallWall`, `topPutWall`, `topCallPct`, `topPutPct`)
was correctly `null`. A real numeric zero where every sibling field honestly reported absence is
the "0-where-real-number-or-null-expected" class this sweep watches for.

### Root cause

`buildVectorUniverseRow` computes `const spot = hm?.spot ?? null;`. The upstream heatmap can
legitimately return `spot: 0` (a halted/delisted ticker, or a provider placeholder for "no price")
— not `undefined`/`null` — and `??` only replaces nullish values, so a literal `0` passes straight
through untouched. Every downstream consumer of this same `spot` local already treats `<= 0` as
"no real spot" (the `spot != null && spot > 0` self-heal guard immediately below it, the
`computeGexWalls` gate, etc.), which is exactly why every OTHER field on the row came out null —
only the raw `spot` field itself skipped that treatment.

### Fix

`spot` is now `hm?.spot != null && hm.spot > 0 ? hm.spot : null` — the same `> 0` condition every
downstream consumer of this value already applies, just applied once at the source instead of
implicitly re-derived at each call site.

### Blast radius

Single field, single function. Every downstream computation (`gexWalls`, `beadRailGexWalls`,
`vexWalls`, the `removeDynamicUniverseTicker` self-heal) already gated on `spot > 0` explicitly, so
none of them change behavior — this only changes what the row's own `spot` field reports when the
heatmap's spot is exactly zero.

### Verify

```
export PATH=/opt/node20/bin:$PATH
npx tsx --test --experimental-test-module-mocks src/features/vector/lib/vector-universe.test.ts
```

New test: a `ZEROSPOT` fixture ticker whose heatmap returns `spot: 0` — the row's `spot` field
must be `null`, not `0`. RED before the fix (1/12 failing via `git stash` on the source file
alone), GREEN after (12/12).

Full `src/features/vector/**/*.test.ts`: 1376/1376 pass. `npx tsc --noEmit`: clean.

### Note

Per `CLAUDE.md`'s self-authored-PR carve-out, this PR holds for Cursor's explicit
`✅ GO AHEAD MERGE` sign-off before merging — not self-merged.
