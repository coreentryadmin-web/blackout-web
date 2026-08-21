import type { AnthropicToolDef } from "@/lib/providers/anthropic";
import {
  BANGER_RE,
  CORTEX_READ_RE,
  FLOW_TOOLS_RE,
  FUNDAMENTAL_RE,
  GEX_POSITIONING_RE,
  HELIX_READ_RE,
  HELIX_SIGNAL_RE,
  matchesIntent,
  NEWS_TOOLS_RE,
  NIGHTHAWK_RE,
  PLATFORM_READ_RE,
  PREDICTIONS_RE,
  RECORD_READ_RE,
  SCREENER_RE,
  SPX_DESK_TOOLS_RE,
  SPX_PIN_RE,
  SWING_RE,
  THERMAL_READ_RE,
  VECTOR_READ_RE,
  WALL_DYNAMICS_RE,
  MATRIX_CHANGE_RE,
  VOL_TOOLS_RE,
} from "@/lib/largo/intent-keywords";
import { KNOWN_TICKERS } from "@/lib/largo/question-intent";

import { dteRangeLabel } from "@/lib/horizons";

const SWING_DTE_RANGE = dteRangeLabel("SWING");



function t(

  name: string,

  description: string,

  properties: Record<string, unknown> = {},

  required: string[] = []

): AnthropicToolDef {

  return { name, description, input_schema: { type: "object", properties, required } };

}



const T = { ticker: { type: "string", description: "e.g. NVDA, SPY, SPX, I:SPX" } };



/** Largo tool surface — Polygon/Benzinga primary (unlimited), UW fallback (rate-limited). */

