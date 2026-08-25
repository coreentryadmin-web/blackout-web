import type { PreEarningsPackCard } from "@/lib/largo/pre-earnings-pack";

export type MeridianEventKind = "macro" | "earnings" | "opex" | "fda";

export type MeridianImpact = "high" | "medium" | "low";

/** One row on the catalyst timeline — macro print, earnings, OpEx, or FDA. */
export type MeridianTimelineItem = {
  id: string;
  kind: MeridianEventKind;
  title: string;
  subtitle: string | null;
  /** ET calendar date YYYY-MM-DD. */
  date: string;
  /** Approximate ET release time HH:mm when known. */
  time: string | null;
  impact: MeridianImpact;
  days_until: number;
  ticker: string | null;
  /** Earnings-only: confirmed/projected date status from calendar feed. */
  date_status?: string | null;
  /** Earnings-only: Benzinga importance 0–5. */
  importance?: number | null;
  /** Earnings-only: true when actual EPS/revenue landed. */
  is_printed?: boolean;
  /**
   * Earnings-only: the implied move, as a NUMBER.
   *
   * It was already in the subtitle string, but a sentence is not a datum — anything that wants
   * to rank, compare or chart it had to parse prose back into a float. Carried explicitly so the
   * sector cohort can be computed from the lane the reader is already looking at.
   */
  expected_move_pct?: number | null;
  /** Earnings-only: 2-digit SIC major group — the sector-cohort key. */
  sic_major_group?: string | null;
  /** Earnings-only: display name of that cohort, e.g. "Semis & Electronics". */
  sector_label?: string | null;
};

export type MeridianSpxPositioning = {
  available: boolean;
  spot: number | null;
  flip: number | null;
  flip_distance_pts: number | null;
  call_wall: number | null;
  put_wall: number | null;
  net_gex_label: string | null;
  gamma_regime: string | null;
};

export type MeridianFlowSkew = {
  available: boolean;
  bias: "bullish" | "bearish" | "neutral" | "unknown";
  summary: string;
  call_put_ratio: number | null;
  net_premium: number | null;
};

export type MeridianMacroIndicatorRead = {
  label: string;
  latest_value: number | null;
  prior_value: number | null;
  change_pct: number | null;
  as_of: string | null;
};

export type MeridianMacroBrief = {
  kind: "macro";
  event: string;
  date: string;
  time: string | null;
  impact: MeridianImpact;
  event_window: string | null;
  /** Consensus / forecast when the live calendar carries it. */
  estimate: string | null;
  macro_indicator: MeridianMacroIndicatorRead | null;
  /** Prior prints of the same macro family with SPX reaction. */
  release_history: MeridianMacroRelease[];
  correlation_rail: MeridianCorrelationRail;
  surprise: MeridianMacroSurprise | null;
  related_headlines: MeridianCatalystHeadline[];
  /** Lead economics narrative from Benzinga (prose — not a substitute for indicator actuals). */
  economics_narrative: string | null;
  spx_positioning: MeridianSpxPositioning;
  flow: MeridianFlowSkew;
  report: MeridianMacroReport;
  as_of: string;
};

export type MeridianMacroReport = {
  available: boolean;
  expected_move: {
    available: boolean;
    session_pct: number | null;
    intraday_60_pct: number | null;
    headline: string | null;
    source: "historical";
  };
  expectations: {
    available: boolean;
    consensus: string | null;
    headline: string;
    surprise_verdict: MeridianMacroSurprise["verdict"] | null;
  };
  outlook: {
    lean: "risk_on" | "risk_off" | "neutral";
    headline: string;
    summary: string;
  };
  watch_list: string[];
  warnings: string[];
  scenarios: string[];
  news_context: string[];
  disclaimer: string;
};

export type MeridianMacroRelease = {
  date: string;
  label: string;
  actual: number | null;
  estimate: number | null;
  prior: number | null;
  spx_session_pct: number | null;
  spx_next_day_pct: number | null;
  /** SPX move in the 60m after release (Polygon minute bars). */
  spx_intraday_60_pct: number | null;
};

