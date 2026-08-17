import type { DailyMarketBar } from "@/lib/providers/polygon";
import type { SessionReaction } from "@/lib/meridian/meridian-reaction-core";
import type {
  MeridianOpexCrossMarket,
  MeridianOpexCrossMarketRow,
  MeridianOpexMag7Summary,
  MeridianOpexMover,
  MeridianOpexPinAccuracy,
  MeridianOpexReport,
  MeridianSpxPositioning,
} from "@/features/meridian/lib/meridian-types";

/** Mag 7 preset — same membership as Thermal compare "mega". */
export const MERIDIAN_OPEX_MAG7 = [
  "NVDA",
  "AAPL",
  "MSFT",
  "GOOG",
  "AMZN",
  "META",
  "TSLA",
] as const;

export const MERIDIAN_OPEX_BENCHMARKS = ["SPY", "QQQ", "IWM"] as const;

const MOVER_PRICE_MIN = 5;
const MOVER_PRICE_MAX = 400;
const MOVER_MIN_VOL = 1_000_000;
const LIQUID_TICKER = /^[A-Z]{1,5}$/;

function pctChange(from: number, to: number): number | null {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === 0) return null;
  return Number((((to - from) / Math.abs(from)) * 100).toFixed(2));
}

function avg(nums: Array<number | null>): number | null {
  const valid = nums.filter((n): n is number => n != null && Number.isFinite(n));
  if (!valid.length) return null;
  return Number((valid.reduce((a, b) => a + b, 0) / valid.length).toFixed(2));
}

function fmtPct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

/** Rank liquid session movers from Polygon grouped-daily. */
export function rankOpexSessionMovers(
  rows: DailyMarketBar[],
  opts?: { priceMin?: number; priceMax?: number; minVol?: number }
): { top_gainer: MeridianOpexMover | null; top_loser: MeridianOpexMover | null } {
  const priceMin = opts?.priceMin ?? MOVER_PRICE_MIN;
  const priceMax = opts?.priceMax ?? MOVER_PRICE_MAX;
  const minVol = opts?.minVol ?? MOVER_MIN_VOL;

  const candidates: MeridianOpexMover[] = [];
  for (const row of rows) {
    const ticker = String(row.T ?? "").toUpperCase();
    const o = Number(row.o);
    const c = Number(row.c);
    const v = Number(row.v ?? 0);
    if (!LIQUID_TICKER.test(ticker)) continue;
    if (!Number.isFinite(o) || !Number.isFinite(c) || o <= 0 || c <= 0) continue;
    if (c < priceMin || c > priceMax || v < minVol) continue;
    const session_pct = pctChange(o, c);
    if (session_pct == null) continue;
    candidates.push({ ticker, session_pct, close: c, volume: v });
  }

  if (!candidates.length) return { top_gainer: null, top_loser: null };
  const sorted = [...candidates].sort((a, b) => b.session_pct - a.session_pct);
  return { top_gainer: sorted[0] ?? null, top_loser: sorted[sorted.length - 1] ?? null };
}

export function summarizeMag7Sessions(
  members: Array<{ ticker: string; session_pct: number | null }>
): MeridianOpexMag7Summary {
  const withPct = members.filter((m) => m.session_pct != null) as Array<{
    ticker: string;
    session_pct: number;
  }>;
  const avg_session_pct = avg(withPct.map((m) => m.session_pct));
  let best: MeridianOpexMag7Summary["best"] = null;
  let worst: MeridianOpexMag7Summary["worst"] = null;
  for (const m of withPct) {
    if (!best || m.session_pct > best.session_pct) best = { ticker: m.ticker, session_pct: m.session_pct };
    if (!worst || m.session_pct < worst.session_pct) worst = { ticker: m.ticker, session_pct: m.session_pct };
  }
  return { avg_session_pct, best, worst, members };
}