export const LARGO_TOOL_DEFS: AnthropicToolDef[] = [

  t("get_quote", "Live quote from Polygon. Price, change%, day range, VWAP, volume.", T, ["ticker"]),

  t(

    "get_technicals",

    "Full MTF chart analysis from Polygon: daily/hourly/15m EMAs, RSI, MACD, ATR, S/R, weekly & monthly breakout highs/lows.",

    T,

    ["ticker"]

  ),

  t("get_peer_rs", "Relative strength vs sector ETF — 5d/10d/20d returns (Polygon bars).", T, ["ticker"]),

  t("get_seasonality", "Monthly seasonality — Polygon SPY proxy first; UW only for specific ticker.", {

    ticker: { type: "string" },

  }),

  t("get_qqq_relative_strength", "QQQ vs SPY tech leadership spread (Polygon)."),

  t("get_oi_per_strike", "OI + GEX by strike. Polygon chain first; UW fallback if empty.", {

    ...T,

    expiry: { type: "string" },

  }, ["ticker"]),

  t("get_oi_per_expiry", "OI bucketed by expiry. Polygon reference contracts first; UW fallback.", T, ["ticker"]),

  t("get_max_pain", "Max pain strike. Polygon chain first; UW fallback.", { ...T, expiry: { type: "string" } }, ["ticker"]),

  t("get_greeks", "Greeks by strike/expiry. Polygon Options Advanced first; UW fallback.", { ...T, expiry: { type: "string" } }, ["ticker"]),

  t("get_atm_chains", "ATM options contracts. Polygon chain first; UW fallback.", { ...T, expiry: { type: "string" } }, ["ticker"]),

  t("get_options_chain", "Near-the-money chain: IV, delta, OI, bid/ask. Polygon first; UW fallback.", {

    ...T,

    expiry: { type: "string" },

    option_type: { type: "string", enum: ["call", "put"] },

  }, ["ticker", "expiry", "option_type"]),

  t("get_options_volume", "Options volume. Polygon chain aggregate first; UW fallback.", T, ["ticker"]),

  t(
    "get_options_flow",
    "Per-ticker options flow — the only one of Largo's 4 flow tools that REQUIRES a ticker. For SPX/SPXW: returns a flow-only slice of the live SPX Sniper desk (the exact same in-memory desk get_spx_structure dumps in full — no extra API call) — flow_alerts (the desk's own spx_flows), unified_tape (top 20 prints), intraday_0dte {call_premium, put_premium, net}, bias, and strike_stacks computed over the desk's flow_alerts (not the wider unified_tape); source 'spx_sniper_desk'. For every OTHER ticker: MERGES three live Unusual Whales REST pulls (per-ticker flow-alerts capped at 50, flow-per-strike-intraday for the 0DTE aggregate, flow-recent capped at 100) with up to 48h / 500 rows of BlackOut's OWN Postgres-ingested HELIX tape (fetchRecentFlows — the exact same flow_alerts table get_flow_tape and get_postgres_flows read), deduped by strike+type+expiry+premium+alert-minute so a print present in both sources is never double-counted, then computes strike_stacks (Repeated Hits + same-strike accumulation) over that deduped MERGED set. The response's helix_session_alerts (row count) and source ('unusual_whales + helix' vs plain 'unusual_whales') tell you whether HELIX actually contributed rows this call. IMPORTANT — despite the UW-sourced live pull, this is NOT purely UW-only data for non-SPX tickers: there is genuinely no Polygon equivalent to this product (live flow-alerts / strike_stacks), but 'no Polygon' does not mean 'no Postgres/HELIX' — part of what it returns is BlackOut's own ingested tape. Use get_global_flow instead when the question is market-wide rather than about one ticker (it also accepts an optional ticker filter, but stays pure live-UW with no HELIX merge). Use get_flow_tape or get_postgres_flows instead when you only need the already-ingested Postgres tape without paying for a fresh live UW round trip (e.g. a cross-ticker leaderboard).",
    T,
    ["ticker"]
  ),

  t("get_net_prem_ticks", "UW ONLY — tick-level net premium velocity.", T, ["ticker"]),

  t("get_nope", "UW ONLY — Net Options Pricing Effect.", T, ["ticker"]),

  t("get_flow_per_strike", "UW ONLY — intraday premium flow by strike.", T, ["ticker"]),

  t("get_flow_expiry_breakdown", "UW ONLY — premium flow by expiry.", T, ["ticker"]),

  t("get_dark_pool", "UW ONLY — dark pool institutional prints.", T, ["ticker"]),

  t("get_lit_flow", "UW ONLY — lit exchange order flow.", T, ["ticker"]),

  t("get_unusual_trades", "UW ONLY — unusual trade prints.", { ticker: { type: "string" } }),

  t("get_market_oi_change", "UW ONLY — market-wide OI changes today."),

  t("get_top_net_impact", "UW ONLY — highest net premium impact tickers."),

  t("get_iv_stats", "IV rank + OI changes. Polygon VIX rank for index proxies; UW fallback for single names.", T, ["ticker"]),

  t("get_iv_term_structure", "IV term structure. UW only.", T, ["ticker"]),

  t("get_volatility_regime", "Vol regime: Polygon VIX indices + UW IV rank if needed.", { ticker: { type: "string" } }),

  t("get_realized_vol", "UW ONLY — realized vs implied vol.", T, ["ticker"]),

  t("get_risk_reversal_skew", "UW ONLY — put/call skew history.", T, ["ticker"]),

  t("get_market_context", "Polygon indices + session status; UW market tide (exclusive)."),

  t("get_market_breadth", "Sector ETF + mega-cap breadth (Polygon)."),

  t("get_sector_flow", "Polygon sector ETF performance + UW sector tide.", {

    sector: { type: "string" },

  }),

  t("get_market_movers", "Top gainers/losers (Polygon)."),

  t("get_economic_calendar", "FOMC, CPI, NFP — curated static US macro schedule.", { days_ahead: { type: "integer", default: 14 } }),

  t("get_etf_flow", "UW ONLY — ETF in/outflow + tide. Polygon quote for price.", { etf: { type: "string" } }),

  t("get_company_profile", "Polygon ticker details; UW fallback.", T, ["ticker"]),

  t("get_financials", "UW financial statements.", T, ["ticker"]),

  t("get_earnings", "Per-ticker earnings: Benzinga STRUCTURED calendar primary — `next_report` (date, BMO/AMC time, confirmed vs projected) and `print_history` (actual vs estimated EPS and revenue, with each print's reaction anchored to its report timing) — plus UW earnings/estimates. `related_news` is news MENTIONING this ticker in the earnings channel, NOT its own results — never quote it as this company's earnings. A non-null `calendar_error` means the calendar could not be READ, which is not evidence the company has no scheduled report. Move/return fields are PERCENTS under `_pct` names; `expected_move` (no suffix) is a DOLLAR amount. Neither is to be rescaled.", T, ["ticker"]),

  t("get_earnings_history", "UW earnings history and estimates — one row per past print. Move/return fields are PERCENTS under `_pct` names (reaction_pct is the print reaction, (post_close-pre_close)/pre_close x100); `expected_move` is a DOLLAR amount. Do not rescale either.", T, ["ticker"]),

  t("get_analyst_ratings", "Benzinga analyst-ratings channel primary; UW screener fallback.", T, ["ticker"]),

  t(
    "get_news",
    "Benzinga full-text primary → Polygon sentiment → UW fallback. Optionally filter by Benzinga channel(s) to pull targeted, high-signal news.",
    {
      ticker: { type: "string", description: "e.g. NVDA, SPY. Omit for general/market-wide news." },
      channels: {
        type: "string",
        description:
          "Optional Benzinga channel filter. Space-delimited, lowercase; pass multiple by comma-separating (any-of match). Omit for general news. Available channels: 'analyst ratings', 'price target', 'upgrades', 'downgrades', 'analyst color', 'earnings', 'guidance', 'm&a', 'movers', 'after-hours center', 'insider trades', 'short sellers', 'fda', 'dividends', 'ipos', 'buybacks', 'offerings', 'top stories', 'trading ideas', 'rumors', 'exclusives'. Examples: 'fda', 'analyst ratings', 'guidance', 'm&a', 'insider trades'.",
      },
    }
  ),

  t("get_web_search", "Internet search for breaking catalysts and macro context.", {

    query: { type: "string" },

  }, ["query"]),

  t("get_fda_calendar", "UW ONLY — FDA events for biotech/pharma.", T, ["ticker"]),

  t("get_ipo_calendar", "Polygon vX IPO calendar for upcoming listings; web search fallback if none found.", {
    from: { type: "string", description: "YYYY-MM-DD start date; defaults to today" },
    to: { type: "string", description: "YYYY-MM-DD end date; defaults to 30 days out" },
  }),

  t("get_short_interest", "Polygon short interest first; UW fallback.", T, ["ticker"]),

  t("get_short_data", "Polygon SI + short volume first; UW float/FTDs fallback.", { ticker: { type: "string" } }),

  t("get_insider_flow", "UW insider transactions.", T, ["ticker"]),

  t("get_congress_trades", "UW ONLY — congressional trading disclosures.", { ticker: { type: "string" } }),

  t("get_screener", "UW ONLY — stocks, short_squeeze, option_flow, dark_pool, analysts.", {

    type: { type: "string", enum: ["stocks", "short_squeeze", "contracts", "option_flow", "dark_pool", "analysts"] },

  }),

  t("get_spx_structure", "Full live SPX Sniper desk — price, GEX, flow tape, dark pool, news headlines, macro, tide (same as dashboard)."),

  t(
    "get_spx_play",
    "SPX Slayer's OWN live play-engine snapshot (SPX/SPXW only) — NOT market-wide backdrop: phase (SCANNING/WATCHING/OPEN), action (SCANNING/WATCHING/BUY/HOLD/TRIM/SELL), direction, grade, score, confidence, headline/thesis, every confluence factor with its weight/detail, entry/stop/target levels, full gate state (gates.passed + humanized blocks/warnings + entry_mode + play_idea), the AI arbiter's verdict (claude), the currently open play if any (entry price, stop, target, MFE, trim status, option label/premium), the 10-item confirmation checklist, MTF/RSI/EMA technicals, the option ticket, watch-state (armed-but-not-yet-open, with promote_ready), adaptive-gate telemetry (cold/promote win rates, score boosts), lotto and power-hour sub-plays, session_phase, and signal_committed (true only once a play is actually committed to the DB this cycle — a BUY action alone does NOT mean a position is live; wait for signal_committed before treating it as opened). Use for 'what phase/setup/bias is SPX Slayer in right now,' 'why did the play get rejected/vetoed,' 'what gates or confluence factors are active,' or any question about THIS engine's own current or most recently closed play — for market-wide conditions that aren't specific to this play engine (regime, backdrop, is-this-a-good-environment), use get_market_regime instead. get_ecosystem_context returns this exact object as spx_full_state when ticker is SPX/SPXW — prefer that single call instead of this one if the turn also needs Night Hawk's take, HELIX flow, or anomaly context for the same ticker."
  ),

  t("get_open_plays", "Open desk trades."),

  t("get_trade_history", "Closed trades from Postgres.", { ticker: { type: "string" }, days: { type: "integer" } }),

  t("get_setup_stats", "Win rates by setup from Postgres."),

  t(
    "get_postgres_flows",
    "Raw ingested flow-alert prints from Postgres (BlackOut's own HELIX ingestion of the UW option_trades WS feed + cron backfill, the flow_alerts table) — the SAME data source get_flow_tape reads, but WITHOUT get_flow_tape's aggregates: just the flat print list (ticker, premium, option_type, strike, expiry, direction, score, route, alerted_at, dte, and a handful of enrichment fields), sorted biggest-premium-first by default, last 48h window, default limit 25 (vs get_flow_tape's 50). get_flow_tape is a strict SUPERSET of this tool — it calls this exact same underlying fetch and returns the result verbatim as its own `recent` field, then adds count/total_premium/top_tickers on top — so prefer get_flow_tape unless you specifically want the bare print list with nothing else attached. No live UW REST call is made (contrast get_options_flow, which DOES call UW live for a single ticker and additionally merges this same Postgres tape in), and no strike_stacks are computed (that pattern-detection is get_options_flow/get_global_flow only).",
    { ticker: { type: "string" }, limit: { type: "integer", default: 25 } }
  ),

  t("get_signal_log", "SPX signal log from Postgres.", { limit: { type: "integer" } }),

  t(
    "get_spx_engine_snapshots",
    "Retrospective log of the SPX play engine's REJECTED/scanning history — answers 'why was the last signal rejected' or 'what was the engine doing at time Y', which get_signal_log CANNOT answer: get_signal_log's spx_signal_log table only ever records a COMMITTED BUY/SELL/TRIM signal, so a gate-blocked entry, a Claude veto, a WATCHING/near-miss setup, or a plain no-setup SCANNING tick leaves zero trace there — the evaluation happened, then vanished once the next poll tick overwrote it in memory. This tool reads spx_engine_snapshots instead: one row per DISTINCT phase/action/direction/gates state the engine has passed through (throttled to state transitions only, not one row per poll tick, so consecutive identical ticks collapse into a single row spanning that whole period) — phase (SCANNING/WATCHING/OPEN), action, direction, score, the exact gates.blocks list that kept a would-be entry from firing (e.g. 'MTF conflict', 'below full min score', 'Claude veto: ...'), a thesis/explanation string, and the engine's as_of timestamp for that state. Use for 'why didn't SPX Slayer take a trade earlier today', 'what was blocking entry at 10:15', or 'when did the engine's bias flip from bullish to bearish watching' — questions about the engine's rejected/scanning history. For the committed trade history itself, use get_signal_log (recent fired signals) or get_trade_history (closed, graded trades) instead.",
    { limit: { type: "integer" } }
  ),

  t("get_lotto_state", "Today's lotto state from Postgres."),

  t(
    "get_zerodte_plays",
    "0DTE Command's OWN live scanner board (the default tab at /grid, formerly branded 'BlackOut Grid') — a DIFFERENT, MULTI-TICKER engine from SPX Slayer: an always-on scanner that hunts the broader tape all session for brand-new 0DTE setups across many tickers (index products like SPY/QQQ/NDX are eligible alongside single names), never SPX/SPXW's own single-instrument play engine. Returns: `plays` — today's ledger of setups the scanner has already flagged, each with lifecycle `status` (OPEN/HOLD/TRIM/CLOSED), `direction`, `strike`, `entry_premium`, `last_mark`, `live_pnl_pct`, `peak_score`, the current BlackOut Intelligence `action`/`intel` reasoning line, and (once closed) a `graded` outcome/pnl_pct; `fresh_finds` — the top 5 setups the scanner just surfaced this cycle that are NOT yet on the ledger (ticker/status/direction/strike/score/gross_premium/aggression/plan/intel; `status` is WATCH for an uncommitted candidate or SKIP for a refused find — a fresh find is NEVER an OPEN position and must not be presented as one); `excluded_covered_elsewhere` — tickers deliberately withheld from fresh_finds because last night's Night Hawk edition already covers them (a name members already have is a repeat, not a find, so it won't double-count here); and `rules`, the 0DTE discipline every play is managed to (no new entries after 15:00 ET, -50%/+100% stop/trim plan, hard exit by 15:30 ET). IMPORTANT — do not conflate this with SPX Slayer: this tool has no visibility into and never reflects SPX Slayer's own phase/gates/confluence/score for its current or most recent play. For SPX/SPXW's own single-instrument play-engine state, use get_spx_play (or get_spx_structure for the full desk view) instead — only reach for this tool when the question is actually about the multi-ticker 0DTE Command scanner/board itself. This tool ONLY shows setups that already cleared every gate — for a candidate that DIDN'T make the board, use get_zerodte_rejections instead.",
    {}
  ),
  t(
    "get_zerodte_rejections",
    "0DTE Command's near-miss/gate-rejection log — answers 'why didn't ticker X make the Grid board' or 'what has the scanner been rejecting today', which get_zerodte_plays structurally CANNOT answer: that tool only ever shows candidates that already cleared every one of the scanner's 4 evidence gates (gross premium ≥ $750k, at-the-ask aggression share ≥ 30%, side dominance ≥ 65%, and not a deep-ITM stock-replacement strike) — a candidate that failed even ONE of those checks is invisible there and left no trace anywhere until this tool existed. Reads zerodte_scan_rejections: one row per ticker per DISTINCT rejection state (throttled to state transitions, not one row per scan cycle), naming exactly which `gate_failed` (min_gross/min_aggr_share/min_dominance/max_itm_pct/no_dominant_strike/no_underlying_price — the last means the tape never carried a usable underlying price for that ticker, so the deep-ITM stock-replacement check couldn't run and fails closed rather than passing the candidate through unchecked) stopped the candidate, the live `threshold` it was measured against, and whichever of gross_premium/aggression/side_dominance/otm_pct had actually been computed before the scan short-circuited past it — later-gate metrics are `null`, never guessed, when an earlier gate already rejected the ticker (e.g. a min_gross rejection never learns a direction or aggression share, because the live scan never computes those for it either). Pass `ticker` to scope to one name's rejection history, or omit for the most recent rejections across every candidate. IMPORTANT — this is 0DTE Command's OWN multi-ticker scanner (src/lib/zerodte/board.ts, the exact same engine get_zerodte_plays reads), a COMPLETELY DIFFERENT product from SPX Slayer: for SPX/SPXW's own single-instrument engine's rejected/scanning history, use get_spx_engine_snapshots instead — do not conflate the two just because both are 0DTE-flavored.",
    { ticker: { type: "string" }, limit: { type: "integer" } }
  ),
  t(
    "get_zerodte_record",
    "0DTE Command multi-day track record — graded win/loss stats from the scanner ledger (plan-outcome methodology, option-premium returns). Use for 'how is 0DTE Command doing this month', win rate, avg P&L — NOT SPX Slayer point results and NOT Night Hawk stock-move returns. `days` rolling window (default 30, max 90).",
    { days: { type: "integer", default: 30 } }
  ),
  t(
    "get_gate_blocked_value",
    "What the publish gates COST and SAVED — every Night Hawk play a gate blocked in the window, counterfactually graded on real bars, split into how many would have LOST (the gate was right) and how many would have WON (the gate cost us). Also per-gate lines so a single threshold can be judged on its own record. This is the only source that can answer 'is that gate actually earning its number' or 'what did we miss by being strict', and it is the honest counterpart to get_zerodte_record — a track record counts what was taken, this counts what was refused. Grading is a WIN/LOSS verdict per blocked play, not a P&L. `blocked_total` is every blocked play; `graded_total` is the subset that could be graded — never quote the first as though it were the second. `unfilled_total` is blocked plays that would not even have filled (the gate was trivially right); they are excluded from the won/lost read. `days` rolling window (default 30, max 120).",
    { days: { type: "integer", default: 30 } }
  ),
  t(
    "get_grader_agreement",
    "How often the MID (mechanical) grade and the OFFICIAL (executable / as-executed) grade agree on win-vs-loss across the 0DTE ledger, plus EVERY row where they disagree with both verdicts side by side. Use for 'how do you know your record is right', 'are the numbers audited', or any challenge to grading integrity. `comparable` is the only population that can be tested (rows carrying a grade on BOTH lanes) and is distinct from `total_plays` — quote the agreement rate against `comparable`, never against the window. A disagreement is a METHODOLOGICAL difference, not a defect: a row partially banked by WS-11 reads `stopped −50%` on the mid lane and a WIN on the official one, and the official lane is what the member was actually guided to. `days` rolling window (default 90, max 365).",
    { days: { type: "integer", default: 90 } }
  ),
  t(
    "get_gate_rules",
    "The ACTUAL SPX Slayer play-gate thresholds, read live from the engine's own config functions — mixed-tape block (GRADE-SCALED: A tolerates one more conflicting signal than B), minimum grade, buy cooldown + A+ bypass, post-stop cooldown, GEX staleness ceiling. CALL THIS BEFORE attributing any loss or skip to a gate. get_scan_rejections and get_spx_engine_snapshots show what a gate DID for one candidate at one score; they do not tell you the rule, and reconstructing the rule from them produces confident, wrong root causes (measured 2026-08-10). Takes no arguments.",
    {}
  ),
  t(
    "get_banger_board",
    `Night Hawk Bangers lane (Engine B) — whole-market weekly breakout discovery with mechanical scale-out tracking. Returns open + recently closed banger_positions: ticker, contract, entry/last mark, live P&L, scale-out state, discovery stats. Distinct from 0DTE Command (intraday scanner) and Swings (\${SWING_DTE_RANGE} thesis lane). COUNTS: \`open_count\` is the TRUE number of open positions (queried independently of \`limit\`); \`open_shown\` is how many are in this response and \`truncated\` says whether more exist. Quote open_count as the total — never the length of the \`open\` array, which is capped by \`limit\`.`,
    { limit: { type: "integer", default: 40 } }
  ),
  t(
    "get_swing_horizon",
    `Night Hawk Swings lane — ${SWING_DTE_RANGE} multi-day discovery board with seven action sections (COMMIT_NOW, WAITING_FOR_ENTRY, WATCH, RESEARCH, MANAGING, SCALING_OUT, EXITING). Returns committed/watch counts, section counts, and sample plays with scores. Use for swing-specific questions — NOT the evening Legacy edition (get_nighthawk_edition) and NOT 0DTE Command (get_zerodte_plays).`,
    {}
  ),
  t(
    "get_nighthawk_horizons",
    "Night Hawk unified horizon board — compact 0DTE Command + Swings snapshot in one call. Use when the question spans both intraday scanner plays AND swing lane status without needing full play detail from each dedicated tool.",
    {}
  ),
  t(
    "get_horizon_outcomes",
    "Cross-lane graded outcomes — unified win/loss read across ZERO_DTE and SWING horizons (each lane keeps its own grading methodology; this republishes, never blends). `days` rolling window (default 30). Use for cross-product performance questions that span 0DTE Command and Swings.",
    { days: { type: "integer", default: 30 } }
  ),
  t(
    "get_helix_signal_outcomes",
    "HELIX velocity/split-flow signal follow-through tracker — graded vs pending signal outcomes from the helix_signal_outcomes ledger. Use for 'do HELIX velocity signals actually follow through'. RATE — `summary.continuation_rate_pct` (same number as the legacy `winRatePct`) is a DIRECTIONAL FOLLOW-THROUGH rate, not a trade win rate and not a P&L. It is null below `summary.min_graded_for_rate` graded samples — null means NOT ENOUGH DATA, never 0%. NEVER report its complement as losses: the graded rows split three ways and the split is the answer. Read `summary.continuedCount` / `flatCount` / `reversedCount` — a signal that is 62% continued, 30% FLAT and only 7% REVERSED rarely goes wrong, it often goes nowhere, which is a completely different instrument from one that is wrong a third of the time. Say which. `outcome` is relative to each row's own `direction`, so a continued BEARISH firing means price FELL. `outcome_values` lists the vocabulary. `rows_shown` vs `rows_summarized` differ on purpose — the rate is computed over ALL fetched rows, the list is the newest few. PER TYPE — `summary.by_signal_type` breaks the same follow-through down per signal type (split_flow / velocity_spike / …), each with its OWN `graded` denominator and its OWN `continuation_rate_pct` (null below `min_graded_for_rate`, same rule as the aggregate). Use it for 'which HELIX signal is more reliable' — do NOT hand-count the capped `rows` list to compare types, it is a truncated slice and can rank them backwards. Per-type counts sum to the aggregate.",
    { limit: { type: "integer", default: 50 } }
  ),
  t(
    "get_spx_pin",
    "SPX end-of-day pin forecaster — probabilistic close magnet strike from live GEX + flow context (the SPX Slayer pin rail). Distinct from max pain (options-writer payout min) and gamma magnet (dealer center of mass).",
    {}
  ),
  t(
    "get_spx_pulse",
    "Fast SPX desk pulse — price, session change, internals, mega-cap snapshot (~2s lane). Lighter than get_spx_structure when only price/internals are needed.",
    {}
  ),
  t(
    "get_cortex_decision",
    "Cortex commit/skip/exit evidence for a 0DTE-relevant ticker — pinned ledger truth when a play exists this session, otherwise live 'what would Cortex say now'. Pass `ticker` and optional `question` for direction hints. Use for 'why did we commit/skip X', Cortex veto, or gate evidence — NOT SPX Slayer play-engine gates (get_spx_play / get_spx_engine_snapshots).",
    { ticker: { type: "string" }, question: { type: "string" } }
  ),
  t(
    "get_nighthawk_edition",
    "Night Hawk's OWN dedicated tool — always returns the FULL published edition object, regardless of any parameter: `available`, `edition_for`, `published_at`, `recap_headline`, `recap_summary`, `market_recap`, and `plays` (the complete array: rank, ticker, direction, conviction, play_type, thesis, key_signal, entry_range, target, stop, options_play, entry_premium/entry_cost_per_contract, premium_cap_ok, risk_note, score, flow_streak_days, iv_rank — every field a member sees on /nighthawk), plus state flags `recap_only` (a recap published but no play survived the funnel), `degraded` (served from a legacy/fallback source, not the first-class pipeline), `stale`/`served_for` (tonight's edition isn't published yet, so an OLDER edition was served instead — do not say 'Edition live'), and `carry_until_close`. Pass `date` (YYYY-MM-DD) to pull a SPECIFIC PAST edition — this is the ONLY Night Hawk tool that can do that; omit for the latest published edition. IMPORTANT — do not substitute get_platform_snapshot for this: that tool's own `nighthawk` field is a STRIPPED SUMMARY by default (recap_headline + up to 5 bare ticker symbols only — no thesis/entry/target/stop/score at all) unless its `full_edition` flag is explicitly set true, and even then it can only ever return the LATEST published edition — it has no `date` parameter and can never answer 'what did Night Hawk pick on [a past date]'. Use THIS tool whenever the question needs the plays' own detail or is scoped to a specific day; reach for get_platform_snapshot only when the SAME turn also needs the SPX desk and/or flow tape alongside Night Hawk.",
    {
      date: { type: "string", description: "Edition date YYYY-MM-DD; defaults to latest published." },
    }
  ),

  t(
    "get_helix_derived",
    "HELIX's DERIVED panels — Stacked Hits, Top Prints, Velocity Radar and Split Flow — the four analytics the /flows page COMPUTES from the raw tape rather than fetching. get_flow_tape and get_options_flow return the individual PRINTS; this returns what HELIX makes of them, and those are different questions. Use for 'what is stacking on NVDA', 'which contract is being hit repeatedly', 'what are the top prints right now', 'anything spiking on the velocity radar', 'is anyone fighting on this name'. stacked_hits = repeated prints on the SAME contract (strike + expiry + side) — the repeat-hit signature, not merely two prints on one strike. top_prints = the conviction-scored leaders; ALWAYS read top_prints_session_fallback, because when it is true every row sits OUTSIDE the rolling hit window and they are STALE session leaders, not live conviction — say so rather than presenting them as current. velocity_spikes = prints per 15min vs the prior window, per ticker. split_flow = opposing call AND put premium (each >= $500K) on the same name inside 30 minutes. Omit `ticker` for a whole-market read, or pass one to scope it. prints_analyzed tells you how much tape the derivations actually saw; when it is 0, empty_reason distinguishes 'the pipeline returned nothing' from a genuinely quiet tape — never report the first as the second. Prints are read NEWEST-FIRST, the same population the member's /flows desk shows — these ARE the current stacks and spikes, not the largest prints of the last two days.",
    {
      ticker: { type: "string" },
      limit: { type: "integer", description: "Prints to analyse (50-1000, default 400). Every derivation is a WINDOW, so a small limit under-reports." },
      since_hours: { type: "integer", description: "Rolling lookback in hours (default 168 = 7d). Prints are read NEWEST-FIRST, so the limit usually binds first and the real span is much shorter. Pass a small value to scope to right now." },
      hours: { type: "integer", description: "Alias for since_hours." },
    }
  ),

  t(
    "get_flow_brief",
    "HELIX FlowBrief — deterministic session memo (call/put skew, whale count, massive print callouts). Same composeFlowBrief the /flows FlowBrief panel uses — NOT an LLM hallucination. Use for 'summarize the tape', 'what is flow doing', 'give me the flow brief'. Prints are read NEWEST-FIRST, the same population the member's /flows desk shows. WINDOW — never quote `window.requested_hours` as the period summarised: the row limit almost always binds first, so quote `window.actual_hours` and say the read is limit-bound when `window.limit_reached` is true. `window.newest_age_minutes` tells you how stale the freshest print is, and `window.undated_prints` how many prints carry no real UW time at all (routinely most of the tape) — a memo over a cold or largely undated tape must say so."
  ),

  t(
    "get_helix_tape_analytics",
    "HELIX secondary panels computed from the Postgres flow tape — the aggregates the UI renders as Net Premium leaderboard, Route Breakdown (SWEEP/BLOCK/SPLIT/…), Expiry Concentration, and session call/put skew. get_helix_derived covers Stacked Hits/Velocity/Split Flow; THIS tool covers the leaderboard/route/expiry panels. Optional ticker narrows the tape to one name. EXPIRY — read `expiry_horizons` (0DTE / This week / Monthly / LEAPS, with call/put split) for any question about horizon, and ALWAYS for \"is there 0DTE flow\": it is the aggregation the member panel shows and it is complete. `expiry_concentration` is the per-DATE detail and is only the top 8 BY PREMIUM — `expiry_concentration_truncated` tells you whether dates were dropped, and near-dated expiries are the ones that drop, because 0DTE prints are small next to LEAPS blocks. Never infer a date's horizon yourself: every row carries `dte` and `horizon`, measured against `session_date` (the ET CALENDAR DATE this tape is scored against). `session_date` is NOT the same as the date part of `as_of` — after ~8pm ET the UTC date is already tomorrow, so treating an expiry as 0DTE because it matches `as_of` is wrong by a full session. `available` is true even on an empty tape; `empty_reason: \"no_prints_in_window\"` means the window was genuinely quiet, not that the tool failed. WINDOW — never quote `window.requested_hours` as the period you analysed. The row limit almost always binds before the time window does: a 168-hour request with limit 500 came back covering 54 MINUTES. Quote `window.actual_hours` (the span of the prints themselves) — or `window.actual_minutes` when the span is short, which it often is — and when `window.limit_reached` is true say the read is limit-bound, not window-bound. `window.no_dated_print_reason` distinguishes an empty window from one whose prints all lack an exchange timestamp. `window.newest_age_minutes` tells you how stale the freshest print is — off-hours a tape can be complete and still hours old. Rows are ordered NEWEST-FIRST, the same population the member's /flows desk shows; the desk additionally hides prints under `member_panel_premium_floor` ($200k) which this tool does NOT (`premium_floor_applied: false`). That cuts BOTH ways and neither is an error: this read includes small prints the desk hides, so small-print totals can be HIGHER here; but the desk's floored page reaches further back in time for the same row count, so a big name's total can be LOWER here than on screen. SKEW — `call_pct` is **null** whenever no call/put premium was measured (empty or all-typeless tape). null means NOT MEASURED; it does NOT mean balanced, and there is no 50 fallback. Say the tape is quiet rather than reporting an even split. `session.typeless_prints` reconciles `whale_prints` with `total_premium`: a typeless print counts as a print (and can be a whale) but adds to neither premium leg, so `{whale_prints: 1, total_premium: 0}` is coherent, not a broken sum. CONTRACT — `freshness` (live/delayed/stale) + `age_seconds` describe the newest REAL print, and both are **null when the tape's age cannot be measured at all** (most prints are ingest-stamped and carry no exchange time); null there means UNKNOWN, not stale. `direction` is present ONLY when the skew was measurable — its ABSENCE means not measured, and there is no neutral fallback. `ticker_class` (index/etf/equity) and `canonical_root` accompany `ticker`, which is left as the tape reported it: SPX and SPXW are different settlement series that both trade, so join on `canonical_root` but never restate SPXW as SPX. A genuine failure returns `available: false` with `unavailable: {reason, what_is_missing, retryable}` — distinct from a healthy but quiet tape, which stays `available: true` with `empty_reason`. Never report the second as the first.",
    {
      ticker: { type: "string", description: "Optional — omit for market-wide tape panels." },
      limit: { type: "integer", default: 500, description: "Prints to aggregate (default 500, max 5000). Rows are newest-first, so a bigger limit reaches further BACK in time." },
      since_hours: { type: "integer", description: "Rolling lookback in hours (default 168 = 7d, the member desk's own window). Pass a small value for \"what is the tape doing RIGHT NOW\" — e.g. 1 for the last hour. Note the row limit usually binds before this does; read `window.actual_hours`." },
      hours: { type: "integer", description: "Alias for since_hours." },
    }
  ),

  t(
    "get_flow_tape",
    "HELIX tape from Postgres (the flow_alerts table — same ingestion pipeline as get_postgres_flows): count, total_premium, top_tickers (top 10 by aggregated premium, each with ticker/premium/count), and recent (the flat print list — identical rows to what get_postgres_flows returns on its own; this tool calls that exact same underlying fetch and returns it verbatim as `recent`, then adds the aggregates on top). A strict SUPERSET of get_postgres_flows, never a different view — get_postgres_flows exists for when you want ONLY the bare print list. Default limit 50 (vs get_postgres_flows' 25), last 48h window, sorted biggest-premium-first by default; pass `since_hours` (or `hours`) for intraday windows like \"last hour\" / \"right now\" — values ≤6 also sort by most-recent-first. ticker is optional (omit for a platform-wide tape + leaderboard). No live UW REST call — contrast get_options_flow, which DOES call UW live for a single ticker and merges this same Postgres tape in, and get_global_flow, which is a pure live UW pull with no Postgres data at all. No strike_stacks (that pattern-detection is get_options_flow/get_global_flow only). If you already need this ticker's other cross-instrument context too, prefer get_ecosystem_context's flow_full_state field instead of a standalone call — it returns this exact object (via the same underlying function) plus per-print GEX-proximity enrichment.",
    {
      ticker: { type: "string" },
      limit: { type: "integer", default: 50 },
      since_hours: { type: "integer", description: "Rolling lookback in hours (e.g. 1 for last hour)." },
      hours: { type: "integer", description: "Alias for since_hours." },
    }
  ),

  t(
    "get_platform_snapshot",
    "Cross-service, ONE-CALL combo across up to 3 products in parallel — NOT a substitute for a product's own dedicated tool when the question needs that product's full detail. `spx` — the exact same object get_spx_structure returns (both call the identical getSpxDeskSummary() — price, GEX, flow, dark pool, macro, tide). `flows` — the exact same object get_flow_tape returns (both call the identical getFlowTapeSummary(): count/total_premium/top_tickers/recent), same default limit 50 (override with `flow_limit`). `nighthawk` — by DEFAULT a STRIPPED-DOWN summary ONLY (available/edition_for/published_at/recap_headline/play_count/top_tickers as bare ticker strings — no thesis/entry/target/stop/score at all); pass `full_edition: true` to ALSO get a `nighthawk_edition` field holding the exact same full object get_nighthawk_edition returns — but even then this is ALWAYS the LATEST published edition. There is no date parameter here, unlike get_nighthawk_edition's own `date` (YYYY-MM-DD) for a specific past edition. Use `include` (subset of spx/flows/nighthawk; defaults to all three) to skip services you don't need. NOTE: pass `include: ['largo']` (or add `largo` to the include array) to attach `snapshot.largo` — the Redis-backed BIE full-platform read (Thermal matrix, Vector SPX, HELIX near-misses, 0DTE rejections). IMPORTANT — for a Night-Hawk-ONLY question needing actual play detail (thesis/entry/target/stop/score) or a specific past date, call get_nighthawk_edition directly instead: this tool's default nighthawk field can't answer either, and full_edition:true still can't answer the date case. Reach for THIS tool only when the question genuinely spans multiple products in the same turn (e.g. 'how does the SPX desk look alongside tonight's flow tape and Night Hawk picks').",
    {
      include: {
        type: "array",
        items: { type: "string", enum: ["spx", "flows", "nighthawk", "largo"] },
        description: "Subset of services; default all three. `largo` adds `snapshot.largo` — the BIE full-platform state (Thermal, Vector, HELIX near-misses, 0DTE rejections).",
      },
      flow_limit: { type: "integer", default: 50 },
      full_edition: { type: "boolean", description: "Include the full Night Hawk edition object (latest only — no date param)." },
    }
  ),

  t("get_gex", "GEX/dealer map. Polygon chain GEX first; UW spot exposures fallback. For SPX/I:SPX, all strike levels are SPX-denomination (thousands). Default to I:SPX (not SPY) when the user asks about index GEX or gamma walls.", {

    ...T,

    expiry: { type: "string", description: "YYYY-MM-DD, defaults today for 0DTE" },

  }, ["ticker"]),

  t("get_greek_flow", "UW ONLY — dealer greek flow by strike/expiry.", {

    ...T,

    expiry: { type: "string" },

  }, ["ticker"]),

  t("get_predictions_consensus", "UW ONLY — prediction market confidence from insiders, smart money, unusual flow, whales.", {
    ticker: { type: "string", description: "Optional filter e.g. NVDA" },
    limit: { type: "integer", default: 20 },
  }),

  t("get_group_greek_flow", "UW ONLY — basket dealer greek flow (mag7, semis, etc.).", {
    group: { type: "string", description: "Flow group e.g. mag7, semis", default: "mag7" },
    expiry: { type: "string", description: "Optional YYYY-MM-DD expiry" },
  }),

  t("get_macro_indicator", "UW ONLY — macro series (GDP, CPI, unemployment).", {
    indicator: { type: "string", enum: ["GDP", "CPI", "UNRATE"], default: "CPI" },
  }),

  t("get_option_contract", "UW ONLY — single contract flow/intraday (OCC symbol required).", {

    contract_id: { type: "string", description: "OCC symbol e.g. NVDA250117C00124000" },

  }, ["contract_id"]),

  t("get_stock_state", "UW comprehensive ticker snapshot — use get_quote + get_technicals first.", T, ["ticker"]),

  t("get_ownership", "UW ONLY — institutional ownership + insider.", T, ["ticker"]),

  t("get_institutional", "UW ONLY — 13F filings, institution activity.", {

    ticker: { type: "string" },

    institution: { type: "string", description: "e.g. Citadel, Berkshire" },

  }),

  t("get_etf_detail", "UW ETF holdings/exposure + Polygon quote.", { etf: { type: "string" } }, ["etf"]),

  t("get_market_stats", "UW ONLY — market-wide options volume, correlations, net flow.", {}),

  t("get_nbbo", "Polygon real-time NBBO quote + last trade.", T, ["ticker"]),

  t("get_uw_bars", "OHLC bars — Polygon aggs first; UW fallback only.", {

    ...T,

    candle_size: { type: "string", enum: ["1m", "5m", "15m", "30m", "1h", "4h", "1d"], default: "1d" },

  }, ["ticker"]),

  t("get_uw_technicals", "Use get_technicals (Polygon) first. UW indicator fallback only.", {

    ...T,

    indicator: { type: "string", description: "rsi, macd, sma, ema, bbands, stoch, etc." },

    interval: { type: "string", default: "daily" },

  }, ["ticker", "indicator"]),

  t("get_earnings_market", "UW ONLY — the current ET session's premarket/afterhours earnings. Trust each row's own `report_date` for which session it belongs to, and `as_of_session`/`as_of_weekday` for the ET session this was read on — do not infer today's session from a timestamp. Move/return fields are PERCENTS under `_pct` names; `expected_move` is a DOLLAR amount.", {}),

  t(
    "get_earnings_calendar",
    "Market-wide earnings calendar (Alpha Vantage, 3-month horizon) — next report date per ticker. Distinct from get_earnings (Benzinga per-ticker). Optional ticker filter. Read `available` and `configured` before concluding anything from an empty result: `available:false` means the calendar could not be read at all, and `configured:false` means it holds no dates for ANY ticker — neither is evidence that a ticker has no upcoming report. Only `available:true` + `configured:true` + a null `next_report_date` means the horizon genuinely has no date for that ticker.",
    { ticker: { type: "string", description: "Optional — filter to one symbol." } }
  ),

  t("get_congress_unusual", "UW ONLY — unusual congressional trades.", { ticker: { type: "string" } }),

  t("get_vix_term", "VIX term structure — Polygon VIX indices first; UW fallback.", { ticker: { type: "string" } }),

  t("get_dividends", "Polygon dividends + splits first; UW fallback.", T, ["ticker"]),

  t("search_ticker", "Full-text ticker/company name search (Polygon). Returns matches with exchange, type, market.", {
    query: { type: "string", description: "Company name or ticker prefix e.g. 'Apple' or 'NVDA'" },
    limit: { type: "integer", default: 10 },
  }, ["query"]),

  t("get_option_price_history", "Historical OHLC bars for a specific option contract (Polygon). Requires OCC symbol.", {
    contract_id: { type: "string", description: "OCC symbol e.g. AAPL250117C00200000 (O: prefix optional)" },
    multiplier: { type: "integer", default: 1 },
    timespan: { type: "string", enum: ["minute", "hour", "day"], default: "day" },
    from: { type: "string", description: "YYYY-MM-DD start date" },
    to: { type: "string", description: "YYYY-MM-DD end date" },
  }, ["contract_id"]),

  t(
    "get_global_flow",
    "Market-wide options flow — a single live Unusual Whales REST pull (/api/option-trades/flow-alerts, up to 200 alerts server-side, capped at 40 returned) across ALL tickers, not scoped to one name by default; optionally narrow with a ticker filter and/or min_premium/is_call/is_put. Pure live UW data — no Postgres/HELIX merge, unlike get_options_flow's non-SPX path — so this one genuinely is UW ONLY with no Polygon equivalent. Also computes strike_stacks (Repeated Hits + same-strike accumulation) over whatever alerts this pull returns. Use get_options_flow instead for a single ticker's flow — it REQUIRES a ticker and, for non-SPX names, additionally merges in BlackOut's own Postgres-ingested HELIX tape for a fuller same-session picture than a live UW pull alone gives you. Use get_flow_tape or get_postgres_flows instead for the already-ingested Postgres tape (aggregated top_tickers/count/total_premium, or the raw print list) without paying for a fresh live UW round trip.",
    {
      ticker: { type: "string" },
      min_premium: { type: "number" },
      is_call: { type: "boolean" },
      is_put: { type: "boolean" },
    }
  ),

  // --- Cross-tool objects the platform already computes (Largo audit wiring) ---
  t("get_spx_confluence", "SPX confluence engine — the scored desk thesis: action (BUY_CALL/BUY_PUT/HOLD/WAIT), bias, score (-100..100), grade A+..D, agreeing vs conflicting factors with weights, entry/stop/target/invalidation. Explains WHY the desk leans a direction. Pure compute on the live desk."),

  t("get_positioning", "Dealer positioning for ANY ticker — full Thermal canonical read: spot, change_pct, net GEX/VEX/DEX/CHARM with posture + regime reads, gamma flip, call/put walls, gex king strike, max pain, nearest_wall, distance_to_flip_pct, intraday shift_summary, optional UW cross-validation. Same object as get_ecosystem_context.gex_positioning. For SPX/I:SPX, strikes are SPX-denomination (thousands). Prefer get_gex_heatmap for per-strike ladder / lens toggles (GEX/VEX/DEX/CHARM).", T, ["ticker"]),

  t(
    "get_gex_heatmap",
    "BlackOut Thermal matrix for a ticker — the SAME shared gex-heatmap cache the /heatmap UI reads. Returns spot, change_pct, flip, walls, max pain, net GEX/VEX/DEX/CHARM, regime reads, nearest_wall, shift_summary, plus top_strikes ranked by |net| for the requested lens (gex/vex/dex/charm). Use for 'show me the gamma matrix', 'per-strike GEX on NVDA', 'VEX/DEX/CHARM lens', 'what is the king strike'. NOT the same as get_gex (which reads SPX desk or raw Polygon 0DTE bundle).",
    {
      ...T,
      lens: { type: "string", enum: ["gex", "vex", "dex", "charm"], description: "Matrix lens; default gex." },
      top_strikes: { type: "integer", default: 12, description: "How many top |net| strikes to return." },
    },
    ["ticker"]
  ),

  t(
    "get_gex_matrix_changes",
    "Material strike-level GEX changes since the last heatmap-warm snapshot — answers 'what changed in the matrix', 'is a wall building', 'which strikes moved'. Compares current Thermal cache vs the prior cron snapshot (≥$100 notional threshold). Returns largest_moves with signed gex_change and direction (stronger/weaker/flipped). Use alongside get_gex_regime_events for durable flip/wall-cross history.",
    { ...T, limit: { type: "integer", default: 15 } },
    ["ticker"]
  ),

  t(
    "get_helix_thermal_compare",
    "HELIX flow vs Thermal GEX on ONE ticker — parallel side-by-side bias, premiums, flip, walls, and a non-directional regime interaction. Use for 'flow vs GEX', 'HELIX vs Thermal', or when systems disagree. READING IT — the thermal side is NOT directional: `bias` is 'neutral' for long gamma (mean-reverting) or 'mixed' for short gamma (amplifies moves BOTH ways), with `gamma_posture` and `volatility_regime` carrying the real read; never restate it as bullish or bearish. `regime_interaction.read` is the honest flow-vs-regime line — use it instead of inventing a direction conflict. `conflict: false` is not automatically agreement — read `conflict_note`, which says whether the two sides were compared at all. `net_premium: null` means UNMEASURED, not flat. Flow premiums are summed over `window_hours` (the tape defaults to 48h, so it is NOT just today). TIMING — `as_of` is an ET wall-clock stamp and `session_date` is the ET SESSION (never derive a session from a UTC date); `market_session` says whether the cash session was open; `thermal.freshness` is 'cached' because the gamma read is a cache read, and `thermal.age_seconds` is the MATRIX COMPUTE age, not the age of the price it models; `thermal.matrix_session_date` is the ET session that matrix belongs to.",
    {
      ticker: { type: "string", description: "Ticker (default SPX)." },
    }
  ),

  t(
    "get_thermal_compare",
    "BlackOut Thermal compare strip — side-by-side SPY/SPX/QQQ (or custom tickers) spot, change, flip, call/put walls, net GEX, gamma regime read, and cross_validation divergence. Same preset universe as the /heatmap compare cards. TIMING — read these before quoting a price: `as_of` is an ET wall-clock stamp and `session_date` is the ET SESSION this payload belongs to; never derive a session from a UTC date. `market_session` (OPEN / PRE-MARKET / AFTER-HOURS / CLOSED) and `et_time` describe the wall clock. Each ticker carries `matrix_asof_et` + `matrix_session_date` for WHEN that ticker's matrix was computed, plus `freshness` ('cached' — this is a cache read) and `matrix_age_sec`. IMPORTANT: `matrix_age_sec` is the age of the COMPUTATION, not of the price — a matrix rebuilt 300 seconds ago can be modelling a close that settled hours earlier. Outside OPEN, `spot` is the prior session's close or an extended-hours print, NOT a live quote — say which session a price belongs to rather than presenting it as current. A cold ticker carries `unavailable.reason` instead of a wall of nulls. SCOPE — every number here is a MULTI-EXPIRY AGGREGATE over `expiry_scope` (count + date range), not a single expiry. The /heatmap desk can be scoped to ONE expiry and legitimately show the opposite gamma posture at the same instant, so name the scope you are quoting instead of implying one wall or one flip exists.",
    {
      tickers: {
        type: "array",
        items: { type: "string" },
        description: "Optional ticker list (default SPY, SPX, QQQ).",
      },
    }
  ),

  t(
    "get_wall_dynamics",
    "Dealer wall ladder + build/fade/shift dynamics. SPX: live desk γ-ladder + intel. Single names: full Vector rail — walls, wallEvents (building/fading/new/dissolved/shifted), wallHistory beads, integrity scores. Use for 'are walls building or fading', 'bead trail on NVDA', 'did the put wall shift'. Prefer get_vector_full_state for the complete Vector desk; this is the focused wall-dynamics read.",
    T,
    ["ticker"]
  ),

  t(
    "get_gex_regime_events",
    "BlackOut Thermal's durable log of GEX regime/flip/wall-crossing events — answers 'when did SPY's gamma flip last cross', 'how many times has NVDA's call wall broken today', or 'has the gamma regime flipped this session', which get_positioning/get_gex structurally CANNOT answer: those two only ever return the CURRENT snapshot, with no memory of what changed earlier in the session. Reads gex_regime_events: one row per DISTINCT (ticker, event type + direction) transition (throttled to real state changes, not one row per matrix poll), each carrying event_type (flip_crossed / wall_broken / regime_flipped / net_gex_sign_flipped), severity (warn for destabilizing crosses, info otherwise), the human message, the level crossed (flip/wall strike) when applicable, direction, and the natural from_value/to_value numeric pair for that event type (spot before/after the crossed level for flip_crossed/wall_broken; the gamma-flip level at each end for regime_flipped; net GEX dollars before/after for net_gex_sign_flipped) — null when a type has no single natural pair, never fabricated. Pass `ticker` to scope to one name's transition history, or omit for the most recent transitions across every ticker BlackOut Thermal has computed a fresh matrix for. IMPORTANT — this is a DIFFERENT question from get_positioning/get_gex (current state) and from /api/cron/gex-alerts' live push notifications (which only ever fire for SPY/SPX/QQQ and only for a subset of these same event types) — this tool's history spans EVERY ticker Thermal has touched today and every event type, independent of whether a push was ever sent.",
    { ticker: { type: "string" }, limit: { type: "integer" } }
  ),

  t("get_nighthawk_outcomes", "Night Hawk track record — realized win/loss vs target/stop over a window, plus still-pending plays. Use to cite credibility (e.g. hit-rate over 30d).", {
    window_days: { type: "integer", default: 30 },
  }),

  // Computed server-side (not left to the model) specifically because a comparison
  // between two products is a DERIVED number — see run-tool.ts's dispatch case for
  // why that matters for grounding correctness.
  t(
    "get_spx_vs_nighthawk_comparison",
    "Head-to-head SPX Slayer (0DTE Command intraday plays) vs Night Hawk (evening swing picks) performance over the SAME rolling window: each product's own win rate + signal volume, PLUS a pre-computed win-rate delta and signal-count delta — computed once, server-side, so the model never subtracts two other tools' numbers itself. `days` is a rolling day-count window (not a calendar week), applied identically to both products — same honest-approximation framing as get_trade_history's `days` and get_nighthawk_outcomes' `window_days`. Use this instead of calling get_setup_stats and get_nighthawk_outcomes separately whenever a question directly compares the two products (e.g. 'how's SPX Slayer doing vs Night Hawk this week', 'which is hotter right now').",
    {
      days: {
        type: "integer",
        default: 7,
        description: "Rolling day window applied identically to both products (not a calendar week).",
      },
    }
  ),

  t("get_nighthawk_dossier", "Night Hawk per-ticker research dossier behind a pick (the full scored research) — flow/tech/positioning/news/smart-money/fundamental/short-interest/catalyst sub-scores, fundamental_block, trading_halt. Omit ticker to list dossier tickers for the edition. Works both WHILE tonight's hunt is still building AND the morning after it publishes: live staging is cleared once an edition publishes, so this transparently falls back to the durable nighthawk_scoring_history archive once that happens (response includes `archived: true` when the answer came from the archive rather than live staging) — always the right tool for 'why was ticker X scored/excluded', regardless of when it's asked.", {
    date: { type: "string", description: "Edition date YYYY-MM-DD; defaults to latest." },
    ticker: { type: "string", description: "Ticker to fetch the full dossier for." },
  }),

  t("get_lotto_live", "Current live SPX lotto play (read-only record): phase, direction, strike, entry/target/invalidation, catalysts, confidence."),

  t("get_power_hour", "Current Power Hour (2:45–3:15 PM ET) play (read-only record): phase, direction, strike, levels, status."),

  t("get_catalysts", "Benzinga catalyst pipeline for a ticker — FDA, guidance, M&A, earnings, upgrades, and other event-driven catalysts from confirmed Benzinga channels.", {
    ...T,
    limit: { type: "integer", default: 8 },
  }, ["ticker"]),

  t("get_price_targets", "Benzinga analyst price target for a ticker — most recent PT, action (Maintains/Raises/Lowers), analyst firm, and prior target.", T, ["ticker"]),

  t("get_ah_movers", "Benzinga after-hours movers — tickers moving in the after-hours session with catalyst context from the Benzinga after-hours center channel.", {
    limit: { type: "integer", default: 15 },
  }),

  t(
    "get_ecosystem_context",
    "BIE cross-instrument snapshot for ONE ticker: today's 0DTE Command take (if any), the most recent PUBLISHED Night Hawk take (a rejected play never appears here — check recent_audit_entries for an 'nighthawk_rejected' alert_type instead), the last 10 alert_audit_log entries, a same-day HELIX flow summary (print count + call/put premium totals over the last 6h — reported neutrally, never as a single bullish/bearish label), flow_full_state (HELIX's ENTIRE flow-tape snapshot for this ticker — the exact same object get_flow_tape returns: count, total_premium, top_tickers, strike_stacks, and the full recent print list, EACH print additionally carrying gex_proximity ('at_gamma_flip'/'at_call_wall'/'at_put_wall'/'near_call_wall'/'near_put_wall') from the same GEX enrichment the live /flows member page applies; null when there's no flow for this ticker in-window — use this instead of a separate get_flow_tape call when you already need this ticker's other ecosystem context too, and prefer it over recent_flow whenever you need the actual prints/strikes/GEX proximity rather than just the premium totals), any pattern-detected flow anomalies in the last 24h (coordinated sweeps, premium spikes, put surges, concentration), spx_play (SPX/SPXW only — SPX Slayer's own current open play and most recently closed play, null for every other ticker), spx_full_state (SPX/SPXW only — SPX Slayer's ENTIRE live play-engine snapshot, the exact same object get_spx_play returns: phase, every confluence factor with its weight/detail, full gate pass/fail state, the 10-item confirmation checklist, MTF/RSI/EMA technicals, adaptive-gate telemetry, watch state, the AI arbiter's verdict, the option ticket; null for every other ticker — use this instead of a separate get_spx_play call when you already need this ticker's other ecosystem context too), vector_full_state (Vector's ENTIRE live desk for this ticker — same object get_vector_full_state returns: walls, flip, beads/wallHistory, wallEvents, ladder, heatmap summary, technicals, VEX, dark pool, play; null when no live spot), gex_positioning (BlackOut Thermal's canonical dealer positioning for this ticker — the exact same object get_positioning's underlying getGexPositioning() call reads: spot, gamma flip, call_wall/put_wall, max_pain, gex_king_strike, net GEX/VEX/DEX/CHARM each with a posture + one-line regime read, nearest_wall (closer of the two walls, with signed point distance), distance_to_flip_pct, and an optional UW cross-validation check on the primary levels; runs for EVERY ticker, not gated to SPX/SPXW, since GEX positioning is not a single-instrument product; null when the shared GEX matrix is cold for this ticker — use this instead of a separate get_positioning call when you already need this ticker's other ecosystem context too), arsenal (relevance-gated earnings date, fundamentals snippet, peer RS, news headlines, macro events — the cross-product research block), and flow_feed_fresh (is the live flow pipeline actually up right now). IMPORTANT: if flow_feed_fresh is false, a null/empty recent_flow, flow_full_state, or recent_anomalies means 'we can't currently see,' NOT 'genuinely quiet' — say so rather than reporting silence as a finding. Use when a question needs 'what does the rest of the desk already think about this name' rather than a single tool's isolated view — e.g. confirming whether today's 0DTE flag and last night's Night Hawk pick agree or conflict, whether unusual options flow has been building on the name (including exactly which strikes/prints and whether they sit near a GEX wall), whether dealer gamma positioning favors a squeeze or pin, whether Vector walls are building/fading, or (for SPX/SPXW) whether SPX Slayer already has a live play on and its full reasoning behind it.",
    T,
    ["ticker"]
  ),

  t(
    "call_internal_api",
    "Read ANY of BlackOut's own internal READ endpoints for live platform data — the universal read-access tool. GOVERNED + READ-ONLY: only GET requests to routes the route-registry marks class:'read' are served (market quote/indices/news/heatmap/gex-positioning/dark-pool/flows/regime, the full SPX desk read family, the full Vector read family, Night Hawk edition, platform snapshot/intel, track record, health). Anything else is HARD-DENIED: any non-GET verb, any admin/cron/auth/webhook/push/membership/engine route, and every LLM-cost route (largo/query, spx/commentary, nighthawk/hunt) — the tool will refuse them, it cannot mutate, authenticate, spend, or reach a webhook. Pass `path` (e.g. '/api/market/gex-positioning') and optional `params` (query params object). Use when a question needs a specific platform surface not already covered by a dedicated tool; prefer the dedicated tool (get_ecosystem_context, get_vector_full_state, get_flow_tape, …) when one exists.",
    {
      path: { type: "string", description: "Internal API path, e.g. /api/market/gex-positioning. Must be a GET, class:read route." },
      params: { type: "object", description: "Optional query params, e.g. {\"ticker\":\"NVDA\",\"dte\":\"all\"}." },
    },
    ["path"]
  ),

  t(
    "get_uw",
    "Read a live Unusual Whales DATA endpoint directly (GET, read-only) — for UW data not already wrapped by a dedicated tool. Pass `endpoint` (a UW API path, e.g. '/api/darkpool/NVDA' or '/api/stock/NVDA/greek-exposure') and optional `params`. GOVERNED: only allowlisted read-data paths (stock/darkpool/option-trades/market/gex/greek/flow/etf/congress/insider/screener/…) are served; absolute URLs, traversal, and off-allowlist paths are refused. Goes through UW's own rate limiter + circuit breaker + cache (never bypassed). Prefer a dedicated tool (get_options_flow, get_dark_pool, get_gex, …) when one covers the need; use this for the long tail.",
    {
      endpoint: { type: "string", description: "UW API path, e.g. /api/darkpool/NVDA" },
      params: { type: "object", description: "Optional query params object." },
    },
    ["endpoint"]
  ),

  t(
    "get_polygon",
    "Read a live Polygon/Massive DATA endpoint directly (GET, read-only) — for Polygon data not already wrapped by a dedicated tool. Pass `endpoint` (a Polygon REST path, e.g. '/v2/aggs/ticker/AAPL/range/1/day/2026-07-01/2026-07-10' or '/v3/reference/tickers') and optional `params` (apiKey is injected automatically). GOVERNED: only versioned data namespaces (/v1../v2../v3../vX, /snapshot, /reference, /aggs, /marketstatus) are served; absolute URLs and traversal are refused. Goes through Polygon's own rate limiter (polygonTrackedFetch), never bypassed. Prefer a dedicated tool (get_quote, get_technicals, get_uw_bars, …) when one covers the need.",
    {
      endpoint: { type: "string", description: "Polygon REST path, e.g. /v3/reference/tickers" },
      params: { type: "object", description: "Optional query params object (apiKey added automatically)." },
    },
    ["endpoint"]
  ),

  t(
    "get_cross_product_read",
    "CROSS-PRODUCT read for one ticker — the ONLY tool that answers questions spanning several BLACKOUT products at once: \"where do Helix and Vector disagree\", \"what matters right now on SPX\", \"do the products agree\". Fans out to Helix (tape), Thermal (dealer gamma), Vector (differential pulse), Meridian (earnings/catalyst) and Night Hawk (committed plays), then JOINS their readings. Returns `verdict` (aligned | split | insufficient), `camps` (each direction with the products holding it and their evidence), `reporting`, `missing` (every product that did NOT report, each with a specific reason), `coverage` (e.g. \"2/5 products reporting\") and `reading_note`. RULES: when `verdict` is `split` the products GENUINELY DISAGREE — report BOTH readings with their evidence and do NOT resolve it, pick a side, or present the larger camp as the answer; the disagreement is the finding. When `aligned`, always state the coverage, because agreement among two products is not agreement among five. When `insufficient`, say so rather than presenting one product's read as a cross-product conclusion. Thermal deliberately casts NO directional vote — dealer gamma is not a directional measurement (short gamma amplifies moves in BOTH directions), so it appears in `missing` with its posture and volatility regime in the reason. `session_date` is the ET session this read is scored against.",
    { ...T },
    ["ticker"]
  ),

  t(
    "get_vector_pulse",
    "Vector PULSE for a ticker — the live signal rail the Vector desk streams, NOT another static snapshot. Pulse is DIFFERENTIAL: each signal exists because this Vector state differs from the previous one, so this is the tool that answers 'what just CHANGED', 'what is the pulse saying on NVDA', 'did the regime flip', 'is a new wall forming', 'did the magnet move' — questions get_vector_full_state structurally cannot answer because it only ever describes the CURRENT state with no memory of the one before it. Returns the real PulseSignal rows the panel renders (kind: play-state / regime-flip / proximity / magnet-shift / integrity / wall-structure / flow-print; tone; severity tier 1-3 where tier 1 is regime-defining; the signal line, its anchored level, quantified magnitudes, the trade implication and the one-line WHY), plus the recent wall-dynamics events and the bead-sample count behind them. `has_baseline` is FALSE on the first read of a session — there is no previous snapshot to diff against, so an empty signal list then means 'no baseline yet', NOT 'the tape is quiet'; say which one it is rather than reporting silence as a finding. `is_new_observation` is the SECOND way an empty list can be uninformative and is easy to miss: the underlying VECTOR STATE is served from a 15-minute cache, so two asks inside that window receive the SAME snapshot and the walls/regime/magnet diff is taken against an identical observation — when `is_new_observation` is FALSE, zero signals means 'the Vector state has not been re-measured since your last answer', NOT 'structure is stable', and `baseline_observed_at` will equal `observed_at`. It is scoped to the Vector state deliberately: this tool ALSO fetches live options flow (and, on SPX, the play engine) on every call, so those genuinely were re-measured even when the state was not. `is_new_observation` is NULL when `freshness` is 'unknown' — the age cannot be established, so neither can the claim. Only report a quiet tape when `has_baseline` is true AND `is_new_observation` is true. Freshness travels with every read: `observed_at` is when the Vector state was MEASURED (an ISO instant), `as_of` is when this tool READ it as an ET stamp, `session_date` is the ET session of that read, `age_seconds` is the gap, and `freshness` is live/recent/stale/unknown — a 'stale' read must be disclosed rather than presented as the current tape (`note` carries the wording). horizon is 0dte/weekly/monthly/all (default all).",
    { ...T, horizon: { type: "string", enum: ["0dte", "weekly", "monthly", "all"], description: "DTE horizon; defaults to 'all'." } },
    ["ticker"]
  ),

  t(
    "get_vector_full_state",

    "Vector's OWN complete live desk state for a ticker + DTE horizon — the exact same object the Vector chart's desk terminal reads and get_ecosystem_context returns as its vector_full_state field (via fetchVectorFullState). Hands you Vector's ENTIRE surface in one call: spot, gamma regime (long/short/transition), gamma walls (call/put, ranked) + per-wall INTEGRITY (firm/moderate/thin, held-% of session), gamma flip, the gamma magnet (pin vs pivot), wall-proximity, the options-implied expected move (±1σ/±2σ bands), max pain, confluence zones, the derived concrete PLAY (buildVectorPlay — style/bias/entry/targets/invalidation/conviction/grade), the full per-strike GEX ladder (king strikes + magnitudes), a compact heatmap-presence summary, options-flow prints, the wall-history RAIL (the 'beads' over the session) + its dynamics events (building/fading/new/dissolved/shifted — the 'fadeness'), the VANNA (VEX) lens (walls + zero-vanna flip), dark-pool levels, and server-computed chart technicals (VWAP/EMA stack/RSI/MACD/structure). horizon is one of 0dte/weekly/monthly/all (default all). NO LIVE STATE: when there is no live spot this returns `{ available: false, reason: 'no_live_vector_state', detail }` rather than null — the market may be closed, the symbol may not be optionable, or the shared GEX matrix may be cold for it, and this read CANNOT tell those apart. Say the desk cannot read it right now; never report it as the ticker having no levels. ABSENCE IS NOT EMPTINESS: every section here fails open, so read `unavailable_sections` — it names each section that was not present on this read (gex_walls / gamma_flip / max_pain / expected_move / ladder / heatmap / technicals / flow_markers / vex_walls / dark_pool_levels / wall_history / play). A named section means 'we could not read it on this pass', which does NOT establish that the ticker has no such level — an upstream that could not be reached and a genuinely empty result are indistinguishable at this layer, so say the section was unavailable rather than asserting the level does not exist (`absence_note` carries the wording). `wall_history_empty_reason` is the one absence with a real reason attached: 'outside_rth_no_recording_yet' means the bead rail simply has not been recorded yet because the snapshot predates the open — that is the recorder working as designed and must never be reported as missing data — while 'no_samples_during_rth' is a genuine intraday gap worth flagging. FRESHNESS: this state is served from a cache that can be up to 15 minutes old, so every read carries `observed_at` (when the state was MEASURED, an ISO instant), `as_of` (when this tool READ it, as an ET stamp), `session_date` (the ET session of that read), `age_seconds`, and `freshness` (live/recent/stale/unknown) — check `freshness` before describing the numbers as the current tape, and when it is 'stale' say how old the read is rather than answering in the present tense (`note` carries the wording). The warming cron is RTH-gated and covers only the ~55 allowlist names, so off-hours reads and less-liquid tickers are the ones most likely to come back stale. Use for ANY question about what Vector shows for a ticker — 'what's the Vector setup / regime / play on NVDA', 'are the walls building or fading', 'where's the gamma flip and magnet', 'what's the expected move' — the deterministic Vector read, zero Claude cost. Runs for any optionable symbol.",
    { ...T, horizon: { type: "string", enum: ["0dte", "weekly", "monthly", "all"], description: "DTE horizon; defaults to 'all'." } },
    ["ticker"]
  ),

  t(
    "get_vector_analytics",
    "Vector's CHART ANALYTICS — the nine panels the Vector desk computes from the drawn candles and the universe sweep rather than from the wall/GEX state, and which get_vector_full_state therefore structurally cannot answer. Use for 'where is the point of control / value area on NVDA', 'did SPX break structure', 'is this a BOS or a CHoCH', 'where is the golden pocket', 'what are today's floor pivots / opening range / HOD-LOD', 'when is the next OpEx', 'which names are nearest their gamma flip', 'how does NVDA compare to its peers'. Returns: volume_profile (POC, ~70% value-area high/low, heaviest buckets — computed on the 1m bars exactly as the chart does; total_volume 0 with empty_reason='no_volume_on_bars' means volume was unavailable, NOT a session with no trading); market_structure (fractal pivots labelled HH/LH/HL/LL and the BOS/CHoCH breaks between them — BOS is continuation, CHOCH is a character change, never conflate them; latest_event is the live one). EVERY pivot and event carries `et` (a full ET timestamp) and `session_date` ALONGSIDE the raw `time` — use those, never the bare epoch: this panel is built from a THREE-SESSION bar seed, so its events routinely span several days, and dating them all as 'today' is the mistake the anchor exists to prevent (`time` is epoch SECONDS, not milliseconds); fib_swing (the DOMINANT swing of the displayed window with 38.2/50/61.8/78.6 retracements and the 61.8-65% golden-pocket ZONE — null with fib_swing_empty_reason='no_swing_above_min_range' when nothing cleared the chart's 0.15%-of-price floor, which means no swing exists, not that none was sought); key_levels (HOD/LOD, opening range at the member's configured window, session fib, prior-day PDH/PDL/PDC and classic floor pivots P/R1-R3/S1-S3 — the prior-day and pivot groups are EMPTY with prior_session_ohlc null when only one session was seeded, because pivots off a partial prior day would be confidently wrong); opex (next monthly expiry, next QUARTERLY 'triple witching', and days_away — 0 means today); daily_regime (end-of-session gamma flip + primary walls per recorded session, SHORT-RANGE by design at ~15-day retention — always state the `coverage` window rather than implying long history); screener (the three curated desk presets nearest-flip / most-pinned / most-explosive over the universe snapshot, with updated_at — a scanner list is only as current as the sweep behind it); ticker_comparison (the active name vs its peers by regime, flip distance and wall strength); and coaching (SPX-ONLY live desk alerts; coaching_scope says 'not_applicable_non_spx' for every other ticker, and an empty alert list means the SPX session window was closed or nothing triggered, NOT all-clear). Read `unavailable_sections`: a named section could not be read, which is a different answer from a section that is genuinely empty. TIME: `as_of` is a UTC instant but almost everything here is SESSION-scoped (opening range, HOD/LOD, prior-day pivots, OpEx day count, per-session daily_regime), so use `as_of_et` and `session_date` — after ~20:00 ET the UTC date is already tomorrow and resolving 'today' from `as_of` lands a session ahead of the data. The screener carries `updated_at_et` / `updated_at_session_date` for the same reason. Complements, does not replace, get_vector_full_state (walls/flip/magnet/beads/play/technicals) and get_vector_pulse (what just CHANGED).",
    {
      ...T,
      timeframe_min: { type: "integer", description: "Chart timeframe for structure/levels/auto-fib. Default 5." },
      opening_range_minutes: { type: "integer", description: "Opening-range window. Default 15 (the product default)." },
      regime_days: { type: "integer", description: "Sessions of dealer-regime history, 1-30. Default 15." },
    },
    ["ticker"]
  ),

  t(
    "get_hot_tickers",
    "Leaderboard of single-name tickers with the most options-flow premium over the last 6h (print count + total premium each). Index/ETF and leveraged-ETP names are excluded so SPY/QQQ don't just occupy every slot. Use for open-ended 'what's hot / what's moving / any unusual flow today' questions that don't name a specific ticker — for a question ABOUT one ticker, use get_ecosystem_context or get_flow_tape instead."
  ),

  t(
    "get_market_regime",
    "Market-wide backdrop, not ticker-specific and NOT SPX Slayer's own play-engine state: composite regime (BREAKOUT_BULL/BREAKDOWN_BEAR/RANGE_BOUND/MIXED), GEX regime, flow regime, the suggested playbook, net GEX, above/below VWAP, IV percentile, count of critical flow anomalies in the last hour (+ which tickers), and the premarket brief's call/put walls. This is the SAME data Night Hawk's own scoring already reads internally (src/lib/nighthawk/platform-intel-snapshot.ts) — use for 'what's the market regime / what's the backdrop / is this a good environment for X' questions. Does NOT cover SPX Slayer's own phase/gates/score/confluence for its current or most recent play — for that, use get_spx_play (or get_ecosystem_context's spx_full_state field). This anomaly count only ever includes anomalies that actually FIRED — for a candidate that didn't clear the anomaly threshold (or fired but got dedup-suppressed), use get_flow_anomaly_near_misses instead."
  ),

  t(
    "get_flow_anomaly_near_misses",
    "HELIX's near-miss/rejection log for its market-wide flow-anomaly detector (src/app/api/cron/market-regime-detector's 5-min RTH cron) — answers 'why didn't ticker X get flagged as an anomaly' or 'what has HELIX's anomaly scan been passing over today', which NEITHER of the two existing anomaly-reading surfaces can answer: get_ecosystem_context's `recent_anomalies` field and get_market_regime's critical-anomaly count BOTH only ever read the flow_anomalies table, which the live detector writes to ONLY once a candidate clears a hard threshold — a $2M+ single option print (LARGE_PREMIUM_PRINT) or a 10:1+ call/put premium skew on $500k+ total volume (DIRECTIONAL_FLOW_SKEW). A candidate that fell short — a $1.8M print, an 8:1 skew — is invisible in both of those and left no trace anywhere until this tool existed. Reads flow_anomaly_near_misses: one row per (ticker, anomaly_type) pair per DISTINCT near-miss state (throttled to state transitions, not one row per cron tick), each row naming the `anomaly_type`, the `reason` it never reached flow_anomalies — 'BELOW_THRESHOLD' (the metric itself never cleared the hard threshold; only genuinely close calls are captured, at least half-way to the real threshold, not every sub-threshold value) vs. 'DEDUP_SUPPRESSED' (the candidate DID clear its threshold this tick, but a matching anomaly was already logged for the same ticker+type within the last 15 minutes, so the write was skipped — a structurally different, later-pipeline-stage reason, never conflated with BELOW_THRESHOLD) — the live `metric_value` and `threshold` it was measured against (a dollar amount for LARGE_PREMIUM_PRINT, a ratio for DIRECTIONAL_FLOW_SKEW — do not confuse with `premium`, which is always a dollar total), `direction`, and (for DEDUP_SUPPRESSED only — a BELOW_THRESHOLD candidate never reaches the point where the live detector assigns one) `severity`. Pass `ticker` to scope to one name's near-miss history, or omit for the most recent near-misses across every candidate. IMPORTANT — this is a DIFFERENT question from get_ecosystem_context's `recent_anomalies` and get_market_regime's anomaly count (both committed-only, i.e. anomalies that DID fire) and from get_zerodte_rejections (0DTE Command's OWN separate multi-ticker scanner, a completely different engine and threshold set) — only reach for this tool when the question is specifically about why HELIX's flow-anomaly detector did NOT flag something.",
    { ticker: { type: "string" }, limit: { type: "integer" } }
  ),

  t(
    "get_confluence_outcomes",
    "Platform-wide, not ticker-specific: does agreeing across instruments/factors actually correlate with a different hit rate? Two sections, both evidence-gated (a bucket under 10 samples is flagged insufficient_sample — treat its numbers as noise, not signal, and say so if asked). `zerodte_nighthawk_echo`: over the last 60 days of GRADED 0DTE Command flags, buckets agree / disagree / no_echo (no prior Night Hawk take at all) by hit rate % and average move %. `spx_slayer_shadow_factors`: SPX Slayer's shadow-mode confluence factors (risk-reversal skew, realized-vs-implied vol, flow anomalies, mega-cap catalysts, ecosystem cross-instrument agreement, macro-prediction consensus — see spx_confluence_shadow_observations) correlated against SPX Slayer's own real graded trade outcomes, bucketed per factor_name by agree / disagree / neutral with win rate % and average P&L in points; a factor_name with no bucket yet reaching 10 samples has not earned a live-scoring opinion. Use for 'does it help when the instruments agree / is confluence real / how reliable is X / is [shadow factor] worth promoting' meta-questions about the platform's own track record, not for a single play's own grade (use get_zerodte_plays, get_nighthawk_outcomes, or get_spx_play for that)."
  ),

  t(
    "get_similar_precedents",
    "Semantic search over the platform's own history of RESOLVED alerts (0DTE Command + Night Hawk, published and rejected) — 'has a setup like this happened before, and what happened.' Pass a short natural-language description of the CURRENT situation (e.g. 'NVDA 0DTE long setup, high conviction, aggression spike') as `query`; returns the most similar past alerts with their outcome, ranked by similarity. This is pattern-matching on the platform's own track record, not a live signal — a returned precedent is historical color for a member's question, never a reason to change a live gate or score. Empty results mean either no similar precedent exists yet or the corpus hasn't accumulated enough graded history — say so rather than implying 'never happened before.'",
    { query: { type: "string", description: "Natural-language description of the current setup to find precedents for." } },
    ["query"]
  ),

];