export type MeridianCorrelationRail = {
  sample_size: number;
  avg_spx_session_pct: number | null;
  avg_spx_next_day_pct: number | null;
  avg_intraday_60_pct: number | null;
  regime_tag: "risk_on" | "risk_off" | "mixed" | "unknown";
  headline: string;
};

export type MeridianMacroSurprise = {
  actual: number | null;
  estimate: number | null;
  surprise_pct: number | null;
  verdict: "beat" | "miss" | "inline" | "unknown";
  historical: {
    beats: number;
    misses: number;
    avg_surprise_pct: number | null;
  };
};

export type MeridianAnalystRevision = {
  title: string;
  firm: string | null;
  action: string | null;
  published: string | null;
};

export type MeridianInsiderActivity = {
  title: string;
  published: string | null;
};

export type MeridianCongressActivity = {
  politician: string | null;
  ticker: string | null;
  transaction: string | null;
  published: string | null;
};

export type MeridianExpectedVsRealized = {
  /** The implied captured for the SAME print as `realized_move_pct`. Null when `same_event` is false. */
  expected_move_pct: number | null;
  realized_move_pct: number | null;
  ratio: number | null;
  verdict: "under" | "over" | "inline" | "unknown";
  /**
   * Are both numbers from the same print? Only then may a consumer show them together, take a
   * ratio, or use an "expected vs realized" label. False means the block describes one measured
   * reaction and nothing else.
   */
  same_event: boolean;
  headline: string | null;
};

export type MeridianCatalystHeadline = {
  title: string;
  channel: string | null;
  published: string | null;
};

export type MeridianStreetEstimate = {
  period: string | null;
  eps_estimate: number | null;
  revenue_estimate: number | null;
  source?: "earnings_calendar" | "uw" | null;
};

/** Structured earnings print row from the earnings calendar feed. */
export type MeridianEarningsCalendarRow = {
  benzinga_id: string | null;
  date: string;
  time: string | null;
  report_time_et: string | null;
  date_status: string | null;
  fiscal_period: string | null;
  fiscal_year: number | null;
  importance: number | null;
  currency: string | null;
  estimated_eps: number | null;
  actual_eps: number | null;
  eps_surprise: number | null;
  eps_surprise_pct: number | null;
  estimated_revenue: number | null;
  actual_revenue: number | null;
  revenue_surprise: number | null;
  revenue_surprise_pct: number | null;
  previous_eps: number | null;
  previous_revenue: number | null;
  eps_method: string | null;
  revenue_method: string | null;
  notes: string | null;
  last_updated: string | null;
  is_printed: boolean;
};

export type MeridianEarningsYoY = {
  eps_yoy_pct: number | null;
  revenue_yoy_pct: number | null;
};

export type MeridianEarningsGuidanceRow = {
  date: string;
  fiscal_period: string | null;
  fiscal_year: number | null;
  release_type: string | null;
  min_eps: number | null;
  max_eps: number | null;
  min_revenue: number | null;
  max_revenue: number | null;
  street_eps: number | null;
  street_revenue: number | null;
  eps_method: string | null;
  revenue_method: string | null;
  notes: string | null;
  last_updated: string | null;
};

export type MeridianEarningsRevision = {
  ticker: string;
  date: string;
  company_name: string | null;
  last_updated: string | null;
  date_status: string | null;
  importance: number | null;
  headline: string;
};

/** Estimate revision with EPS/revenue deltas (Redis snapshot diff). */
export type MeridianEstimateRevisionEntry = {
  ticker: string;
  company_name: string | null;
  date: string;
  last_updated: string;
  change_kind: "eps" | "revenue" | "date_status" | "print" | "calendar";
  eps_delta: number | null;
  revenue_delta_pct: number | null;
  estimated_eps: number | null;
  estimated_revenue: number | null;
  headline: string;
};

export type MeridianEarningsWeekAnalytics = {
  names_count: number;
  printed_this_week: number;
  eps_beat_rate: number | null;
  revenue_beat_rate: number | null;
  /** Prints each universe rate was computed from. `0` means the rate beside it is null. */
  eps_graded?: number;
  revenue_graded?: number;
  avg_surprise_pct: number | null;
  median_surprise_pct: number | null;
  headline: string;
};

