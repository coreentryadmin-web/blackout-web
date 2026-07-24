# SWING-ENGINE.md — Night Hawk SWING (2–30 DTE) Authoritative Build Plan

**STATUS: BUILT — all 16 PRs merged 2026-07-24** (#1032, #1033, #1035, #1036, #1037, #1038, #1039, #1040, #1041, #1042, #1043, #1044, #1045, #1046, #1047, #1048). The full pipeline — Ingest → Discover → Score → Contract → Gate → Commit → Manage → Grade → Calibrate — ships on `main`, 33 `src/lib/swing/*` modules, ~289 swing/horizon tests green. Everything is **evidence-only / calibration-first**: nothing sizes real risk or flips a floor/weight/gate/exit-rung/cap to enforcement until its own archetype×sub-lane graded bucket clears the ladder (n≥10, Δ≥15pt). Live-but-dormant on the desk: phase-anchored cron writes accumulation + append-only snapshots as evidence, the lane serves a WATCH-only rail (`commitEligibleCount = 0`), and roll execution is wired opt-in. The graduation ladder is the safety. See the per-PR ledger below.

Status (original): build plan (authoritative). Supersedes the nine independent design drafts and the adversarial review. Where a draft conflicts with this document, this document wins. Every reconciliation decision from the adversarial review (SEV-1…SEV-9) is resolved here and marked `[R]`.

---

## 1. Thesis

The Swing engine reuses the 0DTE **pipeline shape** (Ingest → Discover → Score → Contract → Gate → Commit → Manage → Grade → Calibrate), the **pure-core / thin-IO-shell** idiom, the **feature-store + graduation-ladder** discipline (`recommendSignal`, `ENFORCE_MIN_BLOCK_N=10`, `ENFORCE_MIN_DELTA_PTS=15`, `MIN_SAMPLES=20`, "a null is honest, a fabricated zero is a lie"), and the **horizon spine** (`horizons.ts`, `horizon-fanout.ts`, `horizon-scorers.ts`, `horizon-candidate.ts`, `horizon-plays.ts`, `horizon-board.ts`, `swing-signals.ts`) — it extends these, never forks them. But it **redesigns the five things that make a multi-session thesis different from a same-day lottery**: (1) *evidence* — a 7-pillar archetype-weighted score (persistence + structure + relative strength + catalyst + time + vol/contract + regime), never the 0DTE flow score; (2) *cadence* — phase-anchored whole-market discovery + hourly active-refresh that only **commits once a thesis has persisted across sessions**, never on a lone print; (3) *contract* — a 0.50–0.75Δ directional instrument chosen by a full-chain tradability×thesis-fit ranker per sub-lane (Tactical 2–7 / Standard 8–21 / Extended 22–30), never the top-flow strike and never the 0.35Δ banger; (4) *exits* — underlying-thesis-primary management (structural stop in the underlying, thesis break, trailing-underlying stop) with the premium scale-out only underneath and a −60% capital backstop; (5) *grading* — a multi-truth (execution/path/thesis/management/financial) grader over a **longitudinal snapshot series** with a linked roll chain (close+grade+open-new, never overwrite). Everything new ships **evidence-only** (`scoreFloorGraduated:false`, `enforce:false`) until its own archetype×sub-lane graded bucket graduates it through the existing ladder.

---

## 2. REUSE table — existing modules the Swing engine plugs into unchanged

| Module (file:line) | What Swing reuses it for |
|---|---|
| `src/lib/db.ts:1931 fetchRecentFlows` | 120h multi-day flow tape (`since_hours:120, min_premium:250_000, limit:800` — **no `max_dte` cap**, unlike 0DTE's `max_dte:1`) |
| `src/features/nighthawk/lib/flow-accumulation.ts:199 flowAccumulationByTicker` + `src/lib/zerodte/flow-accumulation-context.ts:125 accumulationSignalsFromFlow` (`:42 ZeroDteFlowAccumulation`) | The multi-day accumulation persistence engine = the swing flow pillar (NOT `computeFlowQuality`) |
| `src/features/nighthawk/lib/candidates.ts:440 screenBreakoutMovers`, `:54 isExcludedInstrument`, `:513 extractMultiSourceCandidates` | Whole-market Tier-0 structure screen + ETP/index exclusion + corroboration-bonus pattern |
| `src/lib/providers/polygon.ts:226 fetchDailyMarketSummary`, `:238 fetchPriorDayCloses`, `:769 fetchStockDailyBars`, `:318 fetchSectorPerformance`, `:819 fetchShortInterest` | Grouped-daily universe, prior closes, daily bars (10d/63d returns, EMA source), 11-SPDR sector perf, short interest |
| `src/lib/providers/polygon-largo.ts:213 fetchPolygonMtfTechnicals` (`:41 fetchAggBars`, `:383 fetchStockLastNbbo`, `:13 AggBar`) | EMA20/50/200, ATR14, RSI14, rel_volume, range_high_20d; forward option/underlying bars for grading; fresh spot |
| `src/features/nighthawk/lib/technicals.ts:123 buildTechnicalCard`, `:75 classifySetup`, `:34 swingLevels` | Assembled technical card + setup tags (extract `classifySetup`/`swingLevels` to shared, don't re-derive) |
| `src/lib/providers/options-snapshot.ts:286 fetchOptionsUnifiedSnapshot` (`:82 OptionSnapshot`, `:142 normalizeImpliedVol`) | Per-contract greeks/IV/OI/quote for the contract ranker + liquidity gate |
| `src/lib/providers/polygon-options-gex.ts:3300 fetchPolygonIvTermStructure`; `src/lib/providers/uw-earnings.ts:115 fetchNextEarningsDate`; `src/lib/providers/macro-events.ts:390 fetchUpcomingMacroEventsLive`; `catalyst-news.ts:84 catalystTag`; `unusual-whales.ts:1649 fetchUwFdaCalendar`, `:849 fetchUwDarkPool`, `:1332 fetchUwOiChange` | IV term slope, earnings-in-window, macro-in-window, news/FDA catalysts, dark-pool + OI-change evidence |
| `src/lib/horizon-scorers.ts:31-99` (`clamp`, `round1`, `unit`, `momentumFromReturnPct`, `accumulationPersistence`, `trendStackScore`, `relativeStrengthScore`, `liquidityDepthScore`) | Pillar normalizer primitives — imported, not reimplemented |
| `src/lib/swing-signals.ts:72 swingSignalsFromReads` (`:24 SwingReads`) | The direction-signing convention (LONG/SHORT alignment) — the one canonical adapter `[R]` (SEV-2) |
| `src/lib/horizon-fanout.ts:88 explodeChainRows`, `:130 clearsLiquidity`, `:71 calendarDte`, `:27 ChainContract`, `:45 LiquidityGate` | Chain explode, liquidity gate primitive, DTE math, contract type |
| `src/lib/horizon-board.ts:103 assembleHorizonBoard`, `:86 scopeBoardToHorizon`, `:72 makePlaySet` | Board assembly + horizon scoping (extended, not replaced) |
| `src/lib/zerodte/scale-out.ts:56 gradeScaleOut`, `:106 deriveScaleOutAction`, `:25 SCALE_OUT_RULES`; `banger-scale-out-grade.ts:53 gradeBangerScaleOut` | Premium scale-out execution layer + the multi-day option-bar scale-out grade (financial truth) |
| `src/lib/zerodte/calibration.ts:452 recommendSignal`, `:49 ENFORCE_MIN_BLOCK_N`, `:55 ENFORCE_MIN_DELTA_PTS`, `:542 readScaleOutGradeBlob`, `:592 recommendScaleOutFromGrades`, `:316 bucketOf`, `:374 rawWinRatePct` | The entire graduation ladder — imported wholesale, zero new graduation math |
| `src/lib/zerodte/feature-store.ts:102 MIN_SAMPLES`, `:105 BaseRate`, `:130 sealRate`, `:38 labelFromPlanOutcome` pattern; `record.ts:102 isZeroDteWin`, `:27 LOW_N_THRESHOLD` | Feature-store read primitives + honest-null base rates + win predicate (`pnl>0`) |
| `src/lib/zerodte/feature-vector.ts:121 numOrNull`, `:197 numericVector`, `:34 versioning` pattern | The flat/versioned/null-safe feature-vector pattern (distinct swing schema, same discipline) |
| `src/lib/zerodte/governor.ts:65 CORRELATION_GROUPS`/`correlationGroupOf`; `src/lib/portfolio/allocation.ts:102 allocate`, `board-allocation.ts:36 allocateBoard`; `src/lib/sector-map.ts:56 getSector` | Correlation-group seed + advisory allocation rank/walk skeleton + sector map |
| `src/app/api/cron/zerodte-warm/route.ts:33`; `src/lib/cron-registry.ts:22 CRON_JOBS`; `src/lib/ws/uw-socket.ts:1133`; `src/lib/zerodte/scan-trigger.ts:46` | Cron route template, cron registry, live WS event hook, throttled-debouncer pattern |
| `src/app/api/market/nighthawk/horizons/route.ts:18` (`authorizeCronOrTierApi("premium")` + `requireToolApi("nighthawk")`, `no-store`); `nighthawk-view.ts:93 horizonForView` | Serving route auth/headers + `?view=swings` vocabulary |
| `src/features/nighthawk/command-deck/adapters.ts:163 terminalPlayFromHorizon`, `types.ts:30 TerminalPlay` | Command-deck carrier (extended to stop hardcoding `factors:[]`/`thesisBreak:{intact}`) |

---

## 3. NET-NEW modules

### 3.1 Foundational pure (zero live risk)
| File | Purpose |
|---|---|
| `src/lib/swing/taxonomy.ts` `[R]` (SEV-1/6) | **The one canonical source** for `SwingArchetype`, `SwingSubLane`, `SwingSetupState`, `SwingEntryState`, `SWING_SUB_LANES`, `subLaneForDte`. Every consumer imports from here. |
| `src/lib/swing/dossier.ts` `[R]` (SEV-2) | The one versioned `SwingDossier` type (`SWING_DOSSIER_VERSION`) + `buildSwingDossier` + numeric/categorical key lists. The single carrier produce→…→grade. |
| `src/lib/swing/archetype.ts` | `classifyArchetype(ArchetypeInputs) → ArchetypeVerdict` (single-winner, margin-confidence, `null` when thin) + `archetypeInputsFromReads` (reuses swing-signals direction-signing). |
| `src/lib/swing/sub-lane.ts` | `SwingSubLaneSpec` records (per-lane delta band, liquidity gate, grader, provisional floor, thetaSensitivity, earningsHazard). Re-exports from taxonomy. |
| `src/lib/swing/swing-pillars.ts` `[R]` (SEV-8) | The **7-pillar archetype-weighted scorer** `scoreSwingPillars` (A price-structure, B rel-strength, C options-flow, D vol/contract, E catalyst, F regime, G data-quality) + `SWING_PILLAR_WEIGHTS_BY_ARCHETYPE`. This is the SWING evidence hierarchy; `scoreSwing` becomes a back-compat shim. |
| `src/lib/swing/contract-ranker.ts` | Full-chain tradability×thesis-fit ranker (0.50–0.75Δ directional stance, breakeven-headroom, DTE-fit) → one pick per sub-lane, with `topFlowStrike`/`topFlowWasPicked` provenance. |
| `src/lib/swing/setup-state.ts` + `entry-model.ts` | Setup maturity (`deriveSetupState`) + entry model (`SwingEntryPlan`, `actualFill:null` until real fill, entry deadline ≠ option expiry). |
| `src/lib/swing/gates.ts` + `portfolio.ts` | 3-way `COMMIT/WATCH/SKIP` gate stack + underlying-based R:R + portfolio-overlap (evidence-only). |
| `src/lib/swing/theme-cluster.ts` `[R]` (SEV-9) | The **one** theme/correlation resolver (`CORRELATION_THEMES`, `ETF_PROXY_THEMES`, `resolveTheme`, `sameThesis`) shared by gate + allocation. Collapses NVDA+AMD+SMH+QQQ → one cluster. |
| `src/lib/swing/swing-risk.ts` + `beta.ts` + `swing-allocation.ts` | Per-position greek/$ risk, OLS index beta, risk-budgeted allocation (advisory). |
| `src/lib/swing/manage.ts` | Underlying-thesis-primary management state machine + DTE-migration + roll-intent detection (pure). |
| `src/lib/swing/grade.ts` | Multi-truth grader (`gradeSwingPosition` → execution/path/thesis/management/financial) reusing `gradeBangerScaleOut`. |
| `src/lib/swing/feature-vector.ts` + `feature-store.ts` + `record.ts` + `calibration.ts` | Longitudinal swing feature vector, read-side store + trajectory studies, roll-chain-aware record, archetype/sub-lane graduation wrappers. |
| `src/lib/swing/serving.ts` + `serving-board.ts` | 7-section action router (`sectionForSwingPlay`) + sectioned lane assembler. |

### 3.2 IO shells (ledger-dependent)
| File | Purpose |
|---|---|
| `src/lib/swing/discovery.ts` `[R]` (SEV-3) | **The one** whole-market discovery core (`deriveSwingCandidates` pure + `runSwingDiscoveryScan` shell). Two-tier: Tier-0 flow + structure screens → merge → Tier-1 per-name enrich → `SwingDossier[]`. |
| `src/lib/swing/accumulation-store.ts` | Pre-commit persistence memory (`swing_candidate_accumulation`): accretes one observation/scan; promotes to WATCH only on cross-session persistence. |
| `src/lib/swing/swing-ingest.ts` | Per-candidate multi-day read assembler (the missing `swingSignalsFromReads` caller). |
| `src/lib/swing/active-refresh.ts` + `event-trigger.ts` + `manage-sync.ts` + `roll.ts` + `serving-ingest.ts` | Held-position refresh, live event routing, management IO shell, roll execution (close+grade+link), per-ticker serving meta. |

### 3.3 New DB tables + accessors (in `db.ts runMigrations`)
- **`swing_candidate_accumulation`** — PK `(ticker, direction)`; persistence memory (observation count, distinct session days, phases_seen, promoted_position_id). Accessors: `upsertSwingAccum`, `fetchAccumulating`, `markAccumPromoted`, `fadeStaleAccum`.
- **`swing_positions`** `[R]` (Q4 #5) — PK `id BIGSERIAL`; `root_position_id/parent_position_id/roll_seq` (roll chain), `sub_lane`, `archetype`, `top_flow_strike` + chosen `contract_*`, `thesis_invalidation_px`/`target_underlying_px` (underlying-terms), COALESCE-pinned `entry_context/gate_calibration_json/feature_vector/plan_json`, premium latches + `underlying_mfe/mae`, `scale_out_grade JSONB`, `grade_json JSONB`, `grade_methodology`, `legacy_grade JSONB`, monotonic `status` (adds terminal `ROLLED`). Accessors: `insertSwingPosition`, `updateSwingLiveState`, `gradeSwingPosition`, `pinSwingScaleOutGrade`, `fetchOpenSwingPositions`, `fetchSwingPositionsRange`, `fetchUngradedSwingPositions`, `fetchSwingPositionChain`, `fetchGradedSwingFeatureRows`, `fetchOpenSwingExposure`.
- **`swing_position_snapshots`** — PK `id BIGSERIAL`, FK `position_id`; append-only longitudinal series (`snapshot_kind`, `dte_remaining`, underlying/option marks, running MFE/MAE, `thesis_state`, full re-computed `feature_vector`, `event_json`). Accessor: `insertSwingSnapshot`, `fetchSwingSnapshots`.

### 3.4 New providers / gaps
No new *live* provider is required for v1. Documented gaps (§6): historical IV-rank series, industry-granular relative strength, structured corp-actions, index-beta fetcher (derived via OLS in the meantime).

### 3.5 New scripts (evidence harnesses)
- `scripts/audit/swing-discovery-scan.mjs` (`npm run scan:swing`) — whole-market discovery funnel + dossiers.
- `scripts/audit/swing-sim.mjs` (`npm run sim:swing --grade=DATE`) — multi-truth grader over real forward bars.
- `scripts/audit/swing-portfolio-sim.mjs` — allocation backtest (graduates the budget caps).

---

## 4. Dependency-ordered PR sequence

Discipline for every PR: small, single-issue, `npx tsx --test` green, calibration-first. "Evidence-only" = ships live but sizes/gates nothing (`scoreFloorGraduated:false` / `enforce:false`). "Gating" = mechanical tradeability only (liquidity/spread/quote-staleness/expiry/thesis-invalidation), never an ungraduated edge threshold. PRs that change what commits are marked **HOLD** (open as draft; merge on operator go).

### Phase 0 — Foundations (pure, zero live risk)

**PR-1 — Canonical swing taxonomy** `[R]` (SEV-1/6)
- Files: `src/lib/swing/taxonomy.ts` (+ `taxonomy.test.ts`).
- Delivers: the one `SwingArchetype` union (final list below), `SwingSubLane` (`TACTICAL|STANDARD|EXTENDED`), `SwingSetupState`, `SwingEntryState`, `SWING_SUB_LANES`, `subLaneForDte`. **Blocks every other PR** — resolves the five-way archetype split and the naming split before any consumer exists.
- Verify: union membership stable-ordered; `subLaneForDte(5)==="TACTICAL"`, `(14)==="STANDARD"`, `(25)==="EXTENDED"`, `(1)/(31)===null`.
- Stance: evidence-only (pure types).

**PR-2 — Sub-lane specs + pillar-scorer skeleton** `[R]` (SEV-8)
- Files: `src/lib/swing/sub-lane.ts`, `src/lib/swing/swing-pillars.ts`, `src/lib/swing/swing-archetype.ts` (weight tables) (+ tests).
- Delivers: `scoreSwingPillars` with all 7 normalizers reusing `horizon-scorers.ts:31-99`; `SWING_PILLAR_WEIGHTS_BY_ARCHETYPE` (each vector sums 100); `SWING_PILLAR_WEIGHTS_GRADUATED=false`. Absent pillar → `present:false`, 0 points, renormalize over present pillars.
- Verify: weights sum 100 per archetype; archetype swap re-ranks two synthetic names; score ∈ [0,100]; null pillar drops from denominator.
- Stance: evidence-only.

**PR-3 — Archetype classifier + canonical dossier** `[R]` (SEV-2)
- Files: `src/lib/swing/archetype.ts`, `src/lib/swing/dossier.ts` (+ tests).
- Delivers: `classifyArchetype → ArchetypeVerdict` (single winner, `ARCHETYPE_PRIORITY` tie-break, margin confidence, `null` when thin); `SwingDossier` + `buildSwingDossier` (numOrNull discipline, `v` stamp, `dataQuality.degraded`); `archetypeInputsFromReads` (reuses swing-signals direction-signing). This is the one dossier all consumers take.
- Verify: each `fitX` fires on its fixture, low elsewhere; SHORT inputs invert symmetrically; ties resolve by priority; thin data → `null`; dossier preserves nulls.
- Stance: evidence-only.

**PR-4 — Contract ranker (0.50–0.75Δ directional stance)** `[R]` (SEV-4)
- Files: `src/lib/swing/contract-ranker.ts` (+ test); extend `ChainContract` (optional greeks/`bidSize`/`askSize`/`dayVolume`), `OptionSnapshot` mapper (map already-fetched `bid_size`/`ask_size`/`session.volume`); update `HORIZONS.SWING.contract` fallback to `targetDelta:0.60, deltaBand:[0.50,0.75]`.
- Delivers: `rankSwingContracts` (tradability×thesis-fit, breakeven-headroom, DTE-fit) → one pick per sub-lane with flow-strike provenance. **This is the contract picker the gate + serving path consume — not a low-delta `fanOutSwingSubLanes`.** Resolves SEV-4: the wired instrument no longer reintroduces FM#5.
- Verify: 0.60Δ beats 0.30Δ on breakeven-headroom at equal tradability; tighter-spread/bigger-size wins at equal thesis-fit; null greeks degrade to delta-closest without throwing; ranker never picks a strike *because* it is the flow strike.
- Stance: gating only on mechanical liquidity/delta-band/expiry; rank weights `graduated:false` (evidence-only).

### Phase 1 — Decision layer (pure)

**PR-5 — Setup-state + entry-model + gate stack + portfolio-overlap**
- Files: `src/lib/swing/setup-state.ts`, `entry-model.ts`, `gates.ts`, `portfolio.ts`, `theme-cluster.ts` `[R]` (SEV-9) (+ tests); export `governor.ts correlationGroupOf`.
- Delivers: `evaluateSwingGates → {verdict:COMMIT|WATCH|SKIP, setupState, entryPlan, blocks, softPenalties, calibration}`. **Structural gates enforce** (liquidity, spread, quote_stale, daily_bar_incomplete, expiry_insufficient, thesis_invalidated, earnings/binary-in-window without auth, gate_context_unavailable/fail-closed). **`reward_risk_floor` and `entry_extended` log `would_block` but `enforced:false`** `[R]` (SEV-5) — their thresholds (1.8 R:R, 0.5·ATR) are ungraduated. `theme-cluster.ts` is the one theme resolver shared by gate overlap + allocation.
- Verify: structural gates veto on fixtures; edge gates log would_block without changing verdict; `actualFill` stays null; `entryDeadline ≠ contract.expiry`; `sameThesis("QQQ","NVDA")===true`.
- Stance: mechanical gates gating; all edge thresholds evidence-only.

**PR-6 — Risk math + advisory allocation**
- Files: `src/lib/swing/swing-risk.ts`, `beta.ts` (OLS only; `fetchNameBeta` deferred), `swing-allocation.ts`, `swing-board-allocation.ts` (+ tests).
- Delivers: `allocateSwingBook` under three v1 caps (theme premium, book premium, expiry-week cluster), `clusterPolicy:"AGGREGATE_CAP"`, `enforce:false`. `existing` injectable (empty `[]` acceptable — still catches NVDA+AMD+SMH+QQQ in one session's candidate set).
- Verify: risk math + null-propagation (betaMissing/greeksMissing → `partial`); the four-name cluster collapses; nothing resized when `enforce:false`.
- Stance: evidence-only (advisory).

**PR-7 — Management state machine + DTE migration + roll intent**
- Files: `src/lib/swing/manage.ts` (+ test).
- Delivers: `evaluateSwingManagement` with precedence **expiry_risk → structural_stop(underlying) → thesis_stop → premium_stop(−60% backstop) → [advisory: catalyst/regime → profit-ladder → flow/rel-strength/vol-collapse → time-stop → add-eligible]**; `evaluateDteMigration`; `detectRollCandidate` (intent only). Reuses `deriveScaleOutAction` for premium mechanics; `SWING_SUBLANE_MANAGE` per-lane params.
- Verify: LONG breakout trails+runners; hits underlying structural stop at any premium P&L; migrates at 3 DTE with theta disproportion → roll intent; holds on missing data.
- Stance: capital-preservation rungs gating (structural/premium/expiry); all edge rungs evidence-only until `graduatedRungs` includes them.

**PR-8 — Multi-truth grader**
- Files: `src/lib/swing/grade.ts` (+ test); `scripts/audit/swing-sim.mjs` (`npm run sim:swing`).
- Delivers: `gradeSwingPosition → SwingGrade` (five truth families) reusing `gradeBangerScaleOut` for the financial scale-out truth; `graderTimeframeForSubLane` `[R]` (SEV-9: pin Tactical→minute/hour once — use **hour** for Standard, **day** for Extended, **minute** for Tactical); conservative intrabar ordering (stop-before-target). Sim runs over real forward bars.
- Verify: each truth family asserts on synthetic bars; ungradeable survivorship guard; `gradeSwingScaleOut` parity with `gradeBangerScaleOut`; `sim:swing --grade=DATE` prints archetype cuts.
- Stance: evidence-only (produces graded evidence; sizes nothing).

**PR-9 — Serving section router (pure)**
- Files: `src/lib/swing/serving.ts` (+ test); extend `HorizonPlay` (optional `archetype/subLane/setupState/entryStatus/parentPlayId/serving`), `HorizonLaneBoard` (optional `sections`), `TerminalPlay` (optional swing fields).
- Delivers: 7-section `sectionForSwingPlay` router keyed on **observable** state (setupState/entryStatus/live status/thesisLevel), never on ungraduated stats. Router uses only the canonical `SwingSetupState` `[R]` (SEV-6). `committed/watch` stay derived back-compat views; 0DTE/LEAPS untouched.
- Verify: 91-pt-extended → `WAITING_FOR_ENTRY`, 82-pt-at-trigger → `COMMIT_NOW`; `scopeBoardToHorizon` zeroes `sections` on non-selected lanes.
- Stance: sections gate on mechanical/observable reads; probability/EV fields are null-until-graduated evidence.

### Phase 2 — Ledger + IO (the persistence artifact)

**PR-10 — `swing_positions` + `swing_position_snapshots` + `swing_candidate_accumulation` migrations + accessors** `[R]` (Q4 #5)
- Files: `src/lib/db.ts` (migrations + all §3.3 accessors) (+ test against a fresh migration).
- Delivers: the greenfield ledger every IO shell and all grading persistence depend on. COALESCE-pin discipline, first-write-wins scale-out grade, monotonic status with terminal `ROLLED/CLOSED`, append-only snapshots.
- Verify: insert/upsert/latch/grade round-trip; monotonic status rejects regression; append snapshots don't upsert; roll chain fetch ordered by `roll_seq`.
- Stance: schema only — no live behavior. **HOLD** (merge with PR-11 discovery so the table has a writer).

### Phase 3 — Wire the lane live (evidence-only on the desk)

**PR-11 — One whole-market discovery core + ingest assembler + accumulation store** `[R]` (SEV-3)
- Files: `src/lib/swing/discovery.ts` (`deriveSwingCandidates` pure + `runSwingDiscoveryScan` shell), `swing-ingest.ts`, `accumulation-store.ts` (+ tests).
- Delivers: **the single** two-tier discovery (Tier-0 flow + structure → merge → Tier-1 enrich → `SwingDossier[]` → `scoreSwingPillars`), persistence-gated promotion to WATCH. Feeds `produceHorizonPlays`.
- Verify: `scan:swing` returns dossiers from both paths over the live market; a flow-less Path-B candidate still produces a dossier (FM#1 proof); a 1-session candidate stays below `meetsPersistence`, a 2-session clears it.
- Stance: evidence-only (`commitEligibleCount` held at 0; WATCH rail only).

**PR-12 — Serving lane + route wiring (4 of 7 sections live)**
- Files: `src/lib/swing/serving-board.ts`, `serving-ingest.ts`, `getSwingServingLane` service; edit `route.ts` SWING branch; de-hardcode `terminalPlayFromHorizon` (`adapters.ts:163`).
- Delivers: `?view=swings` shows real `COMMIT_NOW/WAITING_FOR_ENTRY/WATCH/RESEARCH` (the three live-position sections render empty until PR-13). Deck factors/regime/thesisBreak fed from real reads.
- Verify: iOS/HTML read of `?view=swings` shows populated WATCH/RESEARCH rails; provisional-floor badge present; calibrated-probability renders `—` (null).
- Stance: evidence-only, member-safe.

**PR-13 — Cron + EventBridge + WS hook** — **HOLD**
- Files: `src/app/api/cron/swing-discovery/route.ts`, `swing-active-refresh/route.ts`, `scan-cadence.ts`, `event-trigger.ts`, `active-refresh.ts`, `manage-sync.ts`; two `CRON_JOBS` entries; UW WS `isMaterialSwingFlow` hook.
- Delivers: phase-anchored discovery (post-close first, then 4 more phases) + hourly active-refresh writing snapshots; live event routing (advance-candidate, never commit).
- Verify: cron fires idempotent per `(date,phase)`; active-refresh appends `eod` snapshots; WS hook advances accumulation without committing.
- Stance: evidence-only writes; **HOLD** because it starts persisting positions.

### Phase 4 — Grade, calibrate, graduate (closes the loop)

**PR-14 — Feature vector + feature store + record**
- Files: `src/lib/swing/feature-vector.ts`, `feature-store.ts`, `record.ts` (+ tests).
- Delivers: longitudinal swing vector (recomputed per snapshot), read-side base rates + trajectory studies (`studyTwoStagnantSessions`, `studyFlowDecay`, `studyIvKillsGoodSetups`, `analyzeBestDteByArchetype`), roll-chain-aware `buildSwingRecord` (per-leg grades + chain composite — a roll never nets away a loss).
- Verify: base rates null under MIN_SAMPLES; trajectory joins snapshot series to outcome; chain composite preserves parent loss.
- Stance: evidence-only.

**PR-15 — Roll execution + management IO shell** — **HOLD**
- Files: `src/lib/swing/roll.ts` (`closeAndRollSwingPosition`), wire `manage-sync.ts` to ledger.
- Delivers: roll = transactional close+grade parent (`ROLLED`, frozen `realized_pnl_pct`) + insert linked child. Management snapshots on every tick; acts only on gating rungs.
- Verify: parent grade frozen on roll; child links `parent_position_id`/`root_position_id`; snapshot appended even when nothing gates.
- Stance: gating rungs act (capital-preservation only); **HOLD**.

**PR-16 — Calibration + graduation wrappers** `[R]` (SEV-7)
- Files: `src/lib/swing/calibration.ts` — **distinctly named** wrappers (no collisions): `analyzeArchetypeRecord` (floor graduation), `analyzeSubLaneRecord`, `analyzePillarWeightRecord`, `analyzeSwingScaleOut`, `analyzeSwingGateCalibration`, `analyzeContractRankCalibration`, `analyzeAllocationRecord` — all reusing `recommendSignal`/ladder. Plus `scripts/audit/swing-portfolio-sim.mjs`.
- Delivers: per-archetype/sub-lane graduation. Flips `scoreFloorGraduated`, pillar-weight, gate `enforced`, exit-rung, and budget caps to live **only** when the bucket clears `n≥10`, delta≥15pt.
- Verify: a bucket below n=10 stays provisional; a bucket clearing the bar flips exactly one graduation flag.
- Stance: this is the mechanism that *earns* gating — nothing graduates without its own graded bucket.

**Final canonical `SwingArchetype` list** `[R]` (SEV-1) — 8 members: `BREAKOUT`, `PULLBACK_CONTINUATION`, `MEAN_REVERSION`, `FAILED_BREAKDOWN`, `POST_EARNINGS_DRIFT`, `FLOW_ACCUMULATION`, `SECTOR_ROTATION`, `EVENT_DRIVEN`. (Merges the 10/8/6/5/4 variants: drops the rarely-separable `PRE_EARNINGS_MOMENTUM`→folds into `EVENT_DRIVEN`, `VOL_COMPRESSION`/`VOLATILITY_EXPANSION`→`BREAKOUT` sub-signal, `TREND_CONTINUATION`→`PULLBACK_CONTINUATION`, `GAP`→`EVENT_DRIVEN`. Eight is enough buckets to be meaningful while still reachable for n≥10 graduation.)

---

## 5. PR-1 fully specified (`src/lib/swing/taxonomy.ts`)

```ts
// src/lib/swing/taxonomy.ts — THE canonical swing taxonomy. Every swing module imports from here.
// No IO, no deps beyond horizon types. This file resolves SEV-1/SEV-6 (five-way archetype/sub-lane split).

import type { ContractPreference, ExitPrimitive, GraderTimeframe } from "../horizons";
import type { LiquidityGate } from "../horizon-fanout";

export const SWING_TAXONOMY_VERSION = 1;

// ─── Archetype (the partition key for weights + calibration; FM#7) ─────────────
export type SwingArchetype =
  | "BREAKOUT"
  | "PULLBACK_CONTINUATION"
  | "MEAN_REVERSION"
  | "FAILED_BREAKDOWN"
  | "POST_EARNINGS_DRIFT"
  | "FLOW_ACCUMULATION"
  | "SECTOR_ROTATION"
  | "EVENT_DRIVEN";

/** Stable render/iteration order. */
export const SWING_ARCHETYPES: readonly SwingArchetype[] = [
  "BREAKOUT", "PULLBACK_CONTINUATION", "MEAN_REVERSION", "FAILED_BREAKDOWN",
  "POST_EARNINGS_DRIFT", "FLOW_ACCUMULATION", "SECTOR_ROTATION", "EVENT_DRIVEN",
] as const;

/** Most-specific-first tie-break for the single-winner classifier (PR-3). */
export const ARCHETYPE_PRIORITY: readonly SwingArchetype[] = [
  "EVENT_DRIVEN", "POST_EARNINGS_DRIFT", "FAILED_BREAKDOWN", "FLOW_ACCUMULATION",
  "SECTOR_ROTATION", "BREAKOUT", "PULLBACK_CONTINUATION", "MEAN_REVERSION",
] as const;

export interface ArchetypeMeta {
  id: SwingArchetype;
  label: string;
  note: string;
  scoreFloor: number;            // PROVISIONAL per-archetype commit floor
  scoreFloorGraduated: boolean;  // v1: always false — graduates on its own graded bucket
}
export const ARCHETYPE_META: Record<SwingArchetype, ArchetypeMeta>;

// ─── Sub-lane (FM#2 — 2–30 DTE is three contract classes, not one) ─────────────
export type SwingSubLane = "TACTICAL" | "STANDARD" | "EXTENDED";

export const SWING_SUB_LANES_ORDER: readonly SwingSubLane[] = ["TACTICAL", "STANDARD", "EXTENDED"] as const;

export interface SwingSubLaneSpec {
  id: SwingSubLane;
  label: string;
  dteMin: number;                // contiguous, non-overlapping within [2,30]
  dteMax: number;
  contract: ContractPreference;  // 0.50–0.75Δ directional stance (NOT the 0.35Δ banger) — SEV-4
  liquidity: LiquidityGate;      // Extended tolerates wider spread / higher premium
  exit: ExitPrimitive;           // "SCALE_OUT" (kept per-lane for future divergence)
  grader: GraderTimeframe;       // TACTICAL:"minute" · STANDARD:"hour" · EXTENDED:"day" — SEV-9 pinned
  scoreFloor: number;            // PROVISIONAL
  scoreFloorGraduated: boolean;  // false until the sub-lane bucket graduates
  thetaSensitivity: number;      // 0–1, Pillar-D theta penalty weight (TACTICAL harsh, EXTENDED lenient)
  earningsHazard: number;        // 0–1, Pillar-E earnings-in-window hazard multiplier
}

export const SWING_SUB_LANES: Record<SwingSubLane, SwingSubLaneSpec> = {
  TACTICAL: {
    id: "TACTICAL", label: "Tactical (2–7d)", dteMin: 2, dteMax: 7,
    contract: { targetDelta: 0.65, deltaBand: [0.55, 0.75], note: "near-ITM, tracks underlying over 2–7d" },
    liquidity: { minOpenInterest: 400, maxSpreadPct: 0.18, maxPremiumPerShare: 35 },
    exit: "SCALE_OUT", grader: "minute", scoreFloor: 64, scoreFloorGraduated: false,
    thetaSensitivity: 1.0, earningsHazard: 1.0,
  },
  STANDARD: {
    id: "STANDARD", label: "Standard (8–21d)", dteMin: 8, dteMax: 21,
    contract: { targetDelta: 0.60, deltaBand: [0.50, 0.72], note: "directional 8–21d, breakeven inside target" },
    liquidity: { minOpenInterest: 250, maxSpreadPct: 0.25, maxPremiumPerShare: 45 },
    exit: "SCALE_OUT", grader: "hour", scoreFloor: 60, scoreFloorGraduated: false,
    thetaSensitivity: 0.6, earningsHazard: 0.6,
  },
  EXTENDED: {
    id: "EXTENDED", label: "Extended (22–30d)", dteMin: 22, dteMax: 30,
    contract: { targetDelta: 0.58, deltaBand: [0.50, 0.72], note: "time-in-thesis + convexity, 22–30d" },
    liquidity: { minOpenInterest: 200, maxSpreadPct: 0.32, maxPremiumPerShare: 55 },
    exit: "SCALE_OUT", grader: "day", scoreFloor: 60, scoreFloorGraduated: false,
    thetaSensitivity: 0.3, earningsHazard: 0.4,
  },
};

/** Which sub-lane owns a calendar DTE inside the SWING window, or null if outside [2,30]. */
export function subLaneForDte(dte: number): SwingSubLane | null;
/** Fast→slow order. */
export function allSwingSubLanes(): SwingSubLaneSpec[];

// ─── Pre-entry maturity + entry position (the serving router keys on these) ────
export type SwingSetupState = "FORMING" | "TRIGGERED" | "EXTENDED" | "INVALIDATED";
export type SwingEntryState = "PRE_TRIGGER" | "AT_TRIGGER" | "PULLBACK_TO_ENTRY" | "EXTENDED_CHASE";
```

Test (`taxonomy.test.ts`, `npx tsx --test`): `SWING_ARCHETYPES.length === 8` and every member has `ARCHETYPE_META`; `ARCHETYPE_PRIORITY` is a permutation of `SWING_ARCHETYPES`; `subLaneForDte` boundary cases (1→null, 2/7→TACTICAL, 8/21→STANDARD, 22/30→EXTENDED, 31→null); every `SWING_SUB_LANES[x].scoreFloorGraduated===false`; sub-lane DTE ranges are contiguous and non-overlapping covering exactly [2,30]; each sub-lane `contract.targetDelta ≥ 0.50` (asserts SEV-4 the directional stance is baked into the taxonomy, not the banger).

Note on `SwingSetupState`: PR-1 uses `FORMING|TRIGGERED|EXTENDED|INVALIDATED` (the serving-router vocabulary) as canonical; gate-entry's `EARLY|CONFIRMED|DEGRADED` distinctions are folded (`EARLY`→`FORMING`, `CONFIRMED`→`TRIGGERED`, `DEGRADED`→a soft flag on `TRIGGERED`), so the serving router branches all fire against real states `[R]` (SEV-6).

---

## 6. Open questions / provider gaps needing operator input

1. **Available swing capital & per-position risk cap.** `PortfolioBudget.capitalUsd` has no fetcher — it's operator config. Need a number (or a per-tier rule) before the allocation caps mean anything. Until provided, allocation runs on a placeholder and stays advisory.
2. **Historical IV-rank / percentile series** — no fetcher exists (only per-row `iv_rank`). Consumed by contract ranker (`ivPercentile`), Pillar D, `iv_killed_it` grading, `iv_richness` gate. v1 falls back to term-structure *slope* + per-row `iv_rank`, else `null`. Operator: is a provider/plan upgrade in scope, or do we ship slope-only permanently?
3. **Industry / sub-sector relative strength** — only 11 SPDR sector ETFs today. `SECTOR_ROTATION` archetype and Pillar B relative strength run at coarse sector granularity; `industryRs` stays `null`. Operator: acceptable for v1, or source an industry-group feed?
4. **Index beta** — no direct fetcher; derived via OLS over daily bars (`computeBeta`), `betaMissing` flag propagates, so the β-weighted-delta budget cap is always `partial` in v1. Operator: acceptable, or provision a beta source?
5. **Commit authorization for the swing lane.** The 0DTE standing auto-merge/auto-commit authorization is explicit. Swing PRs 13/15 (cron writes + roll execution) are marked **HOLD** because they begin persisting real positions and acting on rungs. Confirm the graduation gate — no swing floor/weight/cap goes live until its archetype×sub-lane bucket clears n≥10/delta≥15pt — is the intended bar, and that we may auto-merge the *evidence-only* PRs (1–12, 14, 16) under the existing policy while holding 13/15 for explicit go.
6. **Structured corp-actions (splits, guidance revisions)** — only untyped Benzinga news. `corp_action_clean` stays a SOFT/null-safe check. Confirm this is acceptable (grouped-daily is already split-adjusted, so distortion risk is low).
7. **Discovery phase rollout order.** Plan ships POST_CLOSE discovery first (cleanest full-session accumulation read), then adds the other 4 phases. Confirm that ordering, and the top-N per-name Tier-1 fetch cap (to stay under the 120s cron budget).