// The BIE-authored subset of Largo's tool surface — single source of truth so
// TOOL_GROUPS.platform below and knowledge.ts's generated capabilities doc
// (ingestBieKnowledge) both read the same list. Add a new BIE tool here once;
// both consumers pick it up automatically instead of needing a second edit.
export const BIE_TOOL_NAMES = [
  "get_ecosystem_context",
  "call_internal_api",
  "get_uw",
  "get_polygon",
  "get_vector_full_state",
  "get_hot_tickers",
  "get_market_regime",
  "get_confluence_outcomes",
  "get_similar_precedents",
];

export const TOOL_GROUPS = {
  spx_desk: [
    "get_spx_structure",
    "get_spx_play",
    "get_open_plays",
    "get_flow_tape",
    "get_signal_log",
    "get_spx_engine_snapshots",
    "get_lotto_state",
    "get_setup_stats",
    "get_trade_history",
    "get_greek_flow",
    "get_gex",
    "get_gex_regime_events",
    "get_group_greek_flow",
    // cross-tool desk objects newly surfaced to Largo
    "get_spx_confluence",
    "get_lotto_live",
    "get_power_hour",
    "get_spx_pin",
    "get_spx_pulse",
  ],
  flow_analysis: [
    "get_options_flow",
    "get_global_flow",
    "get_dark_pool",
    "get_nope",
    "get_flow_per_strike",
    "get_flow_expiry_breakdown",
    "get_net_prem_ticks",
    "get_postgres_flows",
    "get_lit_flow",
    "get_unusual_trades",
    // previously orphaned (in no group → uncallable) — LARGO-9
    "get_market_oi_change",
    "get_etf_flow",
    "get_market_stats",
    "get_option_contract",
    "get_helix_signal_outcomes",
    "get_flow_brief",
    "get_helix_tape_analytics",
    "get_helix_derived",
  ],
  stock_analysis: [
    "get_quote",
    "get_technicals",
    "get_gex",
    "get_greek_flow",
    "get_options_chain",
    "get_oi_per_strike",
    "get_max_pain",
    "get_greeks",
    "get_atm_chains",
    "get_options_volume",
    "get_peer_rs",
    "get_short_interest",
    "get_nbbo",
    "get_positioning",
    "get_gex_heatmap",
    "get_gex_matrix_changes",
    "get_thermal_compare",
    "get_wall_dynamics",
    "get_gex_regime_events",
    // previously orphaned — LARGO-9
    "get_seasonality",
    "get_qqq_relative_strength",
    "get_oi_per_expiry",
    "get_short_data",
    "get_stock_state",
    "get_uw_bars",
    "get_uw_technicals",
    "search_ticker",
    "get_option_price_history",
  ],
  vol_analysis: [
    "get_iv_stats",
    "get_iv_term_structure",
    "get_volatility_regime",
    "get_vix_term",
    "get_market_context",
    // previously orphaned — LARGO-9
    "get_realized_vol",
    "get_risk_reversal_skew",
  ],
  news_events: [
    "get_news",
    "get_web_search",
    "get_earnings",
    "get_economic_calendar",
    "get_macro_indicator",
    "get_earnings_market",
    "get_earnings_calendar",
    "get_fda_calendar",
    "get_ipo_calendar",
    "get_catalysts",
    "get_price_targets",
    "get_ah_movers",
  ],
  fundamental: [
    "get_analyst_ratings",
    "get_financials",
    "get_insider_flow",
    "get_congress_trades",
    "get_congress_unusual",
    "get_institutional",
    "get_predictions_consensus",
    "get_company_profile",
    "get_earnings_history",
    "get_dividends",
    // previously orphaned — LARGO-9
    "get_ownership",
  ],
  platform: [
    "get_platform_snapshot",
    "get_zerodte_plays",
    "get_zerodte_rejections",
    "get_zerodte_record",
    "get_banger_board",
    "get_swing_horizon",
    "get_nighthawk_horizons",
    "get_horizon_outcomes",
    "get_nighthawk_edition",
    // cross-tool Night Hawk objects newly surfaced to Largo
    "get_nighthawk_outcomes",
    "get_nighthawk_dossier",
    // Cross-product comparison — routed here (not spx_desk) so it's reachable
    // whenever NIGHTHAWK_RE fires, same as the two tools above it.
    "get_spx_vs_nighthawk_comparison",
    // The BIE-authored tools (ecosystem-context, hot-tickers, market-regime,
    // confluence-outcomes) — see BIE_TOOL_NAMES above for the canonical list.
    ...BIE_TOOL_NAMES,
    // HELIX flow-anomaly near-miss/rejection log (task #131) — reads the same
    // market-regime-detector cron's output as get_market_regime above, so it
    // lives right alongside it here rather than in BIE_TOOL_NAMES (which is
    // reserved for the BIE-authored cross-instrument snapshot family).
    "get_flow_anomaly_near_misses",
  ],
  screener: [
    "get_screener",
    "get_market_movers",
    "get_market_breadth",
    "get_sector_flow",
    "get_top_net_impact",
    // previously orphaned — LARGO-9
    "get_etf_detail",
  ],
} as const;