export type MeridianStreetSkew = {
  skew: "bullish" | "bearish" | "neutral";
  raised_count: number;
  lowered_count: number;
  initiated_count: number;
  sample_size: number;
  headline: string;
  latest_target: number | null;
  latest_firm: string | null;
};

export type MeridianPriceTargetRow = {
  price_target: number;
  firm: string | null;
  action: string | null;
  summary: string;
  published: string | null;
};

export type MeridianAfterHoursMover = {
  title: string;
  channel: string | null;
  published: string | null;
};

export type MeridianCatalystBrief = {
  type: string;
  title: string;
  published: string | null;
};

export type MeridianEarningsWeekRow = {
  ticker: string;
  company_name: string | null;
  date: string;
  time_et: string | null;
  importance: number | null;
  date_status: string | null;
  estimated_eps: number | null;
  is_printed: boolean;
};

/**
 * The FULL earnings window the analytics panels read — deliberately separate from
 * `earnings_week`.
 *
 * `earnings_week` is a curated grid: importance >=4, capped at 24 rows. That curation is right for
 * a "mega-cap week" strip and wrong for analytics — a beat rate computed over only the biggest 24
 * names is not the week's beat rate, and a calendar built from them shows a fraction of the day's
 * prints. So the analytics window carries every row in range with the surprise/actual fields the
 * curated projection drops, rather than widening (and thereby changing) the existing grid.
 *
 * Structurally satisfies `EarningsAnalyticsRow` in meridian-earnings-analytics-core.
 */
export type MeridianEarningsAnalyticsRow = {
  ticker: string;
  company_name: string | null;
  date: string;
  time: string | null;
  date_status: string | null;
  importance: number | null;
  fiscal_period: string | null;
  fiscal_year: number | null;
  estimated_eps: number | null;
  actual_eps: number | null;
  estimated_revenue: number | null;
  actual_revenue: number | null;
  eps_surprise_pct: number | null;
  revenue_surprise_pct: number | null;
};

export type MeridianEarningsEnrichment = {
  catalysts: MeridianCatalystHeadline[];
  earnings_headlines: MeridianCatalystHeadline[];
  street_estimates: MeridianStreetEstimate[];
  earnings_calendar: MeridianEarningsCalendarRow | null;
  earnings_yoy: MeridianEarningsYoY | null;
  corporate_guidance: MeridianEarningsGuidanceRow | null;
  guidance_entitled: boolean;
  /** True when a corporate guidance row exists for this ticker (distinct from SKU entitlement). */
  guidance_on_file?: boolean;
  post_print: {
    lean: "beat" | "miss" | "inline" | "unknown";
    headline: string | null;
  } | null;
  print_history: MeridianEarningsPrint[];
  print_history_summary: string | null;
  /** Non-null when the earnings-calendar fetch failed — empty panels must say WHY. */
  calendar_error?: string | null;
  beat_rates: {
    eps_beat_rate: number | null;
    revenue_beat_rate: number | null;
    combined_beat_rate: number | null;
    /** How many graded prints each rate came from — a rate without its cohort is not a fact
     *  about the company. `combined_graded` is the POOLED denominator (eps + revenue), which is
     *  what `combined_beat_rate` is now pooled over rather than averaged across. */
    eps_graded?: number;
    revenue_graded?: number;
    /** Pooled READINGS (eps + revenue) — the denominator of `combined_beat_rate`. Not a print
     *  count: 8 prints graded on both measures give 16. Never render this as "prints". */
    combined_graded?: number;
    /** Distinct prints with at least one gradeable measure — the number a human should be shown. */
    prints_graded?: number;
  } | null;
  analyst_revisions: MeridianAnalystRevision[];
  price_targets: MeridianPriceTargetRow[];
  street_skew: MeridianStreetSkew | null;
  estimate_revisions: MeridianEstimateRevisionEntry[];
  catalyst_briefs: MeridianCatalystBrief[];
  insider_activity: MeridianInsiderActivity[];
  congress_trades: MeridianCongressActivity[];
  expected_vs_realized: MeridianExpectedVsRealized | null;
};

