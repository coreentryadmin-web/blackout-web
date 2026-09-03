import { LARGO_TOOL_DEFS } from "@/lib/largo/tool-defs";

/**
 * LARGO CAPABILITY REGISTRY — the data catalog Largo queries to discover what it can answer.
 *
 * THE PROBLEM THIS SOLVES. Largo is handed 137 tools, each with a one-line description. That is
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
  // Meridian is a desk in its own right, like HELIX or THERMAL, and was the only one missing from
  // this union — which is the exposure gap restated: a product with no registry identity cannot be
  // planned for. CATALYSTS covers the plain calendars ("when"); MERIDIAN covers the desk's read on
  // them ("and what of it"), and the planner must be able to tell those apart.
  | "MERIDIAN"
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
 * - `snapshot_delta` — compares NOW against ONE cached prior snapshot and reports the difference.
 *                   Can answer "what just changed"; canNOT be pointed at an arbitrary past moment.
 *
 * WHY `snapshot_delta` EXISTS — it is the class this taxonomy was missing, and its absence caused a
 * real misclassification five times over.
 *
 * `temporal` feeds TWO consumers with different needs. `changeCapabilities()` wants sources that can
 * answer "what changed", and `historicalCapabilities()` / `plan.ts`'s PAST_CAPABLE want sources that
 * can answer about a past moment. Those overlap but are not the same set, and a now-vs-last-snapshot
 * diff sits exactly in the gap: Vector Pulse genuinely answers "what just changed" and genuinely
 * cannot tell you what the pulse looked like yesterday.
 *
 * With no class for that, five such tools were catalogued `windowed` — correct for discovery, and
 * wrong for safety, because `windowed` is past-capable and would clear the guard on a historical
 * question. Flipping them to `as_of` would have fixed the safety hole by breaking discovery, which
 * is why the pulse entry carried an explicit comment defending `windowed`. This class serves both:
 * `changeCapabilities()` includes it, PAST_CAPABLE does not.
 */
