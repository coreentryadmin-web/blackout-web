# LARGO ENGINE MAP — Phase 0

**Status:** Phase 0 deliverable for the LARGO owner lane (`docs/agents/briefs/largo.md`). Built
2026-08-22 by reading the tree at `17eb87e5`, running the contract ratchet on Node 20, and reading
the **deployed** env out of `blackout-production/app/env` rather than trusting code defaults.

This map exists to be a gate, not a document: the charter forbids opening a fix PR against the
Largo engine until the engine is understood end to end. Everything below is either traced in code
with the function named, measured, or explicitly marked **UNKNOWN**. An honest gap is a finding; a
plausible guess is a lie that outlives whoever wrote it.

---

## 0. Deployment reality — read this before assigning any severity

Per `_COMMON.md` rule 8, every env-tunable value here was read from the deployed secret, not from
the code default.

| Fact | Deployed value | Consequence |
|---|---|---|
| `LAUNCHED_TOOLS` | `heatmap,nighthawk` | **`largo` is NOT in it.** `tool-access.ts` gives Largo `defaultLaunched: false`, so in production the `/terminal` desk and `/api/market/largo/*` are reachable only by admins and by users carrying an explicit `publicMetadata.tool_access` grant. This is deliberate (the module comment says so) — but it means **every Largo defect's member-facing blast radius is currently bounded to admins and granted users.** Do not write a P0 severity that assumes a member audience. |
| `DAILY_AI_SPEND_KILL_USD` | `250` | The org-wide kill switch is **ARMED**, not dormant. `isLargoKillSwitchTripped()` and `isAiSpendCeilingTripped()` are both live code paths, so the spend-ceiling TOCTOU in §7 is a real path, not a hypothetical. |
| `LARGO_MEMBER_ROUTE_DEADLINE_MS` | not set → `100_000` | Route races every turn against 100s. |
| `LARGO_TOOL_LOOP_BUDGET_MS` | not set → `75_000` | Loop must give up before the route does. |
| `LARGO_TOOL_LOOP_TIMEOUT_MS`, `LARGO_TOOL_LOOP_MAX_ROUNDS`, `LARGO_DAILY_QUERY_BUDGET`, `LARGO_GLOBAL_MAX_CONCURRENT`, `LARGO_LOCAL_MAX_CONCURRENT`, `LARGO_INFLIGHT_TTL_MS`, `LARGO_REDIS_FAILOPEN`, `LARGO_PERSIST_TOOL_RESULTS_MAX_CHARS`, `LARGO_SESSION_RETENTION_DAYS`, `ANTHROPIC_MODEL`, `DAILY_AI_SPEND_ALERT_USD`, `DAILY_AI_SPEND_LOCAL_BACKSTOP_FRAC` | none set | Code defaults are the deployed values for all of these. That is now checked, not assumed. |

`MAX_TOOL_RESULT_CHARS` is a **compile-time constant** (`16_000`), not env-tunable — it cannot be
changed without a deploy.

---

## 1. Counts of record

Measured by importing the real modules (`LARGO_TOOL_DEFS`, `LARGO_CAPABILITIES`) under Node 20:

- **129 tools** in `LARGO_TOOL_DEFS`.
- **129 capability entries** in `capability-registry.ts`.
- **1:1** — no tool without a capability, no capability without a tool. `registry.test.ts` holds this.

Every count written elsewhere in the tree WAS stale (L-9). All corrected and now pinned by
`src/lib/largo/tool-count-claims.test.ts`, which re-derives the count from `LARGO_TOOL_DEFS` and
fails naming any sentence that disagrees — so this table records history, not an open gap:

| Source | Said | Actual | |
|---|---|---|---|
| `docs/agents/briefs/largo.md` (×5) | 127 tools | 129 | fixed |
| `tool-defs.ts` prompt-cache comment | 116 tools | 129 | fixed |
| `capability-registry.ts` header + ranking note | 120 / 116 tools | 129 | fixed |
| `tool-guard.ts` entitlement docstring | "49 of 116 catalogued" | 129 of 129 catalogued | fixed — and the fail-open policy it argued now says outright that it does not rest on the count |
| `largo-truncation-probe.mjs` header | "all 126" | 129 | fixed |
| `largo-terminal.ts` (×2) | 116 tools | 129 | fixed |
| `tool-guard.test.ts` (×2) | 120 capabilities | 129 | fixed |

Two were deliberately NOT renumbered, because a count that is the **denominator of a past
measurement** is not a claim about today: `largo-terminal.ts`'s *"a mean of 21.9 / 116 tools (19%)"*
(dated instead — renumbering would have falsified a real result) and
`meridian-timeline-for-largo.ts`'s *"0 of 127 … mention Meridian"* (re-measured at **3 of 129**, and
`runLargoTool` now dispatches two Meridian cases, so it was rewritten to the past tense). And
`tool-guard.test.ts`'s *"the other 127"* is `129 − 2`, correct arithmetic that a blind replace would
have broken.

Distribution:

- **Product:** MARKET 42 · THERMAL 17 · HELIX 15 · CATALYSTS 12 · SPX_SLAYER 12 · TRACK_RECORD 9 · NIGHT_HAWK 9 · PLATFORM 7 · VECTOR 4 · MERIDIAN 2
- **Temporal:** `as_of` 58 · `live_only` 26 · `windowed` 21 · `event_log` 13 · `point_in_time` 7 · `snapshot_delta` 4
- **Freshness:** `fast` 55 · `historical` 23 · `realtime` 22 · `periodic` 16 · `session` 13
- **Entitlement:** `premium` **129 / 129**. Not one capability declares `admin`, so the entitlement
  gate in `checkToolEntitlement` is armed and **inert** — it restricts nothing today. That is the
  honest state, and it matches the docstring's own claim.

---

## 2. The trace — one question, every function named

Question used: *"Why does Helix disagree with Thermal on NVDA right now?"* — chosen because it
exercises intent, prefetch, the tool loop, the cross-product join, verification and the caveat
layer in one turn.

### 2.1 Transport in

```
POST /api/market/largo/query   (src/app/api/market/largo/query/route.ts)
```

In order, and the order is load-bearing:

1. `requireTierApi("premium")` — tier gate.
2. `requireToolApi("largo")` — **launch gate**. In production this is where a non-admin without a
   `tool_access` grant is turned away (§0).
3. `largoConfigured()` — Anthropic key present, else 503.
4. `shouldRejectLargoWithoutRedis()` — **fails CLOSED**: no Redis means no budget gate and a blind
   spend ledger, so the request is refused rather than run unmetered.
5. `validateAttachments(body.images)` — deliberately BEFORE any gate that costs the member
   something; a malformed upload must cost a 400, not one of their daily queries.
6. `isLargoKillSwitchTripped()` — org-wide daily spend ceiling. Cheap, no side effects, holds no
   slot, so it is first among the gates that can reject.
7. `acquireLargoSlot(userId)` — per-user concurrency, max 2, Redis Lua `INCR`+`EXPIRE`, **fails open**
   to `LocalConcurrencyBackstop`.
8. `acquireLargoGlobalSlot()` — org-wide concurrency ceiling, leak-safe ZSET, **fails open**.
9. `reserveLargoBudget()` — per-user daily query budget, atomic reserve-and-refund, **fails open**.
10. `wantsStream(req)` → **the browser always takes the SSE branch**. `runLargoQueryStream`.
11. `largoRouteDeadlineRace(...)` — 100s, returns a member-visible message rather than an ALB 504.

### 2.2 Turn preparation — `prepareLargoTurn` (`src/lib/largo-terminal.ts:405`)

All of this is deterministic code, before any model call:

