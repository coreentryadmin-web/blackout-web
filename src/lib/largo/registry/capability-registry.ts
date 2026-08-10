import { LARGO_TOOL_DEFS } from "@/lib/largo/tool-defs";

/**
 * LARGO CAPABILITY REGISTRY — the data catalog Largo queries to discover what it can answer.
 *
 * THE PROBLEM THIS SOLVES. Largo is handed 116 tools, each with a one-line description. That is
 * enough for "which tool fetches an SPX quote" and nowhere near enough for the questions that make
 * Largo worth having: *"what changed on SPX in the last 30 minutes"*, *"which Helix flow eventually
 * became a Night Hawk trade"*, *"where do Helix and Thermal disagree"*. Those need facts a tool
 * description does not carry:
 *
 *   - **Can this source answer about the PAST at all**, or does it only ever return NOW? Answering
 *     a historical question from a live-only source is the single most damaging thing Largo can do,
 *     because the answer looks perfect and is about the wrong moment. `temporal` makes that
 *     checkable instead of hoped-for.
 *   - **How fresh is it, and how fast does it go stale?** `freshness` drives whether a number needs
 *     a staleness caveat, without the model guessing.
 *   - **What can it be JOINED to?** Cross-product reasoning is only possible if something states
 *     that HELIX flow and NIGHT_HAWK plays share a `ticker` key and a `session` key. That is what
 *     `entities` is for.
 *   - **Who is allowed to see it?** Entitlement belongs in the catalog, enforced in deterministic
 *     code, never in a prompt instruction the model could be talked out of.
 *
 * THE DESIGN RULE. Adding a BLACKOUT product must mean REGISTERING it, not rewriting Largo. There
 * are deliberately no question-shaped handlers here — no `answerWhatChanged()`, no
 * `handleComparison()`. The registry describes CAPABILITIES; the model composes them. That is the
 * difference between a system that answers questions someone anticipated and one that answers
 * questions nobody did.
 *
 * WHAT THIS FILE IS NOT. It is not a copy of the tool list — a copy would drift, and a catalog that
 * disagrees with reality is worse than none. `registry.test.ts` asserts every `tool` named here
 * exists in `LARGO_TOOL_DEFS`, so a renamed or deleted tool fails the build rather than silently
 * advertising a capability that cannot execute.
 */

/** The BLACKOUT surfaces a capability can belong to. */
export type LargoProduct =
  | "SPX_SLAYER"
  | "HELIX"
  | "THERMAL"
  | "VECTOR"
  | "NIGHT_HAWK"
  | "TRACK_RECORD"
  | "MARKET"
  | "CATALYSTS"
  | "PLATFORM";

/**
 * What a source can say about TIME. The most important field in the registry.
 *
 * - `live_only`   — returns the current state and nothing else. Asking it about 10:15 gets you
 *                   10:15's question answered with now's data, silently. Never use for history.
 * - `as_of`       — returns current state but stamps when the data is from, so staleness is
 *                   detectable even though the past is not queryable.
 * - `windowed`    — accepts a lookback (days/session) and returns aggregates over it.
 * - `point_in_time` — can return the state at a specific past moment. The only class that can
 *                   honestly answer "what did this look like when the trade fired".
 * - `event_log`   — an ordered record of discrete events; supports "what changed between X and Y"
 *                   by construction.
 */
export type TemporalClass = "live_only" | "as_of" | "windowed" | "point_in_time" | "event_log";

/** How quickly a source's answer goes stale — drives the freshness caveat. */
export type FreshnessClass =
  | "realtime" // sub-minute; websocket or per-request upstream
  | "fast" // ~1-5 min cache
  | "periodic" // cron-driven, tens of minutes
  | "session" // once per trading session
  | "historical"; // immutable once written

/** Join keys. Two capabilities can be reasoned across only if they share one. */
export type EntityKey =
  | "ticker"
  | "contract" // OCC symbol
  | "strike"
  | "expiry"
  | "session" // trading date
  | "play" // a committed play/trade id
  | "signal" // a signal firing id
  | "user";

/** Who may reach it. Enforced in code at the tool layer — never by prompt instruction. */
export type Entitlement = "premium" | "admin";

