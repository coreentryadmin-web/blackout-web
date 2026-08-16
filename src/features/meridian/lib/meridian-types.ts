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
  spx_positioning: MeridianSpxPositioning;
  flow: MeridianFlowSkew;
  as_of: string;
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
  as_of: string;
};

export type MeridianFdaDetail = {
  kind: "fda";
  ticker: string;
  title: string;
  date: string;
  drug: string | null;
  indication: string | null;
  catalysts: MeridianCatalystHeadline[];
  positioning: MeridianSpxPositioning;
  flow: MeridianFlowSkew;
  as_of: string;
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