`ensureLargoSession` → `fetchLargoHistory` → `fetchLargoSessionMetadata` → `parseLargoDepth`
→ `analyzeLargoQuestion` (intent) → `intentOverridesForDeskScope` → `deskScopeConfig`
→ history push (images first, then text — deliberate; a model that has seen the picture before the
instruction answers about the picture) → `trimHistory`
→ `captureLargoLiveFeed` / `formatLargoLiveFeed`
→ `buildConversationContext` → `resolveTimeframe` → `applyConversationToTimeframe` → `formatTemporalBlock`
→ `formatCapabilityBlock` → `formatEntityBlock` → `formatEvidenceOntologyBlock`
→ `rankCapabilities` → `buildQueryPlan` → `formatPlanBlock`
→ `buildDrillDowns` → `formatDrillDownBlock`
→ `loadLargoPlatformSnapshotBlock`
→ conditional prefetch cards (`helixThermalCompareForLargo` fires for this question)
→ `marketPhaseFromEt` → `getUserTier` / `isAdminUser`
→ `buildDynamicSystem(...)` → the system block
→ `filteredTools = LARGO_TOOL_DEFS` — **the full 129-tool surface, every turn, unfiltered.**

Two things about that last line matter and are easy to get backwards. It is not laziness: the
previous per-question allowlist exposed a mean of 21.9/116 tools and failed *silently* (a question
about open positions could not reach `get_open_plays`, so Largo answered from the live feed and
sounded confident). And the static list is the **cheaper** option, because the tool block is the
prompt-cache prefix — a list that changes per question never caches.

**`toolsUsed` is seeded, not observed.** `prepareLargoTurn:483` initialises it to
`["live_feed_capture"]` unconditionally, and prefetch pushes further names
(`platform_vitals_prefetch`, `social_content_pack_prefetch`, `ticker_social_guide_prefetch`,
`meridian_timeline_prefetch`, `get_peer_ticker_compare`, `get_helix_thermal_compare`,
`get_play_similarity`, `get_pre_earnings_pack`). **This settles the reading of the empty-round P0.**
A turn logged `tools_used: ["live_feed_capture"]` did not "dispatch prefetch and no answering tool"
— it dispatched **nothing at all**, model or prefetch. The array is a mix of seeded markers,
prefetch markers and real model dispatches, and only four of those eight prefetch names
(`get_helix_thermal_compare` is the only one that is also a real tool) can be told apart from a
model call by looking at the array.

### 2.3 The loop — `anthropicToolLoop` (`src/lib/providers/anthropic.ts:531`)

Per depth (`largoDepthConfig`):

| Depth | Model | maxRounds | maxTokens | per-round timeout | loop budget |
|---|---|---|---|---|---|
| Concrete | `claude-haiku-4-5` | 2 | 900 | 30s | 30s |
| Deep dive | `claude-sonnet-5` | 10 | 4096 | 75s | 75s |

Each round: `isAiSpendCeilingTripped()` → model call → `content.filter(type === "tool_use")`.