// Task #112 — the cohort-membership test for "did this Largo turn touch SPX
// Slayer's OWN live-engine state" (BIE's self-eval loop, calibration.ts). This is
// deliberately a NARROWER list than TOOL_GROUPS.spx_desk above: spx_desk is a
// *routing* bundle (every tool Largo should have on hand when a question smells
// SPX-flavored, per getToolsForIntent below), so it also carries generic,
// ticker-agnostic market-data tools that are bundled in purely for convenience —
// get_flow_tape, get_greek_flow, get_gex, get_group_greek_flow all take a
// `ticker`/`group` input and hit the same generic UW/Polygon providers
// run-tool.ts uses for ANY ticker (get_greek_flow/get_gex are even shared with
// TOOL_GROUPS.stock_analysis). A turn that only called those tells you nothing
// about SPX-Slayer-engine-state answer quality specifically — it could just as
// easily have been an AAPL flow question. This list keeps only the tools whose
// run-tool.ts implementation reads the engine's own state — `marketPlatform.spx.*`
// (getSpxDeskSummary/getSpxPlayState/getSpxOpenPlay/getSpxSignalLog/
// getSpxLottoState/getSpxSetupStats/getSpxTradeHistory) or pure compute over the
// already-cached live desk / the engine's own lotto/power-hour evaluator output
// (get_spx_confluence, get_lotto_live, get_power_hour) — verified against
// run-tool.ts's case statements, not guessed from naming. Deliberately excludes
// get_ecosystem_context (in BIE_TOOL_NAMES/TOOL_GROUPS.platform): it's a
// cross-product tool callable for ANY ticker, and bie_interactions.tools_used only
// records tool NAMES, never call inputs — there is no way to tell from a
// bie_interactions row alone whether a given get_ecosystem_context call was
// scoped to SPX or to some other ticker, so including it would silently admit
// unrelated cross-product lookups into an "SPX engine state" cohort. Kept as an
// explicit literal list (not derived from TOOL_GROUPS.spx_desk) so this cohort
// tracks "did Largo read the engine's own state" and does not silently
// widen/narrow if spx_desk's bundle composition changes for unrelated
// (system-prompt-routing) reasons — see tool-defs.test.ts for the assertion that
// keeps this list a verified subset of spx_desk.
export const SPX_ENGINE_TOOL_NAMES = [
  "get_spx_structure",
  "get_spx_play",
  "get_open_plays",
  "get_signal_log",
  // get_spx_engine_snapshots (task #108, merged alongside this cohort list) reads the
  // exact same engine-state stream as get_signal_log — the throttled, gate-rejection-
  // inclusive snapshot log rather than the committed-only one — so it belongs in this
  // cohort for the same reason get_signal_log does.
  "get_spx_engine_snapshots",
  "get_lotto_state",
  "get_lotto_live",
  "get_setup_stats",
  "get_trade_history",
  "get_spx_confluence",
  "get_power_hour",
];

