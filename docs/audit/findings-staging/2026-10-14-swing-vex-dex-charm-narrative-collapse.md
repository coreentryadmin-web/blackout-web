> **kind:** FINDING

## VEX/DEX/CHARM content silently dropped for OPEN/WATCH swing briefs — FIXED

| **Status** | FIXED |
|---|---|

**Root cause.** PR #5994 (same day, Ask Largo standing mandate) extended `gexPostureSection`
(`play-brief-intel.ts`) to render `net_vex`/`vanna_regime_read`, `net_dex`/`dex_regime_read`, and
`net_charm`/`charm_regime_read` — fields already loaded into every swing brief's
`ctx.ecosystem.gex_positioning` (via the same `getGexPositioning` Thermal's own desk reads) but
never surfaced in the swing brief. That fix shipped correctly in isolation, but
`collapseRedundantIntelSections` (`play-brief-intel-collapse.ts`) drops the **whole** "GEX posture"
section for OPEN/WATCH buckets whenever a narrative is present (`NARRATIVE_COVERED_TITLES`
includes `"GEX posture"`), appending a note that its detail was "folded into Trade manager read
above." That note was false for VEX/DEX/CHARM: `dealerPostureLine` (`play-brief-narrative.ts`,
the function behind "Trade manager read"'s dealer-posture bullet) narrated gamma posture + gamma
flip only — it never read `net_vex`/`net_dex`/`net_charm` or their regime-read strings at all. So
for the common case (an OPEN or WATCH play with a narrative present — the large majority of real
briefs), the brand-new VEX/DEX/CHARM content from #5994 was computed, rendered into a section, and
then immediately discarded with a note claiming it had been preserved elsewhere. Only CLOSED briefs
(`collapseRedundantIntelSections` returns early for `bucket === "closed"`) and the rare
narrative-absent case ever actually saw it.

**Evidence.** `composeSwingPlayBrief` for any OPEN/WATCH play with `hasNarrative: true` (the normal
case) ran VEX/DEX/CHARM through `gexPostureSection`, then `collapseRedundantIntelSections` filtered
the whole section out via its title-match against `NARRATIVE_COVERED_TITLES`, and the only
remaining trace was the generic "folded into Trade manager read above" note — a false claim for
these three fields, confirmed by reading `dealerPostureLine`'s full source: it builds `mechanic`
(gamma posture text) and `flipBit` (gamma flip) only, with no reference to `net_vex`/`net_dex`/
`net_charm`/`vanna_regime_read`/`dex_regime_read`/`charm_regime_read` anywhere before this fix.

**Blast radius.** Single call site — `dealerPostureLine`'s return string, which feeds the one
"Trade manager read" dealer-posture bullet. No other section or consumer reads
`vanna_regime_read`/`dex_regime_read`/`charm_regime_read` for swing (Thermal's own desk reads the
same `GexPositioning` object through its own independent formatter and is unaffected).

**Fix.** Appended the three regime-read strings (not the raw `$` figures — parity with `net_gex`'s
own dollar value, which is likewise never narrated in this bullet, by design: `gexPostureSection`'s
`Net GEX: **$NM**` line is the one place for the number, this bullet is the one place for the
qualitative "what it means" read) to `dealerPostureLine`'s output, gated on the SAME
`gexMatrixStale` check `gexPostureSection` already uses for these fields — a stale matrix's regime
reads are exactly as unreliable in the narrative as in the standalone section. Each field is
independently null-gated (C3-safe omission), matching the existing `net_gex`/`gamma_posture`
pattern in the same function.

**Fix rationale.** The alternative (special-casing `collapseRedundantIntelSections` to keep "GEX
posture" rendered whenever it carries non-null VEX/DEX/CHARM) would have left the "folded into
Trade manager read" note literally false in the kept-but-partial case and complicated the collapse
function's single, simple title-match rule. Threading the content into the narrative itself makes
the existing claim true instead of carving an exception to it — the narrower, more honest fix.

**Tests.** `play-brief-narrative.test.ts` gained 2 tests: one proving all three regime-read strings
now appear in the narrative body (with a parity check that the raw `$` figures do NOT), and one
proving they're suppressed while the GEX matrix is stale (`matrix_age_sec: 200`), mirroring the
existing Largo C2 staleness-suppression tests in the same file. RED→GREEN proven: `git stash` of
the `play-brief-narrative.ts` fix failed exactly 1 of 114 tests (the new positive-content
assertion; the staleness-suppression test passes vacuously either way, as expected for a
suppression guard); restoring the fix brought all 114 back to green. Also ran the full
`play-brief-intel-collapse`/`play-brief-intel`/`play-brief` test suites (364 tests) clean.
`tsc --noEmit` clean on Node 20.
