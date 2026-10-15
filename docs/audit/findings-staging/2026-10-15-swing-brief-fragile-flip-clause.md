## Ask Largo swing play-brief: dealer-posture narrative cited only the single stable gamma flip, never the fragility fields computed alongside it — a "regime about to re-cross" read the same as a "comfortably stable" one — FIXED

> **kind:** `FINDING`

| **Status** | FIXED |
|---|---|

**Root cause.** `gex-positioning.ts` computes `flip_crossings`, `flip_nearest`, and
`distance_to_nearest_flip_pct` unconditionally for every ticker/brief, with its own header
explicitly warning: "`flip_crossings` > 1 means the served `flip` is NOT the only strike where
dealer gamma changes sign, so the regime is more fragile than the single flip implies — read
`flip_nearest`/`distance_to_nearest_flip_pct` before calling [it] a comfortable distance from
flipping." These fields are already consumed elsewhere (`spx-desk-intel.ts` narrates
`shift_summary`; `v2/origins/positioning.ts` falls back to `distance_to_nearest_flip_pct` for
discovery gating), but `dealerPostureLine` (`src/lib/swing/play-brief-narrative.ts`) — the "Trade
manager read" narrative's dealer-posture clause — only ever cited the single `flip` value, never
the crossing count or the nearer crossing's distance. A book with a second zero-crossing just
beyond the served flip rendered identically to a book with one stable crossing far from spot, even
though the two carry materially different regime-flip risk.

**Evidence.** Confirmed live via source inspection (not a repro against a specific ticker this
cycle): `flip_nearest`/`flip_crossings`/`distance_to_nearest_flip_pct` are defined and documented
in `gex-positioning.ts` (lines ~152-165), populated unconditionally in `getGexPositioning`/
`gexPositioningFromHeatmap` (lines ~387-394, 441-444), and carried into every swing brief's
`ctx.ecosystem.gex_positioning` — but absent from both swing-brief call sites that narrate GEX
posture (`gexPostureSection` in `play-brief-intel.ts`, `dealerPostureLine` in
`play-brief-narrative.ts`). Originally raised as an open design question on PR #4076 (comment
6175832614, 2026-10-14) rather than fixed immediately, since the two framing options (a terse
bullet vs. its own narrative clause) were a genuine design call. No reply after ~22 hours;
implemented per this same thread's established precedent (comment 6168890076: implement after a
reasonable wait on an unanswered low-risk, well-scoped idea rather than block indefinitely).

**Blast radius.** Single call site (`dealerPostureLine`) — `gexPostureSection` (the bullet-list
"GEX posture" evidence block) was considered but left unchanged: that section's job is to surface
the raw fields members can already see under `expandIntel=1`, and a fragile-flip READ (what the
crossing count *means*) belongs in the narrative voice, not as another raw number in a bullet list.
Follows the exact same precedent `dealerPostureLine`'s own file already uses for vanna/dex/charm
regime reads: qualitative "what it means" text lives in the narrative line, the raw figures live in
the evidence section.

**Fix rationale.** Added a `fragileBit` clause to `dealerPostureLine`, appended immediately after
the existing `flipBit` (`· fragile flip — nearer crossing **$X** (Y% away)`), gated on
`!gexStale && flip_crossings > 1 && flip_nearest != null` — reusing the exact same
`gexMatrixStale` staleness gate the sibling vanna/dex/charm regime-read clause already uses a few
lines below, so a stale matrix's crossing count is treated exactly as unreliable as its flip. Left
`gexPostureSection` untouched deliberately (see blast radius above) — adding the raw fields there
too would be a reasonable follow-up but is a separate, additive change, not required to close this
gap in the narrative voice members actually read by default.

**Test.** `src/lib/swing/play-brief-narrative.test.ts` — three new cases: (1) `flip_crossings: 3`
with a real `flip_nearest`/`distance_to_nearest_flip_pct` renders the fragile-flip clause with the
correct nearer-crossing price and signed percent; (2) `flip_crossings: 1` (a stable single
crossing) never renders "fragile flip"; (3) a stale GEX matrix (`freshness: "cached"`,
`matrix_age_sec: 200`) suppresses the clause even with `flip_crossings: 3` present, matching the
file's existing Largo C2 staleness-suppression pattern. RED→GREEN verified via `git stash` on the
source file only: 126/127 pass pre-fix (the positive-assertion test fails; the two
absence-assertion tests pass trivially either way, as expected), 127/127 pass post-fix.
`tsc --noEmit` clean.