export type MeridianEarningsPrint = {
  report_date: string | null;
  /** Benzinga report time (ET). Drives BMO/AMC reaction anchoring — see meridian-reaction-core. */
  report_time_et?: string | null;
  /**
   * Which session `session_change_pct` was measured on:
   *   bmo_session            — pre-open print, report date's own session
   *   amc_next_session       — post-close print, the FOLLOWING session
   *   assumed_report_session — timing unknown; report date assumed. Mark these in the UI:
   *                            for an AMC reporter this value is pre-print drift, not a reaction.
   * Null when no move could be measured at all.
   */
  reaction_basis?: "bmo_session" | "amc_next_session" | "assumed_report_session" | null;
  /**
   * THE reaction to the print. Prefer this over `session_change_pct` anywhere the number is
   * presented as a reaction: a print with a known bell-relative timing is priced while the
   * market is SHUT — overnight for a post-close print, in the premarket for a pre-open one —
   * so this is read from the last close BEFORE the print, and the two routinely differ in SIGN
   * (31.6% of post-close prints, 27.0% of pre-open ones). `reaction_measure` says which read
   * produced it.
   */
  reaction_pct?: number | null;
  /**
   * How `reaction_pct` was measured. The `_to_last` variants mean the anchor session was STILL
   * OPEN when this was read, so the far end is the last trade rather than a close and the value
   * is still moving. See ReactionMeasure in meridian-reaction-core.
   */
  reaction_measure?:
    | "session_open_to_close"
    | "prior_close_to_close"
    | "session_open_to_last"
    | "prior_close_to_last"
    | null;
  /** False while the anchor session is open — `reaction_pct` is provisional. Null if unmeasured. */
  reaction_settled?: boolean | null;
  /**
   * True when `reaction_pct` spans a period the market was closed, so it necessarily includes
   * drift unrelated to the print (median 1.18pp, p90 4.10pp, measured against a premarket-anchored
   * read). The accepted cost of catching the gap — stated, not hidden. Null if unmeasured.
   */
  reaction_includes_prior_drift?: boolean | null;
  eps_estimate: number | null;
  eps_actual: number | null;
  revenue_estimate?: number | null;
  revenue_actual?: number | null;
  revenue_surprise_pct?: number | null;
  surprise_pct: number | null;
  beat: boolean | null;
  eps_method?: string | null;
  revenue_method?: string | null;
  source?: "earnings_calendar" | "uw" | null;
  /** Options-implied move into that print when UW carries it. */
  expected_move_pct: number | null;
  session_change_pct: number | null;
  next_day_change_pct: number | null;
};

export type MeridianFinancialsContext = {
  available: boolean;
  as_of: string | null;
  headline: string | null;
  pe_ratio: number | null;
  price_to_sales: number | null;
  roe_pct: number | null;
  revenue_yoy_pct: number | null;
  net_margin_pct: number | null;
  margin_trend: "expanding" | "contracting" | "flat" | null;
  fcf_positive: boolean | null;
  fcf_trend: "rising" | "falling" | "flat" | null;
  eps_trajectory: string | null;
  net_cash_positive: boolean | null;
  price_target: number | null;
  price_target_upside_pct: number | null;
};

export type MeridianErPlayRead = {
  available: boolean;
  lean: "bullish" | "bearish" | "neutral" | "avoid_directional";
  confidence: "low" | "medium" | "high";
  headline: string;
  rationale: string[];
  structure_hint: string | null;
  risk_note: string;
};

export type MeridianEarningsFlowPrint = {
  premium: number;
  premium_label: string;
  option_type: string | null;
  strike: number | null;
  expiry: string | null;
  dte: number | null;
};

export type MeridianEarningsStrikeStack = {
  strike: number;
  premium: number;
  premium_label: string;
  hit_count: number;
  dominant_type: string | null;
};

