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
  spx_positioning: MeridianSpxPositioning;
  flow: MeridianFlowSkew;
  as_of: string;
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
  expected_move_pct: number | null;
  realized_move_pct: number | null;
  ratio: number | null;
  verdict: "under" | "over" | "inline" | "unknown";
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
};

export type MeridianEarningsEnrichment = {
  catalysts: MeridianCatalystHeadline[];
  earnings_headlines: MeridianCatalystHeadline[];
  street_estimates: MeridianStreetEstimate[];
  print_history: MeridianEarningsPrint[];
  print_history_summary: string | null;
  analyst_revisions: MeridianAnalystRevision[];
  insider_activity: MeridianInsiderActivity[];
  congress_trades: MeridianCongressActivity[];
  expected_vs_realized: MeridianExpectedVsRealized | null;
};

export type MeridianEarningsPrint = {
  report_date: string | null;
  eps_estimate: number | null;
  eps_actual: number | null;
  surprise_pct: number | null;
  beat: boolean | null;
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
  flip: number | null;
  max_pain: number | null;
  net_gex_label: string | null;
  gamma_regime: string | null;
  top_strikes: Array<{ strike: number; net_label: string; pct_of_total: number }>;
  nearest_wall: { strike: number; kind: "resistance" | "support"; distance_pts: number } | null;
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
  play_read: MeridianErPlayRead;
};

export type MeridianEarningsDetail = {
  kind: "earnings";
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

export type MeridianOpexDetail = {
  kind: "opex";
  date: string;
  title: string;
  spx_positioning: MeridianSpxPositioning;
  expiry_read: MeridianOpexExpiryRead;
  prior_opex: MeridianOpexHistoryRow[];
  pin_accuracy: MeridianOpexPinAccuracy;
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
};

export type MeridianFdaDetail = {
  kind: "fda";
  ticker: string;
  title: string;
  date: string;
  drug: string | null;
  indication: string | null;
  catalysts: MeridianCatalystHeadline[];
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
};

export type MeridianTimelinePayload = {
  as_of: string;
  days_ahead: number;
  items: MeridianTimelineItem[];
  stats: MeridianTimelineStats;
  board_tickers: string[];
};
