## 'Other concurrent position(s)' count labeled a non-committed WATCH candidate as a 'live position', overstating real exposure — FIXED

> **kind:** `FINDING`

| **Status** | Fixed |
|---|---|

**Found:** 2026-10-21, Ask Largo standing mandate live health-check cycle (Workflow deep-dive of
`GET /api/market/swing/play-brief` against real production WATCH/OPEN positions).

**Root cause:** `siblingPositionsNote()` (`src/lib/swing/play-brief.ts`, rendered section body)
and its evidence[]-fact mirror in `evidenceFromContext` both rendered
`${siblings.length + 1} concurrent live position(s)` unconditionally for both the WATCH and OPEN
buckets. `siblings` is correctly filtered to rows with a real `liveStatus` (actually committed),
but the unconditional `+1` always counted the brief's OWN subject play as one more "live position"
— true for an OPEN/HOLD subject, but false for a WATCH-bucket subject, which per this same
function's own 2026-10-15 fix comment "is never itself committed" and can never appear in
`laneRows`. Both call sites already compute `hasOwnEntry` (whether the subject itself has a real
entry premium) for an unrelated self-exclusion test a few lines above, but never used it to gate
the `+1`.

**Evidence:** Live repro: reviewing a real TSLA WATCH SHORT candidate (no positionId, no entry
premium, not committed) produced "TSLA carries 2 concurrent live position(s)" in both the rendered
"Other concurrent position(s)" section AND a structured `evidence[]` fact tagged
`kind:"fact"`/`freshness:"recent"`, when there was exactly ONE real committed TSLA position (the
open LONG #60). A member reading only this line could believe they have two live TSLA positions
open when they have one open position and one watch-listed idea — overstating real capital-at-risk
exposure.

**Fix:** only add the "+1" for the subject itself when `hasOwnEntry` is true (the subject is itself
live/committed) at both call sites (the rendered section body and the evidence-fact mirror),
matching the existing `hasOwnEntry` signal already computed in each function.

**Tests:** `src/lib/swing/play-brief.test.ts` — added a new test (WATCH candidate with exactly one
real committed sibling must disclose "1 concurrent live position", not "2") and corrected a
pre-existing test ("a WATCH candidate ... with a same-ticker live sibling still discloses it")
whose assertion had encoded the exact bug being fixed here (it asserted "2 concurrent live
position(s)" for a WATCH subject with one real sibling — the correct count is 1). Full
`play-brief.test.ts` suite: 159/159 pass; `tsc --noEmit` clean. The sibling OPEN-bucket test (AMD
positionId 51/52, both real committed positions) is unaffected — that subject has a real entry
premium, so `hasOwnEntry` is true and the count correctly stays 2.

**Blast radius:** `play-brief.ts` only, both the `siblingPositionsNote()` section body and the
`evidenceFromContext` evidence-fact mirror (the two call sites this file's own comments document as
needing to "never disagree").
