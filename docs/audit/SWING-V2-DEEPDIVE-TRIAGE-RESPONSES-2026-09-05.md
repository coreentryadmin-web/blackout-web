# Swing Engine V2 — Cursor triage responses (2026-09-05)

Second-opinion answers to `SWING-V2-DEEPDIVE-QUESTIONS-2026-09-05.md`. Each item: **(a)** intentional trade-off, **(b)** already covered elsewhere, **(c)** real gap → scoped `fix/*` PR.

| Q | Verdict | Fix status / PR |
|---|---------|-------------------|
| 1 | **(c)** | **MERGED** #3854 — force=1 claim guard |
| 2 | **(c)** | **MERGED** #3850 — per-candidate dossier isolation |
| 3 | **(c)** | **MERGED** #3878 — post-commit WATCH/COMMITTED reconcile |
| 4 | **(c)** | **MERGED** #3845 |
| 5 | **(c)** | **MERGED** #3878 — POSITIONING direction agreement for G-S6 |
| 6 | **(c)** | **MERGED** #3878 — deleted dead `v2/data-fusion.ts`; `swing-ingest.ts` canonical |
| 7 | **(c)** | **MERGED** #3850 — G-S3 in v2/gates (**partial:** legacy `gates.ts` still unwired) |
| 8 | **(c)** | **MERGED** #3868 — G-S4 regime degraded→WATCH |
| 9 | **(c)** | **MERGED** #3852 — halt/LULD |
| 10 | **(c)** | **MERGED** #3850 — G-S3 earnings binary |
| 11 | **(c)** | **MERGED** #3886 — documented G-S3 vs Cortex earnings split |
| 12 | **(c)** | **MERGED** #3878 — `finalizeSwingDossierForArchetype` post-classify catalyst realign |
| 13 | **(a)** | Document; optional proximity-scaled hazard later |
| 14 | **(a)** | Accept race; optional cross-horizon coalesce later |
| 15 | **(c)** | **MERGED** #3878 — e2e test omitted horizon → `0dte` |
| 16 | **(c)** | **MERGED** #3878 — `manage-edge-reads.ts` wired in active-refresh |
| 17 | **(a)** | Roll = continuation; optional re-confluence flag later |
| 18 | **(c)** | **MERGED** #3842 |
| 19 | **(a)** | Structural stop pinned to thesis level by design |
| 20 | **(c)** | **MERGED** #3878 — archetype in `commit_key` |
| 21 | **(c)** | **MERGED** #3878 — `gateBlockedByKey` by thesisKey (supersedes #3875) |
| 22 | **(c)** | **MERGED** #3878 — legacy `legacy:exempt` gate stamp |
| 23 | **(a)** | Per-desk budget by design; cross-desk view not built |
| 24 | **(a)** | Banger uncapped per operator directive |
| 25 | **(c)** | **MERGED** #3886 — `portfolio/cross-desk-theme.ts` (`sectorFor`) canonical for future cross-desk exposure |
| 26 | **(c)** | **MERGED** #3878 — CLOSED tab chain-composite P&L |
| 27 | **(c)** | **MERGED** #3861 — Tier-0 origin failure observability |
| 28 | **(c)** | **MERGED** #3858 — CATALYST kind for event archetypes |
| 29 | **(c)** | **MERGED** #3857 — Cortex fail-closed + pin |
| 30 | **(c)** | **MERGED** #3859 — shadow G-S6/G-S14-only blocks |

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
**(c) documented split (not a bug).** G-S3 (`evaluateEarningsGate`) is swing's authoritative COMMIT-time print protection from dossier `earningsInWindow`. Cortex preflight evaluates Vector dealer/flow/regime — it does not and should not duplicate G-S3. Comments in `v2/cortex-swing.ts` + `v2/gates.ts`.

### Q12 — three intendedDte values
**(c) fixed in PR.** `assembleSwingDossierInput` pins `catalystDerive`; `finalizeSwingDossierForArchetype` re-runs `deriveCatalystReads` with `intendedDteForArchetype` after classification so `earningsInWindow`/CATALYST hazard match the traded horizon.

