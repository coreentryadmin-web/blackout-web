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
};

export type MeridianEarningsPrint = {
  report_date: string | null;
  eps_estimate: number | null;
  eps_actual: number | null;
  surprise_pct: number | null;
  beat: boolean | null;
  session_change_pct: number | null;
  next_day_change_pct: number | null;
};

export type MeridianEarningsDetail = {
  kind: "earnings";
  pack: PreEarningsPackCard;
  enrichment: MeridianEarningsEnrichment;
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
  as_of: string;
};

export type MeridianOpexHistoryRow = {
  date: string;
  spx_session_pct: number | null;
  spx_next_day_pct: number | null;
  max_pain: number | null;
};

export type MeridianFdaDetail = {
  kind: "fda";
  ticker: string;
  title: string;
  date: string;
  drug: string | null;
  indication: string | null;
  catalysts: MeridianCatalystHeadline[];
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

export type MeridianTimelinePayload = {
  as_of: string;
  days_ahead: number;
  items: MeridianTimelineItem[];
};
