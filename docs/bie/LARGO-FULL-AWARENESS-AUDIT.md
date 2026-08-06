# Largo Full Platform Awareness Audit (2026-08-05)

Canonical inventory of what Largo knows, how it is wired, and what was closed in this pass.

## Executive summary

Largo already had **105+ tools** spanning Polygon, UW, Postgres, and Redis. The main gaps were **Night Hawk sub-lanes** (Bangers, Swings), **0DTE track record**, **HELIX signal grading**, **Cortex as a Claude tool**, **SPX pin/pulse**, and **ambient live-feed awareness** of Bangers/Swings alongside 0DTE Command.

This pass adds **9 dedicated tools**, expands the system prompt product map, glossary, BIE full-state snapshot, live feed, and route allowlist so Largo can answer across **every shipped member product**.

## Product coverage matrix

| Product | Route | Largo tools | Live feed / BIE vitals |
|---------|-------|-------------|------------------------|
| SPX Slayer | `/dashboard` | get_spx_structure, get_spx_play, get_spx_confluence, get_open_plays, get_lotto_live, get_power_hour, **get_spx_pin**, **get_spx_pulse**, get_signal_log, get_spx_engine_snapshots | spx_structure, play, gex_regime, spx_confluence, lotto_live |
| HELIX | `/flows` | get_flow_tape, get_options_flow, get_global_flow, get_flow_anomaly_near_misses, **get_helix_signal_outcomes** | flow_tape (on flow intent), tide |
| Thermal | `/heatmap` | get_positioning, get_gex_heatmap, get_gex_matrix_changes, get_wall_dynamics, get_gex_regime_events | gex_regime (SPX scope) |
| Vector | `/vector` | get_vector_full_state, get_wall_dynamics | via BIE full-state vectorSpx |
| Night Hawk — 0DTE Command | `/nighthawk` (0DTE tab) | get_zerodte_plays, get_zerodte_rejections, **get_zerodte_record**, **get_cortex_decision** | zerodte_plays (every turn) |
| Night Hawk — Swings | `/nighthawk` (Swings tab) | **get_swing_horizon**, get_nighthawk_horizons, **get_horizon_outcomes** | **swing_horizon** (every turn) |
| Night Hawk — Bangers | `/nighthawk` (Bangers tab) | **get_banger_board** | **banger_board** (every turn) |
| Night Hawk — Legacy | `/nighthawk` (Legacy tab) | get_nighthawk_edition, get_nighthawk_dossier, get_nighthawk_outcomes | nighthawk (every turn) |
| Largo | `/terminal` | Claude tool loop + all above | full live feed + platform vitals |
| Track record | `/track-record` | get_setup_stats, get_trade_history, get_spx_vs_nighthawk_comparison, **get_zerodte_record**, **get_horizon_outcomes** | — |
| Platform intel | `/api/platform/intel` | get_market_regime | BIE intel block |

## New tools (this pass)

1. **get_banger_board** — Engine B open/closed positions + scale-out state
2. **get_swing_horizon** — seven-section Swings lane
3. **get_nighthawk_horizons** — compact 0DTE + Swings board
4. **get_zerodte_record** — 0DTE Command graded track record (30–90d)
5. **get_horizon_outcomes** — cross-lane ZERO_DTE + SWING outcomes
6. **get_helix_signal_outcomes** — velocity/split signal follow-through
7. **get_spx_pin** — EOD pin forecaster
8. **get_spx_pulse** — fast SPX pulse lane
9. **get_cortex_decision** — Cortex commit/skip/exit evidence (pinned or live)

## Strengths (already strong)

- **Breadth:** 105+ tools cover quotes, chains, flow, fundamentals, screeners, SPX desk, Vector, Thermal, ecosystem one-ticker reads
- **Grounding:** Live feed prefetches market, 0DTE plays, Night Hawk edition, GEX regime, tide, halts every turn
- **BIE full-state:** Cron-warmed `bie:full-state` injects cross-product vitals into every Claude turn
- **Intent routing:** `getToolsForIntent()` narrows tool surface per question (flow, SPX, Thermal, Vector, Night Hawk, Cortex, etc.)
- **Knowledge layer:** Embeddings over docs, glossary, platform map, tool inventory (regenerated from source)
- **Numeric verifier:** largo-verifier nightly audit on assistant turns

## Remaining intentional limits

| Surface | Why not fully wired |
|---------|---------------------|
| `/api/market/zerodte/calibration` | Admin-only gate policy instrument — not a member product |
| `/api/market/nighthawk/play-explain` | LLM cost route — denied in route registry |
| `/api/market/spx/commentary` | LLM cost route — SPX desk data available via get_spx_structure |
| Member personal positions | No unified positions API yet — open SPX via get_open_plays; 0DTE via zerodte feed |
| Vector alert rules CRUD | Mutation surface — read via get_vector_full_state |
| LEAPS horizon | Dormant — no persistence/grader shipped |

## Architecture

```
Member question
  → prefetchLargoTurnCaches (BIE platform context)
  → captureLargoLiveFeed (market + 0DTE + banger + swing + nighthawk + SPX…)
  → loadLargoPlatformSnapshotBlock (bie:full-state vitals)
  → searchKnowledge (embeddings, top 3)
  → getToolsForIntent (subset of ~114 tools)
  → anthropicToolLoop
  → verifyClaims + persist
```

## Key files

- Tools: `src/lib/largo/run-tool.ts`, `src/lib/largo/tool-defs.ts`, `src/lib/largo/product-reads.ts`
- Prompt: `src/lib/largo/system-prompt.ts`
- Live feed: `src/lib/largo/largo-live-feed.ts`
- BIE snapshot: `src/lib/bie/full-platform-snapshot.ts`, `src/lib/bie/platform-read-format.ts`
- Glossary: `src/lib/bie/glossary.ts`
- Routes: `src/lib/route-registry.ts`
- Cortex: `src/lib/bie/cortex-read.ts`

## Validation

```bash
node --import tsx --experimental-test-module-mocks --test src/lib/largo/product-reads.test.ts
node --import tsx --test src/lib/largo/intent-keywords.test.ts  # if present
npx tsc --noEmit
```

Post-deploy: ask Largo "What's on the Bangers board?", "How is 0DTE Command's record?", "Why did Cortex skip NVDA?", "Show Swings lane" — each should dispatch the new tools without generic fallbacks.
