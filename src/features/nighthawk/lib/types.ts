export type HuntMode = "day" | "swing" | "leap";

export type PlaybookPlay = {
  rank: number;
  ticker: string;
  direction: string;
  conviction: string;
  play_type: "stock" | "index" | "etf";
  thesis: string;
  key_signal: string;
  entry_range: string;
  target: string;
  stop: string;
  options_play: string;
  /** Per-share option entry premium (must be ≤ $20). */
  entry_premium?: number;
  /** entry_premium × 100 — cost for one contract. */
  entry_cost_per_contract?: number;
  premium_cap_ok?: boolean;
  risk_note?: string;
  /** Exit discipline this play should be MANAGED under. "scale_out" = a whole-market breakout/banger
   *  play (positive-skew: partial at 2×, trail the runner, hard stop) — structurally distinct from the
   *  index 0DTE grinder's let-it-run ratchet. Absent = the default grinder exit. This is the queryable
   *  marker (the risk_note is only prose) that lets the ledger SELECT bangers to grade them on the
   *  option scale-out path and graduate the exit on evidence. */
  exit_style?: "scale_out";
  /** Sector classification from Polygon profile (lower-cased). Absent when unknown. */
  sector?: string;
  /** Optional so a degraded/legacy source with no real score renders "—", never a fabricated 0. */
  score?: number;
  flow_streak_days?: number;
  iv_rank?: number;
  rr_ratio?: number;
  /** How far the target sits from the entry FILL EDGE, in ATR14 units — |target − fill_edge|
   *  / atr14. NOT recomputed here: this is the value the publish gate G-N2 already measured
   *  and pinned (publish-gates.ts:226, `checks[code="target_unreachable"].value`), stamped
   *  onto the play at build time so the member and the admin surfaces read the SAME number
   *  the gate judged. Absent when the gate could not compute geometry for the play.
   *
   *  WHY SURFACE IT (2026-08-06): the Legacy lane grades on ONE daily bar, so target
   *  distance IS reachability — and the measured one-session touch rate falls off a cliff
   *  (1.5× → 3%, 2.0× → 0.9%, 3.5× → 0.1%; see target-reachability.ts). The system computed
   *  this number on every play and showed members a plain dollar level instead. */
  target_atr_multiple?: number;
  /** Per-component scoring breakdown persisted at publish time so the terminal can show
   *  real factor bars (flow, tech, positioning, etc.) instead of only iv_rank/rr_ratio. */
  factor_breakdown?: Record<string, number>;
  /** Count of scoring dimensions with material positive contribution (flow≥8, tech≥6, etc.). */
  confirming_signals?: number;
  /** True when the name reports earnings within the play's hold window. */
  earnings_risk?: boolean;
  /** PR-N4: true when the morning confirmation INVALIDATED this play and the one-way pull
   *  latch engaged (nighthawk_play_outcomes.pulled, merged at read time by
   *  pull-overlay.ts). A pulled play stays visible at its published rank but must be
   *  presented as PULLED (non-actionable) with its reason — never hidden, never deleted. */
  pulled?: boolean;
  /** Member-facing reason the play was pulled (the verdict's evidence sentence). */
  pulled_reason?: string;
  /** True when a play did NOT fully clear the publish-time sanity gates but was promoted
   *  into the edition anyway because the pipeline would otherwise publish zero plays.
   *  These plays carry gate_warnings explaining which gates failed and by how much.
   *  The UI must badge them so members know the entry may need extra validation. */
  gate_promoted?: boolean;
  /** Human-readable gate-failure reasons (one per failed gate). Only present when
   *  gate_promoted is true. */
  gate_warnings?: string[];
};

export type PlayExplainRequest = {
  edition_for: string;
  ticker: string;
};

export type PlayExplainResponse = {
  ticker: string;
  rank: number;
  explanation: string;
  cached: boolean;
};

export type NightHawkEdition = {
  /** True when there is real published content to show — either ranked plays OR a market recap.
   *  A recap-only edition (plays:[] but a published recap) is `available: true` so the UI renders
   *  the recap instead of the "awaiting close" empty state. */
  available: boolean;
  edition_for: string | null;
  published_at: string | null;
  recap_headline: string | null;
  recap_summary: string | null;
  market_recap?: Record<string, unknown> | null;
  plays: PlaybookPlay[];
  /** True when this edition published a market recap but no ranked plays survived the funnel.
   *  Lets the UI show a recap-only state distinct from both "5 plays" and "awaiting close". */
  recap_only?: boolean;
  /** Funnel-stage reason when recap_only (e.g. "No candidates…", publish-gate zero). Ops already
   *  stores this in meta.recap_only_reason — members see a one-line explanation when present. */
  recap_only_reason?: string | null;
  /** Stage counts when recap_only — candidates → synthesized → published (from meta.funnel). */
  funnel?: import("./edition-funnel").EditionFunnelCounts | null;
  /** True when this edition came from a degraded/legacy source
   *  fallback) rather than the first-class published pipeline. The UI must NOT present a degraded
   *  edition as a fresh "Edition live" recap — show a legacy/degraded notice instead. */
  degraded?: boolean;
  /** True when the served edition is an OLDER stored edition returned because the requested
   *  session's edition isn't published yet (the latest-fallback path). The UI must NOT assert
   *  "Edition live" — it should show "Showing {served_for} edition — tonight's not published yet". */
  stale?: boolean;
  /** The edition_for date that was actually served when `stale` is true (the older edition's date). */
  served_for?: string | null;
  /** True when prior generated plays are intentionally kept visible until their session closes. */
  carry_until_close?: boolean;
};