// Task #133 — the cohort-membership test for "did this Largo turn touch HELIX's
// OWN persisted/computed state" (BIE's self-eval loop, calibration.ts), the same
// pattern SPX_ENGINE_TOOL_NAMES established above for SPX Slayer. HELIX is the
// market-wide options-flow product behind `/flows` — its own engine state is (1)
// the ingested flow tape itself (Postgres `flow_alerts`, what the /flows page
// renders) and (2) the market-regime-detector cron's near-miss/rejection log
// (`flow_anomaly_near_misses`, task #131). Verified against run-tool.ts's case
// statements, not guessed from naming:
//   - get_flow_tape → marketPlatform.flows.getFlowTapeSummary() → fetchRecentFlows()
//     (src/lib/platform/flow-service.ts, src/lib/db.ts) — reads the ingested tape
//     from Postgres and returns HELIX's own aggregate view (count, total_premium,
//     top_tickers, recent prints). This exact return shape is independently
//     branded "HELIX's ENTIRE flow-tape snapshot" in get_ecosystem_context's own
//     description (its `flow_full_state` field documents "the exact same object
//     get_flow_tape returns") — confirming this is treated elsewhere in the
//     codebase as HELIX's canonical state object, not a generic per-ticker proxy.
//   - get_flow_anomaly_near_misses → flowAnomalyNearMissesForLargo() →
//     fetchFlowAnomalyNearMisses() (src/lib/platform/flow-anomaly-near-misses.ts,
//     src/lib/db.ts) — reads flow_anomaly_near_misses, the anomaly detector's own
//     throttled near-miss/rejection log. Nothing else reads this table.
// Deliberately EXCLUDED, verified against the same case statements: every other
// TOOL_GROUPS.flow_analysis tool (get_options_flow, get_global_flow, get_dark_pool,
// get_nope, get_flow_per_strike, get_flow_expiry_breakdown, get_net_prem_ticks,
// get_lit_flow, get_unusual_trades, get_market_oi_change, get_etf_flow,
// get_market_stats, get_option_contract) hits generic ticker-scoped UW/Polygon
// providers (fetchUw*) usable for ANY ticker — the same reasoning
// SPX_ENGINE_TOOL_NAMES's own doc comment gives for excluding get_greek_flow/
// get_gex from that list. get_postgres_flows is the one close call: it calls
// marketPlatform.flows.getFlowTape() (the SAME fetchRecentFlows() table
// get_flow_tape reads), but returns the raw ingested rows with no HELIX-specific
// aggregation/branding — unlike get_flow_tape, nothing else in the codebase
// treats get_postgres_flows's return shape as HELIX's canonical object, so it's
// left out to keep this list to the two tools that are unambiguously "read
// HELIX's own state," not "happen to touch the same table." Also excluded, same
// reasoning SPX_ENGINE_TOOL_NAMES gives for excluding get_ecosystem_context: the
// BIE-authored cross-product tools (get_hot_tickers, get_market_regime, and the
// rest of BIE_TOOL_NAMES) and get_platform_snapshot are callable for ANY ticker
// or span multiple products at once, and bie_interactions.tools_used records
// only tool NAMES, never call inputs — a turn that called get_market_regime (an
// explicitly "market-wide backdrop, not ticker-specific" tool per its own
// description) tells you nothing about HELIX-tape/anomaly-detector answer
// quality specifically. Kept as an explicit literal list (not derived from
// TOOL_GROUPS.spx_desk/flow_analysis/platform) for the same drift-resistance
// reason SPX_ENGINE_TOOL_NAMES is — see tool-defs.test.ts for the assertion
// that keeps this list a verified subset of spx_desk ∪ flow_analysis ∪ platform.
// (get_flow_tape itself lives in spx_desk, bundled there for SPX-flavored
// routing convenience per SPX_ENGINE_TOOL_NAMES's own comment above, not in
// flow_analysis; get_flow_anomaly_near_misses lives in platform.)
export const HELIX_ENGINE_TOOL_NAMES = [
  "get_flow_tape",
  "get_flow_brief",
  "get_helix_tape_analytics",
  "get_helix_derived",
  "get_flow_anomaly_near_misses",
];

