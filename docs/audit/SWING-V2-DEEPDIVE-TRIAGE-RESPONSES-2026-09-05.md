# Swing Engine V2 — Cursor triage responses (2026-09-05)

Second-opinion answers to `SWING-V2-DEEPDIVE-QUESTIONS-2026-09-05.md`. Each item: **(a)** intentional trade-off, **(b)** already covered elsewhere, **(c)** real gap → scoped `fix/*` PR.

| Q | Verdict | Fix status / PR |
|---|---------|-------------------|
| 1 | **(c)** | Open — `fix/swing-discovery-force-claim-guard` |
| 2 | **(c)** | **FIXED** this PR — per-candidate dossier isolation |
| 3 | **(c)** | Open — `fix/swing-serving-committed-watch-reconcile` |
| 4 | **(c)** | **FIXED** #3845 |
| 5 | **(c)** | Open — `fix/swing-positioning-direction-confluence` |
| 6 | **(c)** | Open — delete or wire `data-fusion.ts` |
| 7 | **(c)** | Open — wire G-S3/quote/bar gates or delete dead `gates.ts` |
| 8 | **(c)** | Open — G-S4 regime degraded→WATCH |
| 9 | **(c)** | Open — swing halt/LULD gate (reuse zerodte pattern) |
| 10 | **(c)** | **FIXED** this PR — G-S3 in v2/gates |
| 11 | **(c)** | Open — earnings calendar reader for Cortex(swing) |
| 12 | **(c)** | Open — single authoritative `intendedDte` post-classify |
| 13 | **(a)** | Document; optional proximity-scaled hazard later |
| 14 | **(a)** | Accept race; optional cross-horizon coalesce later |
| 15 | **(c)** | Open — e2e test omitted-horizon 0DTE veto path |
| 16 | **(c)** | Open — wire `thesisBroken`/edge reads in active-refresh |
| 17 | **(a)** | Roll = continuation; optional re-confluence flag later |
| 18 | **(c)** | **FIXED** #3842 |
| 19 | **(a)** | Structural stop pinned to thesis level by design |
| 20 | **(c)** | Open — archetype in `commit_key` or block multi-archetype |
| 21 | **(c)** | Open — key `gateBlockedByKey` by thesisKey |
| 22 | **(c)** | Open — legacy plays: stamp gate state or show EXEMPT |
| 23 | **(a)** | Per-desk budget by design; cross-desk view not built |
| 24 | **(a)** | Banger uncapped per operator directive |
| 25 | **(c)** | Open — unify correlation clusters cross-desk |
| 26 | **(c)** | Open — CLOSED tab chain-composite parity with record |
| 27 | **(c)** | Open — Tier-0 origin failure counters/logs |
| 28 | **(c)** | Open — require CATALYST kind for event archetypes |
| 29 | **(c)** | Open — fail-closed Cortex + pin `entry_context.cortex` |
| 30 | **(c)** | Open — shadow-grade G-S6/G-S14-only blocks |

---

## Per-question detail

### Q1 — force=1 tears live claim
**(c) real gap.** `route.ts:325-326` deletes the phase key on any `force=1` with no check that the prior holder is stale/hung. Combined with `thesisKey` (ticker+direction+archetype) vs `commit_key` (session+ticker+subLane+dir, no archetype), concurrent invocations can double-open when subLane differs. **Fix:** only delete claim when TTL expired or holder PID/token stale; add in-flight scan lock or serialize commits per thesisKey.

### Q2 — poison candidate aborts batch
**(c) real gap.** `mapPool` and `deriveSwingCandidates` have no per-item try/catch. Enrichment is fail-soft; scoring is not. **Fix:** wrap `buildSwingDossier` / `enrichCandidate` per seed, log+skip poison rows, continue scan.

### Q3 — WATCH rail vs COMMITTED desync
**(c) real gap.** `watchCandidates`/`playSet` built pre-commit (`discovery.ts:693-726`); successful commits don't re-tag the serving snapshot. **Fix:** post-commit pass marks committed theses IN_PLAY / removes from WATCH rail or adds `committed: true` on play row.

### Q4 — legacy REL_STRENGTH ?? 0
**(c) real gap — FIXED #3845.** Omit `relStrength` when 10d returns null.

### Q5 — POSITIONING direction discarded
**(c) real gap.** `positioning-screen.ts:39-44` returns tickers only; G-S6 counts kind presence not direction agreement. **Fix:** carry direction into confluence eval or filter POSITIONING credit when dossier direction disagrees.

### Q6 — data-fusion.ts unused
**(c) real gap.** Zero production callers; production path is `swing-ingest.ts`. **Fix:** delete module or route `ingestSwingReads` through it in P1 consolidation PR.

### Q7 — dead gates.ts
**(c) real gap.** `evaluateSwingGates` only called from tests. G-S3 earnings, quote_stale, daily_bar_incomplete unwired. V2 uses `commit.ts` + `v2/gates.ts` (G-S6/G-S14 only). **Fix:** port earnings/quote/bar checks into V2 commit path or explicitly deprecate file + design doc.

### Q8 — G-S4 regime gate missing
**(c) real gap.** `regimeBandFor01` is metrics-only. No degraded-regime→WATCH enforcement anywhere in swing commit path.

### Q9 — halt/LULD for swing
**(c) real gap.** Zero halt/LULD references under `src/lib/swing/`. 0DTE has `zerodte/gates.ts` + board integration. **Fix:** reuse `polygon-luld` / halt store in discovery commit + active-refresh mark path.

### Q10 — G-S3 not in codebase
**(c) real gap.** `SwingGateId` is only G-S6 | G-S14. NVDA AMC scenario can commit with no earnings-window block.