- **No tool calls + text** → return the text. Normal end of turn.
- **No tool calls + no text** → `console.warn("[anthropic] tool-loop round N produced NO tool calls
  and NO text …")` (#2620) and **return `null`**.
- **Tool calls** → `Promise.all` over `params.runTool(...)`, then each result serialized and capped.
- `maxRounds` exhausted → one non-streaming synthesis pass; if that throws,
  `extractTextFromLastAssistant`.

### 2.4 Tool dispatch — `makeGuardedToolRunner` (`src/lib/largo/core/tool-guard.ts:121`)

The single execution path. `checkToolEntitlement` → (deny returns a *structured refusal*, never a
throw, so the model can say it was denied instead of narrating "that data isn't available") →
`roundResultForReading` → push to `capturedResults` → push a `ToolCallDiagnostic`
`{tool, ms, denied, failed, bytes}`.

`runLargoTool` (`src/lib/largo/run-tool.ts:352`) is a 129-arm `switch (name)` over the product read
functions in `product-reads.ts` and the provider modules.

### 2.5 The transport cap — **HEAD slice, not tail**

`anthropic.ts:826-833`:

```ts
const raw = JSON.stringify(results[i]) ?? "null";
const capped = raw.length > MAX_TOOL_RESULT_CHARS
  ? raw.slice(0, MAX_TOOL_RESULT_CHARS) + "…[truncated]"
  : raw;
```

**The transport KEEPS the first 16 000 characters and discards everything after them.** ~~Six~~
**seven** places in the tree described this as a "TAIL slice" — `CLAUDE.md`,
`docs/agents/briefs/largo.md`, `docs/agents/briefs/helix.md`, `docs/agents/briefs/spx-slayer.md`,
`largo-truncation-probe.mjs`, `fit-tool-result.ts` and `nighthawk-edition-for-model.ts`. (Two peer-lane
charters — `helix.md`, `spx-slayer.md` — were missed by this section's first pass, and
`run-tool.ts:1078` was wrongly counted here: it says "tail-TRUNCATES", which can only mean the tail
is removed. Six minus one plus two = seven.) They
meant *"the tail is cut off"*, and every one of them then reasoned correctly from that
(`fit-tool-result.ts` puts aggregates FIRST precisely so the cut eats the row sample). But read
cold, "tail slice" states the opposite of what the code does, and a payload designed on the wrong
reading would put its aggregates last — which is exactly the #2433 defect.

**RESOLVED.** All seven now state what SURVIVES, and `tool-count-claims.test.ts` bans the phrase's
return across the files that describe the cap — with `tool-result-cap.ts`, which quotes it in order
to correct it, serving as the scanner's control.

The measured evidence agrees with the code, not the phrasing: `get_zerodte_record` delivered 1.5%
of itself *"with every aggregate cut off"* — aggregates were serialized third, i.e. late, i.e. in
the discarded tail.

### 2.6 Post-loop — the honesty chain (`runLargoQuery` / `runLargoQueryStream`)

Both paths run the identical chain; the streaming path emits `answer_reset` + a final `token` with
the **complete post-caveat text** and the client replaces rather than appends, because only the
final text has been through this chain:

1. empty text → `isAiSpendCeilingTripped()` → `emptyAnswerFallback` (`classifyEmptyAnswer`)
2. `collectContextNumbers([capturedResults, history])`
3. `verifyClaims(stripLargoBlocks(text), ctxNumbers)` — the **prose only**, deliberately: every
   number inside a ```` ```blackout ```` block also appears in the prose, so verifying the raw answer
   would count each twice and dilute the honesty ratio exactly as an answer got richer.
4. `applyVerificationCaveat`
5. `validatePlanExecution` → `applyPlanCaveat`
6. `findContradictions` → `applyCoherenceCaveat`
7. `findSourceConflicts` → `applyConflictCaveat`
8. `findProvenanceLies` → `applyProvenanceCaveat`
9. `applyMarketEvidenceGates` → `sanitizeLargoMemberText`
10. `formatToolDiagnostics` → `console.info`
11. `logClaudeTurn` (BIE interaction row) → `persistClaudeTurn` (`largo_messages`)
12. `envelopeFromContract` → `validateAnswerContract` (drift **logged, never enforced** — a hard gate
    would mean a member watches a 60s tool loop and gets nothing because the model wrote "Summary"
    instead of "Verdict")
13. `contextualFollowupsFromAnswer` + `generateLargoFollowups` → `withResolutionChips`
14. `buildLargoActions`

### 2.7 UI render

`LargoTerminal` → `useLargoChat` (replaces the streamed provisional text with `done.answer`) →
`LargoAnswerMessage` / `LargoConcreteAnswer` → `splitAnswerCaveats(content)` → `LargoAnswerCaveats`.

`splitAnswerCaveats` walks **backwards from the end** and collects trailing `>` blockquote blocks,
stopping at the first line that is not one.

---

## 3. Tool inventory — all 129

Columns and what they honestly mean:

- **Shape** — does the tool return a `ProductRead<T>` wrapper or a bare product shape.
- **Size bound** — does anything bound this payload *before* the transport's blind 16 000-char cut.
- **Probed** — has `largo-truncation-probe.mjs` ever measured it live.

Three whole-table facts, stated once rather than repeated 129 times:

1. **Shape: 128 of 129 return a bare shape.** `ProductRead<T>` appears in exactly four files —
   `contract/product-read.ts`, `contract/cross-product.ts`, `contract/cross-product-read.ts`, and one
   import line in `run-tool.ts`. The single consumer is `get_cross_product_read`, which composes the
   wrapper internally from five adapters. **No individual product tool is contract-wrapped.** The
   contract is real as types and as the C1 session-anchor ratchet; its adoption at the tool boundary
   is one tool out of 129.
2. **Size bound: 2 of 129 at the time of this inventory — 3 within hours** (#2649 fitted `get_vector_full_state` by hand). Only `get_zerodte_record` and `get_nighthawk_outcomes` pass their rows
   through `fitRowsToBudget` (budget `LARGO_RESULT_CHAR_BUDGET` = 14 000 = 87.5% of the cap, the
   headroom absorbing downstream rounding/wrapping). Those are precisely the two tools someone
   already caught being truncated (#2433, #2480, #2628). **The other 127 are capped blind.**
3. **Probed: 13 of 129 are even in the probe's list**, and 4 have a result on record.

| Tool | Product | Temporal | Freshness | Shape | Size bound | Probed |
|---|---|---|---|---|---|---|
| `get_analyst_ratings` | CATALYSTS | event_log | periodic | bare | **none** | never |
| `get_catalysts` | CATALYSTS | live_only | periodic | bare | **none** | never |
| `get_earnings` | CATALYSTS | windowed | session | bare | **none** | never |
| `get_earnings_calendar` | CATALYSTS | live_only | periodic | bare | **none** | never |
| `get_earnings_history` | CATALYSTS | windowed | historical | bare | **none** | never |
| `get_earnings_market` | CATALYSTS | live_only | periodic | bare | **none** | never |
| `get_economic_calendar` | CATALYSTS | live_only | session | bare | **none** | never |
| `get_fda_calendar` | CATALYSTS | live_only | periodic | bare | **none** | never |
| `get_ipo_calendar` | CATALYSTS | live_only | periodic | bare | **none** | never |
| `get_news` | CATALYSTS | event_log | fast | bare | **none** | never |
| `get_price_targets` | CATALYSTS | as_of | periodic | bare | **none** | never |
| `get_web_search` | CATALYSTS | live_only | fast | bare | **none** | never |
| `get_dark_pool` | HELIX | as_of | fast | bare | **none** | never |
| `get_flow_anomaly_near_misses` | HELIX | event_log | fast | bare | **none** | never |
| `get_flow_brief` | HELIX | as_of | realtime | bare | **none** | never |
| `get_flow_expiry_breakdown` | HELIX | as_of | fast | bare | **none** | never |
| `get_flow_per_strike` | HELIX | as_of | fast | bare | **none** | never |
| `get_flow_tape` | HELIX | as_of | realtime | bare | **none** | never |
| `get_global_flow` | HELIX | as_of | realtime | bare | **none** | never |
| `get_helix_derived` | HELIX | snapshot_delta | realtime | bare | **none** | never |
| `get_helix_signal_outcomes` | HELIX | windowed | historical | bare | **none** | never |
| `get_helix_tape_analytics` | HELIX | as_of | realtime | bare | **none** | never |
| `get_lit_flow` | HELIX | event_log | fast | bare | **none** | never |
| `get_net_prem_ticks` | HELIX | event_log | fast | bare | **none** | never |
| `get_options_flow` | HELIX | as_of | realtime | bare | **none** | never |
| `get_postgres_flows` | HELIX | windowed | historical | bare | **none** | never |
| `get_unusual_trades` | HELIX | event_log | fast | bare | **none** | never |
| `get_ah_movers` | MARKET | live_only | fast | bare | **none** | never |
| `get_company_profile` | MARKET | as_of | historical | bare | **none** | never |
| `get_congress_trades` | MARKET | event_log | historical | bare | **none** | never |
| `get_congress_unusual` | MARKET | event_log | historical | bare | **none** | never |
| `get_dividends` | MARKET | windowed | historical | bare | **none** | never |
| `get_etf_detail` | MARKET | as_of | session | bare | **none** | never |
| `get_etf_flow` | MARKET | as_of | fast | bare | **none** | never |
| `get_financials` | MARKET | windowed | historical | bare | **none** | never |
| `get_hot_tickers` | MARKET | as_of | fast | bare | **none** | never |
| `get_insider_flow` | MARKET | event_log | historical | bare | **none** | never |
| `get_institutional` | MARKET | as_of | historical | bare | **none** | never |
| `get_iv_stats` | MARKET | as_of | fast | bare | **none** | never |
| `get_iv_term_structure` | MARKET | live_only | fast | bare | **none** | never |
| `get_macro_indicator` | MARKET | as_of | periodic | bare | **none** | never |
| `get_market_breadth` | MARKET | as_of | fast | bare | **none** | never |
| `get_market_context` | MARKET | as_of | fast | bare | **none** | never |
| `get_market_movers` | MARKET | as_of | fast | bare | **none** | never |
| `get_market_oi_change` | MARKET | as_of | session | bare | **none** | never |
| `get_market_regime` | MARKET | as_of | periodic | bare | **none** | never |
| `get_market_stats` | MARKET | as_of | fast | bare | **none** | never |
| `get_nbbo` | MARKET | as_of | realtime | bare | **none** | never |
| `get_nope` | MARKET | as_of | fast | bare | **none** | never |
| `get_option_price_history` | MARKET | point_in_time | historical | bare | **none** | never |
| `get_ownership` | MARKET | as_of | historical | bare | **none** | never |
| `get_peer_rs` | MARKET | windowed | fast | bare | **none** | never |
| `get_predictions_consensus` | MARKET | live_only | fast | bare | **none** | never |
| `get_qqq_relative_strength` | MARKET | windowed | fast | bare | **none** | never |
| `get_quote` | MARKET | live_only | realtime | bare | **none** | never |
| `get_realized_vol` | MARKET | windowed | session | bare | **none** | never |
| `get_risk_reversal_skew` | MARKET | live_only | fast | bare | **none** | never |
| `get_screener` | MARKET | live_only | fast | bare | **none** | never |
| `get_seasonality` | MARKET | windowed | historical | bare | **none** | never |
| `get_sector_flow` | MARKET | live_only | fast | bare | **none** | never |
| `get_short_data` | MARKET | windowed | session | bare | **none** | never |
| `get_short_interest` | MARKET | as_of | historical | bare | **none** | never |
| `get_stock_state` | MARKET | as_of | fast | bare | **none** | never |
| `get_technicals` | MARKET | as_of | fast | bare | **none** | never |
| `get_top_net_impact` | MARKET | live_only | fast | bare | **none** | never |
| `get_uw_bars` | MARKET | windowed | fast | bare | **none** | never |
| `get_uw_technicals` | MARKET | as_of | fast | bare | **none** | never |
| `get_vix_term` | MARKET | as_of | realtime | bare | **none** | never |
| `get_volatility_regime` | MARKET | as_of | fast | bare | **none** | never |
| `get_meridian_event` | MERIDIAN | point_in_time | periodic | bare | **none** | never |
| `get_meridian_timeline` | MERIDIAN | live_only | periodic | bare | **none** | never |
| `get_banger_board` | NIGHT_HAWK | as_of | periodic | bare | **none** | in probe list, no result on record |
| `get_cortex_decision` | NIGHT_HAWK | point_in_time | fast | bare | **none** | in probe list, no result on record |
| `get_gate_blocked_value` | NIGHT_HAWK | windowed | session | bare | **none** | in probe list, no result on record |
| `get_nighthawk_dossier` | NIGHT_HAWK | point_in_time | session | bare | **none** | in probe list, no result on record |
| `get_nighthawk_edition` | NIGHT_HAWK | point_in_time | session | bare | **none** | COMPLETE 08-21 |
| `get_nighthawk_horizons` | NIGHT_HAWK | as_of | fast | bare | **none** | in probe list, no result on record |
| `get_swing_horizon` | NIGHT_HAWK | as_of | periodic | bare | **none** | in probe list, no result on record |
| `get_zerodte_plays` | NIGHT_HAWK | as_of | realtime | bare | **none** | COMPLETE 08-21 |
| `get_zerodte_rejections` | NIGHT_HAWK | event_log | fast | bare | **none** | in probe list, no result on record |
| `call_internal_api` | PLATFORM | live_only | fast | bare | **none** | never |
| `get_cross_product_read` | PLATFORM | live_only | fast | `ProductRead` (composed) | **none** | never |
| `get_ecosystem_context` | PLATFORM | as_of | fast | bare | **none** | never |
| `get_platform_snapshot` | PLATFORM | as_of | fast | bare | **none** | never |
| `get_polygon` | PLATFORM | live_only | realtime | bare | **none** | never |
| `get_uw` | PLATFORM | live_only | realtime | bare | **none** | never |
| `search_ticker` | PLATFORM | live_only | historical | bare | **none** | never |
| `get_gate_rules` | SPX_SLAYER | live_only | historical | bare | **none** | never |
| `get_lotto_live` | SPX_SLAYER | as_of | fast | bare | **none** | never |
| `get_lotto_state` | SPX_SLAYER | as_of | realtime | bare | **none** | never |
| `get_open_plays` | SPX_SLAYER | as_of | realtime | bare | **none** | never |
| `get_power_hour` | SPX_SLAYER | as_of | fast | bare | **none** | never |
| `get_signal_log` | SPX_SLAYER | event_log | fast | bare | **none** | never |
| `get_spx_confluence` | SPX_SLAYER | as_of | realtime | bare | **none** | never |
| `get_spx_engine_snapshots` | SPX_SLAYER | point_in_time | fast | bare | **none** | never |
| `get_spx_pin` | SPX_SLAYER | as_of | fast | bare | **none** | never |
| `get_spx_play` | SPX_SLAYER | as_of | realtime | bare | **none** | never |
| `get_spx_pulse` | SPX_SLAYER | as_of | realtime | bare | **none** | never |
| `get_spx_structure` | SPX_SLAYER | as_of | realtime | bare | **none** | never |
| `get_atm_chains` | THERMAL | live_only | realtime | bare | **none** | never |
| `get_gex` | THERMAL | as_of | fast | bare | **none** | never |
| `get_gex_heatmap` | THERMAL | as_of | fast | bare | **none** | never |
| `get_gex_matrix_changes` | THERMAL | snapshot_delta | fast | bare | **none** | never |
| `get_gex_regime_events` | THERMAL | event_log | fast | bare | **none** | never |
| `get_greek_flow` | THERMAL | as_of | fast | bare | **none** | never |
| `get_greeks` | THERMAL | live_only | realtime | bare | **none** | never |
| `get_group_greek_flow` | THERMAL | as_of | fast | bare | **none** | never |
| `get_helix_thermal_compare` | THERMAL | as_of | fast | bare | **none** | never |
| `get_max_pain` | THERMAL | as_of | periodic | bare | **none** | never |
| `get_oi_per_expiry` | THERMAL | as_of | session | bare | **none** | never |
| `get_oi_per_strike` | THERMAL | as_of | session | bare | **none** | never |
| `get_option_contract` | THERMAL | event_log | fast | bare | **none** | never |
| `get_options_chain` | THERMAL | live_only | realtime | bare | **none** | never |
| `get_options_volume` | THERMAL | live_only | fast | bare | **none** | never |
| `get_positioning` | THERMAL | as_of | fast | bare | **none** | never |
| `get_thermal_compare` | THERMAL | as_of | fast | bare | **none** | never |
| `get_confluence_outcomes` | TRACK_RECORD | windowed | historical | bare | **none** | never |
| `get_grader_agreement` | TRACK_RECORD | windowed | session | bare | **none** | in probe list, no result on record |
| `get_horizon_outcomes` | TRACK_RECORD | windowed | historical | bare | **none** | in probe list, no result on record |
| `get_nighthawk_outcomes` | TRACK_RECORD | windowed | historical | bare | `fitRowsToBudget` 14 000 | TRUNCATED 08-21 (fix #2628 unverified) |
| `get_setup_stats` | TRACK_RECORD | windowed | historical | bare | **none** | never |
| `get_similar_precedents` | TRACK_RECORD | point_in_time | historical | bare | **none** | never |
| `get_spx_vs_nighthawk_comparison` | TRACK_RECORD | windowed | session | bare | **none** | never |
| `get_trade_history` | TRACK_RECORD | windowed | historical | bare | **none** | never |
| `get_zerodte_record` | TRACK_RECORD | windowed | historical | bare | `fitRowsToBudget` 14 000 | COMPLETE 08-21 |
| `get_vector_analytics` | VECTOR | as_of | realtime | bare | **none** | never |
| `get_vector_full_state` | VECTOR | as_of | periodic | bare | **none** | never |
| `get_vector_pulse` | VECTOR | snapshot_delta | periodic | bare | **none** | never |
| `get_wall_dynamics` | VECTOR | snapshot_delta | fast | bare | **none** | never |
### What is UNKNOWN about this table

**Typical payload size per tool is UNKNOWN for 125 of 129 tools, and this map does not guess it.**
The charter asks for it; producing it honestly needs live data, and inventing a size class from
reading a return type would be exactly the failure this document is supposed to avoid.

It is, however, *already being measured and thrown away*. `makeGuardedToolRunner` records
`bytes: sizeOf(result)` for every call — the serialized length at the guard, which is the same string
the transport is about to cap. So the real distribution is one log line away (§6).

---

## 4. Grounding and verification

`verifyClaims` (`src/lib/bie/verifier.ts`) extracts numeric claims (`extractNumericClaims`: decimals,
percents, `$`-amounts, 3+ digit ints; years and bare integers ≤31 are prose, not claims) and matches
each against `collectContextNumbers` within 0.5% (or 0.02 absolute), also accepting the derived forms
the desk itself teaches (×2, ×0.5, ×100, ÷100, negation) so `target $8.40` verifies against a `$4.20`
entry.

**#2626 confirmed fixed, by reading the code and not the PR title:** `verifyClaims` returns
`coverage: null` when `claims.length === 0`, and the type is `number | null` with the reason
documented on the field. Consumers guard it (`applyVerificationCaveat` and
`auditLargoAnswerGrounding` both test `coverage != null` before comparing). That defect is closed at
the source.

**It is not closed everywhere.** Three literals still construct the exact fabricated shape the fix
removed — `{ total: 0, verified: 0, coverage: 1, unverified: [] }` — at `largo-terminal.ts:1149`,
`:1167` and `:1454`. Because `coverage` is `number | null`, `1` still compiles. Traced per site:

| Site | Path | Escapes the process? |
|---|---|---|
| `:1149` | `runLargoQuery` catch → `logClaudeTurn` | No. `answerSource: "error"` nulls `claims_total`/`claims_verified`, and `coverage` is not a column. Inert. |
| `:1167` | `runLargoQuery` catch → **returned payload** | **Yes.** The non-streaming JSON API returns `verification.coverage: 1` on an internal-error turn — a data-less fallback advertising perfect grounding. |
| `:1454` | `runLargoQueryStream` catch → `logClaudeTurn` | No. Same nulling; the stream emits only an `error` event, no `verification`. Inert. |

Severity is bounded: the browser always streams, so `:1167` is reachable only through the
non-streaming API, and Largo is admin-gated in production (§0). It is still the forbidden shape, and
the structural fix is a shared constructor (an `unverifiedVerification()` returning `coverage: null`)
rather than three hand-written literals — a convention gets skipped, a factory does not.

### Does the caveat reach the member? Yes — but not as a caveat.

This is the charter's explicit question, and the answer is a defect.

Every other honesty caveat is emitted as a blockquote and rendered as a distinct, labelled callout:

| Producer | Emits | `answer-caveats.ts` kind | Rendered label |
|---|---|---|---|
| `applyCoherenceCaveat` | `> **These two parts of this answer disagree.**` | `coherence` | Internal check |
| `applyProvenanceCaveat` | `> **Source note.**` | `provenance` | Source note |
| `applyConflictCaveat` | `> **Sources disagree on …**` | `source-conflict` | Source conflict |
| market-evidence gate | `> **Data integrity hold.**` | `integrity` | Data integrity hold |
| `applyPlanCaveat` | `> **Timeframe caveat.**` | *no match* → `other` | **"Note"** |
| **`applyVerificationCaveat`** | `_Data check: …_` | *no match, not even a blockquote* | **not rendered as a caveat at all** |

Two independent misses:

1. **The grounding caveat is the only one that is not a blockquote.** `applyVerificationCaveat`
   appends italic prose, so `splitAnswerCaveats` — which collects trailing `>` blocks — never sees
   it. It reaches the member buried in the answer body. The UI has a `verification` kind and a
   `"Grounding note"` label wired end to end (`CAVEAT_PATTERNS`, `KIND_LABEL`, `data-kind`), and
   **nothing in the codebase ever produces the string it matches.** The one honesty signal that most
   needs to be distinct is the only one that isn't.
2. **`applyPlanCaveat` says "Timeframe caveat.", the matcher expects "Timeframe note."** So the
   timeframe caveat *is* split off and rendered, but as generic `other` / "Note" instead of its own
   kind. Cosmetic next to (1), same root cause: producer and matcher are two hand-kept lists with
   no test binding them.

---

## 4b. The `confidence` omit-vs-fabricate sweep

The charter names this as the single most important line in the product contract: **`confidence` must
be OMITTED when a product cannot calibrate it, never fabricated as a plausible number**, because it
is compared against another lane's measured value and corrupts cross-product ranking silently. The
`coverage: 1` bug in `verifier.ts` (#2626) was one instance. This is the sweep for others across the
surface Largo owns.

**Result: the Largo engine layer is clean.** Two constructs look exactly like the bug and both turn
out to be guarded. Recording them as *verified clean* rather than dropping them silently, because
the next person to grep will find them and has to re-derive the same trace.

| Site | Shape | Verdict |
|---|---|---|
| `features/largo/answer/answer-format.ts:219` | `confidence ?? { level: "moderate", why: "" }` | **Guarded, verified end to end.** `largoAnswerToEnvelope` returns `showConfidence: confidence !== undefined`; its only consumer is `LargoAnswerMessage.tsx:118`, which passes it at `:132`; `BieAnswer.tsx:71` renders the chip only on `showConfidence && Boolean(envelope.confidence)`. The placeholder exists in the object and never reaches a pixel. |
| `lib/bie/rich-narrative.ts:57` | `input.confidence ?? { level: "high", why: "Deterministic answer … no LLM." }` | **Latent, not live.** The only caller (`concept-narrative.ts:32`) always passes an explicit `confidence`, so the default is never exercised — and the path is dead for Largo anyway: nothing imports `composeBieAnswer`, and both `product-reads.ts:652` and `vector-pulse-wiring.test.ts:12` record that Largo no longer routes through the BIE answer-router. A trap for the next caller, not a defect today. |
| `largo/answer-contract.ts:376-381` | confidence left **ABSENT** when the model gave no level | **Compliant, and deliberately so.** Its comment records the live incident that produced the rule: the UI once printed "MODERATE CONFIDENCE" above "No confidence rationale was given." |

So within this lane's scope the `coverage: 1` literals (L-5) are the **only** surviving instance of
the shape, and the fix for them is structural — a shared constructor rather than three literals.

**Two candidates outside this lane's scope**, flagged for routing rather than touched (`_COMMON.md`
rule 6b: a defect in a product's own implementation is that lane's fix):

- `features/nighthawk/lib/play-outcomes.ts:82` and `:418` —
  `confidence_label: String(play.conviction ?? "B").toUpperCase()`. An **absent** conviction becomes
  a literal grade **"B"**. That is the fabricate-vs-omit shape precisely: a play nobody graded is
  indistinguishable downstream from a play graded B. *(Night Hawk lane.)*
- `features/spx/lib/spx-play-payload.ts:232` and `spx-play-engine.ts:1633` —
  `confidence: confluence?.confidence ?? 0`. Milder, same family: an unmeasured confidence becomes a
  measured **zero** on the same scale, so a consumer ranking on it cannot tell "no signal" from
  "scored zero". *(SPX Slayer lane.)*

Neither was verified live; both are reads of the code only.

---

## 5. Cross-product coherence

`get_cross_product_read` → `crossProductRead` → `joinProductSignals` → `coverage`.

The design is right where it counts: `Promise.allSettled` so one lane being down does not make the
question unanswerable; a rejected source becomes a **named** absence (`"get_helix_tape_analytics
failed: …"`, because *"thermal unavailable"* and *"the tool threw"* send an operator to different
places); `describeSplit` states what disagrees and the `reading_note` tells the model, in words,
*"Do not resolve the split, pick a side, or present the larger camp as the answer."* Contract C1 is
honoured (`etStamp` + `etSessionDate`). No averaging, no silent winner. **This lane found no
reconciliation defect here.**