type CrossMarketBuildInput = {
  dates: string[];
  spx: Map<string, SessionReaction>;
  spy: Map<string, SessionReaction>;
  qqq: Map<string, SessionReaction>;
  iwm: Map<string, SessionReaction>;
  mag7ByTicker: Map<string, Map<string, SessionReaction>>;
  moversByDate: Map<string, { top_gainer: MeridianOpexMover | null; top_loser: MeridianOpexMover | null }>;
};

function rowForDate(input: CrossMarketBuildInput, date: string): MeridianOpexCrossMarketRow {
  const mag7Members = MERIDIAN_OPEX_MAG7.map((ticker) => ({
    ticker,
    session_pct: input.mag7ByTicker.get(ticker)?.get(date)?.session_change_pct ?? null,
  }));
  const movers = input.moversByDate.get(date);
  return {
    date,
    spx_session_pct: input.spx.get(date)?.session_change_pct ?? null,
    spy_session_pct: input.spy.get(date)?.session_change_pct ?? null,
    qqq_session_pct: input.qqq.get(date)?.session_change_pct ?? null,
    iwm_session_pct: input.iwm.get(date)?.session_change_pct ?? null,
    mag7: summarizeMag7Sessions(mag7Members),
    top_gainer: movers?.top_gainer ?? null,
    top_loser: movers?.top_loser ?? null,
  };
}

function divergenceHeadline(rows: MeridianOpexCrossMarketRow[]): string | null {
  if (rows.length < 2) return null;
  let mag7Led = 0;
  let qqqLed = 0;
  for (const row of rows) {
    if (row.mag7.avg_session_pct == null || row.spx_session_pct == null) continue;
    if (row.mag7.avg_session_pct > row.spx_session_pct) mag7Led += 1;
    if (row.qqq_session_pct != null && Math.abs(row.qqq_session_pct) > Math.abs(row.spx_session_pct ?? 0)) {
      qqqLed += 1;
    }
  }
  const n = rows.filter((r) => r.mag7.avg_session_pct != null && r.spx_session_pct != null).length;
  if (n < 2) return null;
  if (mag7Led >= Math.ceil(n * 0.67)) {
    return `Mag 7 outpaced SPX on ${mag7Led}/${n} prior OpEx sessions`;
  }
  if (qqqLed >= Math.ceil(n * 0.67)) {
    return `QQQ moved more than SPX on ${qqqLed}/${n} prior OpEx sessions`;
  }
  return `Mixed index leadership across ${n} prior OpEx sessions`;
}

/** Shape cross-market OpEx history from batched Polygon reactions + grouped daily. */
export function buildMeridianOpexCrossMarket(input: CrossMarketBuildInput): MeridianOpexCrossMarket {
  const rows = input.dates.map((date) => rowForDate(input, date));
  const graded = rows.filter((r) => r.spx_session_pct != null);
  const avg_spx_session_pct = avg(graded.map((r) => r.spx_session_pct));
  const avg_qqq_session_pct = avg(graded.map((r) => r.qqq_session_pct));
  const avg_mag7_session_pct = avg(graded.map((r) => r.mag7.avg_session_pct));

  let mag7_led_count = 0;
  for (const row of graded) {
    if (row.mag7.avg_session_pct != null && row.spx_session_pct != null && row.mag7.avg_session_pct > row.spx_session_pct) {
      mag7_led_count += 1;
    }
  }

  const divergence = divergenceHeadline(graded);
  const headline =
    graded.length > 0 && avg_spx_session_pct != null
      ? `Prior OpEx avg · SPX ${fmtPct(avg_spx_session_pct)} · QQQ ${fmtPct(avg_qqq_session_pct)} · Mag 7 ${fmtPct(avg_mag7_session_pct)}`
      : null;

  return {
    available: graded.length > 0,
    sample_size: graded.length,
    rows,
    aggregates: {
      avg_spx_session_pct,
      avg_qqq_session_pct,
      avg_mag7_session_pct,
      mag7_led_count,
      divergence_headline: divergence,
    },
    headline,
  };
}