### Q13 — flat catalyst hazard discount
**(a) intentional simplification** for v1: binary in-window hazard. Proximity is partially captured by `preEarnings01` on the same pillar. **Optional (c):** scale hazard term by `daysUntil` if calibration shows T-1 still committing too often.

### Q14 — chain fetch race across horizons
**(a) acceptable trade-off** today: 600s ticker-only chain cache, 5s horizon memo. Worst case duplicate Polygon call + last-write-wins until TTL. **Optional (c):** in-flight coalesce on chain key if cost/latency spikes measured.

### Q15 — 0DTE default horizon test gap
**(c) real gap (test coverage).** `fetch.test.ts` covers explicit `horizon: "swing"`; no e2e asserting omitted horizon → `"0dte"` through `evaluateCortexForCommit`. **Fix:** one integration test on default path.

### Q16 — management edge reads unwired
**(c) fixed in PR.** New pure `manage-edge-reads.ts` derives `thesisBroken`/`catalystShift`/`regimeShift`/`flowDecayed`/`relStrengthLost` from commit-pinned pillars + live daily-bar recompute; `swing-active-refresh` `loadReads` wires them into manage-sync.

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
**(c) fixed with canonical cross-desk module.** Per-desk partitions stay as-is (0DTE governor intraday groups, swing `resolveTheme`) — those measure different things (intraday dealer-hedge correlation vs. multi-session sector/thesis correlation) and neither is touched. Future cross-desk exposure uses `portfolio/cross-desk-theme.ts` → `sectorFor` (AAPL = megatech with MSFT/GOOGL/AMZN/META, not AVGO/CRM) as the single canonical partition for that specific question — `sectorFor` was purpose-built for concentration-risk clustering, so this isn't overriding one desk's view with another's, it's routing a new question to the module designed to answer it. Claude reviewed and approved on PR #3886.

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

## Round 2 (Q31–Q41) — triage (2026-09-05)

| Q | Verdict | Fix status / PR |
|---|---------|-------------------|
| 31 | **(c)** | **OPEN** — no member notification on swing exit/roll (design) |
| 32 | **(c)** | **OPEN** — swing/banger have zero Discord/push path vs 0DTE (design) |
| 33 | **(c)** | **OPEN** — shadow rows never graded/refreshed (calibration evidence gap) |
| 34 | **(c)** | **OPEN** — FINDINGS follow-up scoped but not built (shadow refresh loop) |
| 35 | **(c)** | **OPEN** — no graduation criteria for shadow→budget loosening |
| 36 | **(c)** | **OPEN** — evidence-only path races on concurrent refresh (non-terminal) |
| 37 | **(c)** | **PR open** #3899 — singleton claim + roll execution revalidation (partial) |
| 38 | **(c)** | **MERGED** #3893 — stale-but-200-OK underlying spot guard |
| 39 | **(c)** | **OPEN** — ex-dividend not adjusted before structural_stop (design) |
| 40 | **(c)** | **PR open** #3895 — wire `last_mark_at` → `HorizonPlay.markAsOf` |
| 41 | **(c)** | **PR open** #3895 — SSE tier recheck on marks/vector/flows streams |

**Actionable bugs in flight:** Q40+Q41 (#3895), Q37 (#3899). Q38 **MERGED** #3893. Remaining Q31–Q36, Q39 need design scoping.

---

## Recommended fix queue (updated 2026-09-05)

### Done (Q1–Q30 batch)
All P1 items from the original queue are merged except legacy `gates.ts` cleanup (Q7 partial).

### Round 2 — next
1. **Q38 stale underlying spot** — **MERGED** #3893
2. **Q40+Q41 mark freshness + SSE entitlement** — #3895 (peer ✅ GO AHEAD MERGE)
3. **Q37 roll/CLOSE race** — #3899 (singleton claim + execution revalidation; partial)
4. **Q31–Q32 member notifications** — design: swing/banger alert parity with 0DTE Discord path
5. **Q33–Q35 shadow calibration lifecycle** — design: refresh loop + graduation criteria
6. **Q36 evidence-only path races** — design: idempotency on non-terminal refresh writes
7. **Q39 ex-dividend structural stop** — design: corporate-action adjustment or hazard flag