**It has a coverage gap instead, and the gap is invisible in the payload.** `SOURCES` has five
entries — helix, thermal, vector, meridian, nighthawk. `ProductId` declares **six**: those five plus
`spx`. There is no `spxContribution` adapter and no SPX source.

`coverage()` computes `total = reporting.length + missing.length`, both derived from the same five
sources. So SPX Slayer is not reported, and it is not *missing* either — it is absent from the
denominator. A cross-product read on SPX, the ticker the SPX Slayer desk exists for, returns
`"4/5 products reporting"` and never mentions that the sixth product was never asked. That is rule 7
exactly: an absence that reads as coverage.

---

## 6. Observability — what exists, what does not

| Signal | Exists? | Where |
|---|---|---|
| Per-tool latency, denied, failed, empty | **Yes** | `ToolCallDiagnostic` → `formatToolDiagnostics` → `console.info` |
| Per-tool serialized **bytes** | **Recorded, never surfaced** | `sizeOf(result)` is stored on every diagnostic and read by nothing but the `bytes === 0` "EMPTY" flag |
| **Per-tool truncation** | **No** | Nothing anywhere compares a tool's bytes to `MAX_TOOL_RESULT_CHARS` |
| Empty-round occurrence | **Yes** (#2620) | `console.warn` in `anthropicToolLoop`, round shape included |
| Turn phase split (prefetch vs loop) | **Yes** | `summarizeTurnPhases` / `logTurnPhases` |
| Verification coverage per turn | **Partial** | `claims_total`/`claims_verified` on the BIE row; `coverage` itself is not a column |
| Answer-contract drift | **Yes** | `console.warn` in `envelopeFromContract` |
| Spend-ceiling state at request time | **No** | Ceiling decisions are silent; only the member-facing message differs |
| Per-round tool-dispatch trace | **No** | `persistClaudeTurn` writes the final answer and a flattened `tools_used` only |
| Contract-compliance drift per tool | **No** | Nothing measures whether a payload still satisfies `ProductRead<T>` — 128/129 never did |

**The cheapest high-value instrument in the whole engine is already half-built.** Every tool result's
size is measured at the guard. Adding `bytes > MAX_TOOL_RESULT_CHARS` to the diagnostic line turns
"which of 129 tools are over the cap" from a live-probe question into a log query, and it would have
detected #2433, #2480 and #2628 the first time each ran. The truncation probe stays valuable — it
verifies what the *model actually received* — but detection should not require it.

### The truncation probe has no valid control right now

`largo-truncation-probe.mjs` proves its own instrument each run by probing a tool KNOWN to exceed the
cap; if the control comes back COMPLETE, every other result is reported UNVERIFIED rather than clean.
Its control is `get_nighthawk_outcomes` at `window_days=180`, and the harness header says so in as
many words:

> *NOTE FOR WHOEVER READS THIS AFTER #2480 SHIPS: that fix makes this control return COMPLETE, at
> which point the run will correctly report UNVERIFIED and demand a new control.*

#2480 shipped, and #2628 fixed the re-truncation on top of it. **The probe is therefore expected to
report UNVERIFIED on every run until a new over-cap control is chosen** — the design working as
written, not a break. Picking the replacement by guesswork would reintroduce the exact failure the
harness guards against; picking it from measured `bytes` (above) would not. **This is the dependency
order for Phase 1: instrument first, then re-arm the probe, then probe the tools it does not yet
cover.** (Deliberately not a fixed number: the probe's `LANE_TOOLS` grows as lanes add their own —
it went 13 → 17 on 2026-08-23 when Helix added four — so any figure written here is stale by the
next lane contribution. It is `LARGO_TOOL_DEFS.length - LANE_TOOLS.length`, derivable on demand.)

---

## 7. Spend ceiling

Two checks, and the charter asks whether their process-local backstops have drifted apart. **They
have not — they are literally the same field**, verified by reading both:

- `anthropic.ts:49` — `export function currentProcessAiSpendUsd() { return spendTracker.currentTotal; }`
- `anthropic.ts:415-420` — `isAiSpendCeilingTripped()` reads `spendTracker.currentTotal`

The route imports the former; the provider uses the latter directly. One `SpendTracker` instance per
process, one field. There is no drift to fix.

The **TOCTOU is real and is handled**, not eliminated: the route checks once pre-flight, the ledger
is cross-replica and accrues every round, so a ceiling can trip *after* the gate passed. The loop
then returns `null`, and `runLargoQuery`/`runLargoQueryStream` re-read the ceiling **once, only on an
empty turn**, so `classifyEmptyAnswer` can return `budget_ceiling` → *"Largo is temporarily paused:
the platform-wide daily AI spend limit has been reached"* rather than the `no_data` copy. With
`DAILY_AI_SPEND_KILL_USD = 250` deployed, this is a live path.

Both Redis-loss paths fail **closed** to the per-process backstop — a Redis blip is exactly when an
unbounded Claude loop is most dangerous.

### The empty-round P0, restated precisely

`classifyEmptyAnswer` has three causes: `budget_ceiling`, `timeout` (elapsed ≥ 85% of the **loop**
budget), and a default of `no_data` → *"I couldn't pull enough live data to answer that."*

There is no cause for **"the model returned nothing."** `anthropicToolLoop` returns `null` for both
"no tool calls and no text" and every other empty outcome, so the one place that *knows* which
happened (`anthropic.ts:785`, where #2620 logs the round shape) discards the distinction one line
later by returning a bare `null`. The classifier then defaults to blaming the data — for a turn where
the data was never the problem.

The fix is small and structural: have the loop return a discriminated outcome (or set a flag the
caller can read) so `emptyAnswerFallback` can distinguish an empty model round from a genuine data
gap, and say so. That is the difference between a member being told something false about the
platform and being told the truth about the turn.

---

## 8. Contract C1 — session-anchor ratchet

`src/lib/largo/contract/session-anchor.test.ts`, run on Node 20 at `17eb87e5`: **6/6 pass**,
**48 entries in `KNOWN_GAPS`**. The shrink-only test is in place, so a fixed file must be removed
from the list. No entry currently defers to an open PR, so there is **no cross-PR ordering
dependency to sequence** at the time of writing — re-check before releasing anything that touches
the allowlist (`CLAUDE.md` carries the incident this caused once).

---

## 9. Candidate defects found while tracing

Recorded, **not fixed** — the charter gates fix PRs behind this map merging. Ordered by what a fix
would be worth, not by how easy it is.

| # | What | Where | Class |
|---|---|---|---|
<<<<<<< HEAD
| L-1 | No truncation detection anywhere, despite per-call bytes already being measured. 127 of 129 tools have no size bound at all. | `tool-guard.ts` `sizeOf`/`formatToolDiagnostics` | observability / transport |
| L-2 | The grounding caveat never renders as a caveat — `applyVerificationCaveat` emits italics, the UI matches blockquotes. The `verification` kind is dead code. | `turn-outcome.ts:19` vs `answer-caveats.ts:17` | member-facing honesty |
| **L-3** | **Four different null paths — gate closed, no client, spend stop, round-0 model failure — all reported as "I couldn't pull enough live data." REPRODUCED LIVE 9/9 turns, see §9b.** | `anthropic.ts:572,574,577,761-791`, `empty-answer-fallback.ts` | member-facing honesty |
| L-4 | SPX Slayer is a declared `ProductId` with no cross-product source or adapter, and is absent from the coverage denominator rather than reported missing. | `cross-product-read.ts:35` | cross-product coherence |
| L-5 | Three `coverage: 1` literals survive #2626; one leaves the process on the non-streaming error path. | `largo-terminal.ts:1149,1167,1454` | fabricated certainty |
| L-6 | `applyPlanCaveat` emits "Timeframe caveat.", matcher expects "Timeframe note." → renders as generic "Note". | `plan.ts:194` vs `answer-caveats.ts:17` | UI classification |
| L-7 | `tools_used` conflates seeded markers, prefetch markers and real model dispatches. BIE calibration cohorts bucket on this array. | `largo-terminal.ts:483` + prefetch pushes | observability / data integrity |
| L-8 | The truncation probe's control is expected COMPLETE post-#2628, so every run reports UNVERIFIED until a new control is chosen from measured sizes. | `largo-truncation-probe.mjs:74` | tooling (blocked on L-1) |
| L-9 | Five stale tool counts across the tree (116/120/126/127 vs 129), including in the charter and in the entitlement docstring. | see §1 | documentation |
| L-10 | "TAIL slice" in six places describes a HEAD-keeping cut. Every current reader reasons correctly from it; a new one would not. | see §2.5 | documentation |

**Suggested order.** L-1 first — it is the instrument the others are measured with, and it unblocks
L-8, which unblocks probing the remaining 116 tools. L-2 and L-3 next: both are member-facing
honesty defects with small, local fixes. L-4 and L-5 after. L-6/L-7/L-9/L-10 are cheap and can ride
=======
| ~~L-1~~ **FIXED** | No truncation detection anywhere, despite per-call bytes already being measured. 127 of 129 tools have no size bound at all. Now flagged as `TRUNCATED <bytes>/<cap>` from the size the guard already recorded; the cap moved to a dependency-free `tool-result-cap.ts` so `tool-guard.ts` could read it without pulling the SDK graph. Detection only — no payload changes. | `tool-guard.ts`, `tool-result-cap.ts` | observability / transport |
| ~~L-2~~ **FIXED** | The grounding caveat never renders as a caveat — `applyVerificationCaveat` emits italics, the UI matches blockquotes. The `verification` kind is dead code. | `turn-outcome.ts:19` vs `answer-caveats.ts:17` | member-facing honesty |
| ~~L-3~~ **FIXED** | Four different null paths — gate closed, no client, spend stop, round-0 model failure — all reported as "I couldn't pull enough live data." Reproduced live 9/9 turns (§9b); root cause confirmed from the production log as an HTTP 400 *"credit balance is too low"*. The loop now reports which of its eight exits it took (`ToolLoopStopReason` + `onStop`), and a stated reason outranks the elapsed-time heuristic. | `anthropic.ts`, `empty-answer-fallback.ts` | member-facing honesty |
| L-4 | SPX Slayer is a declared `ProductId` with no cross-product source or adapter, and is absent from the coverage denominator rather than reported missing. | `cross-product-read.ts:35` | cross-product coherence |
| ~~L-5~~ **FIXED** | Three `coverage: 1` literals survive #2626; one leaves the process on the non-streaming error path. | `largo-terminal.ts:1149,1167,1454` Replaced by one `unverifiedTurn()` constructor returning `coverage: null` — a convention gets skipped, a constructor cannot be. | fabricated certainty |
| ~~L-6~~ **FIXED** | `applyPlanCaveat` emits "Timeframe caveat.", matcher expects "Timeframe note." → renders as generic "Note". | `plan.ts:194` vs `answer-caveats.ts:17` | UI classification |
| L-7 | ~~`tools_used` conflates seeded markers, prefetch markers and real model dispatches. BIE calibration cohorts bucket on this array.~~ **RATCHETED (#2687) — and this row overstated it.** The cohorts bucket on `{SPX,HELIX,THERMAL}_ENGINE_TOOL_NAMES` (11/5/6 names) and **no non-dispatch marker is in any of them**, so no cohort is polluted today: the exposure is LATENT, not active. What IS broken now: of the four prefetch sites pushing a `get_*` name, `get_helix_thermal_compare` **is a real callable tool**, so that name reaches the log from both a keyword-gated server prefetch (`largo-terminal.ts:678`) and a genuine model dispatch, and a stored turn cannot say which. `tools-used-provenance.test.ts` pins it shrink-only; the **rename is deferred to the coordinator** because it changes the shape of a persisted column. | `largo-terminal.ts:483` + prefetch pushes | observability / data integrity |
| L-11 | `LargoDeskMiniPanel` is mounted by nothing, and its premium-gated route `/api/market/largo/mini-panel` is live with no caller. #2358 added and mounted it; #2387 ("drop the two side panels") removed the mount and left both behind. The lane charter still described the panels as a current member surface — corrected. **Delete-vs-remount is a product call, not this lane's**, so it is flagged rather than actioned. | `LargoDeskMiniPanel.tsx`, `api/market/largo/mini-panel/route.ts` | dead surface / stale doc |
| L-8 | The truncation probe's control is expected COMPLETE post-#2628, so every run reports UNVERIFIED until a new control is chosen from measured sizes. **Unblocked by L-1**, but needs a live turn to produce the measurement — waiting on the upstream outage to clear. | `largo-truncation-probe.mjs:74` | tooling (unblocked, awaiting live data) |
| L-9 | ~~Five stale tool counts across the tree (116/120/126/127 vs 129), including in the charter and in the entitlement docstring.~~ **FIXED** — 14 live claims corrected and pinned by `tool-count-claims.test.ts`; two historical measurements dated rather than renumbered. | see §1 | documentation |
| L-10 | ~~"TAIL slice" in six places describes a HEAD-keeping cut. Every current reader reasons correctly from it; a new one would not.~~ **FIXED** — seven sites (not six) rewritten to say what survives; a scanner test with a control bans the phrase's return. | see §2.5 | documentation |

**Suggested order.** L-1 first — it is the instrument the others are measured with, and it unblocks
L-8, which unblocks probing the tools the probe does not yet cover. **L-3 is done** — the coordinator released it
ahead of the rest once the outage made it live. L-2 next: the same class of member-facing honesty
defect, with a small, local fix. L-4 and L-5 after. L-6/L-9/L-10 are cheap and can ride
>>>>>>> origin/main
along with a neighbouring fix rather than costing a PR each.

---

## 9b. LIVE VALIDATION — Largo is returning the empty-answer fallback on every turn

Run 2026-08-22 ~23:40 UTC against production, admin session (Largo is launch-gated, §0), read-only,
temp Clerk user deleted. **Nine turns, nine identical results.**

`largo-truncation-probe.mjs` first — every tool came back INDETERMINATE, *"never appears in the
trace — the model answered from somewhere else"*. The `--json` reply showed why:

```
"reply": "**I couldn't pull enough live data to answer that — try naming a ticker or asking
          about SPX structure.**  _(neutral)_\n\n## Read\nI couldn't pull enough live data…"
```

That is verbatim `emptyAnswerFallback`'s `no_data` copy. A follow-up probe across both depths:

| Depth | Model | Latency | Verdict | `tools_used` |
|---|---|---|---|---|
| concrete | haiku-4-5 | 3546 ms | EMPTY-FALLBACK (`no_data`) | `live_feed_capture, platform_vitals_prefetch` |
| deep | sonnet-5 | 3711 ms | EMPTY-FALLBACK (`no_data`) | `live_feed_capture, platform_vitals_prefetch` |
| concrete | haiku-4-5 | **924 ms** | EMPTY-FALLBACK (`no_data`) | `live_feed_capture, platform_vitals_prefetch` |
| deep | sonnet-5 | 4067 ms | EMPTY-FALLBACK (`no_data`) | `live_feed_capture, platform_vitals_prefetch` |

Three things this establishes that three prior investigations could not:

1. **It is not depth- or model-specific.** Haiku and Sonnet fail identically, so a single-model
   outage is ruled out — including the `LARGO_ESCALATION_MODEL` fallback #2582 added for exactly
   that case.
2. **`tools_used` is the seed plus one prefetch marker and nothing else** — precisely the turn-5218
   signature. §2.2 predicted this shape from reading the seed; here it is live. Zero model
   dispatches.
3. **924 ms.** A Deep turn that actually reaches the model runs 20–45 s. Sub-second means the loop
   returned **before or at the first model round**, not after it.

### Root cause, by elimination

`anthropicToolLoop` has three pre-flight `return null` paths (`anthropic.ts:572, 574, 577`) plus a
round-0 failure path that also degrades to `null`. Taking them in turn, against measured facts:

| Path | Would produce | Eliminated because |
|---|---|---|
| `!anthropicGateOpen("largo")` (`:572`) | `no_data` | `largoClaudeEnabled()` = key present ∧ not staging. Key **is** present in `blackout-production/app/env` (108 chars; value never read out). `STAGING_CLAUDE`/`STAGING_LARGO_CLAUDE` unset. Gate is open. |
| `!client` (`:574`) | `no_data` | Same key check. `getClient()` returns null only on a missing key. Also, the route's own `largoConfigured()` would have 503'd first — it returned 200. |
| `isAiSpendCeilingTripped()` (`:577`) | **`budget_ceiling`** | The caller re-reads the ceiling on an empty turn and would have rendered *"temporarily paused: the platform-wide daily AI spend limit has been reached."* We saw the `no_data` copy. Ceiling not tripped. |
| **round-0 model call fails or returns empty** | **`no_data`** | **Not eliminated. This is the remaining path.** |

So the loop reached the model and got nothing usable back. The code says so itself, in the comment
on the streaming branch added by #2582/#2607: *"On failure, fall back to whatever assistant text
prior rounds accumulated (often a usable partial), else null → the empty-answer fallback."* At round
0 there is no accumulated text, so it is always `null`.

**Two sub-cases remain and this map cannot separate them from outside the process**: the model call
*threw* (an upstream rejection — a credits/quota refusal returns in well under a second, which fits
the 924 ms), or the model *returned* a round with no tool calls and no text. #2620's
`console.warn` at `anthropic.ts:785` distinguishes them in the production log, and reading that line
is the next step. It is a one-line lookup, not another investigation.

### What this changes

**This is not a new defect — it is L-3 happening, in production, on 100% of sampled turns.** Three
structurally different failures (gate closed, no client, round-0 model failure) all collapse to the
same bare `null`, and all three are reported to the reader as *"I couldn't pull enough live data"* —
a data excuse for something that is not a data problem. #2607's fix removed the *wrong* message
("the desk tools did not complete cleanly", which blamed the tools) and replaced it with a
differently wrong one.

Scope: Largo is admin-and-grant-only in production (§0), so **no ordinary member is affected**. The
upstream condition itself — if it is an account/credits state — is not a code fix and not this
lane's to make. **L-3 is the code fix**: the loop must say which of its four null paths it took, so
the reader is told the truth about the turn.

---

## 9c. Is there a CODE-level cause for the outage? Six eliminated, one signature left

§9b established *that* the loop returns `null` at round 0. This section asks the separate question:
**is a code regression causing it**, or is the code faithfully reporting an upstream fault? Every
check below is offline — no live Largo call — and production is running current `main`
(`deploy-freshness.mjs --since=48h`: *"every deploy-worthy commit has a later deploy run"*, newest
2026-08-22T23:31Z), so these line references describe deployed code.

| # | Candidate code cause | Eliminated by |
|---|---|---|
| 1 | **A malformed or duplicate tool schema** would 400 the whole request for every model and every depth — and a large batch of Largo tool PRs landed 2026-08-21, the day the outage began. | Validated all **129** definitions offline: no duplicate names, every name inside `^[a-zA-Z0-9_-]{1,64}$`, every `input_schema` an object with `properties`, every `required` entry present in `properties`, no empty descriptions. Clean. Serialized tool block 99 540 chars (~25k tokens) — large but far inside a 200k context. |
| 2 | **An empty system text block** (the API rejects zero-length text blocks) | `buildDynamicSystem` returns exactly two blocks: `LARGO_SYSTEM_PROMPT` (a constant) and `dynamicPart` (always contains literal headings). Neither can be empty. `applySystemCache` passes the array through untouched because block 0 already carries a marker. |
| 3 | **A sampling-param 400** — `temperature` is rejected by Sonnet 5 | `modelRejectsSamplingParams` is `/claude-(?:opus\|sonnet)-5\|.../` and correctly matches `claude-sonnet-5`, so Deep omits `temperature`. Concrete runs `claude-haiku-4-5`, which accepts it. **The two depths take opposite branches of this guard and fail identically** — so the guard is not the discriminator. |
| 4 | **Top-level `cache_control`** on `MessageCreateParams` (added by a cast, i.e. not in the SDK's type) | Shipped 2026-08-10 in #2020. `CLAUDE.md` records a **successful** live truncation-probe run on 2026-08-21 — *"control PROVEN, `get_zerodte_record`/`get_nighthawk_edition`/`get_zerodte_plays` COMPLETE"*. Largo was answering with this code in place, so it is not fatal. |
| 5 | **Gate closed / no client / spend ceiling** | §9b. Key present, staging flags unset, and a ceiling stop renders different copy. |
| 6 | **A single-model outage** (529/429 on `claude-sonnet-5`) | Ruled out by the escalation retry itself — see below. |

### The escalation retry is the strongest evidence, and it points away from code

#2582 wired `LARGO_ESCALATION_MODEL` into the round-0 failure path: when the primary model's
create/stream throws on round 0, the loop swaps model and retries once
(`anthropic.ts:717` streaming, `:745` non-stream). So a failing turn actually attempts **two
different models**:

- **Deep**: `claude-sonnet-5` → throws → retry on `claude-sonnet-4-6` → throws → `null`.
- **Concrete**: `claude-haiku-4-5` → throws → retry on `claude-sonnet-4-6` → throws → `null`.

Across the two depths that is **three distinct models failing at round 0**, and the measured
latencies fit two failed calls each (Deep 3.5–4.1 s, Concrete 924 ms). `shouldFallBackToEscalationModel`'s
own docstring names this exact signature:

> *"on a non-transient fault (a 400, an auth/spend error) **both models fail** and it costs one
> extra call, never a wrong answer."*

Three models do not degrade simultaneously. **The code is behaving as designed; what it is reporting
is an account-level, non-transient upstream fault.** That is corroboration of the billing hypothesis
derived from the code path, not an assumption inherited from it.

### Correction to §9b's "next step"

§9b said #2620's warn at `anthropic.ts:785` settles which sub-case is firing. That is only half
right, and the distinction matters to whoever reads the log:

| Log line | Means |
|---|---|
| `[anthropic] tool-loop stream round failed — falling back to accumulated assistant text <MSG>` (`:713`) or `[anthropic] tool-loop round create failed — … <MSG>` (`:741`) | The model call **threw**. **`<MSG>` is the upstream error verbatim** — the 401/429/400/credit message. This is the line that ends the investigation. |
| `[anthropic] round 0 stream on claude-sonnet-5 failed — retrying once on claude-sonnet-4-6` (`:718`) | The escalation retry fired — confirms the multi-model signature above. |
| `[anthropic] tool-loop round N produced NO tool calls and NO text` (`:785`) | The model **returned** an empty round. A *different* fault from the above. |

**The error is already logged.** An earlier reading of mine that the throw path swallows it silently
was wrong — both catches `console.error` the message before returning. So no logging fix is needed
and no code change is required to diagnose this: one `grep` of the production log for
`[anthropic] tool-loop` names the cause exactly.

### Verdict

**No code regression found.** Six candidate code causes eliminated; the remaining signature is an
account-level upstream fault that the loop reports faithfully and then narrates wrongly. The only
code defect in scope is **L-3** — four structurally different failures collapsing into one `null`
that is rendered as *"I couldn't pull enough live data"*. Fixing L-3 would not have prevented this
outage; it would have made it self-describing instead of costing three lanes a day of investigation.

---

## 10. What this map still does not know

Stated so nobody mistakes this document for complete:

- **Typical payload size for 125 of 129 tools.** §3. Not guessable; measurable via L-1.
- **Which tools are contract-*shaped* even though they are not contract-*wrapped*.** 128 return bare
  shapes, but some may already carry `as_of`, provenance and an absence reason under other names.
  That distinction decides whether contract adoption is a rename or a rewrite, and it has not been
  surveyed.
- **Which of the two round-0 sub-cases is firing** — an upstream throw or a genuinely empty model
  round. §9b eliminates everything else; #2620's warn line at `anthropic.ts:785` settles it, and
  nobody has read the production log for it yet.
- **Live behaviour of §9 apart from L-3.** L-3 is now reproduced live (§9b). The other nine are
  traced in code and measured offline, which per `_COMMON.md` rule 6 is not the same as validated.
- **Whether `applyVerificationCaveat`'s threshold is calibrated.** It fires at ≥4 claims and <50%
  coverage. Both numbers are asserted in two places and derived in none.