type OpexReportInput = {
  cross_market: MeridianOpexCrossMarket;
  pin_accuracy: MeridianOpexPinAccuracy;
  spx_positioning: MeridianSpxPositioning;
};

function outlookLean(avgSpx: number | null): MeridianOpexReport["outlook"]["lean"] {
  if (avgSpx == null) return "neutral";
  if (avgSpx >= 0.25) return "risk_on";
  if (avgSpx <= -0.25) return "risk_off";
  return "neutral";
}

/** Advisory OpEx read from cross-market history + pin accuracy. */
export function buildMeridianOpexReport(input: OpexReportInput): MeridianOpexReport {
  const { cross_market: cm, pin_accuracy, spx_positioning } = input;
  if (!cm.available || cm.sample_size === 0) {
    return { available: false, outlook: { lean: "neutral", headline: "", summary: "" }, watch_list: [], warnings: [] };
  }

  const avgSpx = cm.aggregates.avg_spx_session_pct;
  const avgMag7 = cm.aggregates.avg_mag7_session_pct;
  const lean = outlookLean(avgSpx);
  const latest = cm.rows[0];

  const outlookHeadline =
    lean === "risk_on"
      ? "Historical OpEx sessions lean risk-on"
      : lean === "risk_off"
        ? "Historical OpEx sessions lean risk-off"
        : "Historical OpEx sessions are mixed / flat";

  const summaryParts: string[] = [];
  if (cm.headline) summaryParts.push(cm.headline);
  if (cm.aggregates.divergence_headline) summaryParts.push(cm.aggregates.divergence_headline);
  if (pin_accuracy.graded > 0 && pin_accuracy.accuracy_pct != null) {
    summaryParts.push(pin_accuracy.headline);
  }

  const watch_list: string[] = [];
  if (latest?.mag7.best) {
    watch_list.push(`Last OpEx Mag 7 leader · ${latest.mag7.best.ticker} ${fmtPct(latest.mag7.best.session_pct)}`);
  }
  if (latest?.top_gainer) {
    watch_list.push(`Last OpEx top mover · ${latest.top_gainer.ticker} ${fmtPct(latest.top_gainer.session_pct)}`);
  }
  if (avgMag7 != null && avgSpx != null && avgMag7 > avgSpx + 0.15) {
    watch_list.push("Mag 7 historically outruns SPX on OpEx — watch single-name gamma vs index pin");
  }
  if (spx_positioning.gamma_regime) {
    watch_list.push(`Current SPX structure · ${spx_positioning.gamma_regime}`);
  }

  const warnings: string[] = [];
  if (pin_accuracy.graded > 0 && pin_accuracy.accuracy_pct != null && pin_accuracy.accuracy_pct < 50) {
    warnings.push("Max pain pin accuracy below 50% in recent OpEx — treat pin levels as soft guides");
  }
  const wideDispersion = cm.rows.filter(
    (r) =>
      r.mag7.best &&
      r.mag7.worst &&
      r.mag7.best.session_pct - r.mag7.worst.session_pct >= 3
  ).length;
  if (wideDispersion >= 2) {
    warnings.push("Mag 7 dispersion often wide on OpEx — index pin may not reflect single-name moves");
  }
  if (latest?.spx_session_pct != null && Math.abs(latest.spx_session_pct) >= 1) {
    warnings.push(`Last OpEx SPX moved ${fmtPct(latest.spx_session_pct)} — reversion risk into the next expiry`);
  }

  return {
    available: true,
    outlook: {
      lean,
      headline: outlookHeadline,
      summary: summaryParts.join(" · ") || "Cross-market OpEx history loaded",
    },
    watch_list: watch_list.slice(0, 6),
    warnings: warnings.slice(0, 4),
  };
}
