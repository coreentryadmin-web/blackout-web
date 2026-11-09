# "GEX posture" was unconditionally dropped by `collapseRedundantIntelSections`, but its Net VEX/DEX/CHARM dollar figures have no narrative counterpart — same false-fold bug just fixed for 7 sibling titles, missed for this 8th one

> **kind:** `FINDING`

### Summary
On 2026-11-08, `src/lib/swing/play-brief-intel-collapse.ts` was given per-title opt-in flags
(`laneRankFolded`, `wallDynamicsFolded`, `vectorDeskFolded`, `levelsOnChartFolded`,
`flowIntelFolded`, `macroTapeFolded`, `holdPlanFolded`) because 7 titles in
`NARRATIVE_COVERED_TITLES` render real content the narrative does NOT actually carry, so dropping
them unconditionally under a "folded into Trade manager read above" note was a false claim.
"GEX posture" is the 8th member of that same Set but was left with no opt-in flag — it was always
dropped whenever any narrative bullet exists, with no proof check at all (the least-safe default,
unlike the "omitted/false is the SAFE default" discipline this file's own doc comment establishes
for the other seven).

### Root cause
`gexPostureSection` (`play-brief-intel.ts`) renders Net VEX (vanna)/DEX (delta)/CHARM (pinning)
dollar figures whenever the GEX matrix isn't stale and the field is non-null. The narrative's only
counterpart, `dealerPostureLine` (`play-brief-narrative.ts`), deliberately keeps VEX/DEX/CHARM as
qualitative regime-read TEXT only — never their dollar amounts (unlike `net_gex`, whose own dollar
figure WAS added to the narrative on 2026-10-14). This asymmetry is locked in by an explicit,
currently-passing regression test (`play-brief-narrative.test.ts`) asserting the narrative body
does NOT match the VEX/DEX/CHARM dollar-figure fixtures. `net_vex`/`vanna_regime_read` are declared
non-nullable on `gex_positioning` (always assigned from `vex.total`, unlike `net_dex`/`net_charm`
which are conditionally null), so this section almost always carries real, narratively-uncovered
content whenever the matrix exists and isn't stale.

### Fix
Added a `gexPostureFolded` opt (same safe-default shape as the other seven) computed from
`gex.net_vex == null && gex.net_dex == null && gex.net_charm == null` — deliberately NOT also
OR'ing in matrix staleness (unlike the VEX/DEX/CHARM lines' own internal `!stale` gate), since
staleness alone would risk falsely folding the section's "may lag spot" caveat line in a
stale-GEX/fresh-Vector combination that also has no narrative counterpart. The null-only check
stays on the safe-default side in every case `gexPostureSection` itself would still render
something.

Updated every existing test in `play-brief-intel-collapse.test.ts` that used "GEX posture" as an
unconditionally-dropped control section for a sibling title's test (7 call sites) to pass
`gexPostureFolded: true` explicitly, and added "GEX posture"'s own dedicated 3-test block
(keeps when `false`, defaults safe when omitted, drops when `true`), mirroring the existing
`holdPlanFolded` block exactly.

### Evidence
- RED: 2/31 fail pre-fix (the new "omitted defaults to keep" test and, transitively, any test
  relying on the fix). GREEN: 31/31 post-fix.
- Full `src/lib/swing/*.test.ts`: 2292/2292 pass. `npx tsc --noEmit` clean.

### Blast radius
`collapseRedundantIntelSections`'s only caller is `buildIntelSections` (`play-brief-intel.ts`),
feeding `GET /api/market/swing/play-brief`. Net effect pre-fix: whenever a WATCH/OPEN brief has a
fresh GEX matrix and any narrative bullets at all (the overwhelmingly common case), the Net VEX
(and often Net DEX/CHARM) dollar figures were silently deleted with a false "folded into Trade
manager read above" note, even though no dollar figure for vanna/delta/charm appears anywhere else
in the brief.

| **Status** | FIXED — this PR. |
