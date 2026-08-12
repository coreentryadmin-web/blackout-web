import { dteRangeLabel } from "@/lib/horizons";

const SWING_DTE = dteRangeLabel("SWING");

/**
 * End-to-end product knowledge for Largo — panels, fields, and which tool serves each surface.
 * Injected into the system prompt so Haiku knows the full desk layout without guessing.
 */

export const LARGO_PRODUCT_KNOWLEDGE = `
## Product knowledge — panels, fields, and tools (A–Z)

Use this map to pick the RIGHT tool for the member's question. Every panel below exists in production;
if a field is listed here, a dedicated tool or nested object can return it — do not invent values.

### SPX Slayer (/dashboard) — single-instrument SPX 0DTE play engine

**Left rail — GEX matrix heatmap:** strike×expiry 0DTE matrix, GEX/VEX lens toggle, live spot row in ladder.
- Tool: get_gex_heatmap (ticker=SPX, lens=gex|vex) or get_positioning (summary scalars + cross_validation)
- SPX desk bundle: get_spx_structure (price, GEX snapshot, flow tape, dark pool, macro, tide, internals)

**Center — play engine:** phase (SCANNING/WATCH/OPEN/HOLD/CLOSED), confluence score/grade, action (BUY_CALL/BUY_PUT/HOLD/WAIT),
gate pass/fail checklist, confirmation items, adaptive-gate telemetry, AI arbiter verdict, option ticket (strike/expiry/premium).
- Tools: get_spx_play (full engine snapshot), get_spx_confluence (scored thesis only), get_spx_engine_snapshots (history)

**Open positions / member plays:** OPEN/HOLD/TRIM plays with entry, mark, P&L, stop state.
- Tool: get_open_plays

**Special lanes:** Lotto live play, Power Hour (2:45–3:15 PM ET) play, EOD pin forecast (NOT max pain).
- Tools: get_lotto_live, get_power_hour, get_spx_pin

**Fast desk pulse:** price, session change, TICK/TRIN/ADD, mega-cap snapshot (~2s lane).
- Tool: get_spx_pulse

**Embedded Vector on SPX desk:** same Vector state as /vector for SPX — walls, beads, flip, magnet, play card.
- Tool: get_vector_full_state (ticker=SPX) — NOT a separate SPX-only Vector API

**Gate thresholds (live config):** mixed-tape block, min grade, buy cooldown, GEX staleness ceiling, post-stop cooldown.
- Tool: get_gate_rules (SPX Slayer gates — NOT Night Hawk publish gates)

**Track record / signal log:** graded plays, setup stats, trade history, confluence shadow outcomes.
- Tools: get_signal_log, get_setup_stats, get_trade_history, get_confluence_outcomes

**NOT SPX Slayer:** multi-ticker 0DTE Command scanner → get_zerodte_plays; evening Night Hawk picks → get_nighthawk_edition

---

### HELIX (/flows) — market-wide options flow tape

**Command bar:** ticker filter, min premium, side, DTE, route filters — affects all panels below.
**Helix tide bar:** market-wide call/put tide bias (UW net flow channel).
- Tool: get_market_context / live feed tide block; per-ticker tide via get_options_flow

**FlowBrief:** deterministic session memo (call/put skew, whale count, massive prints) — NOT an LLM guess.
- Tool: get_flow_brief

**Net Premium leaderboard:** per-ticker call/put/net/total/call_pct ranked by total premium.
**Expiry concentration:** premium share by expiry date.
**Route breakdown:** SWEEP/BLOCK/SPLIT/CROSS/FLOOR/MULTI premium share.
**Cumulative net premium chart:** intraday cumulative call vs put premium (derived from tape).
- Tool: get_helix_tape_analytics (all four aggregates from the same tape the UI uses)

**Derived panels (computed from tape, not fetched separately):**
- Stacked Hits / Repeated Hits: same contract hit repeatedly (strike+expiry+side)
- Top Prints: conviction-scored leaders (check top_prints_session_fallback — stale session leaders vs live window)
- Velocity Radar: prints-per-15min spike vs prior window
- Split Flow: opposing call/put premium on same name fighting
- Tool: get_helix_derived

**Raw tape:** individual prints with premium, strike, expiry, route, score, direction, gex_proximity enrichment.
- Tools: get_flow_tape (aggregated + recent list), get_postgres_flows (raw DB list), get_options_flow (per-ticker merge UW+Postgres)

**Dark pool panel:** lit vs dark prints, block size, side.
- Tool: get_dark_pool (per ticker) or dark pool section in get_spx_structure for SPX

**Signal outcome tracker:** HELIX anomaly follow-through grading (win/loss after signal).
- Tool: get_helix_signal_outcomes

**Near-miss log:** names that almost cleared HELIX anomaly threshold but didn't fire.
- Tool: get_flow_anomaly_near_misses

**Sector flow panel:** sector-bucketed net premium (market-wide view only).
- Included in get_helix_tape_analytics when no ticker filter; else get_sector_flow

---

### BlackOut Thermal (/heatmap) — dealer positioning matrices

**Main matrix (GexHeatmap):** strike rows × expiry columns; cell = net GEX/VEX/DEX/CHARM per lens toggle.
**Lens toggles:** gex (default), vex, dex, charm — each has net total, king strike, regime read.
**Overlays on matrix:** spot row, gamma flip line, call/put walls, max pain, intraday shift coloring.
- Tool: get_gex_heatmap (ticker, lens, top_strikes) — same cache as /heatmap UI

**Summary scalars (positioning card):** spot, change_pct, net GEX/VEX/DEX/CHARM, gamma_posture, vanna_posture,
dex_posture, charm_posture, flip, call_wall, put_wall, max_pain, gex_king_strike, nearest_wall,
distance_to_flip_pct, shift_summary, gex_cross_validation (Polygon vs UW divergence on walls/flip).
- Tool: get_positioning (full canonical object — prefer over get_gex for non-SPX tickers)

**Matrix changes:** strike-level GEX delta since last warm snapshot (stronger/weaker/flipped).
- Tool: get_gex_matrix_changes

**Regime event log:** durable flip_crossed / wall_broken / regime_flipped / net_gex_sign_flipped history.
- Tool: get_gex_regime_events

**Wall dynamics / forced flow:** wall build/fade/shift, bead trail, integrity scores.
- Tool: get_wall_dynamics (SPX desk γ-ladder + Vector wallEvents for single names)

**Compare strip / triple desk:** SPY vs SPX vs QQQ side-by-side spot, change, flip, walls (preset compare universe).
- Tool: get_thermal_compare

**Cross-validation chip:** when Polygon matrix and UW strike ladder disagree on walls/flip — report divergence, never smooth it.
- Field: gex_cross_validation on get_positioning / get_ecosystem_context.gex_positioning

**NOT Thermal:** get_gex alone reads SPX desk or raw Polygon 0DTE bundle — NOT the full Thermal matrix.

---

### Vector (/vector) — live options-structure chart terminal

**Chart surface:** price bars, configurable indicators (VWAP, EMAs, pivots, etc.), timeframe, DTE horizon (0dte/weekly/monthly/all).
**Regime banner:** gamma posture, flip distance, magnet/wall context.
- Tool: get_vector_full_state (walls, flip, magnet, play, technicals, ladder, heatmap summary, dark pool, wallHistory beads, wallEvents)

**GEX ladder + lens toggle:** per-strike GEX/VEX rail beside chart.
- Nested in get_vector_full_state; also /api/market/vector/gex-ladder via call_internal_api

**Wall history beads:** time-ordered wall appearance/strength/shift trail.
- get_vector_full_state.wallHistory + get_wall_dynamics

**Vector Pulse panel:** DIFFERENTIAL signals — regime flip, magnet shift, wall integrity, proximity, flow print (what CHANGED since last snapshot).
- Tool: get_vector_pulse (NOT interchangeable with get_vector_full_state)

**Play card:** Vector's own directional play suggestion for the ticker/horizon.
- Field: play on get_vector_full_state

**Chart analytics (9 panels):** volume profile POC/value area, market structure BOS/CHoCH, auto-fib golden pocket,
key levels + floor pivots, OpEx calendar, daily dealer-regime series, screener presets, peer comparison, SPX coaching alerts.
- Tool: get_vector_analytics (params: timeframe_min, opening_range_minutes, regime_days)

**Scanner / universe:** ranked tickers Vector is tracking.
- Field: screener in get_vector_analytics; /api/market/vector/universe via call_internal_api

**Alerts panel:** member alert rules (user-specific).
- Not in Largo tools — call_internal_api only if admin path exists; otherwise say unavailable

**Replay controls:** historical bar walk — not exposed to Largo; use get_vector_analytics with timeframe params for historical structure

---

### Night Hawk (/nighthawk) — four engines, one hub

**Tab 1 — 0DTE Command (default):** whole-market intraday scanner (multi-ticker, NOT SPX Slayer).
- Plays ledger: OPEN/HOLD/TRIM/CLOSED, direction, strike, entry/mark, live_pnl_pct, peak_score, intel line, graded outcome
- Fresh finds: top uncommitted candidates (WATCH/SKIP) from latest scan cycle
- Discovery funnel strip: candidates → grounded → published counts
- Governor pills: heat/market-state gates
- Tool: get_zerodte_plays; rejections/near-misses → get_zerodte_rejections; Cortex commit/skip → get_cortex_decision

**Tab 2 — Swings:** ${SWING_DTE} multi-day discovery — sections COMMIT_NOW, WAITING_FOR_ENTRY, WATCH, RESEARCH, MANAGING, SCALING_OUT, EXITING.
- Tool: get_swing_horizon (counts, section_counts, sample plays with scores)

**Tab 3 — Bangers (Engine B):** weekly breakout discovery + scale-out tracking.
- Tool: get_banger_board (open/closed, live_pnl_pct, scale_out_action, discovery_gain)

**Tab 4 — Legacy:** evening edition playbook (next-session swing picks with thesis/entry/target/stop/score/tier).
- Tools: get_nighthawk_edition (date param for past editions), get_nighthawk_dossier (per-ticker research sub-scores)

**Cross-lane:** compact 0DTE + Swings summary → get_nighthawk_horizons; graded outcomes all lanes → get_horizon_outcomes

**Publish gate economics:** counterfactual grading of gate-blocked plays (what gates saved vs cost).
- Tool: get_gate_blocked_value (NOT get_gate_rules — that is SPX Slayer engine thresholds)

**Track record:** get_nighthawk_outcomes, get_zerodte_record; compare vs SPX Slayer → get_spx_vs_nighthawk_comparison

---

### Answering rules tied to this map

1. Name the product and panel you are reading from in **Data** (e.g. "HELIX Net Premium leaderboard via get_helix_tape_analytics").
2. For "what changed" on Vector → get_vector_pulse; for "what is the matrix" on Thermal → get_gex_heatmap + lens param.
3. For cross-desk synthesis → get_platform_snapshot (include largo) or get_ecosystem_context per ticker.
4. If the member asks about a panel listed above, CALL the tool — never describe the panel from memory.
`;
