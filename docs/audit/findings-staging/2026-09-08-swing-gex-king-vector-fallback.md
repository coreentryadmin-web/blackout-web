> **kind:** `FINDING`

## Ask Largo swing brief: "GEX king" showed two different strikes in the same envelope — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | Ask Largo swing play-brief (`play-brief.ts`'s `levels` builder) |
| **PR** | (pending — `fix/king-strike-vector-fallback`) |

### Symptom

Found during the standing Ask Largo monitor cycle (2026-09-08), live-fetching the CG swing brief
(`SWING:CG`, positionId 25). The same labeled quantity — "GEX king" — rendered **two different
strikes in the same response**: `52.5` in the structured `envelope.levels[]` array (surfaced in
"Levels on chart"), `50.00` in the "Trade manager read" narrative bullet
("GEX king 50.00 — largest gamma concentration on the board."). Same class of bug as the confluence
-score duplication found and fixed earlier this session — one figure, computed twice, disagreeing.

### Root cause

`play-brief.ts`'s `levels` array builds `call wall`, `put wall`, and `gamma flip` all with the same
established precedence — prefer a LIVE Vector reading, fall back to the GEX matrix only when
Vector is stale/absent (`vecX ?? gex?.x`, mirroring `focalLevelsFrom` in `play-brief-narrative.ts`).
The "GEX king" entry, immediately below those three in the same function, was left reading ONLY
`gex?.gex_king_strike` — no Vector-ladder fallback at all. Meanwhile the narrative side's
`focalLevelsFrom` already computed king as `vecKing ?? kingFromGex` (Vector's `ladder.rows`
`isKing` strike first). Two different precedence rules for the same field, in two sections of the
same brief — an incomplete rollout of the Vector-preferred pattern to this one level, not an
intentional divergence.

### Fix

`play-brief.ts`'s king computation now mirrors call wall/put wall/flip exactly: `vecKing ??
gex?.gex_king_strike`, with the matching staleness/provenance handling (`kingFromStaleGex` checked
against whether the GEX-sourced value specifically is what's being used, same shape as
`callWallFromStaleGex`/`putWallFromStaleGex`/`flipFromStaleGex`).

### Blast radius

Single field (`king`), single function (`levels` builder in `play-brief.ts`). Reviewed the other
three sibling levels (call wall, put wall, gamma flip) in the same function — they already had the
correct Vector-preferred pattern; only king was missing it. `play-brief-narrative.ts`'s
`focalLevelsFrom`/`narrateKing` were already correct and untouched.

### Verify

```
export PATH=/opt/node20/bin:$PATH
npx tsx --test --experimental-test-module-mocks src/lib/swing/play-brief.test.ts
```

New test: a live Vector ladder king (24) and a present GEX matrix king (25) both supplied — the
`levels` array must show 24 (Vector), not 25 (GEX), matching what the narrative side already shows
for the same inputs. RED before the fix (1/35 failing via `git stash` on the source file alone),
GREEN after (35/35).

Full `src/lib/swing/*.test.ts`: 827/827 pass. `npx tsc --noEmit`: clean.

### Note

Per `CLAUDE.md`'s self-authored-PR carve-out, this PR holds for Cursor's explicit
`✅ GO AHEAD MERGE` sign-off before merging — not self-merged.
