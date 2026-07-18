import type { NightHawkEdition, NightHawkRecordResponse, PlayMorningStatus, PlaybookPlay } from "./types";

export const PREVIEW_PLAYS: PlaybookPlay[] = [
  {
    rank: 1,
    ticker: "NVDA",
    direction: "BULLISH",
    conviction: "A+",
    play_type: "stock",
    thesis: "Massive call sweeps at the ask into close — dealers short gamma above 880 with room to squeeze into CPI whisper.",
    key_signal: "3-session call dominance · $12M premium at 880C",
    entry_range: "$872 – $878",
    target: "$895",
    stop: "$865",
    options_play: "NVDA 880C (0–3 DTE)",
    entry_premium: 4.2,
    entry_cost_per_contract: 420,
    score: 94,
    flow_streak_days: 3,
    iv_rank: 0.62,
  },
  {
    rank: 2,
    ticker: "META",
    direction: "BEARISH",
    conviction: "A",
    play_type: "stock",
    thesis: "Put wall building at 520 — negative gamma pin with distribution on rips into resistance.",
    key_signal: "Repeated put blocks at 520P · RS vs QQQ rolling",
    entry_range: "$528 – $534",
    target: "$512",
    stop: "$538",
    options_play: "META 520P (weekly)",
    entry_premium: 3.85,
    score: 87,
    flow_streak_days: 2,
    iv_rank: 0.48,
  },
  {
    rank: 3,
    ticker: "SPY",
    direction: "BULLISH",
    conviction: "B",
    play_type: "etf",
    thesis: "Index tide bullish with dealer long gamma below spot — fade dips toward VWAP for continuation.",
    key_signal: "Net call premium +$48M · gamma flip held",
    entry_range: "$562 – $564",
    target: "$568",
    stop: "$559",
    options_play: "SPY 565C (0DTE)",
    entry_premium: 1.15,
    score: 78,
    flow_streak_days: 1,
    iv_rank: 0.35,
  },
];

export const PREVIEW_EDITION: NightHawkEdition = {
  available: true,
  edition_for: "2026-07-17",
  published_at: new Date(Date.now() - 3600_000 * 4).toISOString(),
  recap_headline: "Tech-led call tide · VIX compressed · CPI tomorrow",
  recap_summary:
    "Flow leaned bullish into the close with NVDA and semis leading. VIX held sub-14; dealers remain short gamma on the tape above key strikes.",
  market_recap: {
    tide: "Bullish call bias · premium +$1.2B vs puts",
    spx_vix: "SPX 5624 · VIX 13.8 · contango shallow",
    sector_strength: "SMH, NVDA, META",
    sector_weakness: "XLE, XLF",
    catalysts: "CPI 8:30 ET · NVDA GTC headlines",
  },
  plays: PREVIEW_PLAYS,
};

export const PREVIEW_RECORD: NightHawkRecordResponse = {
  available: true,
  window_days: 30,
  total_resolved: 42,
  win_rate_pct: 58,
  profitable_rate_pct: 62,
  avg_return_pct: 18,
  pending_count: 3,
  by_conviction: [
    { conviction: "A+", n: 8, win_rate_pct: 62 },
    { conviction: "A", n: 14, win_rate_pct: 57 },
    { conviction: "B", n: 12, win_rate_pct: 50, low_n: true },
  ],
};

export const PREVIEW_MORNING: Map<string, PlayMorningStatus> = new Map([
  [
    "NVDA",
    {
      rank: 1,
      ticker: "NVDA",
      direction: "BULLISH",
      status: "CONFIRMED",
      reason: "Opening drive held entry zone · flow still one-sided",
    },
  ],
  [
    "META",
    {
      rank: 2,
      ticker: "META",
      direction: "BEARISH",
      status: "DEGRADED",
      reason: "Gap through entry — size down or wait for retest",
    },
  ],
  [
    "SPY",
    {
      rank: 3,
      ticker: "SPY",
      direction: "BULLISH",
      status: "CONFIRMED",
      reason: "VWAP reclaim aligned with playbook thesis",
    },
  ],
]);
