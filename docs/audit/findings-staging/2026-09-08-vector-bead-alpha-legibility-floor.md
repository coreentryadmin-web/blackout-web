> **kind:** `FINDING`

## Vector bead rails: weak-bead alpha floor raised 0.25 -> 0.35 for legibility — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | Vector single-chart bead rails (`src/features/vector/lib/vector-wall-rail-core.ts`) |
| **PR** | (pending — `fix/bead-alpha-floor-legibility`) |

### Symptom

Member-reported, live investigation this session: comparing the current Vector bead rail against
the pre-Sept-3 reference render, the member asked whether beads still vary by magnitude at all
("all beads are same sized and same contrast"). Investigation (documented in-session, not
fabricated) found:
- Bead **size** (`beadRadiusForPctShare`, `HALF_PX_MIN`/`HALF_PX_MAX` = 2.2/7.5px) is unchanged
  since before Sept 3 and does vary correctly by magnitude — confirmed via `git diff` against the
  pre-Sept-3 commit showing zero logic changes.
- Bead **alpha** (`fillAlpha`, `FILL_ALPHA_MIN`/`FILL_ALPHA_MAX`) is also unchanged in logic, and
  computed against the correct `BEAD_TUNING_DEFAULT` profile (not the Compare-pane profile, an
  earlier miscalculation this session self-corrected before shipping), differentiation was already
  strong: 21/22 rendered strikes carried distinct alpha values in a real sample.
- The visual "sparser than the reference" complaint is real but is **not a code regression** — it
  is explained by genuine differences in real market gamma concentration between the two sessions
  (measured bead-fusion rate: 85% of top strikes fused into a continuous ribbon on 2026-09-03 vs
  40% on the live comparison session, same unchanged fusion-radius formula).
- One genuine, narrower legibility gap did survive: at the CURRENT floor (`FILL_ALPHA_MIN = 0.25`,
  set 2026-08-18 to fix a prior "everything looks equally bold" complaint), the weakest bead on a
  busy rail renders faint enough to be hard to read against the dark chart background — a real,
  separate complaint from the fusion-rate one above, and the one the member asked to fix.

### Root cause

`FILL_ALPHA_MIN` in `vector-wall-rail-core.ts` was deliberately lowered from 0.6 to 0.25 on
2026-08-18 to fix the opposite problem (a 0.6-0.98 budget made every bead look equally bold, no
strength differentiation). That fix was correct for the problem it solved, but it moved the floor
further than needed — 0.25 is dim enough on the chart's dark background (`#040407`-adjacent) that
the weak end of a row reads as barely-there rather than "visibly dimmer but still present."

### Fix

Raised `FILL_ALPHA_MIN` from 0.25 to 0.35 — the highest value that still clears every existing
differentiation invariant in `vector-wall-rail-core.test.ts` with margin:
- alpha budget spread: 0.63 (test requires `>= 0.6`)
- king-vs-mid gap: 0.39 (test requires `>= 0.3`)
- mid-vs-weak gap: 0.20 (test requires `>= 0.15`)

`FILL_ALPHA_MAX` (0.98) is unchanged. No change to the size ladder, color-shade mixing, or any
other tuning profile (`BEAD_TUNING_COMPARE` is untouched — this only affects the single-chart
Vector desk's default profile, which is the one the member is looking at).

### Blast radius

Single constant, single file (`vector-wall-rail-core.ts`), consumed by `BEAD_TUNING_DEFAULT` only.
Reviewed `BEAD_TUNING_COMPARE` and every other tuning field (`kingBoost`, `kingAlphaCap`,
`kingHaloMul`, `modeledAlphaScale`) for the same floor-too-low pattern — none of them share this
constant or exhibit the same complaint, so none were touched.

### Fix rationale

Considered leaving 0.25 as-is (a previously deliberate, evidence-based choice) vs raising it. Chose
to raise because: (1) the member explicitly requested it after being shown the exact tension
(0.25 was itself a fix for the opposite complaint, so this partially reverses that fix); (2) 0.35
was verified against every existing invariant test before making the change, so it does not
reintroduce the "everything looks equally bold" defect the 0.25 floor was built to prevent — the
spread and gaps that test enforces are still comfortably satisfied. Deliberately did NOT touch
`PCT_FLOOR_SHARE`/`PCT_CEIL_SHARE` (the size-ladder calibration) in the same PR — that constant is
explicitly cross-ticker calibrated with an in-code warning against single-ticker-validated
changes (citing incident #2242), and revisiting it needs its own multi-ticker remeasurement, not
bundled into an alpha-only legibility fix.

### Verify

```
export PATH=/opt/node20/bin:$PATH
npx tsx --test --experimental-test-module-mocks src/features/vector/lib/vector-wall-rail-core.test.ts
```

New test `"weak-bead legibility floor sits at 0.35, not the old 0.25"` — RED before the fix (1/67
failing, proved via `git stash` on the source file alone), GREEN after (67/67).

Full Vector suite: `npx tsx --test --experimental-test-module-mocks src/features/vector/**/*.test.ts`
— 1376/1376 pass. `npx tsc --noEmit`: clean.

### Note

Per `CLAUDE.md`'s self-authored-PR carve-out, this PR holds for Cursor's explicit
`✅ GO AHEAD MERGE` sign-off before merging — not self-merged.