// Task #137 — the cohort-membership test for "did this Largo turn touch BlackOut
// Thermal's OWN computed/cached dealer-positioning state" (BIE's self-eval loop,
// calibration.ts), same purpose as SPX_ENGINE_TOOL_NAMES above but for Thermal
// (the GEX/gamma/dealer-positioning product behind /heatmap) instead of SPX Slayer.
//
// Verified against run-tool.ts's case statements, not guessed from naming — and
// the naming trap here is real, so read carefully before "fixing" this list:
//   - get_positioning (case "get_positioning" → fetchPositioningSummary,
//     src/lib/nighthawk/positioning.ts): PRIMARY path calls getGexPositioning(sym)
//     (src/lib/providers/gex-positioning.ts), which is a strict CACHE-READER over
//     fetchGexHeatmap's shared `gex-heatmap:{ticker}` matrix — that file's own doc
//     comment calls it "the ONE source every other tool/service/AI surface consumes
//     for the Heat Maps dealer-positioning data." This is exactly Thermal's own
//     engine state (spot, gamma flip, call/put walls, max pain, GEX king strike,
//     net GEX/VEX/DEX/CHARM). INCLUDED.
//   - get_gex_regime_events (case "get_gex_regime_events" → gexRegimeEventsForLargo,
//     src/lib/providers/gex-regime-events.ts): reads gex_regime_events, task #136's
//     durable Postgres log of flip/wall/regime transitions — persisted directly off
//     computeGexEvents()' diff of Thermal's own fetchGexHeatmap matrix (see that
//     file's header comment: "ONE DERIVATION, NOT TWO... every call site passes in
//     the EXACT GexEvent[] array computeGexEvents() already produced"). This is
//     Thermal's own transition HISTORY, the durable analogue of the CURRENT-state
//     snapshot get_positioning returns. INCLUDED. (Note: tool-defs.test.ts already
//     asserts this name is NOT part of SPX_ENGINE_TOOL_NAMES, for the unrelated
//     reason that it's ticker-generic rather than SPX-Slayer-engine-specific — that
//     exclusion says nothing about Thermal-specificity, which is the only axis this
//     list cares about.)
//   - get_gex (case "get_gex"): despite the name — and despite this being "the GEX
//     product" — this tool's implementation does NOT read fetchGexHeatmap or
//     getGexPositioning at all. For SPX/I:SPX at today's expiry it reads
//     getLargoSpxLiveDesk(userId), i.e. SPX SLAYER's own live desk (SPX_ENGINE_TOOL_
//     NAMES' territory, not Thermal's). For every other case it calls
//     fetchPolygonOdteGexRows → fetchPolygonOdteDeskBundle, a THIRD, separate,
//     spot-keyed (no ticker parameter at all) cache — the 0DTE desk bundle, not the
//     per-ticker Thermal heatmap matrix — or, failing that, raw ad hoc Unusual
//     Whales spot-exposure/gex-level calls. None of get_gex's three branches ever
//     touch Thermal's canonical cache. EXCLUDED — the same "too generic, verified
//     via the case body" reasoning SPX_ENGINE_TOOL_NAMES's own comment gives for
//     excluding get_gex from ITS list, just landing on the identical conclusion for
//     a different, Thermal-specific reason: it doesn't read Thermal's state either.
//   - get_options_chain / get_oi_per_strike / get_max_pain / get_greeks /
//     get_atm_chains / get_options_volume (all TOOL_GROUPS.stock_analysis): each
//     one independently fetches+computes over a raw polygonChainBundle() chain for
//     whatever ticker/expiry was asked, with no read of the shared heatmap cache —
//     generic per-ticker options-chain shape, not a Thermal-positioning-specific
//     read. EXCLUDED.
//   - get_ecosystem_context (BIE_TOOL_NAMES/TOOL_GROUPS.platform): its payload DOES
//     embed gex_positioning (the same getGexPositioning() object get_positioning
//     returns), but it's a cross-product, ANY-ticker tool, and bie_interactions.
//     tools_used only records tool NAMES, never call inputs — there's no way to
//     tell from a row alone whether a given call actually needed the GEX slice or
//     was scoped to something unrelated (e.g. a 0DTE/Night Hawk question about a
//     name with no Thermal angle at all). Same reasoning SPX_ENGINE_TOOL_NAMES's
//     own comment gives for excluding it from that list. EXCLUDED.
// Kept as an explicit literal list (not derived from TOOL_GROUPS.stock_analysis)
// for the same reason SPX_ENGINE_TOOL_NAMES is: so this cohort tracks "did Largo
// read Thermal's own computed state" and can't silently widen/narrow if
// stock_analysis's bundle composition changes for unrelated routing reasons — see
// tool-defs.test.ts for the assertion keeping this a verified subset of
// TOOL_GROUPS.stock_analysis.
export const THERMAL_ENGINE_TOOL_NAMES = [
  "get_positioning",
  "get_gex_heatmap",
  "get_gex_matrix_changes",
  "get_thermal_compare",
  "get_wall_dynamics",
  "get_gex_regime_events",
];