export type LargoCapability = {
  /** Stable id, used in query plans and diagnostics. */
  id: string;
  product: LargoProduct;
  /** The tool that serves it. MUST exist in LARGO_TOOL_DEFS (asserted by the drift test). */
  tool: string;
  /** One line, phrased as the QUESTION it answers — this is what the model matches against. */
  answers: string;
  temporal: TemporalClass;
  freshness: FreshnessClass;
  entities: EntityKey[];
  entitlement: Entitlement;
  /** Free-text search terms beyond `answers`. Deliberately NOT a routing regex — this is ranking
   *  input for discovery, never a gate that can hide a capability the way the deleted intent
   *  allowlist did (FINDINGS 2026-08-10). */
  keywords?: string[];
  /** Capability ids that are commonly joined with this one. Seeds cross-product plans. */
  joinsWith?: string[];
  /** Stated limitation. Surfaced to the model so it can caveat instead of over-claiming. */
  caveat?: string;
};

// ── The catalog ───────────────────────────────────────────────────────────────────────────────
// Grouped by product. Every entry's `tool` is asserted to exist by registry.test.ts.

export const LARGO_CAPABILITIES: readonly LargoCapability[] = [
  // ── SPX Slayer ──
  {
    id: "spx.structure",
    product: "SPX_SLAYER",
    tool: "get_spx_structure",
    answers: "What is the SPX desk's current structural read — spot, levels, bias?",
    temporal: "as_of",
    freshness: "realtime",
    entities: ["ticker", "session"],
    entitlement: "premium",
    keywords: ["spx", "structure", "bias", "desk", "read"],
    joinsWith: ["thermal.positioning", "helix.tape", "nighthawk.zerodte_board"],
  },
  {
    id: "spx.play",
    product: "SPX_SLAYER",
    tool: "get_spx_play",
    answers: "What is the current SPX play, its phase, and which gates passed or failed?",
    temporal: "as_of",
    freshness: "realtime",
    entities: ["ticker", "play", "session"],
    entitlement: "premium",
    keywords: ["play", "phase", "gate", "setup", "entry"],
    joinsWith: ["spx.engine_snapshots", "record.trade_history"],
  },
  {
    id: "spx.engine_snapshots",
    product: "SPX_SLAYER",
    tool: "get_spx_engine_snapshots",
    answers: "What did the SPX engine look like at each point earlier in the session?",
    // The reason this capability exists: it is one of the few SPX sources that can answer about a
    // PAST moment, which is what "what changed since the trade fired" requires.
    temporal: "point_in_time",
    freshness: "fast",
    entities: ["session", "play"],
    entitlement: "premium",
    keywords: ["earlier", "changed", "history", "snapshot", "timeline", "since"],
    joinsWith: ["spx.play", "spx.signal_log"],
  },
  {
    id: "spx.signal_log",
    product: "SPX_SLAYER",
    tool: "get_signal_log",
    answers: "Which SPX signals fired, when, and in what order?",
    temporal: "event_log",
    freshness: "fast",
    entities: ["session", "signal"],
    entitlement: "premium",
    keywords: ["signal", "fired", "when", "sequence", "timeline"],
    joinsWith: ["spx.engine_snapshots", "helix.signal_outcomes"],
  },
  {
    id: "spx.pin",
    product: "SPX_SLAYER",
    tool: "get_spx_pin",
    answers: "Where is SPX projected to pin into the close?",
    temporal: "as_of",
    freshness: "fast",
    entities: ["ticker", "session"],
    entitlement: "premium",
    keywords: ["pin", "close", "eod", "magnet", "forecast"],
    caveat: "A forecast, not a measurement — never present it as an observed level.",
  },
  {
    id: "spx.confluence",
    product: "SPX_SLAYER",
    tool: "get_spx_confluence",
    answers: "Which SPX evidence families currently agree or disagree?",
    temporal: "as_of",
    freshness: "realtime",
    entities: ["ticker", "session"],
    entitlement: "premium",
    keywords: ["confluence", "agree", "disagree", "conflict", "alignment"],
    joinsWith: ["thermal.positioning", "helix.tape"],
  },
  {
    id: "spx.power_hour",
    product: "SPX_SLAYER",
    tool: "get_power_hour",
    answers: "What is the power-hour setup into the final hour?",
    temporal: "as_of",
    freshness: "fast",
    entities: ["ticker", "session"],
    entitlement: "premium",
    keywords: ["power hour", "final hour", "close", "into the close"],
  },
  {
    id: "spx.open_plays",
    product: "SPX_SLAYER",
    tool: "get_open_plays",
    answers: "Which SPX plays are currently open for this member?",
    temporal: "as_of",
    freshness: "realtime",
    entities: ["user", "play", "ticker"],
    entitlement: "premium",
    keywords: ["open", "positions", "my", "holding", "risk", "exposure"],
    joinsWith: ["record.trade_history"],
  },

  // ── HELIX ──
  {
    id: "helix.tape",
    product: "HELIX",
    tool: "get_flow_tape",
    answers: "What is printing on the options-flow tape right now?",
    temporal: "as_of",
    freshness: "realtime",
    entities: ["ticker", "contract", "strike", "expiry"],
    entitlement: "premium",
    keywords: ["flow", "tape", "prints", "sweeps", "whale", "helix"],
    joinsWith: ["thermal.positioning", "nighthawk.zerodte_board", "helix.signal_outcomes"],
  },
  {
    id: "helix.options_flow",
    product: "HELIX",
    tool: "get_options_flow",
    answers: "What is the options flow for one ticker, including strike stacks?",
    temporal: "as_of",
    freshness: "realtime",
    entities: ["ticker", "contract", "strike", "expiry"],
    entitlement: "premium",
    keywords: ["flow", "stacks", "repeated hits", "premium", "calls", "puts"],
  },
  {
    id: "helix.global_flow",
    product: "HELIX",
    tool: "get_global_flow",
    answers: "What is the market-wide flow picture across all tickers?",
    temporal: "as_of",
    freshness: "realtime",
    entities: ["ticker"],
    entitlement: "premium",
    keywords: ["market wide", "everything", "across the market", "global", "bullish signals"],
  },
  {
    id: "helix.postgres_flows",
    product: "HELIX",
    tool: "get_postgres_flows",
    answers: "What flow was recorded historically, for comparison against today?",
    // The comparison arm of "compare today's flow with yesterday" — the live tape cannot do it.
    temporal: "windowed",
    freshness: "historical",
    entities: ["ticker", "session"],
    entitlement: "premium",
    keywords: ["yesterday", "historical", "compare", "last week", "previous session"],
    joinsWith: ["helix.tape"],
  },
  {
    id: "helix.signal_outcomes",
    product: "HELIX",
    tool: "get_helix_signal_outcomes",
    answers: "Did HELIX signals actually follow through, and how often?",
    temporal: "windowed",
    freshness: "historical",
    entities: ["ticker", "signal", "session"],
    entitlement: "premium",
    keywords: ["follow through", "accuracy", "performed", "worked", "hit rate"],
    joinsWith: ["helix.tape", "record.horizon_outcomes"],
  },
  {
    id: "helix.anomaly_near_misses",
    product: "HELIX",
    tool: "get_flow_anomaly_near_misses",
    answers: "What nearly triggered the anomaly detector but did not?",
    temporal: "event_log",
    freshness: "fast",
    entities: ["ticker", "session"],
    entitlement: "premium",
    keywords: ["near miss", "almost", "watching", "not triggered", "close to"],
  },
  {
    id: "helix.dark_pool",
    product: "HELIX",
    tool: "get_dark_pool",
    answers: "What dark-pool activity is there for a ticker?",
    temporal: "as_of",
    freshness: "fast",
    entities: ["ticker"],
    entitlement: "premium",
    keywords: ["dark pool", "off exchange", "block"],
  },

  // ── THERMAL ──
  {
    id: "thermal.positioning",
    product: "THERMAL",
    tool: "get_positioning",
    answers: "How are dealers positioned in a ticker — gamma flip, call wall, put wall?",
    temporal: "as_of",
    freshness: "fast",
    entities: ["ticker", "strike", "expiry"],
    entitlement: "premium",
    keywords: ["dealer", "gamma", "gex", "call wall", "put wall", "flip", "positioning"],
    joinsWith: ["helix.tape", "spx.structure", "vector.full_state"],
  },
  {
    id: "thermal.heatmap",
    product: "THERMAL",
    tool: "get_gex_heatmap",
    answers: "What does the full GEX/VEX/DEX/CHARM matrix look like by strike and expiry?",
    temporal: "as_of",
    freshness: "fast",
    entities: ["ticker", "strike", "expiry"],
    entitlement: "premium",
    keywords: ["matrix", "heatmap", "vex", "dex", "charm", "by strike"],
  },
  {
    id: "thermal.matrix_changes",
    product: "THERMAL",
    tool: "get_gex_matrix_changes",
    answers: "How has the dealer-positioning matrix CHANGED since earlier?",
    // A first-class "what changed" source. Answering matrix drift from two live snapshots the
    // model diffed itself would be a fabricated comparison; this is measured server-side.
    temporal: "windowed",
    freshness: "fast",
    entities: ["ticker", "strike", "expiry", "session"],
    entitlement: "premium",
    keywords: ["changed", "shift", "moved", "since", "delta", "drift"],
    joinsWith: ["thermal.positioning", "thermal.regime_events"],
  },
  {
    id: "thermal.regime_events",
    product: "THERMAL",
    tool: "get_gex_regime_events",
    answers: "When did the gamma regime flip, and what happened around it?",
    temporal: "event_log",
    freshness: "fast",
    entities: ["ticker", "session"],
    entitlement: "premium",
    keywords: ["flipped", "regime change", "crossed", "after", "when did"],
    joinsWith: ["thermal.positioning", "spx.signal_log"],
  },
  {
    id: "thermal.max_pain",
    product: "THERMAL",
    tool: "get_max_pain",
    answers: "Where is max pain for a ticker and expiry?",
    temporal: "as_of",
    freshness: "periodic",
    entities: ["ticker", "expiry"],
    entitlement: "premium",
    keywords: ["max pain", "pain"],
  },

  {
    id: "helix.derived_panels",
    product: "HELIX",
    tool: "get_helix_derived",
    // DERIVED, not fetched. Catalogued separately from the raw tape because "what is stacking"
    // and "show me the prints" rank alike on keywords and only one of them the tape can answer.
    answers: "What is HELIX making of the tape — stacked hits, top prints, velocity spikes, split flow?",
    temporal: "windowed",
    freshness: "realtime",
    entities: ["ticker", "strike", "expiry"],
    entitlement: "premium",
    keywords: ["stacked", "stacking", "top prints", "top hits", "velocity", "radar", "split flow", "repeated", "hits"],
    joinsWith: ["helix.tape", "thermal.positioning", "vector.full_state"],
  },
  // ── VECTOR ──
  {
    id: "vector.full_state",
    product: "VECTOR",
    tool: "get_vector_full_state",
    answers: "What is Vector's full chart state for a ticker — walls, beads, flip, magnet?",
    temporal: "as_of",
    freshness: "realtime",
    entities: ["ticker", "strike", "expiry"],
    entitlement: "premium",
    keywords: ["vector", "walls", "beads", "chart", "magnet", "rail"],
    joinsWith: ["thermal.positioning"],
  },
  {
    id: "vector.pulse",
    product: "VECTOR",
    tool: "get_vector_pulse",
    // DIFFERENTIAL, not a snapshot — this is the distinction the registry has to carry, because
    // "what just changed" and "what is the state" rank identically on keywords alone and only one
    // of them can actually be answered from a single state read.
    answers: "What CHANGED on Vector just now — regime flip, magnet shift, new wall forming, integrity change?",
    temporal: "windowed",
    freshness: "realtime",
    entities: ["ticker", "strike"],
    entitlement: "premium",
    keywords: ["pulse", "just changed", "signal", "forming", "flipped", "shifted", "alert"],
    joinsWith: ["vector.full_state", "vector.wall_dynamics"],
  },
  {
    id: "vector.wall_dynamics",
    product: "VECTOR",
    tool: "get_wall_dynamics",
    answers: "How have the walls MOVED through the session?",
    temporal: "windowed",
    freshness: "fast",
    entities: ["ticker", "strike", "session"],
    entitlement: "premium",
    keywords: ["wall moved", "migrating", "changed", "through the day", "since open"],
    joinsWith: ["thermal.matrix_changes"],
  },

  // ── NIGHT HAWK ──
  {
    id: "nighthawk.zerodte_board",
    product: "NIGHT_HAWK",
    tool: "get_zerodte_plays",
    answers: "Which 0DTE plays are committed on the board right now?",
    temporal: "as_of",
    freshness: "realtime",
    entities: ["ticker", "play", "contract", "session"],
    entitlement: "premium",
    keywords: ["0dte", "today's plays", "board", "committed", "scanner"],
    joinsWith: ["nighthawk.rejections", "nighthawk.cortex", "record.zerodte_record"],
  },
  {
    id: "nighthawk.rejections",
    product: "NIGHT_HAWK",
    tool: "get_zerodte_rejections",
    answers: "What did the 0DTE scanner look at and REJECT, and for which gate?",
    // The "watching but not triggered" capability. Without it Largo can only describe what fired,
    // which is exactly half the picture a member needs.
    temporal: "event_log",
    freshness: "fast",
    entities: ["ticker", "session"],
    entitlement: "premium",
    keywords: ["rejected", "why not", "near miss", "watching", "didn't trigger", "not on the board"],
    joinsWith: ["nighthawk.zerodte_board", "nighthawk.cortex"],
  },
  {
    id: "nighthawk.cortex",
    product: "NIGHT_HAWK",
    tool: "get_cortex_decision",
    answers: "Why did Cortex commit or veto a specific name?",
    temporal: "event_log",
    freshness: "fast",
    entities: ["ticker", "play", "session"],
    entitlement: "premium",
    keywords: ["cortex", "veto", "why", "decision", "blocked", "skipped"],
  },
  {
    id: "nighthawk.swings",
    product: "NIGHT_HAWK",
    tool: "get_swing_horizon",
    answers: "What is on the multi-day swing board?",
    temporal: "as_of",
    freshness: "periodic",
    entities: ["ticker", "play", "contract"],
    entitlement: "premium",
    keywords: ["swing", "multi-day", "swings"],
    joinsWith: ["record.horizon_outcomes"],
  },
  {
    id: "nighthawk.bangers",
    product: "NIGHT_HAWK",
    tool: "get_banger_board",
    answers: "What is on the weekly banger breakout board?",
    temporal: "as_of",
    freshness: "periodic",
    entities: ["ticker", "play"],
    entitlement: "premium",
    keywords: ["banger", "breakout", "weekly", "engine b"],
  },
  {
    id: "nighthawk.edition",
    product: "NIGHT_HAWK",
    tool: "get_nighthawk_edition",
    answers: "What is in tonight's Legacy evening playbook edition?",
    // "session" is a FRESHNESS class, not a temporal one. The edition is rebuilt once per session
    // and then frozen, so it reports the state it was built from: as_of, refreshed per session.
    temporal: "as_of",
    freshness: "session",
    entities: ["ticker", "session"],
    entitlement: "premium",
    keywords: ["edition", "playbook", "tonight", "evening", "legacy"],
    caveat: "Built once per session — it reflects the state at build time, not the live tape.",
  },
  {
    id: "nighthawk.horizons",
    product: "NIGHT_HAWK",
    tool: "get_nighthawk_horizons",
    answers: "What is the compact cross-lane view of 0DTE and swings together?",
    temporal: "as_of",
    freshness: "fast",
    entities: ["ticker", "play"],
    entitlement: "premium",
    keywords: ["lanes", "cross lane", "both", "compare lanes"],
  },

  // ── TRACK RECORD ──
  {
    id: "record.zerodte_record",
    product: "TRACK_RECORD",
    tool: "get_zerodte_record",
    answers: "How has 0DTE Command performed — graded wins, losses, average P&L?",
    temporal: "windowed",
    freshness: "historical",
    entities: ["ticker", "play", "session"],
    entitlement: "premium",
    keywords: ["win rate", "performed", "record", "results", "how did we do", "last month"],
    joinsWith: ["nighthawk.zerodte_board", "record.horizon_outcomes"],
  },
  {
    id: "record.horizon_outcomes",
    product: "TRACK_RECORD",
    tool: "get_horizon_outcomes",
    answers: "What are the graded outcomes across lanes — 0DTE and swing together?",
    temporal: "windowed",
    freshness: "historical",
    entities: ["play", "session"],
    entitlement: "premium",
    keywords: ["outcomes", "graded", "across lanes", "cross product performance"],
    caveat: "Each lane keeps its own grading methodology — republish, never blend into one number.",
  },
  {
    id: "record.trade_history",
    product: "TRACK_RECORD",
    tool: "get_trade_history",
    answers: "What individual trades closed, when, and how did each resolve?",
    temporal: "windowed",
    freshness: "historical",
    entities: ["ticker", "play", "session"],
    entitlement: "premium",
    keywords: ["closed trades", "today's trades", "why did it win", "why did it lose", "history"],
    joinsWith: ["record.setup_stats", "spx.open_plays"],
  },
  {
    id: "record.setup_stats",
    product: "TRACK_RECORD",
    tool: "get_setup_stats",
    answers: "Which setup types have historically performed best, and under what conditions?",
    temporal: "windowed",
    freshness: "historical",
    entities: ["session"],
    entitlement: "premium",
    keywords: ["best setup", "which signals performed", "conditions", "regime", "historically"],
    joinsWith: ["market.regime", "record.horizon_outcomes"],
  },
  {
    id: "record.nighthawk_outcomes",
    product: "TRACK_RECORD",
    tool: "get_nighthawk_outcomes",
    answers: "How did the Night Hawk Legacy edition picks resolve?",
    temporal: "windowed",
    freshness: "historical",
    entities: ["ticker", "session"],
    entitlement: "premium",
    keywords: ["edition results", "legacy performance", "playbook results"],
  },
  {
    id: "record.confluence_outcomes",
    product: "TRACK_RECORD",
    tool: "get_confluence_outcomes",
    answers: "How did trades perform by confluence tier?",
    temporal: "windowed",
    freshness: "historical",
    entities: ["session"],
    entitlement: "premium",
    keywords: ["confluence", "tier", "conviction", "performed by"],
  },
  {
    id: "record.precedents",
    product: "TRACK_RECORD",
    tool: "get_similar_precedents",
    answers: "When has a setup like this happened before, and what followed?",
    temporal: "point_in_time",
    freshness: "historical",
    entities: ["ticker", "session"],
    entitlement: "premium",
    keywords: ["before", "precedent", "similar", "last time", "historically when"],
  },

  // ── MARKET ──
  {
    id: "market.quote",
    product: "MARKET",
    tool: "get_quote",
    answers: "What is the live price of a ticker or index?",
    temporal: "live_only",
    freshness: "realtime",
    entities: ["ticker"],
    entitlement: "premium",
    keywords: ["price", "quote", "spot", "trading at", "level"],
    caveat: "Live only — cannot answer what a price WAS. Use bars/history for the past.",
  },
  {
    id: "market.technicals",
    product: "MARKET",
    tool: "get_technicals",
    answers: "What do the multi-timeframe technicals say — EMAs, RSI, VWAP, ATR, S/R?",
    temporal: "as_of",
    freshness: "fast",
    entities: ["ticker"],
    entitlement: "premium",
    keywords: ["technicals", "ema", "rsi", "vwap", "atr", "support", "resistance", "trend"],
  },
  {
    id: "market.regime",
    product: "MARKET",
    tool: "get_market_regime",
    answers: "What is the current market regime and platform-wide backdrop?",
    temporal: "as_of",
    freshness: "periodic",
    entities: ["session"],
    entitlement: "premium",
    keywords: ["regime", "backdrop", "environment", "conditions"],
    joinsWith: ["record.setup_stats"],
  },
  {
    id: "market.context",
    product: "MARKET",
    tool: "get_market_context",
    answers: "What is the broad market context — indices, tide, session state?",
    temporal: "as_of",
    freshness: "fast",
    entities: ["session"],
    entitlement: "premium",
    keywords: ["market", "overall", "backdrop", "indices", "breadth"],
  },
  {
    id: "market.hot_tickers",
    product: "MARKET",
    tool: "get_hot_tickers",
    answers: "Which tickers are the platform's hottest right now?",
    temporal: "as_of",
    freshness: "fast",
    entities: ["ticker"],
    entitlement: "premium",
    keywords: ["hot", "active", "movers", "what's moving", "strongest"],
  },
  {
    id: "market.movers",
    product: "MARKET",
    tool: "get_market_movers",
    answers: "What are the biggest movers in the market?",
    temporal: "as_of",
    freshness: "fast",
    entities: ["ticker"],
    entitlement: "premium",
    keywords: ["movers", "gainers", "losers", "biggest"],
  },
  {
    id: "market.option_price_history",
    product: "MARKET",
    tool: "get_option_price_history",
    answers: "What did a specific option contract trade at over time?",
    temporal: "point_in_time",
    freshness: "historical",
    entities: ["contract", "ticker", "strike", "expiry"],
    entitlement: "premium",
    keywords: ["contract history", "what was it worth", "when the trade fired", "premium over time"],
    joinsWith: ["record.trade_history"],
  },

  // ── CATALYSTS ──
  {
    id: "catalysts.news",
    product: "CATALYSTS",
    tool: "get_news",
    answers: "What news is out on a ticker?",
    temporal: "event_log",
    freshness: "fast",
    entities: ["ticker"],
    entitlement: "premium",
    keywords: ["news", "headline", "why is it moving", "catalyst"],
  },
  {
    id: "catalysts.earnings",
    product: "CATALYSTS",
    tool: "get_earnings",
    answers: "When does a ticker report, and what happened at past reports?",
    temporal: "windowed",
    freshness: "session",
    entities: ["ticker", "session"],
    entitlement: "premium",
    keywords: ["earnings", "report", "eps"],
  },
  {
    id: "catalysts.economic",
    product: "CATALYSTS",
    tool: "get_economic_calendar",
    answers: "What macro events are scheduled?",
    temporal: "windowed",
    freshness: "session",
    entities: ["session"],
    entitlement: "premium",
    keywords: ["fomc", "cpi", "macro", "calendar", "economic"],
  },

  // ── PLATFORM ──
  {
    id: "platform.snapshot",
    product: "PLATFORM",
    tool: "get_platform_snapshot",
    answers: "What is the whole platform showing right now, across every desk?",
    temporal: "as_of",
    freshness: "fast",
    entities: ["ticker", "session"],
    entitlement: "premium",
    keywords: ["everything", "whole platform", "all desks", "overview", "across blackout"],
    joinsWith: ["spx.structure", "helix.tape", "thermal.positioning", "nighthawk.zerodte_board"],
  },
  {
    id: "platform.ecosystem",
    product: "PLATFORM",
    tool: "get_ecosystem_context",
    answers: "What does every desk say about ONE ticker?",
    temporal: "as_of",
    freshness: "fast",
    entities: ["ticker"],
    entitlement: "premium",
    keywords: ["everything on", "full read", "all desks on", "ecosystem"],
    joinsWith: ["thermal.positioning", "helix.options_flow", "vector.full_state"],
  },
  {
    id: "platform.internal_api",
    product: "PLATFORM",
    tool: "call_internal_api",
    answers: "Read any internal GET route when no dedicated capability covers the question.",
    temporal: "as_of",
    freshness: "fast",
    entities: [],
    entitlement: "premium",
    keywords: ["fallback", "raw", "endpoint"],
    caveat:
      "Escape hatch, not a first choice. An unknown query param can silently return a DIFFERENT " +
      "slice than intended — see FINDINGS 2026-08-10, where ?view=outcomes served the 0DTE lane " +
      "with a 200. Prefer a registered capability whenever one exists.",
  },
] as const;