export type MeridianEarningsThermalRead = {
  available: boolean;
  spot: number | null;
  gex_king_strike: number | null;
  call_wall: number | null;
  put_wall: number | null;
  /** Raw gamma argmax strike when display walls were coerced for band ordering. */
  gamma_call_wall?: number | null;
  /** Raw gamma argmin strike when display walls were coerced for band ordering. */
  gamma_put_wall?: number | null;
  /** True when gamma call/put ordering inverted before display coercion. */
  walls_inverted?: boolean;
  flip: number | null;
  max_pain: number | null;
  net_gex_label: string | null;
  gamma_regime: string | null;
  top_strikes: Array<{ strike: number; net_label: string; pct_of_total: number }>;
  nearest_wall: { strike: number; kind: "resistance" | "support"; distance_pts: number } | null;
  /**
   * Which chain the WALLS and MAX PAIN describe. "event_expiry" = the first expiry on or after
   * the print, i.e. the contract that actually prices it. "aggregate" = the whole-book near-term
   * sum, which mixes expiries that may die before the company reports. They render identically,
   * so the scope has to be stated.
   *
   * It does NOT describe `gex_king_strike`, `flip`, `net_gex_label`, `gamma_regime`,
   * `top_strikes` or `nearest_wall` — see `level_scopes` and `structure_scope` below. Rendering
   * this one value as a badge over all of them is the mislabel those two fields exist to end.
   */
  expiry_scope?: "event_expiry" | "aggregate";
  /** Per-level scope, so a list that mixes them can mark which is which. */
  level_scopes?: Record<
    "call_wall" | "put_wall" | "gamma_call_wall" | "gamma_put_wall" | "max_pain" | "gex_king_strike" | "flip",
    "event_expiry" | "aggregate"
  >;
  /**
   * Scope of the derived structure block — `net_gex_label`, `gamma_regime`, `top_strikes` and
   * `nearest_wall`. Always "aggregate": none of them is re-derived per expiry today.
   */
  structure_scope?: "event_expiry" | "aggregate";
  /** Reader-facing description of that block's basis, e.g. "whole-book aggregate across 12…". */
  structure_scope_label?: string;
  expiry_used?: string | null;
  expiry_days_from_event?: number | null;
  expiry_label?: string | null;
  aggregate_expiry_count?: number;
};

export type MeridianEarningsDarkPoolPrint = {
  premium: number;
  premium_label: string;
  strike: number | null;
  side: string | null;
  executed_at: string | null;
};

export type MeridianEarningsDarkPool = {
  available: boolean;
  bias: string;
  total_premium: number;
  total_premium_label: string | null;
  call_premium_label: string | null;
  put_premium_label: string | null;
  pcr: number | null;
  detail: string | null;
  top_prints: MeridianEarningsDarkPoolPrint[];
};

export type MeridianEarningsVectorWallEvent = {
  message: string;
  severity: "info" | "warn";
  time_label: string | null;
};

export type MeridianEarningsVectorFlowPrint = {
  premium_label: string;
  option_type: string | null;
  strike: number | null;
  executed_at: string | null;
};

export type MeridianEarningsVectorRead = {
  available: boolean;
  /** Vector DTE horizon the read was scoped to (weekly for earnings context). */
  horizon: string | null;
  expiry: string | null;
  move_pct: number | null;
  spot: number | null;
  bands: Array<{ sigma: number; low: number; high: number }> | null;
  /** Human-readable gamma posture from Vector regime. */
  regime: string | null;
  call_wall: number | null;
  put_wall: number | null;
  gamma_flip: number | null;
  max_pain: number | null;
  /** Count of wall-history rail samples ("beads") in today's session rail. */
  bead_samples: number;
  recent_events: MeridianEarningsVectorWallEvent[];
  recent_flow: MeridianEarningsVectorFlowPrint[];
  /** Staleness disclosure when the Vector snapshot is not live. */
  freshness_note: string | null;
};

export type MeridianEarningsNighthawkRead = {
  available: boolean;
  on_board: boolean;
  lane: "setup" | "ledger" | null;
  direction: "long" | "short" | null;
  strike: number | null;
  expiry: string | null;
  score: number | null;
  conviction: string | null;
  status: string | null;
  headline: string | null;
  live_pnl_pct: number | null;
  session_label: string | null;
};

export type MeridianEarningsSpxStrikeStack = {
  strike: number | null;
  premium_label: string;
  hit_count: number;
};

export type MeridianEarningsSpxRead = {
  available: boolean;
  price: number | null;
  change_pct: number | null;
  gamma_regime: string | null;
  gamma_flip: number | null;
  gex_king: number | null;
  call_wall: number | null;
  put_wall: number | null;
  tide_bias: string | null;
  flow_0dte_net: number | null;
  play_phase: string | null;
  play_action: string | null;
  play_grade: string | null;
  play_headline: string | null;
  strike_stacks: MeridianEarningsSpxStrikeStack[];
};