export const VECTOR_ENGINE_TOOL_NAMES = [
  "get_vector_full_state",
  "get_vector_pulse",
  "get_vector_analytics",
  "get_wall_dynamics",
];

// Task #144 — the cohort-membership test for "did this Largo turn touch Night
// Hawk's OWN live-engine state" (BIE's self-eval loop, calibration.ts) — the
// same-shaped analogue of SPX_ENGINE_TOOL_NAMES above, for Night Hawk instead
// of SPX Slayer. Kept just as narrow, and for the same reason: only tools whose
// run-tool.ts implementation reads Night Hawk's own persisted/computed state
// belong here — verified against run-tool.ts's case statements, not guessed
// from naming:
//   - get_nighthawk_edition -> marketPlatform.nighthawk.getLatestNightHawkEdition()
//     / getNightHawkEditionForDate(date) — the published edition object itself
//     (recap, plays, scores) — see run-tool.ts's "get_nighthawk_edition" case.
//   - get_nighthawk_outcomes -> fetchNighthawkOutcomeAnalytics(windowDays) +
//     fetchPendingNighthawkOutcomes(7) — Night Hawk's own closed/pending
//     outcome ledger — see run-tool.ts's "get_nighthawk_outcomes" case.
//   - get_nighthawk_dossier -> fetchStagedDossiers(editionFor) falling back to
//     fetchNighthawkScoringHistory(editionFor, ticker) — Night Hawk's own
//     per-ticker research/scoring state (live staging while tonight's hunt is
//     still running, the durable archive once it publishes) — see
//     run-tool.ts's "get_nighthawk_dossier" case.
//
// Deliberately EXCLUDES two other Night-Hawk-adjacent TOOL_GROUPS.platform
// tools, for the same "can't attribute scope from tools_used alone" reasoning
// SPX_ENGINE_TOOL_NAMES gives above for excluding get_ecosystem_context:
//   - get_spx_vs_nighthawk_comparison: its run-tool.ts case ALWAYS calls BOTH
//     fetchPlayOutcomeStatsForWindow (SPX Slayer's own closed plays) AND
//     fetchNighthawkOutcomeAnalytics (Night Hawk's), then returns a derived
//     cross-product delta. A turn that called only this tool touched SPX
//     Slayer's own engine state just as certainly as Night Hawk's — including
//     it here wouldn't narrow this cohort, it would silently CONFLATE it with
//     SPX-engine-state turns (the exact failure mode SPX_ENGINE_TOOL_NAMES's
//     own comment warns against, just from the other direction).
//   - get_platform_snapshot: a cross-service combo across up to 3 products
//     (spx/flows/nighthawk) in a single call, gated by its own `include`/
//     `full_edition` params — but bie_interactions.tools_used records only the
//     tool NAME, never its call inputs, so a logged row gives no way to tell
//     whether a given get_platform_snapshot call ever touched the nighthawk
//     slice at all (it may have been called with `include: ["spx","flows"]`
//     only). Including it would silently admit unrelated single-product
//     lookups into a "Night Hawk engine state" cohort.
// Kept as an explicit literal list (not derived from TOOL_GROUPS.platform), for
// the same drift-resistance reason as SPX_ENGINE_TOOL_NAMES — see
// tool-defs.test.ts for the assertion that keeps this list a verified subset of
// TOOL_GROUPS.platform.
export const NIGHTHAWK_ENGINE_TOOL_NAMES = [
  "get_nighthawk_edition",
  "get_nighthawk_outcomes",
  "get_nighthawk_dossier",
];