### Q11 — Cortex(swing) no earnings calendar
**(c) real gap.** Swing Cortex reuses 0DTE readers; none read earnings calendar. 0DTE has hard `earnings` gate. **Fix:** add earnings-date reader or wire G-S3 before Cortex.

### Q12 — three intendedDte values
**(c) real gap.** Pre-classify 14d in enrich, `catalystShortHorizon` in ingest, `intendedDteForArchetype` post-classify for subLane only — catalyst pillar not recomputed. **Fix:** recompute catalyst reads after archetype/subLane finalization.

### Q13 — flat catalyst hazard discount
**(a) intentional simplification** for v1: binary in-window hazard. Proximity is partially captured by `preEarnings01` on the same pillar. **Optional (c):** scale hazard term by `daysUntil` if calibration shows T-1 still committing too often.

### Q14 — chain fetch race across horizons
**(a) acceptable trade-off** today: 600s ticker-only chain cache, 5s horizon memo. Worst case duplicate Polygon call + last-write-wins until TTL. **Optional (c):** in-flight coalesce on chain key if cost/latency spikes measured.

### Q15 — 0DTE default horizon test gap
**(c) real gap (test coverage).** `fetch.test.ts` covers explicit `horizon: "swing"`; no e2e asserting omitted horizon → `"0dte"` through `evaluateCortexForCommit`. **Fix:** one integration test on default path.

### Q16 — management edge reads unwired
**(c) real gap.** `loadReads` in active-refresh never sets `thesisBroken`, `catalystShift`, `regimeShift`, `flowDecayed`, `relStrengthLost`. Rungs #2/#5/#6/#8/#9 cannot fire in production.

### Q17 — roll skips G-S6/G-S14
**(a) intentional:** roll continues authorized thesis; re-checks budget/caps/idempotency/DTE buffer only. **Optional (c):** advisory re-confluence flag on roll when RS/archetype inputs invert (P4).

### Q18 — TRIM latch without enforced
**(c) real gap — FIXED #3842.** `latchSwingLiveStatus` now requires `verdict.enforced`.

### Q19 — roll copies structural stop
**(a) intentional:** `thesis_invalidation_px` is a structural thesis level, not entry-relative sizing. Roll updates entry spot but preserves invalidation anchor. Document in roll-plan header; optional tighten-only rule is P4.

### Q20 — commit_key vs thesisKey
**(c) real gap.** Same ticker+direction+subLane+different archetype → same `commit_key`, upsert overwrites. **Fix:** include archetype in commit_key or reject second archetype same session.

### Q21 — gateBlockedByKey overwrite
**(c) real gap.** Keyed `ticker|direction` only; second archetype overwrites first in Map. **Fix:** key by full thesisKey.

### Q22 — legacy NIGHT HAWK bypasses G-S6 display
**(c) real gap.** `LEGACY_SWING_SIGNAL_KIND` not in `DISCOVERY_PATH_KINDS`; empty paths → `gateBlocks: null` looks like cleared G-S6. **Fix:** stamp `commitGateBlockedBy: ["legacy:exempt"]` or run lightweight confluence on promote.

### Q23 — cross-desk budget
**(a) intentional:** `evaluateSwingCommitBudget` reads `swing_positions` only. Cross-desk heat is not computed. Document as per-desk cap.

### Q24 — Banger vs swing 6% cap
**(a) intentional** per operator directive (FINDINGS 2026-08-04). `maxPortfolioLossPct: 6` is swing-book only.

### Q25 — AAPL cluster disagreement
**(c) real gap** between 0DTE `CORRELATION_GROUPS` and swing `sectorFor`/theme-cluster. SEV-9 unification is intra-swing only. **Fix:** shared correlation map or documented canonical source.

### Q26 — CLOSED tab vs record composite
**(c) real gap.** `closedDeckSourcesFromChains` uses terminal leg only; `record.ts` uses worst-leg composite. Member can see win on CLOSED tab, loss in track record. **Fix:** align CLOSED tab with chain composite or badge rolled chains.

### Q27 — Tier-0 screen failure invisible
**(c) real gap.** vector/catalyst/positioning screens `.catch(() => [])` with no distinguishing metric. **Fix:** `recall_metrics.tier0_origin_errors` counter or structured log per origin.

### Q28 — event archetype confluence without CATALYST kind
**(c) real gap.** Comment says "CATALYST + 1 other" but `evaluateSwingConfluence` is count-only. EVENT_DRIVEN can pass on FLOW+STRUCTURE with zero Tier-0 CATALYST path. **Fix:** require `"CATALYST"` in kinds for event archetypes.

### Q29 — Cortex error → silent pass
**(c) real gap.** `discovery.ts:839` `.catch(() => null)` treats errors as pass; `entry_context` doesn't pin cortex assessment (unlike 0DTE). **Fix:** fail-closed on throw + pin cortex verdict in `buildCommitInsert`.

### Q30 — shadow excludes G-S6/G-S14 blocks
**(c) real gap.** `isRiskGateOnly` only `budget:`/`cap:`. G-S6/G-S14 blocks get rejection rows but no forward-graded shadow. **Fix:** extend shadow eligibility to gate-only blocks for calibration evidence.

---

## Recommended fix queue (P1 first)

1. **G-S3 earnings binary** (Q7+Q10) — **FIXED this PR**
2. **Swing halt/LULD** (Q9) — real-money mark/commit on halted names
3. **Per-candidate isolation** (Q2) — **FIXED this PR**
4. **force=1 claim guard** (Q1) — double-open under recovery
5. **Cortex fail-closed + pin** (Q29)
6. **Event archetype CATALYST kind required** (Q28)