// ── Query surface ─────────────────────────────────────────────────────────────────────────────

/** All capabilities a given entitlement may reach. Deterministic filter, never a prompt rule. */
export function capabilitiesFor(entitlement: Entitlement): LargoCapability[] {
  return LARGO_CAPABILITIES.filter((c) => c.entitlement === "premium" || c.entitlement === entitlement);
}

/**
 * Capabilities that can honestly answer about a PAST moment.
 *
 * The guard against the worst temporal failure: answering "what did SPX look like at 10:15" from a
 * `live_only` source produces a confident, well-sourced answer about the wrong moment, and nothing
 * downstream can detect it. `live_only` and `as_of` are excluded by construction.
 */
export function historicalCapabilities(): LargoCapability[] {
  return LARGO_CAPABILITIES.filter(
    (c) => c.temporal === "point_in_time" || c.temporal === "event_log" || c.temporal === "windowed"
  );
}

/** Capabilities that can answer "what CHANGED" — an ordered record, or a server-computed delta. */
export function changeCapabilities(): LargoCapability[] {
  return LARGO_CAPABILITIES.filter((c) => c.temporal === "event_log" || c.temporal === "windowed");
}

/** Capabilities sharing an entity key — the join surface for cross-product reasoning. */
export function capabilitiesSharingEntity(entity: EntityKey): LargoCapability[] {
  return LARGO_CAPABILITIES.filter((c) => c.entities.includes(entity));
}

