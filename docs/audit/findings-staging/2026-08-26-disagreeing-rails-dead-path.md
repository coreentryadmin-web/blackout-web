> **kind:** `FINDING`

## `disagreeing_rails` was structurally dead in the live 0DTE thesis path — FIXED

| **Status** | FIXED |
|---|---|

**Root cause.** Every discovery-rail scorer call in `railHitsFromLegacySetup`
(`src/lib/zerodte/thesis/rails/legacy-bridge.ts`) passed the setup's single overall
`direction` unconditionally, for FLOW, BREAKOUT, and PIN alike. But `mergeSameTickerDiscovery`
(`src/lib/zerodte/board.ts`) already collapses same-ticker candidates from different discovery
origins into ONE `EnrichedZeroDteSetup` with ONE winning `direction` before the thesis pipeline
ever runs — so every `RailHit` the thesis layer ever saw for a ticker carried the identical
direction. `buildMergedThesisFromHits`'s disagreement filter
(`hits.filter(h => h.direction !== direction)`, `thesis/pipeline.ts`) was therefore comparing a
set of hits that could never disagree — `disagreeing_rails.length` was always 0 for every real
committed setup, regardless of whether the origins actually fought over direction.

The real per-origin vote was never lost — `recordOriginContributionsOnMerge` already stamps each
rail's own (direction, score) onto `setup.origin_contributions` at merge time (the WS-06
mechanism backing `origin_direction_map`/`origin_score_map`). `legacyBridgeExtrasFromSetup` /
`railHitsFromLegacySetup` simply never read it — the data existed on the setup object and was
discarded by the one function meant to expose it as `disagreeing_rails`.

**Blast radius.** `soloBreakoutNeedsCorroboration` (`thesis/live-pipeline.ts`) and the
`thesis-board-sync.ts` conflict-surfacing both gate on `disagreeing_rails.length > 0` and could
never fire from a real cross-rail conflict — only from a hand-built test fixture. The "Fracture"
disagreement section on `ThesisRankCard` (#2908) was therefore unreachable in production for the
three primary discovery rails (FLOW/BREAKOUT/PIN); it could only ever render empty.

**Fix.** `railHitsFromLegacySetup` now reads each origin's own recorded direction —
`setup.origin_contributions?.FLOW?.direction ?? direction` (and the same for BREAKOUT/PIN) —
falling back to the setup's overall direction when no per-origin vote was recorded (the common
single-origin case, and any legacy row predating `origin_contributions`). Verified safe against
each rail scorer's own logic: `scoreFlowRail`'s score math is direction-agnostic (direction only
labels call/put bias); `scoreBreakoutRail`/`scorePositioningRail` use `direction` to test
structural levels (resistance/support/walls) — passing each origin's OWN voted direction makes
those structural checks MORE correct, not less, since they now evaluate that origin's own claim
against the levels rather than the (possibly different) kept direction.

`buildMergedThesisFromHits` gained an optional `keptDirection` parameter — pinned to
`setup.direction` by `runThesisPipelineForSetup` (the single-setup live path), so the thesis
still always describes the direction the board actually committed/traded, and disagreement is
reported AGAINST that direction rather than letting an independent score-weighted vote drift the
thesis to a different direction than what's live. `mergeScanPassTheses` (the cross-setup,
whole-scan-pass merge with no single pre-decided direction) is unaffected — it omits
`keptDirection` and keeps its existing vote-based resolution.

**Deliberately unchanged.** `crossProductCorroborationBoost` still uses the setup's overall
`direction` (not each origin's) — that boost is about cross-PRODUCT (dark-pool/HELIX) alignment
with the traded direction, a different question than cross-RAIL disagreement, and out of scope
here. The 5 derived rails (MOMENTUM/RS/REVERSAL/CATALYST/VOL) still receive the setup's overall
`direction` unchanged — they are not independent discovery origins with their own vote; they
compute derived signals about the SAME instrument in the SAME traded direction, so echoing it is
correct for them.

**Regression test.** `thesis-first.test.ts`: "pipeline: a real cross-origin conflict surfaces in
disagreeing_rails, not silently agrees" — FLOW argues long (kept), PIN argues short via
`origin_contributions`; asserts `thesis.direction` stays `"long"` (still describes the traded
direction) while PIN's opposing vote appears in `disagreeing_rails` and is excluded from
`rail_scores`. Confirmed failing against the pre-fix code, passing after.
