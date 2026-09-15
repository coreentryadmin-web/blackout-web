> **kind:** FINDING

## Swing play-brief wall/flip/king level provenance mislabeled a live Vector price as GEX's staler read (Largo C8) — FIXED

**Status:** FIXED — `fix/swing-wall-level-provenance-mismatch`

### Root cause

`levelsFromContext` (`src/lib/swing/play-brief.ts`) already prefers the live Vector wall for
`price` (`callWall = vecCallWall ?? gex?.call_wall`), but the `provenance.asOf`/`provenance.freshness`
for the same entry tested the WRONG variable: `gex?.call_wall != null ? "gex" : "vector"` — whether
GEX *has* a value at all, not whether GEX is the side `??` actually fell through to for `price`.
Since both feeds almost always carry a wall value, this ternary picked GEX's own (often staler)
timestamp/freshness bucket every time, even when the displayed price was Vector's live one. Same
bug in all four wall-family entries: call wall, put wall, gamma flip, and GEX king strike.

The correct pattern already exists two blocks below in the same function, for `spot`:
`source: vecSpot != null ? "Vector" : "GEX"` — testing the price-driving vec-side variable, not
whether GEX independently has a value. The four wall-family entries never got this treatment.

### Evidence

- Direct source read confirmed all four provenance blocks used `gex?.X != null ? "gex" : "vector"`
  while `price` used `vecX ?? gex?.X` — mismatched conditions.
- Isolated fixture repro: Vector put wall = 14 (age ~0, "live" bucket), GEX matrix put wall = 13
  (`matrix_age_sec: 100`, "recent" bucket, 60s-600s). Displayed price correctly `14` (Vector wins),
  but pre-fix provenance reported GEX's "recent" freshness/timestamp for a number that was actually
  live — a genuinely fresh value read as stale-by-comparison to a member or to Largo.
- Live cross-check (per the auditing subagent, `playId=SWING:NN`): `spot`'s provenance correctly
  reported `freshness: "live"` while `call wall`/`put wall`/`gamma flip`/`GEX king` all reported
  `"recent"` at the identical ET-minute `asOf` stamp — consistent with the same GEX-age-bleeding-into-
  Vector-price defect.

### Blast radius

Four provenance blocks in one function (`levelsFromContext`, `play-brief.ts`), no other call site.
The `source` LABEL itself ("GEX") is intentional and correct — it's a deliberate domain label for
the wall/flip/king-strike family regardless of which underlying feed supplied today's number
(matches the sibling narrative `chartLevelsSection`'s identical "(GEX)" labeling) — only
`asOf`/`freshness` were wrong, and only those two fields were touched.

### Fix

Replaced `gex?.X != null ? "gex" : "vector"` (asOf) and `gex?.X != null ? gexFresh : vecFresh`
(freshness) with `vecX != null ? "vector" : "gex"` / `vecX != null ? vecFresh : gexFresh` in all
four blocks — the exact same precedence test `price` and `spot`'s provenance already use.

### Fix rationale

Mirrored the already-correct `spot` pattern rather than inventing a new precedence rule. Left
`source: "GEX"` untouched (a deliberate, separately-justified domain label, not part of this bug).

### Tests

- `src/lib/swing/play-brief.test.ts`: new test using two clearly distinct freshness buckets
  (Vector ~0s age = "live", GEX `matrix_age_sec: 100` = "recent") so the assertion cannot pass by
  coincidental bucket overlap — asserts `callWallLevel.provenance.freshness === "live"` and
  `putWallLevel.provenance.freshness === "live"`, not GEX's "recent".
- RED→GREEN proof: `git stash` on `play-brief.ts` reproduced 1 failing test against the pre-fix
  tree; restoring the fix returned the suite to green (68/68).
- `npx tsc --noEmit`: clean.
