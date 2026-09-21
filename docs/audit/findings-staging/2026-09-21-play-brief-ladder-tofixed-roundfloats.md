> **kind:** FINDING

## Swing "Structure Ladder" cross-desk agreement note had the same toFixed-vs-roundFloats price mismatch as #5380/#5383 — FIXED

| | |
|---|---|
| **Area** | Night Hawk Swings — Ask Largo (`GET /api/market/swing/play-brief`) |
| **File** | `src/lib/swing/play-brief-ladder.ts` |
| **Status** | FIXED (`fix/swing-play-brief-toFixed-diff-ladder`) |

### Root cause
`narrateVectorGexAgreement` (the function behind `StructureLadder.crossDeskAgreement.note`) baked
the raw `gex.flip` and `spot` floats into its disagreement sentence with `n.toFixed(2)`. The SAME
raw floats also feed `StructureLadder.spot` and the ladder's own `rung.price` fields — plain
numeric JSON fields that get rounded by `roundFloats()` (`Math.round(n*100)/100`) when the whole
`play-brief` route response is serialized (`route.ts` line 57:
`NextResponse.json(roundFloats({ available: true, ...brief }), ...)`).

`toFixed` and `Math.round(n*100)/100` can disagree by a full cent at an IEEE-754 half-cent
boundary — e.g. `(95.175).toFixed(2)` is `"95.17"` (95.175 is actually stored as
95.174999999999997...) while `Math.round(95.175*100)/100` is `95.18`. Because `note` is a STRING
baked server-side BEFORE `roundFloats()` runs, the wrapper can't fix it after the fact — it can
only round plain numeric fields, not numbers already embedded in text.

This is the THIRD occurrence of the exact bug class already fixed in `play-brief-narrative.ts`
(#5380) and `play-brief-narrative-coaching.ts` (#5383) — same shared `fmtPriceLevel` helper
(`src/lib/fmt-money.ts`, added by #5380), same mechanism, different file.

### Evidence
Added a RED→GREEN regression test in `play-brief-ladder.test.ts` using `gex.flip = 95.175` /
`vector.spot = 100.005` — values chosen because they hit the documented IEEE-754 half-cent
boundary. Pre-fix: `git stash` on the code fix alone, test fails (`note` contains `"95.17"` and
`"100.00"`, i.e. the raw-`.toFixed(2)` values). Post-fix: `note` contains `"95.18"` and `"100.01"`
(the `roundFloats`-consistent values), matching what `ladder.spot`/rung prices would show
elsewhere in the same response. Full swing test dir + `fmt-money.test.ts`: 1471/1471 pass.
`tsc --noEmit` clean.

### Blast radius
Checked the other three files disclosed as follow-up in #5383's own PR body
(`play-brief.ts`, `play-brief-diff.ts`, `play-brief-intel.ts`) for the same pattern:
- `play-brief.ts` / `play-brief-intel.ts` still carry many raw `n.toFixed(2)` price-level call
  sites (wall/flip/spot/strike) — genuine remaining follow-up, NOT fixed in this PR (large,
  many-call-site sweep; scoping to keep this PR single-issue per the repo's PR-size policy).
- `play-brief-diff.ts` was investigated and NOT changed: its `narrateSpotShift`/`narrateMarkShift`/
  `narrateStructuralLevelShift` run entirely CLIENT-SIDE (`useSwingPlayBrief.ts`, `"use client"`),
  reading `spot`/`gammaFlip`/`callWall`/`putWall` from `envelope.levels` and `mark` from a
  `TerminalPlay` sourced off `horizons/route.ts` — BOTH of which already apply `roundFloats()`
  server-side before the client ever sees them. Reformatting an already-2dp-rounded number with
  raw `.toFixed(2)` is a no-op, not a live mismatch, so no bug exists there today; converting it to
  `fmtPriceLevel` would be defensive-only, not a fix, and is left alone to avoid overclaiming a
  finding that doesn't reproduce.

### Fix rationale
Same fix as #5380/#5383: import `fmtPriceLevel` from `@/lib/fmt-money` and use it for the two bare
price levels (`gex.flip`, `spot`) instead of raw `.toFixed(2)`. Left every other numeric field in
this file (R:R ratios, distance %, ATR multiples) untouched — none of them are duplicated
elsewhere in the response as a `roundFloats`'d field, so they carry no such risk.

### Remaining follow-up (disclosed, not started)
`play-brief.ts` and `play-brief-intel.ts` still need the same sweep — many call sites
(wall/flip/spot/strike price levels), large enough to warrant their own PR(s).