export type MeridianEarningsReportSignal = {
  pillar:
    | "flow"
    | "dark_pool"
    | "thermal"
    | "vector"
    | "history"
    | "fundamentals"
    | "analyst"
    | "news"
    | "insider"
    | "surprise"
    | "yoy";
  label: string;
  lean: "bullish" | "bearish" | "neutral";
  weight: number;
  detail: string;
  score: number;
};

export type MeridianEarningsReport = {
  available: boolean;
  verdict: "bullish" | "bearish" | "neutral";
  confidence: "low" | "medium" | "high";
  /** Composite score from weighted pillars (negative = bearish). */
  score: number;
  headline: string;
  summary: string;
  signals: MeridianEarningsReportSignal[];
  best_play: {
    headline: string;
    structure: string;
    risk: string;
  };
  risk_note: string;
};

export type MeridianEarningsIntel = {
  expected_move_pct: number | null;
  expected_move_source: "calendar" | "chain_iv" | null;
  expected_move_band: { spot: number; up: number; down: number } | null;
  financials: MeridianFinancialsContext | null;
  flow_into_print: {
    available: boolean;
    window_hours: number;
    bias: string;
    net_premium: number | null;
    net_premium_label: string | null;
    top_prints: MeridianEarningsFlowPrint[];
    strike_stacks: MeridianEarningsStrikeStack[];
  };
  dark_pool: MeridianEarningsDarkPool;
  thermal: MeridianEarningsThermalRead;
  vector: MeridianEarningsVectorRead;
  nighthawk: MeridianEarningsNighthawkRead;
  spx: MeridianEarningsSpxRead;
  report: MeridianEarningsReport;
  play_read: MeridianErPlayRead;
};

export type MeridianEarningsDetail = {
  kind: "earnings";
  /** Day series of past reads for this event, oldest first. Empty until a second day exists. */
  drift_snapshots?: Array<{
    day: string;
    score: number | null;
    verdict: "bullish" | "bearish" | "neutral" | null;
    confidence: string | null;
    pillars: Record<string, string> | null;
  }>;
  pack: PreEarningsPackCard;
  enrichment: MeridianEarningsEnrichment;
  intel: MeridianEarningsIntel;
};

export type MeridianOpexExpiryRead = {
  max_pain: number | null;
  greek_headline: string | null;
  pinned_expiry: string | null;
  pinned_pct: number | null;
  net_flow_label: string | null;
};

export type MeridianOpexMover = {
  ticker: string;
  session_pct: number;
  close: number;
  volume: number;
};

export type MeridianOpexMag7Summary = {
  avg_session_pct: number | null;
  best: { ticker: string; session_pct: number } | null;
  worst: { ticker: string; session_pct: number } | null;
  members: Array<{ ticker: string; session_pct: number | null }>;
};

export type MeridianOpexCrossMarketRow = {
  date: string;
  spx_session_pct: number | null;
  spy_session_pct: number | null;
  qqq_session_pct: number | null;
  iwm_session_pct: number | null;
  mag7: MeridianOpexMag7Summary;
  top_gainer: MeridianOpexMover | null;
  top_loser: MeridianOpexMover | null;
};

export type MeridianOpexCrossMarket = {
  available: boolean;
  sample_size: number;
  rows: MeridianOpexCrossMarketRow[];
  aggregates: {
    avg_spx_session_pct: number | null;
    avg_qqq_session_pct: number | null;
    avg_mag7_session_pct: number | null;
    mag7_led_count: number;
    divergence_headline: string | null;
  };
  headline: string | null;
};

export type MeridianOpexReport = {
  available: boolean;
  outlook: {
    lean: "risk_on" | "risk_off" | "neutral";
    headline: string;
    summary: string;
  };
  watch_list: string[];
  warnings: string[];
};

export type MeridianOpexDetail = {
  kind: "opex";
  date: string;
  title: string;
  spx_positioning: MeridianSpxPositioning;
  expiry_read: MeridianOpexExpiryRead;
  prior_opex: MeridianOpexHistoryRow[];
  pin_accuracy: MeridianOpexPinAccuracy;
  cross_market: MeridianOpexCrossMarket;
  report: MeridianOpexReport;
  as_of: string;
};