/**
 * Rank capabilities against a question.
 *
 * RANKING, NOT FILTERING — the distinction is the whole lesson of FINDINGS 2026-08-10. The deleted
 * intent allowlist decided which tools the model could SEE, so a phrasing nobody anticipated made a
 * capability unreachable. This returns an ORDER over the full set and hides nothing: a low score
 * pushes a capability down the list, it never removes it. Discovery must never be able to make an
 * answer impossible.
 */
export function rankCapabilities(question: string, limit = 12): LargoCapability[] {
  const q = question.toLowerCase();
  const terms = q.split(/[^a-z0-9]+/).filter((t) => t.length > 2);
  const scored = LARGO_CAPABILITIES.map((c) => {
    let score = 0;
    const hay = `${c.answers} ${(c.keywords ?? []).join(" ")} ${c.product}`.toLowerCase();
    for (const t of terms) if (hay.includes(t)) score += 1;
    // Multi-word keywords are far more specific than a single token — weight them accordingly.
    for (const k of c.keywords ?? []) if (k.includes(" ") && q.includes(k)) score += 3;
    return { c, score };
  });
  return scored
    .sort((a, b) => b.score - a.score || a.c.id.localeCompare(b.c.id))
    .slice(0, limit)
    .map((s) => s.c);
}

