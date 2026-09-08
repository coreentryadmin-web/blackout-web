> **kind:** `FINDING`

## Ask Largo swing brief: "Dealer posture" evidence cited a different wall than the rest of the envelope — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | Ask Largo swing play-brief (`play-brief.ts`'s `evidenceFromContext`) |
| **PR** | (pending — `fix/dealer-posture-nearest-wall-vector-precedence`) |

### Symptom

Third instance of the same bug shape found this session, during the standing Ask Largo monitor
cycle, live-fetching the NN swing brief (`SWING:NN`, positionId 32). `envelope.levels[]` and the
"Trade manager read" narrative both correctly showed `put wall 14.00` (Vector's live wall, per the
already-established precedence). But the `evidence[]` "Dealer posture" line said
`"nearest wall 13.00 (-2.2 pts)"` — a different strike, for the same ticker, in the same response.

### Root cause

`evidenceFromContext`'s "Dealer posture" evidence line read `gex.nearest_wall` — a field computed
entirely inside `gex-positioning.ts`'s `nearestWallFromLevels(call_wall, put_wall, spot)` from the
raw GEX matrix ONLY, with no knowledge of Vector's live wall values. Meanwhile the SAME file's
`levels` array (and `play-brief-narrative.ts`'s `focalLevelsFrom`) already resolve call/put wall as
`vecX ?? gex?.x` (Vector-preferred, GEX-matrix fallback) — the precedence fixed for the "GEX king"
level earlier this session. The evidence line was a third call site nobody had updated to match.

### Fix

`evidenceFromContext` now computes the same Vector-preferred call/put wall values used elsewhere in
the brief, and calls `nearestWallFromLevels` with THOSE values instead of reading the raw
`gex.nearest_wall` field. To make this possible without pulling `gex-positioning.ts`'s
`server-only` guard into `play-brief.ts` (which broke test loading — Node's test runner treats the
`server-only` sentinel as a hard boundary violation once imported outside a real request), the pure
`nearestWallFromLevels` helper was extracted into a new marker-free module,
`src/lib/providers/gex-nearest-wall.ts`. `gex-positioning.ts` now imports and re-uses that same
shared implementation instead of keeping its own copy, so there is exactly one nearest-wall
algorithm, not two that could drift.

### Blast radius

Single evidence line (`evidenceFromContext`'s "Dealer posture" text), single new shared file. The
`net_gex`/`gamma_posture` facts in the same evidence block are unchanged — they have no Vector
equivalent, so they correctly stay GEX-matrix-only. `gex-positioning.ts`'s own `nearest_wall` field
(used elsewhere in the app, e.g. Heat Maps) is unchanged in behavior — still computed from the raw
GEX matrix only, as documented; only `play-brief.ts`'s evidence text now recomputes its OWN,
brief-consistent version rather than reading that field directly.

### Verify

```
export PATH=/opt/node20/bin:$PATH
npx tsx --test --experimental-test-module-mocks src/lib/swing/play-brief.test.ts
npx tsx --test --experimental-test-module-mocks src/lib/providers/gex-positioning.test.ts
```

New test: GEX matrix has put wall 13 (nearest_wall says so too), Vector has a live put wall 14 —
the Dealer posture evidence line must say "nearest wall 14.00", matching `envelope.levels`'s put
wall. RED before the fix (1/35 failing on `play-brief.test.ts`), GREEN after (35/35).
`gex-positioning.test.ts`: 11/11 pass (extraction didn't change its own behavior).

Full `src/lib/swing/*.test.ts`: 827/827 pass. `npx tsc --noEmit`: clean.

### Note

Per `CLAUDE.md`'s self-authored-PR carve-out, this PR holds for Cursor's explicit
`✅ GO AHEAD MERGE` sign-off before merging — not self-merged.