export type MeridianOpexPinAccuracy = {
  graded: number;
  held: number;
  accuracy_pct: number | null;
  tolerance_pct: number;
  headline: string;
};

export type MeridianOpexHistoryRow = {
  date: string;
  spx_session_pct: number | null;
  spx_next_day_pct: number | null;
  max_pain: number | null;
  spx_close: number | null;
  pin_held: boolean | null;
  /**
   * WHERE `max_pain` came from — or, when null, WHY there is nothing.
   *
   * A bare null here is indistinguishable from "there was no pin", which is a different claim
   * entirely. For a SETTLED expiry the live chain carries no open interest at all (it prunes
   * settled expiries by design), and historical max pain is not stored anywhere — so this is a
   * permanent, non-retryable absence, not a transient miss.
   */
  max_pain_basis: "expiry_open_interest" | null;
  max_pain_unavailable: {
    reason: string;
    what_is_missing: string;
    retryable: boolean;
  } | null;
};

export type MeridianFdaDetail = {
  kind: "fda";
  ticker: string;
  title: string;
  date: string;
  drug: string | null;
  indication: string | null;
  catalysts: MeridianCatalystHeadline[];
  catalyst_briefs: MeridianCatalystBrief[];
  insider_activity: MeridianInsiderActivity[];
  congress_trades: MeridianCongressActivity[];
  prior_decisions: MeridianFdaPriorDecision[];
  positioning: MeridianSpxPositioning;
  flow: MeridianFlowSkew;
  as_of: string;
};

export type MeridianFdaPriorDecision = {
  date: string;
  drug: string | null;
  headline: string | null;
  session_change_pct: number | null;
  next_day_change_pct: number | null;
};

export type MeridianEventDetail =
  | MeridianMacroBrief
  | MeridianEarningsDetail
  | MeridianOpexDetail
  | MeridianFdaDetail;

export type MeridianTimelineStats = {
  total: number;
  macro: number;
  earnings: number;
  fda: number;
  opex: number;
  high_impact: number;
  next_24h: number;
  earnings_mega_cap: number;
};

export type MeridianTickerLookup = {
  ticker: string;
  found: boolean;
  in_timeline: boolean;
  earnings: {
    date: string;
    time: string | null;
    company_name: string | null;
    date_status: string | null;
    estimated_eps: number | null;
    fiscal_period: string | null;
    fiscal_year: number | null;
    days_until: number;
    when: "premarket" | "afterhours" | null;
    status_label: string | null;
  } | null;
  timeline_id: string | null;
  message: string;
};

export type MeridianTimelinePayload = {
  as_of: string;
  days_ahead: number;
  items: MeridianTimelineItem[];
  stats: MeridianTimelineStats;
  board_tickers: string[];
  earnings_week: MeridianEarningsWeekRow[];
  earnings_week_analytics: MeridianEarningsWeekAnalytics | null;
  earnings_analytics_rows: MeridianEarningsAnalyticsRow[];
  recent_earnings_revisions: MeridianEarningsRevision[];
  estimate_revision_timeline: MeridianEstimateRevisionEntry[];
  after_hours_movers: MeridianAfterHoursMover[];
  earnings_calendar_entitled: boolean;
  /** Prints hidden because the name has no listed options. */
  non_optionable_hidden?: number;
  /** How far the options-implied move got — requested / attempted / skipped / resolved, and a
   *  note when anything was skipped. A null `expected_move_pct` on a SKIPPED name is not evidence
   *  the name lacks an options market. */
  expected_move_coverage?: {
    requested: number;
    attempted: number;
    skipped: number;
    resolved: number;
    note: string | null;
  };
  /** False when the optionable universe was unavailable, so NOTHING was filtered. */
  optionable_filter_applied?: boolean;
  /** How many lane rows carry a sector cohort key, and how many do not. Coverage, stated. */
  sectors_classified?: number;
  sectors_unclassified?: number;
  /** True on the lite first paint — client should revalidate the full payload for implied moves. */
  enrich_pending?: boolean;
};
