import type { PreEarningsPackCard } from "@/lib/largo/pre-earnings-pack";

export type MeridianEventKind = "macro" | "earnings" | "opex";

export type MeridianImpact = "high" | "medium" | "low";

/** One row on the catalyst timeline — macro print, earnings, or OpEx. */
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

export type MeridianMacroBrief = {
  kind: "macro";
  event: string;
  date: string;
  time: string | null;
  impact: MeridianImpact;
  event_window: string | null;
  spx_positioning: MeridianSpxPositioning;
  flow: MeridianFlowSkew;
  as_of: string;
};

export type MeridianEarningsDetail = {
  kind: "earnings";
  pack: PreEarningsPackCard;
};

export type MeridianOpexDetail = {
  kind: "opex";
  date: string;
  title: string;
  spx_positioning: MeridianSpxPositioning;
  as_of: string;
};

export type MeridianEventDetail = MeridianMacroBrief | MeridianEarningsDetail | MeridianOpexDetail;

export type MeridianTimelinePayload = {
  as_of: string;
  days_ahead: number;
  items: MeridianTimelineItem[];
};