// Task #149 — the analogous cohort-membership list for 0DTE Command (the SEPARATE
// multi-ticker scanner behind `/grid`'s default tab, per task #127's standing
// disambiguation from SPX Slayer above — both are "0DTE"-branded but are two
// independent engines). Same design philosophy as SPX_ENGINE_TOOL_NAMES: kept to
// the tools whose run-tool.ts implementation reads 0DTE Command's OWN persisted/
// computed engine state, verified against run-tool.ts's case statements, not
// guessed from naming:
//   - get_zerodte_plays → zeroDtePlaysForLargo() (zerodte/scan.ts) → readZeroDteLedger()
//     joined with scanZeroDteBoard()'s live finds — reads zerodte_setup_log, the
//     board's own committed-setup ledger.
//   - get_zerodte_rejections → zeroDteRejectionsForLargo() (zerodte/rejections.ts) —
//     reads zerodte_scan_rejections (task #147), the board's own near-miss/gate-
//     rejection log. See admin-zerodte-health.ts's module doc for more background
//     on both tables.
// Unlike SPX_ENGINE_TOOL_NAMES, this is NOT a narrowing of a larger routing bundle —
// TOOL_GROUPS.platform (where both tools live) has no generic, ticker-agnostic
// tools bundled in alongside them the way spx_desk does, so there is nothing to
// exclude; this list is simply the full pair. Kept as an explicit literal list
// (not derived from TOOL_GROUPS.platform) for the same reason SPX_ENGINE_TOOL_NAMES
// is: this cohort tracks "did Largo read 0DTE Command's own engine state" and must
// not silently widen if TOOL_GROUPS.platform gains unrelated tools later — see
// tool-defs.test.ts for the assertion that keeps this list a verified subset of
// TOOL_GROUPS.platform.
export const ZERODTE_ENGINE_TOOL_NAMES = ["get_zerodte_plays", "get_zerodte_rejections"];

// Task #161 — the cohort-membership list for `market_context`, the FOURTH of BIE's
// deterministic router intents (src/lib/bie/router.ts's classifyBieIntent:
// zerodte_plays/ticker_play_state/spx_structure/market_context) — the one intent
// left without a calibration.ts tool-calling cohort until now. Same design
// philosophy as SPX_ENGINE_TOOL_NAMES/ZERODTE_ENGINE_TOOL_NAMES: kept to the tools
// whose run-tool.ts implementation reads the SAME state the router's own composer
// reads, verified against run-tool.ts's case statement and composers.ts directly,
// not guessed from naming:
//   - get_market_context → run-tool.ts's "get_market_context" case: batches Polygon
//     index/ETF snapshots (SPX/VIX/SPY/QQQ/IWM/SOXX), UW market tide, market status,
//     and upcoming-session info behind the shared `market_context` cache, then layers
//     the user's own live SPX desk summary on top. This is EXACTLY what
//     composeMarketContext (src/lib/bie/composers.ts) reads via
//     `runLargoTool("get_market_context", {})` to answer the market_context router
//     intent — the same one-tool relationship SPX_ENGINE_TOOL_NAMES's
//     get_spx_structure has to composeSpxStructure.
// Deliberately EXCLUDES get_market_regime, despite it also being a "market-wide"
// BIE tool one might reflexively bundle in here: its run-tool.ts case calls
// fetchPlatformIntelSnapshot() (src/lib/nighthawk/platform-intel-snapshot.ts) — a
// COMPLETELY DIFFERENT read (platform-wide regime/backdrop intel) that
// composeMarketContext never touches. get_market_regime is a BIE_TOOL_NAMES member
// precisely because it's cross-product and callable regardless of which product's
// question is being asked — HELIX_ENGINE_TOOL_NAMES's own doc comment already
// excludes it from ITS list for the identical reason ("an explicitly 'market-wide
// backdrop, not ticker-specific' tool... tells you nothing about HELIX-tape/
// anomaly-detector answer quality specifically"); the same logic applies here
// verbatim, just for market_context instead of HELIX. Including it would silently
// admit turns that never touched market_context's own composed state into this
// cohort. Kept as an explicit literal list (not derived from TOOL_GROUPS.vol_analysis,
// where get_market_context itself lives) for the same drift-resistance reason every
// other *_ENGINE_TOOL_NAMES list is — see tool-defs.test.ts for the assertion that
// keeps this list a verified subset of TOOL_GROUPS.vol_analysis.
export const MARKET_ENGINE_TOOL_NAMES = ["get_market_context"];

/**
 * REMOVED 2026-08-10: `CORE_TOOLS`, `mentionsTicker()` and `getToolsForIntent()`.
 *
 * They implemented a per-question regex ALLOWLIST that decided which of these 116 tools Claude was
 * shown on a given turn. Measured over 20 realistic member questions it exposed a mean of 21.9
 * tools (19%), and it failed silently rather than loudly — see the block comment at the
 * `filteredTools` assignment in largo-terminal.ts for the full root cause, the measurements, and
 * why sending the complete surface is also the cheaper option under prompt caching.
 *
 * Two specific traps are worth recording so neither is rebuilt:
 *
 * 1. The `if (names.size <= 2) { ...CORE_TOOLS }` safety fallback was UNREACHABLE. The seed set
 *    added 4 names unconditionally, so `names.size` was never <= 2. Brute-forcing 1,444 phrasings
 *    put the floor at exactly 4 tools, every time — CORE_TOOLS never once ran in production, and
 *    the tests that referenced it were asserting against a branch that could not execute.
 *
 * 2. Growing the regexes could not fix this. The file this deletion leaves behind
 *    (intent-keywords.ts) is a record of that chase: several of its doc comments describe a
 *    specific phrasing that reached the wrong tool set and the pattern added to catch it. Members
 *    invent phrasings faster than an allowlist can enumerate them.
 *
 * intent-keywords.ts itself is NOT dead — question-intent.ts still uses it to decide which LIVE
 * FEED blocks to prefetch, and largo-followups.ts uses NIGHTHAWK_RE. That is a different job:
 * choosing what data to warm is a cost/latency decision where a miss degrades an answer, whereas
 * choosing what tools to expose was a capability decision where a miss made an answer impossible.
 */