export type TemporalClass =
  | "live_only"
  | "as_of"
  | "windowed"
  | "point_in_time"
  | "event_log"
  | "snapshot_delta";

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
  {
    id: "spx.desk_convergence",
    product: "SPX_SLAYER",
    tool: "get_spx_desk_convergence",
    answers: "Are Vector's suggested SPX play and Slayer desk execution aligned?",
    temporal: "as_of",
    freshness: "realtime",
    entities: ["ticker", "play", "session"],
    entitlement: "premium",
    keywords: ["vector", "slayer", "aligned", "agree", "diverge", "suggested", "execution"],
    joinsWith: ["spx.play", "vector.full_state"],
  },
  {
    id: "spx.voice_feed",
    product: "SPX_SLAYER",
    tool: "get_spx_voice_feed",
    answers: "What transition events fired on the SPX desk this session?",
    temporal: "event_log",
    freshness: "fast",
    entities: ["session"],
    entitlement: "premium",
    keywords: ["changed", "events", "flip cross", "king migrate", "pulse", "timeline"],
    joinsWith: ["spx.pulse", "spx.structure"],
  },
  {
    id: "spx.journal",
    product: "SPX_SLAYER",
    tool: "get_spx_journal",
    answers: "What did this member note in their SPX trade journal?",
    temporal: "as_of",
    freshness: "historical",
    entities: ["user", "play"],
    entitlement: "premium",
    keywords: ["journal", "notes", "my note", "annotated", "tags"],
    caveat: "Per-member annotation only — requires a signed-in user.",
  },
  {
    id: "spx.playbook_shadow_history",
    product: "SPX_SLAYER",
    tool: "get_playbook_shadow_history",
    answers: "What named playbooks fired in shadow mode this session (historical evidence)?",
    temporal: "event_log",
    freshness: "historical",
    entities: ["session"],
    entitlement: "premium",
    keywords: ["shadow", "playbook", "PB-", "matcher", "evidence", "history"],
    joinsWith: ["spx.play", "spx.engine_snapshots"],
    caveat: "Shadow observations only — not committed Slayer trades.",
  },
  {
    id: "platform.discord_alert_history",
    product: "PLATFORM",
    tool: "get_discord_alert_history",
    answers: "What outbound Discord trade alerts were posted recently?",
    temporal: "event_log",
    freshness: "historical",
    entities: ["ticker", "session"],
    entitlement: "premium",
    keywords: ["discord", "alert", "history", "BTO", "STC", "posted", "outbound", "audit"],
    joinsWith: ["record.trade_history"],
    caveat: "Postgres alert_audit_log only — final_output is the member-visible payload, not webhook internals.",
  },
  {
    id: "spx.playbook_promotion_evidence",
    product: "SPX_SLAYER",
    tool: "get_playbook_promotion_evidence",
    answers: "What is the out-of-sample promotion evidence for named SPX playbooks?",
    temporal: "point_in_time",
    freshness: "historical",
    entities: ["session"],
    entitlement: "admin",
    keywords: ["playbook", "promotion", "OOS", "evidence", "PB-", "analytics", "gates"],
    joinsWith: ["spx.playbook_shadow_history"],
    caveat: "Admin-only — same OOS promotion report as the admin API.",
  },
  {
    id: "platform.concept",
    product: "PLATFORM",
    tool: "get_concept",
    answers: "What does a BlackOut platform term mean?",
    temporal: "live_only",
    freshness: "historical",
    entities: [],
    entitlement: "premium",
    keywords: ["what is", "define", "explain", "glossary", "mean"],
    caveat: "Live only — glossary definitions, not live desk state.",
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
    // Cross-product by design: it prefetches HELIX flow and Thermal GEX in PARALLEL and hands the
    // model both sides unmerged, so the compare card can show them side by side rather than the
    // model blending two reads into one claim. Filed under THERMAL because the gamma side is what
    // the answer is anchored on.
    id: "thermal.helix_compare",
    product: "THERMAL",
    tool: "get_helix_thermal_compare",
    answers: "Do HELIX flow and Thermal dealer gamma AGREE or conflict on this ticker right now?",
    temporal: "as_of",
    freshness: "fast",
    entities: ["ticker"],
    entitlement: "premium",
    keywords: ["compare", "conflict", "flow vs gex", "agree", "disagree", "cross-check"],
    joinsWith: ["helix.tape", "thermal.heatmap"],
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
    temporal: "snapshot_delta",
    freshness: "fast",
    entities: ["ticker", "strike", "expiry", "session"],
    entitlement: "premium",
    keywords: ["changed", "shift", "moved", "since", "delta", "drift"],
    joinsWith: ["thermal.positioning", "thermal.regime_events"],
    caveat:
      "A diff of the current heatmap against the previously cached one (`previous_asof`). `limit` caps ROWS, not time — it cannot be pointed at an earlier session.",
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
    id: "thermal.compare",
    product: "THERMAL",
    tool: "get_thermal_compare",
    answers: "How do SPY, SPX, and QQQ dealer positioning compare side by side?",
    temporal: "as_of",
    freshness: "fast",
    entities: ["ticker"],
    entitlement: "premium",
    keywords: ["compare", "spy vs spx", "triple desk", "side by side"],
    joinsWith: ["thermal.positioning", "thermal.heatmap"],
  },

  {
    id: "helix.flow_brief",
    product: "HELIX",
    tool: "get_flow_brief",
    answers: "What is the deterministic HELIX session flow brief?",
    temporal: "as_of",
    freshness: "realtime",
    entities: ["ticker", "session"],
    entitlement: "premium",
    keywords: ["flow brief", "summarize tape", "session memo"],
    joinsWith: ["helix.tape"],
  },
  {
    id: "helix.tape_analytics",
    product: "HELIX",
    tool: "get_helix_tape_analytics",
    answers: "What are the Net Premium leaders, route breakdown, and expiry concentration on the tape?",
    temporal: "as_of",
    freshness: "realtime",
    entities: ["ticker", "session"],
    entitlement: "premium",
    keywords: ["net premium", "route breakdown", "expiry concentration", "leaderboard"],
    joinsWith: ["helix.tape", "helix.derived_panels"],
  },
  {
    id: "helix.derived_panels",
    product: "HELIX",
    tool: "get_helix_derived",
    // DERIVED, not fetched. Catalogued separately from the raw tape because "what is stacking"
    // and "show me the prints" rank alike on keywords and only one of them the tape can answer.
    answers: "What is HELIX making of the tape — stacked hits, top prints, velocity spikes, split flow?",
    temporal: "snapshot_delta",
    freshness: "realtime",
    entities: ["ticker", "strike", "expiry"],
    entitlement: "premium",
    keywords: ["stacked", "stacking", "top prints", "top hits", "velocity", "radar", "split flow", "repeated", "hits"],
    joinsWith: ["helix.tape", "thermal.positioning", "vector.full_state"],
    caveat:
      "Aggregates a FIXED recent window of the current tape. `limit` caps rows, not time — it cannot be pointed at an earlier session.",
  },
  // ── VECTOR ──
  {
    id: "vector.full_state",
    product: "VECTOR",
    tool: "get_vector_full_state",
    answers: "What is Vector's full chart state for a ticker — walls, beads, flip, magnet?",
    temporal: "as_of",
    // NOT "realtime" (sub-minute). This state is served cache-first from a 15-minute TTL, warmed
    // by a 5-minute RTH-gated cron that covers only the ~55 allowlist names — so off-hours, and
    // for every other symbol, an entry simply ages until it expires. `periodic` states the
    // guarantee; `realtime` stated the best case, next to a tool description that says the read
    // can be 15 minutes old.
    freshness: "periodic",
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
    temporal: "snapshot_delta",
    // Same cache as vector.full_state — see the note there.
    freshness: "periodic",
    entities: ["ticker", "strike"],
    entitlement: "premium",
    keywords: ["pulse", "just changed", "signal", "forming", "flipped", "shifted", "alert"],
    joinsWith: ["vector.full_state", "vector.wall_dynamics"],
    caveat:
      "A diff of the CURRENT cached snapshot against the previous one, not a queryable window — it can say what changed between them, never what the pulse looked like at an earlier time. Both ends are cached reads, so neither is 'now': when the same snapshot is served twice the diff has nothing new in it, which the payload reports as is_new_observation: false.",
  },
  {
    id: "vector.chart_analytics",
    product: "VECTOR",
    tool: "get_vector_analytics",
    // BAR-DERIVED, not state-derived. Catalogued separately from full_state because "where is the
    // POC" and "where is the call wall" rank alike on Vector keywords and only one of them the
    // wall/GEX state can answer — the same distinction pulse vs full_state already carries.
    answers:
      "What do Vector's chart analytics show — volume profile POC/value area, market structure (HH/LH/HL/LL, BOS/CHoCH), the auto-fib swing and golden pocket, key levels (HOD/LOD, opening range, floor pivots), the OpEx calendar, the daily dealer-regime series, the screener presets and the peer comparison?",
    temporal: "as_of",
    freshness: "realtime",
    entities: ["ticker"],
    entitlement: "premium",
    keywords: [
      "volume profile",
      "poc",
      "point of control",
      "value area",
      "market structure",
      "bos",
      "choch",
      "higher high",
      "lower low",
      "golden pocket",
      "fib",
      "retracement",
      "opening range",
      "floor pivots",
      "pivot",
      "hod",
      "lod",
      "opex",
      "triple witching",
      "screener",
      "scanner",
      "nearest flip",
      "compare",
    ],
    joinsWith: ["vector.full_state", "vector.pulse", "thermal.positioning"],
  },
  {
    id: "vector.wall_dynamics",
    product: "VECTOR",
    tool: "get_wall_dynamics",
    answers: "How have the walls MOVED through the session?",
    temporal: "snapshot_delta",
    freshness: "fast",
    entities: ["ticker", "strike", "session"],
    entitlement: "premium",
    keywords: ["wall moved", "migrating", "changed", "through the day", "since open"],
    joinsWith: ["thermal.matrix_changes"],
    caveat:
      "Composed from the live Vector state; it takes no time parameter at all and cannot describe walls at a past moment.",
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
    answers: "Why did Cortex commit or veto a specific name (today, or on a given past session)?",
    temporal: "point_in_time",
    freshness: "fast",
    entities: ["ticker", "play", "session"],
    entitlement: "premium",
    keywords: ["cortex", "veto", "why", "decision", "blocked", "skipped"],
    caveat:
      "One decision, pinnable to a session: pass `date` (YYYY-MM-DD) to explain a SPECIFIC past play's frozen commit evidence, else today. Still one decision, not an ordered log of a name's history.",
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
    temporal: "point_in_time",
    freshness: "session",
    entities: ["ticker", "session"],
    entitlement: "premium",
    keywords: ["edition", "playbook", "tonight", "evening", "legacy"],
    caveat: "Accepts a date and returns THAT session's published edition — one of the few genuinely point-in-time sources. Without a date it serves the latest. Built once per session — it reflects the state at build time, not the live tape.",
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
    temporal: "live_only",
    freshness: "session",
    entities: ["session"],
    entitlement: "premium",
    keywords: ["fomc", "cpi", "macro", "calendar", "economic"],
    caveat:
      "Live only, and it looks FORWARD — `days_ahead` is a forward window, not a lookback. It lists scheduled releases, and cannot say what an indicator printed in the past.",
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
    temporal: "live_only",
    freshness: "fast",
    entities: [],
    entitlement: "premium",
    keywords: ["fallback", "raw", "endpoint"],
    caveat:
      "Live only by default. It is an escape hatch across many routes, so the ENDPOINT decides what comes back and nothing here guarantees a temporal class — treat every result as present-time unless the payload stamps otherwise. Escape hatch, not a first choice. An unknown query param can silently return a DIFFERENT " +
      "slice than intended — see FINDINGS 2026-08-10, where ?view=outcomes served the 0DTE lane " +
      "with a 200. Prefer a registered capability whenever one exists.",
  },

  // ── COVERAGE PASS 2026-08-10 · the remaining 67 tools ────────────────────────────────────────
  //
  // WHY THIS BLOCK EXISTS. The catalog covered 51 of the then-118 tools, and `plan.ts` therefore
  // raised its temporal violation only when EVERY tool a turn called was catalogued — with 57%
  // uncatalogued that was almost never. The guard was armed and dormant: a turn mixing one
  // catalogued source with three unknown ones passed the check without the check meaning anything.
  //
  // That pass closed the gap and the catalog has stayed complete since: coverage is 137 of 137
  // today, held 1:1 by `registry.test.ts`. The numbers above are the state BEFORE this block, kept
  // as the reason it exists — do not read them as current.
  //
  // THE CLASSIFICATION RULE, applied to every entry below: `temporal` is read off the
  // IMPLEMENTATION in `run-tool.ts`, and ambiguity resolves DOWNWARD. Marking a live-only source
  // as `windowed` is the harm the registry exists to prevent — the planner would answer a
  // historical question from present data and the answer would look perfect. Marking a windowed
  // source as `live_only` costs only that the planner will not lean on it for history. So where
  // the implementation does not demonstrably accept a lookback or return a series, the entry says
  // `live_only`, even where the upstream might support more.
  //
  // A CALENDAR IS NOT HISTORY. `get_fda_calendar`, `get_ipo_calendar` and `get_earnings_calendar`
  // look FORWARD; they are `live_only` because they return the schedule as it stands now, not
  // because they are stale.

  // ── Market structure & breadth ──
  {
    id: "market.breadth",
    product: "MARKET",
    tool: "get_market_breadth",
    answers: "How broad is the move — advancers vs decliners, sector ETFs, full-market summary?",
    temporal: "as_of",
    freshness: "fast",
    entities: ["ticker", "session"],
    entitlement: "premium",
    keywords: ["breadth", "advancers", "decliners", "participation", "broad"],
    joinsWith: ["market.stats"],
  },
  {
    id: "market.stats",
    product: "MARKET",
    tool: "get_market_stats",
    answers: "What are today's market-wide options stats — total volume, correlations, tide, net flow?",
    temporal: "as_of",
    freshness: "fast",
    entities: ["session"],
    entitlement: "premium",
    keywords: ["market", "total volume", "correlation", "tide", "net flow"],
    joinsWith: ["market.breadth"],
  },
  {
    id: "market.oi_change",
    product: "MARKET",
    tool: "get_market_oi_change",
    answers: "Which contracts saw the largest open-interest change across the market?",
    temporal: "as_of",
    freshness: "session",
    entities: ["ticker", "contract", "strike", "expiry"],
    entitlement: "premium",
    keywords: ["open interest", "oi change", "positioning build"],
    caveat: "OI settles overnight, so this reflects the PRIOR session's build, not today's intraday flow.",
  },
  {
    id: "market.top_net_impact",
    product: "MARKET",
    tool: "get_top_net_impact",
    answers: "Which names are moving the market most by net options impact right now?",
    temporal: "live_only",
    freshness: "fast",
    entities: ["ticker"],
    entitlement: "premium",
    keywords: ["net impact", "movers", "biggest"],
    caveat: "Live only — the current impact ranking, with no record of what led earlier.",
  },
  {
    id: "market.sector_flow",
    product: "MARKET",
    tool: "get_sector_flow",
    answers: "Where is money going by sector — sector tide and sector ETF performance?",
    temporal: "live_only",
    freshness: "fast",
    entities: ["ticker"],
    entitlement: "premium",
    keywords: ["sector", "rotation", "tide", "xlk", "xlf"],
    caveat: "Live only — sector tide as it stands now; it cannot show how rotation developed.",
  },
  {
    id: "market.ah_movers",
    product: "MARKET",
    tool: "get_ah_movers",
    answers: "What is moving after hours?",
    temporal: "live_only",
    freshness: "fast",
    entities: ["ticker"],
    entitlement: "premium",
    keywords: ["after hours", "extended", "post market", "movers"],
    caveat: "Live only — the current after-hours board, not a log of what moved and faded.",
  },
  {
    id: "market.screener",
    product: "MARKET",
    tool: "get_screener",
    answers: "Which names pass a screen — short squeeze, contracts, option flow, dark pool?",
    temporal: "live_only",
    freshness: "fast",
    entities: ["ticker", "contract"],
    entitlement: "premium",
    keywords: ["screener", "scan", "filter", "squeeze"],
    caveat: "Live only — the screen re-runs against present data, so past passes are unrecoverable.",
  },
  {
    id: "market.seasonality",
    product: "MARKET",
    tool: "get_seasonality",
    answers: "How has this month or period performed historically for the market or a ticker?",
    temporal: "windowed",
    freshness: "historical",
    entities: ["ticker"],
    entitlement: "premium",
    keywords: ["seasonality", "historically", "this month", "average return"],
    caveat: "A base rate over past years, not a forecast — it says nothing about the current setup.",
  },
  {
    id: "market.peer_rs",
    product: "MARKET",
    tool: "get_peer_rs",
    answers: "How is this name performing relative to its peers?",
    temporal: "windowed",
    freshness: "fast",
    entities: ["ticker"],
    entitlement: "premium",
    keywords: ["relative strength", "peers", "outperform", "vs sector"],
    joinsWith: ["market.qqq_rs"],
  },
  {
    id: "market.qqq_rs",
    product: "MARKET",
    tool: "get_qqq_relative_strength",
    answers: "How is the market performing relative to QQQ?",
    temporal: "windowed",
    freshness: "fast",
    entities: ["ticker"],
    entitlement: "premium",
    keywords: ["qqq", "relative strength", "nasdaq", "leadership"],
    joinsWith: ["market.peer_rs"],
  },
  {
    id: "market.bars",
    product: "MARKET",
    tool: "get_uw_bars",
    answers: "What did price actually do — OHLC bars at a chosen candle size?",
    temporal: "windowed",
    freshness: "fast",
    entities: ["ticker", "session"],
    entitlement: "premium",
    keywords: ["bars", "candles", "ohlc", "price history", "chart data"],
    caveat: "The only general price-history source here — prefer it over live quotes for any 'what happened at' question.",
  },
  {
    id: "market.uw_technicals",
    product: "MARKET",
    tool: "get_uw_technicals",
    answers: "What do the technical indicators read — RSI, MACD, moving averages, bands?",
    temporal: "as_of",
    freshness: "fast",
    entities: ["ticker"],
    entitlement: "premium",
    keywords: ["rsi", "macd", "sma", "ema", "bollinger", "indicator", "overbought"],
  },
  {
    id: "market.nbbo",
    product: "MARKET",
    tool: "get_nbbo",
    answers: "What is the current NBBO quote, last trade, and today's open/close for a stock?",
    temporal: "as_of",
    freshness: "realtime",
    entities: ["ticker"],
    entitlement: "premium",
    keywords: ["nbbo", "bid", "ask", "spread", "last trade"],
  },
  {
    id: "market.stock_state",
    product: "MARKET",
    tool: "get_stock_state",
    answers: "What is this ticker's overall options state — volume/OI by expiry, fundamentals breakdown?",
    temporal: "as_of",
    freshness: "fast",
    entities: ["ticker", "expiry"],
    entitlement: "premium",
    keywords: ["stock state", "overview", "breakdown", "summary"],
  },
  {
    id: "platform.cross_product_read",
    product: "PLATFORM",
    tool: "get_cross_product_read",
    answers:
      "Do the products agree about this ticker, and where exactly do they disagree? Joins Helix, " +
      "Thermal, Vector, Meridian and Night Hawk into one read.",
    temporal: "live_only",
    freshness: "fast",
    entities: ["ticker"],
    entitlement: "premium",
    keywords: [
      "cross product", "disagree", "disagreement", "conflict", "agree", "consensus",
      "what matters", "why is", "what changed", "strongest setups", "across products",
      "all products", "everything", "combined", "together",
    ],
    joinsWith: [],
    caveat:
      "Live only — this is a snapshot of what the products say NOW, joined at read time. It cannot " +
      "answer what the products agreed about last Tuesday; nothing here is a stored history. " +
      "A `split` verdict is REPORTED, never resolved — four products against one is not a vote, and " +
      "the lone dissenter is often the reason to look twice. Always state `coverage`: an agreement " +
      "among two products is not an agreement among five. Thermal deliberately casts no directional " +
      "vote (dealer gamma is not a directional measurement), so its absence from the camps is " +
      "correct behaviour and must not be reported as an outage.",
  },
  {
    id: "market.polygon_raw",
    product: "PLATFORM",
    tool: "get_polygon",
    answers: "Read an arbitrary Polygon REST endpoint when no registered capability covers it.",
    temporal: "live_only",
    freshness: "realtime",
    entities: ["ticker"],
    entitlement: "premium",
    keywords: ["polygon", "raw", "endpoint", "fallback"],
    caveat:
      "Live only by default. Escape hatch, not a first choice. The endpoint decides what comes back, so nothing here " +
      "guarantees the temporal class — treat every result as live unless the payload stamps otherwise.",
  },
  {
    id: "market.web_search",
    product: "CATALYSTS",
    tool: "get_web_search",
    answers: "What is being reported publicly about this, outside our own data?",
    temporal: "live_only",
    freshness: "fast",
    entities: [],
    entitlement: "premium",
    keywords: ["search", "web", "news", "reported", "why is"],
    caveat: "Live only. Third-party text, not a BLACKOUT measurement — never present a search result as desk data.",
  },

  // ── Volatility ──
  {
    id: "vol.iv_stats",
    product: "MARKET",
    tool: "get_iv_stats",
    answers: "Where is implied volatility relative to its own range — IV rank and percentile?",
    temporal: "as_of",
    freshness: "fast",
    entities: ["ticker"],
    entitlement: "premium",
    keywords: ["iv rank", "iv percentile", "implied volatility", "rich", "cheap"],
    joinsWith: ["vol.realized", "vol.regime"],
  },
  {
    id: "vol.term_structure",
    product: "MARKET",
    tool: "get_iv_term_structure",
    answers: "What does the IV term structure look like across expiries — contango or backwardation?",
    temporal: "live_only",
    freshness: "fast",
    entities: ["ticker", "expiry"],
    entitlement: "premium",
    keywords: ["term structure", "contango", "backwardation", "curve", "iv by expiry"],
    caveat: "Live only. A curve across EXPIRIES at one instant — not a time series, so it cannot show how the curve moved.",
  },
  {
    id: "vol.realized",
    product: "MARKET",
    tool: "get_realized_vol",
    answers: "What has realized volatility actually been over the last 10 and 30 days?",
    temporal: "windowed",
    freshness: "session",
    entities: ["ticker"],
    entitlement: "premium",
    keywords: ["realized vol", "historical volatility", "hv", "actual movement"],
    joinsWith: ["vol.iv_stats"],
  },
  {
    id: "vol.regime",
    product: "MARKET",
    tool: "get_volatility_regime",
    answers: "What volatility regime are we in — VIX level, term structure, IV rank together?",
    temporal: "as_of",
    freshness: "fast",
    entities: ["ticker"],
    entitlement: "premium",
    keywords: ["vol regime", "volatility regime", "calm", "stressed", "vix"],
    joinsWith: ["vol.vix_term", "vol.iv_stats"],
  },
  {
    id: "vol.vix_term",
    product: "MARKET",
    tool: "get_vix_term",
    answers: "What is the VIX complex saying — VIX, VIX9D, VIX3M and the spread between them?",
    temporal: "as_of",
    freshness: "realtime",
    entities: ["ticker"],
    entitlement: "premium",
    keywords: ["vix", "vix3m", "vix9d", "term", "fear"],
    joinsWith: ["vol.regime"],
  },
  {
    id: "vol.skew",
    product: "MARKET",
    tool: "get_risk_reversal_skew",
    answers: "How is skew positioned — what are puts bid over calls by?",
    temporal: "live_only",
    freshness: "fast",
    entities: ["ticker", "strike"],
    entitlement: "premium",
    keywords: ["skew", "risk reversal", "put skew", "smile"],
    caveat: "Live only — skew as it stands now; it cannot show how skew moved into an event.",
  },
  {
    id: "vol.nope",
    product: "MARKET",
    tool: "get_nope",
    answers: "What is NOPE — net options pricing effect — reading for this ticker?",
    temporal: "as_of",
    freshness: "fast",
    entities: ["ticker"],
    entitlement: "premium",
    keywords: ["nope", "net options pricing effect", "dealer pressure"],
  },

  // ── Chain & contract level ──
  {
    id: "chain.options_chain",
    product: "THERMAL",
    tool: "get_options_chain",
    answers: "What does the options chain look like for an expiry — strikes, prices, volume?",
    temporal: "live_only",
    freshness: "realtime",
    entities: ["ticker", "contract", "strike", "expiry"],
    entitlement: "premium",
    keywords: ["chain", "strikes", "options chain", "contracts"],
    caveat: "Live only. The chain AS IT IS NOW. It cannot show what a contract was priced at earlier.",
  },
  {
    id: "chain.atm",
    product: "THERMAL",
    tool: "get_atm_chains",
    answers: "What are the at-the-money contracts and their pricing right now?",
    temporal: "live_only",
    freshness: "realtime",
    entities: ["ticker", "contract", "strike", "expiry"],
    entitlement: "premium",
    keywords: ["atm", "at the money", "near the money", "closest strike"],
    caveat: "Live only — which strikes are ATM now, which changes as spot moves.",
  },
  {
    id: "chain.greeks",
    product: "THERMAL",
    tool: "get_greeks",
    answers: "What are the greeks on this ticker's contracts — delta, gamma, theta, vega?",
    temporal: "live_only",
    freshness: "realtime",
    entities: ["ticker", "contract", "strike", "expiry"],
    entitlement: "premium",
    keywords: ["greeks", "delta", "gamma", "theta", "vega", "charm"],
    caveat: "Live only — greeks recompute continuously and are not retrievable for a past moment.",
  },
  {
    id: "chain.gex",
    product: "THERMAL",
    tool: "get_gex",
    answers: "What is gamma exposure by strike for an expiry?",
    temporal: "as_of",
    freshness: "fast",
    entities: ["ticker", "strike", "expiry"],
    entitlement: "premium",
    keywords: ["gex", "gamma exposure", "dealer gamma", "walls"],
  },
  {
    id: "chain.greek_flow",
    product: "THERMAL",
    tool: "get_greek_flow",
    answers: "How is greek exposure FLOWING — what are dealers accumulating by expiry?",
    temporal: "as_of",
    freshness: "fast",
    entities: ["ticker", "expiry"],
    entitlement: "premium",
    keywords: ["greek flow", "gamma flow", "vanna", "charm", "exposure change"],
  },
  {
    id: "chain.group_greek_flow",
    product: "THERMAL",
    tool: "get_group_greek_flow",
    answers: "How is greek exposure flowing across a group — mag7, semis, and similar baskets?",
    temporal: "as_of",
    freshness: "fast",
    entities: ["ticker", "expiry"],
    entitlement: "premium",
    keywords: ["mag7", "semis", "basket", "group", "greek flow"],
  },
  {
    id: "chain.oi_per_strike",
    product: "THERMAL",
    tool: "get_oi_per_strike",
    answers: "How is open interest distributed across strikes for an expiry?",
    temporal: "as_of",
    freshness: "session",
    entities: ["ticker", "strike", "expiry"],
    entitlement: "premium",
    keywords: ["open interest", "oi", "by strike", "concentration"],
    caveat: "OI settles overnight — this is the prior session's book, not today's flow.",
  },
  {
    id: "chain.oi_per_expiry",
    product: "THERMAL",
    tool: "get_oi_per_expiry",
    answers: "How is open interest distributed across expiries?",
    temporal: "as_of",
    freshness: "session",
    entities: ["ticker", "expiry"],
    entitlement: "premium",
    keywords: ["open interest", "by expiry", "term", "concentration"],
    caveat: "OI settles overnight — this is the prior session's book, not today's flow.",
  },
  {
    id: "chain.options_volume",
    product: "THERMAL",
    tool: "get_options_volume",
    answers: "What are today's call and put volumes for this ticker?",
    temporal: "live_only",
    freshness: "fast",
    entities: ["ticker"],
    entitlement: "premium",
    keywords: ["volume", "call volume", "put volume", "put call ratio"],
    caveat: "Live only. Session-cumulative as of now — it cannot be sliced to an earlier point in the day.",
  },
  {
    id: "chain.contract",
    product: "THERMAL",
    tool: "get_option_contract",
    answers: "What happened on one specific contract — its flow and intraday history?",
    temporal: "event_log",
    freshness: "fast",
    entities: ["contract", "ticker", "strike", "expiry"],
    entitlement: "premium",
    keywords: ["contract", "occ", "specific strike", "that contract"],
  },

  // ── Flow ──
  {
    id: "flow.per_strike",
    product: "HELIX",
    tool: "get_flow_per_strike",
    answers: "How is today's premium flow distributed across strikes?",
    temporal: "as_of",
    freshness: "fast",
    entities: ["ticker", "strike"],
    entitlement: "premium",
    keywords: ["flow by strike", "premium by strike", "where is the flow"],
  },
  {
    id: "flow.per_expiry",
    product: "HELIX",
    tool: "get_flow_expiry_breakdown",
    answers: "How is today's premium flow distributed across expiries?",
    temporal: "as_of",
    freshness: "fast",
    entities: ["ticker", "expiry"],
    entitlement: "premium",
    keywords: ["flow by expiry", "term", "dated", "which expiry"],
  },
  {
    id: "flow.lit",
    product: "HELIX",
    tool: "get_lit_flow",
    answers: "What are the lit-exchange prints for this ticker?",
    temporal: "event_log",
    freshness: "fast",
    entities: ["ticker"],
    entitlement: "premium",
    keywords: ["lit", "prints", "exchange", "on exchange"],
    joinsWith: ["flow.unusual"],
  },
  {
    id: "flow.unusual",
    product: "HELIX",
    tool: "get_unusual_trades",
    answers: "What unusual options trades printed — market-wide or for one ticker?",
    temporal: "event_log",
    freshness: "fast",
    entities: ["ticker", "contract"],
    entitlement: "premium",
    keywords: ["unusual", "sweep", "block", "whale", "big trade"],
    joinsWith: ["flow.lit"],
  },
  {
    id: "flow.net_prem_ticks",
    product: "HELIX",
    tool: "get_net_prem_ticks",
    answers: "How did net premium build through the session, tick by tick?",
    temporal: "event_log",
    freshness: "fast",
    entities: ["ticker", "session"],
    entitlement: "premium",
    keywords: ["net premium", "ticks", "intraday build", "through the day"],
    caveat: "One of the few intraday SERIES here — prefer it for 'when during the day' questions.",
  },

  // ── Positioning: ownership, insiders, congress ──
  {
    id: "own.ownership",
    product: "MARKET",
    tool: "get_ownership",
    answers: "Who owns this name — institutional ownership and insider holdings?",
    temporal: "as_of",
    freshness: "historical",
    entities: ["ticker"],
    entitlement: "premium",
    keywords: ["ownership", "holders", "institutional", "float"],
    caveat: "Filing-derived and quarterly — it lags the market by weeks and cannot describe current positioning.",
  },
  {
    id: "own.institutional",
    product: "MARKET",
    tool: "get_institutional",
    answers: "What has a named institution been buying or holding?",
    temporal: "as_of",
    freshness: "historical",
    entities: ["ticker"],
    entitlement: "premium",
    keywords: ["citadel", "berkshire", "institution", "13f", "fund"],
    caveat: "13F-derived and quarterly — a position shown here may have been exited months ago.",
  },
  {
    id: "own.insider",
    product: "MARKET",
    tool: "get_insider_flow",
    answers: "What have insiders been buying or selling in this name?",
    temporal: "event_log",
    freshness: "historical",
    entities: ["ticker"],
    entitlement: "premium",
    keywords: ["insider", "form 4", "ceo bought", "executive selling"],
  },
  {
    id: "own.congress",
    product: "MARKET",
    tool: "get_congress_trades",
    answers: "What have members of Congress disclosed trading?",
    temporal: "event_log",
    freshness: "historical",
    entities: ["ticker"],
    entitlement: "premium",
    keywords: ["congress", "politician", "pelosi", "disclosure", "senator"],
    joinsWith: ["own.congress_unusual"],
  },
  {
    id: "own.congress_unusual",
    product: "MARKET",
    tool: "get_congress_unusual",
    answers: "Which congressional trades stand out as unusual?",
    temporal: "event_log",
    freshness: "historical",
    entities: ["ticker"],
    entitlement: "premium",
    keywords: ["congress", "unusual", "politician", "suspicious timing"],
    joinsWith: ["own.congress"],
  },
  {
    id: "own.short_interest",
    product: "MARKET",
    tool: "get_short_interest",
    answers: "What is short interest in this name?",
    temporal: "as_of",
    freshness: "historical",
    entities: ["ticker"],
    entitlement: "premium",
    keywords: ["short interest", "si", "days to cover", "shorted"],
    caveat: "Exchange short interest is reported twice monthly — it is weeks stale by construction.",
    joinsWith: ["own.short_data"],
  },
  {
    id: "own.short_data",
    product: "MARKET",
    tool: "get_short_data",
    answers: "What does the full short picture look like — interest, daily volume, FTDs, squeeze screen?",
    temporal: "windowed",
    freshness: "session",
    entities: ["ticker"],
    entitlement: "premium",
    keywords: ["short volume", "ftd", "fails to deliver", "squeeze", "borrow"],
    joinsWith: ["own.short_interest"],
  },

  // ── Fundamentals & corporate ──
  {
    id: "fund.profile",
    product: "MARKET",
    tool: "get_company_profile",
    answers: "What is this company — sector, description, related tickers?",
    temporal: "as_of",
    freshness: "historical",
    entities: ["ticker"],
    entitlement: "premium",
    keywords: ["profile", "what does", "company", "sector", "description"],
  },
  {
    id: "fund.financials",
    product: "MARKET",
    tool: "get_financials",
    answers: "What do the financial statements show — income, balance sheet, cash flow?",
    temporal: "windowed",
    freshness: "historical",
    entities: ["ticker"],
    entitlement: "premium",
    keywords: ["financials", "revenue", "earnings", "balance sheet", "cash flow", "margins"],
  },
  {
    id: "fund.dividends",
    product: "MARKET",
    tool: "get_dividends",
    answers: "What is this name's dividend and split history?",
    temporal: "windowed",
    freshness: "historical",
    entities: ["ticker"],
    entitlement: "premium",
    keywords: ["dividend", "yield", "split", "ex date", "payout"],
  },
  {
    id: "fund.analyst_ratings",
    product: "CATALYSTS",
    tool: "get_analyst_ratings",
    answers: "What are analysts saying — ratings and recent changes?",
    temporal: "event_log",
    freshness: "periodic",
    entities: ["ticker"],
    entitlement: "premium",
    keywords: ["analyst", "rating", "upgrade", "downgrade", "buy rating"],
    joinsWith: ["fund.price_targets"],
  },
  {
    id: "fund.price_targets",
    product: "CATALYSTS",
    tool: "get_price_targets",
    answers: "What price targets have been published for this name?",
    temporal: "as_of",
    freshness: "periodic",
    entities: ["ticker"],
    entitlement: "premium",
    keywords: ["price target", "pt", "analyst target", "fair value"],
    joinsWith: ["fund.analyst_ratings"],
  },
  {
    id: "fund.earnings_history",
    product: "CATALYSTS",
    tool: "get_earnings_history",
    answers: "How has this name reported historically — actuals versus estimates?",
    temporal: "windowed",
    freshness: "historical",
    entities: ["ticker"],
    entitlement: "premium",
    keywords: ["earnings history", "beat", "miss", "eps", "past earnings"],
    caveat:
      "print_history uses Meridian timing-aware reactions (same as the desk). Do not quote raw UW reaction_pct for how a name reacted.",
    joinsWith: ["fund.earnings_calendar", "meridian.event"],
  },
  // ── Meridian: the catalyst desk ──
  // Registered as MERIDIAN rather than CATALYSTS on purpose. The calendar tools answer "when",
  // and Meridian answers "and what does the desk make of it" — a different question with a
  // different payload, so folding them together would let the planner substitute one for the other.
  {
    id: "meridian.timeline",
    product: "MERIDIAN",
    tool: "get_meridian_timeline",
    answers: "What catalysts are coming — macro, earnings, OpEx and FDA in one ranked ET timeline?",
    temporal: "live_only",
    freshness: "periodic",
    entities: ["ticker", "session"],
    entitlement: "premium",
    keywords: [
      "catalyst", "catalysts", "calendar", "coming up", "this week", "timeline",
      "what moves", "event", "events", "opex", "macro", "fomc", "cpi", "earnings this week",
    ],
    caveat:
      "Live only — the forward schedule as it stands now, not a record of past events. `truncated: true` means the list was capped by `limit`; raise it rather than concluding nothing else is scheduled.",
    joinsWith: ["meridian.event", "fund.earnings_calendar"],
  },
  {
    id: "meridian.event",
    product: "MERIDIAN",
    tool: "get_meridian_event",
    answers:
      "What does the desk know about ONE catalyst — print history anchored to BMO/AMC timing, implied vs realized, dealer structure, the play read, OpEx pin accuracy, prior macro releases?",
    // POINT_IN_TIME, not as_of. The registry's own guard caught this and it was right: the tool
    // takes a `date`, so `earnings:NVDA:2026-05-20` reaches a print from three months ago. Filing
    // it as `as_of` would tell the planner this source cannot speak about the past, and the
    // historical questions — "how did this name trade its last four prints", "how did similar
    // setups behave" — are most of why the tool is worth having.
    temporal: "point_in_time",
    freshness: "periodic",
    entities: ["ticker", "session"],
    entitlement: "premium",
    keywords: [
      "why", "detail", "play read", "pin", "max pain", "dealer", "expected move",
      "how does it react", "reaction", "prior", "last print", "gamma flip",
    ],
    caveat:
      "Needs an event id from get_meridian_timeline, or kind + ticker + date. Earnings reactions carry a `reaction_basis` saying WHICH session was measured — an AMC print's reaction is the next session, and a value without its basis is not comparable across names.",
    joinsWith: ["meridian.timeline", "fund.earnings_history", "meridian.peer_cohort"],
  },
  {
    id: "meridian.peer_cohort",
    product: "MERIDIAN",
    tool: "get_meridian_peer_cohort",
    answers:
      "Which sector peers is this earnings print ranked against, and how have those peers historically reacted to their own prints?",
    temporal: "live_only",
    freshness: "periodic",
    entities: ["ticker", "session"],
    entitlement: "premium",
    keywords: [
      "sector peers",
      "peer cohort",
      "compared against",
      "peer comparison",
      "same sector",
      "peer reaction",
      "implied move vs peers",
      "rich vs cohort",
    ],
    caveat:
      "Live only — the cohort is built from the CURRENT Meridian timeline window (today forward), not a historical calendar; a `date` in the past that falls outside that window resolves to \"not found\", not an old cohort. Earnings only. Built from the same-SIC-major-group names in the loaded window — not a static watchlist. Pass an event id from get_meridian_timeline or kind=earnings + ticker + date.",
    joinsWith: ["meridian.timeline", "meridian.event", "fund.earnings_history"],
  },
  {
    id: "fund.earnings_calendar",
    product: "CATALYSTS",
    tool: "get_earnings_calendar",
    answers: "Who reports earnings and when?",
    temporal: "live_only",
    freshness: "periodic",
    entities: ["ticker", "session"],
    entitlement: "premium",
    keywords: ["earnings date", "when does", "reports", "calendar"],
    caveat: "Live only. Forward-looking schedule as it stands now — not a record of past reports.",
    joinsWith: ["fund.earnings_history"],
  },
  {
    id: "fund.earnings_market",
    product: "CATALYSTS",
    tool: "get_earnings_market",
    answers: "Who is reporting premarket and after the bell?",
    temporal: "live_only",
    freshness: "periodic",
    entities: ["ticker", "session"],
    entitlement: "premium",
    keywords: ["premarket earnings", "after hours earnings", "reporting today"],
    caveat:
      "Live only — today’s reporting schedule. Prefer meridian_reaction_pct over UW reaction_pct for print reactions.",
  },
  {
    id: "fund.catalysts",
    product: "CATALYSTS",
    tool: "get_catalysts",
    answers: "What upcoming or recent catalysts exist for this name?",
    temporal: "live_only",
    freshness: "periodic",
    entities: ["ticker"],
    entitlement: "premium",
    keywords: ["catalyst", "event", "upcoming", "what's coming"],
    caveat: "Live only — the catalyst list as it stands now, not a history of past events.",
  },
  {
    id: "fund.fda_calendar",
    product: "CATALYSTS",
    tool: "get_fda_calendar",
    answers: "What FDA decisions are scheduled?",
    temporal: "live_only",
    freshness: "periodic",
    entities: ["ticker", "session"],
    entitlement: "premium",
    keywords: ["fda", "pdufa", "approval", "biotech", "decision date"],
    caveat: "Live only. Forward-looking schedule as it stands now — not a record of past decisions.",
  },
  {
    id: "fund.ipo_calendar",
    product: "CATALYSTS",
    tool: "get_ipo_calendar",
    answers: "What IPOs are coming up?",
    temporal: "live_only",
    freshness: "periodic",
    entities: ["ticker", "session"],
    entitlement: "premium",
    keywords: ["ipo", "listing", "debut", "new issue"],
    caveat: "Live only. Forward-looking schedule as it stands now — not a record of past listings.",
  },
  {
    id: "fund.macro",
    product: "MARKET",
    tool: "get_macro_indicator",
    answers: "What does a macro indicator read — CPI, unemployment, and similar?",
    temporal: "as_of",
    freshness: "periodic",
    entities: [],
    entitlement: "premium",
    keywords: ["cpi", "inflation", "unemployment", "macro", "fed", "economic"],
  },
  {
    id: "fund.predictions",
    product: "MARKET",
    tool: "get_predictions_consensus",
    answers: "What is the prediction-market consensus?",
    temporal: "live_only",
    freshness: "fast",
    entities: ["ticker"],
    entitlement: "premium",
    keywords: ["prediction", "consensus", "odds", "betting", "market implied"],
    caveat: "Live only — present consensus odds, with no history of how they shifted.",
  },

  // ── ETFs ──
  {
    id: "etf.detail",
    product: "MARKET",
    tool: "get_etf_detail",
    answers: "What is inside this ETF — holdings, weights, sector exposure, flows?",
    temporal: "as_of",
    freshness: "session",
    entities: ["ticker"],
    entitlement: "premium",
    keywords: ["etf", "holdings", "weights", "exposure", "what's in"],
    joinsWith: ["etf.flow"],
  },
  {
    id: "etf.flow",
    product: "MARKET",
    tool: "get_etf_flow",
    answers: "Is money flowing into or out of this ETF?",
    temporal: "as_of",
    freshness: "fast",
    entities: ["ticker"],
    entitlement: "premium",
    keywords: ["etf flow", "inflow", "outflow", "creations", "redemptions"],
    joinsWith: ["etf.detail"],
  },

  // ── Desk products that had no entry ──
  {
    id: "spx.pulse",
    product: "SPX_SLAYER",
    tool: "get_spx_pulse",
    answers: "What just changed on the SPX desk?",
    temporal: "as_of",
    freshness: "realtime",
    entities: ["ticker", "session"],
    entitlement: "premium",
    keywords: ["pulse", "just changed", "latest", "moved"],
    joinsWith: ["spx.structure"],
  },
  {
    id: "spx.lotto_state",
    product: "SPX_SLAYER",
    tool: "get_lotto_state",
    answers: "What is the SPX lotto engine's current state?",
    temporal: "as_of",
    freshness: "realtime",
    entities: ["ticker", "session"],
    entitlement: "premium",
    keywords: ["lotto", "cheap", "flyer", "long shot"],
    joinsWith: ["spx.lotto_live"],
  },
  {
    id: "spx.lotto_live",
    product: "SPX_SLAYER",
    tool: "get_lotto_live",
    answers: "What is today's live lotto record?",
    temporal: "as_of",
    freshness: "fast",
    entities: ["ticker", "session"],
    entitlement: "premium",
    keywords: ["lotto record", "lotto today", "lotto result"],
    joinsWith: ["spx.lotto_state"],
  },
  {
    id: "spx.vs_nighthawk",
    product: "TRACK_RECORD",
    tool: "get_spx_vs_nighthawk_comparison",
    answers: "How is SPX Slayer performing versus Night Hawk over a window?",
    temporal: "windowed",
    freshness: "session",
    entities: ["session", "play"],
    entitlement: "premium",
    keywords: ["compare", "vs", "which is better", "head to head", "performance"],
    caveat: "Built so the comparison is computed once rather than synthesized from two separate reads.",
  },
  {
    id: "nighthawk.dossier",
    product: "NIGHT_HAWK",
    tool: "get_nighthawk_dossier",
    answers: "What was in the Night Hawk dossier for a given edition date?",
    temporal: "point_in_time",
    freshness: "session",
    entities: ["session", "ticker", "play"],
    entitlement: "premium",
    keywords: ["dossier", "edition", "that night", "writeup"],
    caveat: "One of the few genuinely point-in-time sources — it can answer what the desk thought on a past date.",
  },
  {
    id: "spx.gate_rules",
    product: "SPX_SLAYER",
    tool: "get_gate_rules",
    answers: "What are SPX Slayer's live play-gate thresholds (mixed-tape block, min grade, cooldowns)?",
    temporal: "live_only",
    freshness: "historical",
    entities: [],
    entitlement: "premium",
    keywords: ["gate", "rule", "why blocked", "criteria", "threshold", "spx slayer"],
    caveat: "Live only — SPX Slayer engine config as it stands in code NOW. NOT Night Hawk publish gates (get_gate_blocked_value).",
  },
  {
    id: "platform.uw_raw",
    product: "PLATFORM",
    tool: "get_uw",
    answers: "Read an arbitrary Unusual Whales endpoint when no registered capability covers it.",
    temporal: "live_only",
    freshness: "realtime",
    entities: ["ticker"],
    entitlement: "premium",
    keywords: ["uw", "unusual whales", "raw", "endpoint", "fallback"],
    caveat:
      "Live only by default. Escape hatch, not a first choice. The endpoint decides what comes back, so nothing here " +
      "guarantees the temporal class — treat every result as live unless the payload stamps otherwise.",
  },
  {
    id: "platform.ticker_search",
    product: "PLATFORM",
    tool: "search_ticker",
    answers: "Which ticker does this company name or partial symbol refer to?",
    temporal: "live_only",
    freshness: "historical",
    entities: ["ticker"],
    entitlement: "premium",
    keywords: ["ticker", "symbol", "what is the ticker", "company name"],
    caveat: "Live only, and a resolver rather than a market source — it answers no question about the market itself.",
  },
  {
    id: "nighthawk.gate_value",
    product: "NIGHT_HAWK",
    tool: "get_gate_blocked_value",
    answers: "What did the publish gates cost and save — how did the plays they blocked actually do?",
    temporal: "windowed",
    freshness: "session",
    entities: ["ticker", "session", "play"],
    entitlement: "premium",
    keywords: ["gate", "blocked", "counterfactual", "cost", "missed", "would have", "strict", "threshold"],
    joinsWith: ["nighthawk.rejections", "record.nighthawk_outcomes"],
    caveat:
      "Graded as a WIN/LOSS verdict per blocked play, not a P&L. `graded_total` is a SUBSET of " +
      "`blocked_total` — a gate with blocked plays and nothing graded has no verdict yet.",
  },
  {
    id: "record.grader_agreement",
    product: "TRACK_RECORD",
    tool: "get_grader_agreement",
    answers: "Do the mechanical and as-executed grades agree, and where exactly do they differ?",
    temporal: "windowed",
    freshness: "session",
    entities: ["ticker", "session", "play"],
    entitlement: "premium",
    keywords: ["grading", "agree", "audit", "verify", "integrity", "how do you know", "cross-check"],
    joinsWith: ["record.zerodte_record"],
    caveat:
      "The agreement rate is against `comparable` (rows graded on BOTH lanes), not the window. A " +
      "disagreement is a methodological difference between mid and executable grading, not a defect.",
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

/**
 * Capabilities that can answer "what CHANGED" — an ordered record, a lookback aggregate, or a
 * now-vs-last-snapshot delta.
 *
 * `snapshot_delta` belongs here and NOT in `historicalCapabilities()`. That split is the reason the
 * class exists: these sources answer "what just changed" well and cannot answer "what did it look
 * like yesterday" at all.
 */
export function changeCapabilities(): LargoCapability[] {
  return LARGO_CAPABILITIES.filter(
    (c) => c.temporal === "event_log" || c.temporal === "windowed" || c.temporal === "snapshot_delta"
  );
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
 * RANKING, NEVER FILTERING. This block adds information; it removes nothing. All 137 tools stay in
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
