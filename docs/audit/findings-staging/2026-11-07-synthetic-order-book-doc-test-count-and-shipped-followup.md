> **kind:** FINDING

## `docs/audit/SYNTHETIC-ORDER-BOOK.md` understates `gex-depth.test.ts`'s coverage and lists an already-shipped follow-up as open — FIXED (docs)

| | |
|---|---|
| **Status** | Fixed (docs-only) |
| **Severity** | P3 (stale audit doc — no source changed, no behavior changed) |
| **Files** | `docs/audit/SYNTHETIC-ORDER-BOOK.md` |

### Symptom

`docs/audit/SYNTHETIC-ORDER-BOOK.md` (the design-of-record for the Thermal depth ladder /
"synthetic order book" feature) made two claims that no longer match `main`:

1. **"Unit-tested in `gex-depth.test.ts` (25 tests)"** — the file actually has **45** `it(...)`
   cases today (`grep -c '  it("' src/lib/gex-depth.test.ts` → 45). The doc was written in the
   same PR that created the test file (#2089, 25 tests at the time) and was never revisited as
   two later PRs added whole new `describe` blocks to the same file: "forced flow between spot
   and a target" (#2093) and "wallMarkerRowIndex" (#3001). Both of those blocks test real,
   shipped invariants the doc's own "Invariants" section does not mention, so the stale count
   wasn't just a number drifting — it was hiding that the test file had grown two whole feature
   surfaces since the doc's last edit.
2. **Follow-up #2, "Matrix rail. A compact version pinned beside the matrix, sharing its strike
   rows."**, is listed as open/unbuilt. It shipped the same day the doc was written —
   PR #2092 ("pin the forced-flow rail to the matrix, row-aligned to each strike") built exactly
   this, including the `depthBandForPrice` exact-band-containment fix the PR's own commit message
   describes; PR #3001 later fixed that rail's wall marker to show the wall's real price instead
   of the nearest rung (`wallMarkerRowIndex`).

### Root cause (of the staleness, not of a code bug — there is no live code bug here)

`git log --oneline -- docs/audit/SYNTHETIC-ORDER-BOOK.md` shows exactly one commit ever touched
this file: `0f4e083fa` (#2089, the feature's original PR). Every later PR that extended
`gex-depth.ts`/`gex-depth.test.ts` or built the "matrix rail" follow-up (`969fc0a8d` #2092,
`cf20de90d` #2093, `25f7be72f` #3001) updated the code and its own tests but never came back to
this design doc — the same "written once, never revisited" pattern the session's other stale-doc
fixes this round found (see `X-CONTENT-CERTIFICATION.md`'s DST-status correction, `#7534`).

### Evidence

```
$ grep -c '  it("' src/lib/gex-depth.test.ts
45
$ git log --oneline -- docs/audit/SYNTHETIC-ORDER-BOOK.md
0f4e083fa feat(thermal): synthetic order book — where dealer hedging flow is forced to happen (#2089)
$ git log --oneline --follow -- src/lib/gex-depth.test.ts | tail -4
25f7be72f fix(thermal): depth ladder wall marker shows real price, not nearest rung (#3001)
cf20de90d feat(thermal): what stands between the price and the desk's own target (#2093)
969fc0a8d feat(thermal): pin the forced-flow rail to the matrix, row-aligned to each strike (#2092)
0f4e083fa feat(thermal): synthetic order book — where dealer hedging flow is forced to happen (#2089)
$ grep -rln "wallMarkerRowIndex\|depthBandForPrice" src --include=*.tsx | grep -v test
src/features/thermal/components/GexHeatmap.tsx
```

`969fc0a8d`'s own commit message ("Phase 2 of the synthetic order book... pin the forced-flow
rail to the matrix") confirms it is the exact feature Follow-up #2 describes as not yet built.
Checked the other three follow-ups against `main` before touching them: #1 (vol axis / shock
engine) and #3 (on the price chart) have no implementation anywhere in `src/` beyond the same
restated comment already in `gex-depth.ts`; #4 (Night Hawk context — annotate a play's target
with forced flow) has zero hits for `forcedFlowBetween`/`ForcedFlow` under
`src/features/nighthawk` or `src/lib/swing`. Both remain genuinely open and were left alone.

### Blast radius

Documentation only. A reader trusting this doc's "Invariants" section would undercount the
regression coverage protecting the depth ladder by nearly half, and a reader trusting the
"Follow-ups" list would propose re-building a matrix-rail feature that has existed (and been
bug-fixed once already) since the doc's own creation date. No source file needed a change.

### Fix (docs-only)

- Updated the test count from 25 to 45.
- Removed the shipped "Matrix rail" item from the numbered Follow-ups list (renumbering the two
  genuinely-open items after it) and added a "Shipped since this list was written" note naming
  the PRs (#2092, #3001) and what they built, so a reader sees both the original claim's intent
  and the corrected, verified-against-`main` status — same pattern as this session's other
  stale-doc corrections. The doc's remaining content (the math, the anchor-refusal band, the
  honest-limits list, the lifecycle/pruning behavior) was independently re-verified against
  `src/lib/gex-depth.ts` (`CALIBRATION_MIN`/`CALIBRATION_MAX` = 0.4/2.5, matching) and
  `prunePastExpiriesFromHeatmap`'s real tests, and left untouched as still accurate.