/** Every tool named by the catalog. Used by the drift test and by plan validation. */
export function registryToolNames(): Set<string> {
  return new Set(LARGO_CAPABILITIES.map((c) => c.tool));
}

/** Tools that exist but carry no capability entry — the catalog's own coverage gap, reported
 *  rather than hidden so it can be worked off deliberately. */
export function uncataloguedTools(): string[] {
  const catalogued = registryToolNames();
  return LARGO_TOOL_DEFS.map((t) => t.name)
    .filter((n) => !catalogued.has(n))
    .sort();
}

/**
 * A compact capability digest for the turn's system context.
 *
 * WHY THIS EXISTS — a measured gap, not a theory. On 2026-08-10 the live stress suite asked
 * "compare today's options flow with yesterday's" and Largo DECLINED: *"all live flow sources
 * return present-time data only and have no historical window."* Honest, and wrong — the platform
 * has `get_postgres_flows`, catalogued here as `windowed / historical`, which covers exactly that
 * window. The model had the tool in its surface and no way to know it was the past-capable one,
 * because a tool description says what a tool returns, never whether it can reach backwards.
 *
 * So the digest leads with what the tool list cannot express: the TEMPORAL class. For a historical
 * question it lists the past-capable capabilities FIRST and states plainly that they are the ones
 * that can cover the window.
 *
 * RANKING, NEVER FILTERING. This block adds information; it removes nothing. All 116 tools stay in
 * the request, so a capability that ranks poorly is merely further down a hint list — it can still
 * be called. That distinction is the entire lesson of the deleted intent allowlist
 * (FINDINGS 2026-08-10): a discovery mechanism that can HIDE a capability can make an answer
 * impossible, and this one cannot.
 */
