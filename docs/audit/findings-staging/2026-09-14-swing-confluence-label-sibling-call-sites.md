> **kind:** FINDING

## Ask Largo's confluence-zone labeling bug recurred at two unpatched sibling call sites — FIXED

| **Status** | FIXED (this commit) |
|---|---|

**Root cause:** a confluence zone can cite a DIFFERENT call/put wall than the single, top-ranked
wall a brief shows elsewhere as "Call wall (GEX)"/"Put wall (GEX)" — `vector-full-state.ts`'s
confluence engine feeds the clustering the FULL ranked `gexWalls.callWalls`/`putWalls` list, not
just index `[0]`, so a lower-ranked wall can cluster with max-pain/flip/golden-pocket under the
same `call-wall`/`put-wall` kind label at a materially different price. This exact defect was
found and fixed once already (2026-09-13, a 3-instance NRG/MU/SKHY pattern, PR #4076 comments
5649059880/5649697371/5649766952) — but the fix (`confluenceZoneLabel` in `play-brief.ts`) was a
private, unexported function that only patched ONE render call site: the structured `levels` array
`play-brief.ts` builds for the envelope. Two sibling functions independently format the same
`ConfluenceZone.kinds` field the identical unpatched way: `formatConfluenceZone`
(`play-brief-intel.ts`, the "Levels on chart" → "Confluence nodes" bullet list) and
`confluenceCoaching` (`play-brief-narrative-coaching.ts`, the "Trade manager read" → "Confluence
<price>" bullet).

**Evidence (live reproduction, 2026-09-14, NAIL and IONX, forensic batch 13):** both real, fresh
positions cross-checked against the SAME envelope's structured `levels` array (which WAS
disambiguated, proving this is a rendering bug, not a data bug):
- NAIL: `envelope.levels` correctly read `"confluence (call-wall@35+max-pain)"` — the confluence
  zone's own call-wall component is really at 35, not the primary call wall (40.00) shown three
  lines up in "Levels on chart". The unpatched prose bullet read `"35.00 (call-wall+max-pain, score
  5.0)"` — no `@35`, reads as if 35 IS the call wall, silently contradicting "Call wall (GEX):
  40.00" in the same section.
- IONX: same shape in BOTH unpatched locations — "Levels on chart" showed `"22.00 (call-wall+max-
  pain, score 5.0)"` and "Trade manager read" showed `"**Confluence 22.00** (call-wall + max-pain,
  score 5.0)"` — both silently contradicting "Call wall (GEX): 24.00" in the same brief.

**Blast radius:** every brief with a confluence zone whose actual wall component differs from the
brief's own single top-ranked wall, on either of the two unpatched render sites. Same root cause as
the already-shipped 2026-09-13 fix; the fix's own blast radius was never swept to these sibling
files at the time, exactly the failure mode CLAUDE.md's PR write-up policy calls out ("duplicated
logic in a second file counts — fix and note all of them").

**Fix:** extracted the disambiguation logic into a shared, exported `confluenceZoneKindsLabel`
(`play-brief-absence.ts` — already imported by all three files) and wired it into all three call
sites: `play-brief.ts`'s private wrapper now delegates to it (byte-identical output, just no
longer a private copy); `formatConfluenceZone` (`play-brief-intel.ts`) now takes the same
`{callWall, putWall}` primary-wall pair `chartLevelsSection` already has in scope via
`preferredGexWalls`; `confluenceCoaching` (`play-brief-narrative-coaching.ts`) derives its primary
walls directly from `vec.gexWalls` (the function already guarantees `vec` is fresh via
`vectorSnapshotStale`, so no GEX-matrix fallback is needed there, unlike `preferredGexWalls`).

**Fix rationale:** moved the helper to `play-brief-absence.ts` rather than exporting it from
`play-brief.ts` directly — `play-brief.ts` imports `play-brief-intel.ts` (`buildIntelSections`), so
exporting from `play-brief.ts` and importing back into `play-brief-intel.ts` would create a
circular import; `play-brief-absence.ts` is already the repo's established home for cross-file
swing-brief helpers (`optionMarkGenuinelyUnknown`, `playExpectsLiveOptionMark`, etc.) and all three
call sites already import from it. Kept the common case (zone agrees with the primary wall) byte-
identical — only the disagreement case gains the `@price` qualifier, same as the original fix.

**Test:** RED→GREEN proven (git-stashed all 4 source files, confirmed 2 new regression tests — one
per sibling call site, live-shaped NAIL/IONX repros — fail against pre-fix code with the exact
wrong un-disambiguated output; restored and confirmed all 319 tests across the 4 touched test
files green). Added 2 more tests (one per call site) proving the fix narrows correctly — a zone
whose wall genuinely agrees with the primary wall still renders the plain kind name, not an
unconditional `@price` qualifier. Full `src/lib/swing/*.test.ts` (1134 tests) green, `tsc --noEmit`
and `eslint` clean on all 6 changed files.