export type PlayConfirmStatus = "CONFIRMED" | "DEGRADED" | "INVALIDATED" | "UNVERIFIED";

export type PlayMorningStatus = {
  rank: number;
  ticker: string;
  direction: string;
  status: PlayConfirmStatus;
  reason: string;
};

export type NightHawkPlayStatusResponse = {
  available: boolean;
  edition_for?: string;
  date?: string;
  reason?: string;
  checked_at?: string;
  spx_premarket?: number | null;
  overnight_gap_pts?: number | null;
  regime?: string | null;
  gex_bias?: string | null;
  plays?: PlayMorningStatus[];
  summary?: { confirmed: number; degraded: number; invalidated: number };
};

/** PR-N2: one grading-methodology segment of the record, as served to members. The two
 *  segments are reported side by side and never aggregated — see analytics.ts's
 *  NighthawkRecordSegment (this is its rounded wire shape). */
export type NightHawkRecordSegmentWire = {
  methodology: string;
  label: string;
  resolved: number;
  scoreable: number;
  wins: number;
  losses: number;
  opens: number;
  ambiguous: number;
  unfilled: number;
  pulled: number;
  stop_data_unavailable: number;
  /** null when nothing is scoreable — never a fake 0%. */
  win_rate_pct: number | null;
  /** Wilson 95% CI lower bound (percent units). null when nothing is scoreable. */
  win_rate_ci_low_pct?: number | null;
  /** Wilson 95% CI upper bound (percent units). null when nothing is scoreable. */
  win_rate_ci_high_pct?: number | null;
  avg_return_pct: number | null;
  /** scoreable < LOW_N_THRESHOLD — the UI must badge this segment's ratios. */
  low_n: boolean;
};

export type NightHawkRecordResponse = {
  available: boolean;
  window_days: number;
  total_resolved: number;
  pending_count: number;
  /** PR-N2: headline ratios cover CURRENT-methodology scoreable rows only. */
  win_rate_pct: number;
  win_rate_ci_low_pct?: number | null;
  win_rate_ci_high_pct?: number | null;
  profitable_rate_pct: number;
  avg_return_pct: number;
  /** FILL-EDGE basis (band edge, the price a member could actually transact at) — the
   *  PRIMARY figures. The mid-basis `avg_return_pct`/`profitable_rate_pct` above are kept
   *  in parallel for one window because they are the basis the live record and every
   *  historical audit were computed on. Optional so a stale SWR cache of the pre-edge
   *  payload still type-checks; the strip falls back to the mid basis when absent. */
  avg_return_pct_edge?: number;
  profitable_rate_edge_pct?: number;
  /** PR-N2 additive fields — optional so a stale SWR cache of the old payload still
   *  type-checks; the strip falls back to the legacy rendering when absent. */
  methodology?: string;
  unfilled_count?: number;
  pulled_count?: number;
  stop_data_unavailable_count?: number;
  segments?: { current: NightHawkRecordSegmentWire; legacy: NightHawkRecordSegmentWire };
  by_conviction: Array<{ conviction: string; n: number; win_rate_pct: number; win_rate_ci_low_pct?: number | null; win_rate_ci_high_pct?: number | null; low_n?: boolean }>;
};

export type AgentFilterValues = Record<string, string | number | boolean>;

export type HuntRequest = {
  mode: HuntMode;
  filters: AgentFilterValues;
};

export type HuntPlay = {
  ticker: string;
  direction: string;
  thesis: string;
  contract: string;
  entry: string;
  target: string;
  stop: string;
  /** Optional — propagates an unknown score (e.g. from a degraded source) as undefined → "—",
   *  never a fabricated 0. */
  score?: number;
  /** Day Trade Agent lifecycle phase. */
  phase?: "CANDIDATE" | "WATCH" | "ACTIONABLE" | "EXPIRED";
  /** Whether play aligns with SPX desk bias when spx_context filter is on. */
  spx_aligned?: boolean;
};

export type HuntResponse = {
  status: "queued" | "complete" | "error";
  mode: HuntMode;
  scanned_at: string;
  message: string;
  plays: HuntPlay[];
  /** Live cross-service context available to hunt agents. */
  platform_context?: {
    spx_price: number | null;
    flow_alerts: number;
    edition_for: string | null;
    edition_plays: number;
    spx_bias?: "bull" | "bear" | "neutral" | null;
  };
  /** Hunt pipeline stats for agent workspaces. */
  scan_meta?: {
    candidates: number;
    duration_ms: number;
  };
};