export function formatCapabilityBlock(
  question: string,
  opts: { historical?: boolean; limit?: number } = {}
): string {
  const limit = opts.limit ?? 10;
  const ranked = rankCapabilities(question, LARGO_CAPABILITIES.length);

  // For a historical question, promote the sources that can actually reach backwards. Without
  // this the ranker's keyword score happily puts a live_only source at the top of a question
  // about yesterday.
  const ordered = opts.historical
    ? [
        ...ranked.filter((c) => c.temporal !== "live_only" && c.temporal !== "as_of"),
        ...ranked.filter((c) => c.temporal === "live_only" || c.temporal === "as_of"),
      ]
    : ranked;

  const shown = ordered.slice(0, limit);
  if (shown.length === 0) return "";

  const lines = [
    "\n\n## Capability hints",
    opts.historical
      ? "This question is about the PAST. These sources are ordered past-capable FIRST — the ones marked" +
        " `windowed`, `point_in_time` or `event_log` can cover a historical window; `live_only` and" +
        " `as_of` cannot, whatever their description suggests."
      : "Relevant sources for this question, with what each can say about TIME:",
    "",
    ...shown.map((c) => {
      const bits = [`\`${c.tool}\``, `[${c.temporal} · ${c.freshness}]`, c.answers];
      if (c.caveat) bits.push(`— ${c.caveat}`);
      return `- ${bits.join(" ")}`;
    }),
    "",
    "These are HINTS, not limits. Every tool remains callable; if none of the above fits, use the" +
      " tool that does.",
  ];
  return lines.join("\n");
}
