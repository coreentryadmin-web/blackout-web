import type {
  MeridianCatalystHeadline,
  MeridianEarningsReport,
  MeridianEarningsReportSignal,
  MeridianFinancialsContext,
} from "@/features/meridian/lib/meridian-types";

type AnalystRow = { title: string; action: string | null };

type ReportInput = {
  ticker: string;
  days_until: number | null;
  flow_bias: string;
  dark_pool_bias: string | null;
  dark_pool_available: boolean;
  gamma_regime: string | null;
  thermal_available: boolean;
  spot: number | null;
  king_strike: number | null;
  call_wall: number | null;
  put_wall: number | null;
  expected_move_pct: number | null;
  beat_rate: number | null;
  /** How many graded prints `beat_rate` came from — see dualBeatRateFromPrints. */
  beat_rate_graded?: number | null;
  post_print: { lean: "beat" | "miss" | "inline" | "unknown"; headline: string | null } | null;
  earnings_yoy: { eps_yoy_pct: number | null; revenue_yoy_pct: number | null } | null;
  financials: MeridianFinancialsContext | null;
  analyst_revisions: AnalystRow[];
  earnings_headlines: MeridianCatalystHeadline[];
  catalysts: MeridianCatalystHeadline[];
  insider_activity_count: number;
  vector_move_pct: number | null;
  vector_expiry: string | null;
};

function biasScore(bias: string | null | undefined): number {
  const b = (bias ?? "").toLowerCase();
  if (b === "bullish") return 2;
  if (b === "bearish") return -2;
  return 0;
}

function pushSignal(
  signals: MeridianEarningsReportSignal[],
  row: Omit<MeridianEarningsReportSignal, "score"> & { score: number }
): void {
  signals.push(row);
}

function analystLean(revisions: AnalystRow[]): { lean: MeridianEarningsReportSignal["lean"]; detail: string; score: number } {
  let up = 0;
  let down = 0;
  for (const r of revisions) {
    const a = (r.action ?? "").toLowerCase();
    if (a === "upgrade" || a === "target") up += 1;
    else if (a === "downgrade") down += 1;
  }
  if (up > down && up > 0) {
    return { lean: "bullish", detail: `${up} recent analyst actions skew positive`, score: 1 };
  }
  if (down > up && down > 0) {
    return { lean: "bearish", detail: `${down} recent analyst actions skew negative`, score: -1 };
  }
  return {
    lean: "neutral",
    detail: revisions.length ? `${revisions.length} analyst notes — mixed` : "No recent analyst revisions",
    score: 0,
  };
}

function fundamentalsLean(f: MeridianFinancialsContext | null): {
  lean: MeridianEarningsReportSignal["lean"];
  detail: string;
  score: number;
} {
  if (!f?.available) {
    return { lean: "neutral", detail: "Fundamentals unavailable", score: 0 };
  }
  let score = 0;
  const parts: string[] = [];
  if (f.revenue_yoy_pct != null) {
    if (f.revenue_yoy_pct >= 10) {
      score += 1;
      parts.push(`Revenue ${f.revenue_yoy_pct >= 0 ? "+" : ""}${f.revenue_yoy_pct.toFixed(0)}% YoY`);
    } else if (f.revenue_yoy_pct < 0) {
      score -= 1;
      parts.push(`Revenue ${f.revenue_yoy_pct.toFixed(0)}% YoY`);
    }
  }
  if (f.margin_trend === "expanding") {
    score += 1;
    parts.push("Margins expanding");
  } else if (f.margin_trend === "contracting") {
    score -= 1;
    parts.push("Margins contracting");
  }
  if (f.eps_trajectory === "rising") score += 1;
  else if (f.eps_trajectory === "falling") score -= 1;

  const lean: MeridianEarningsReportSignal["lean"] =
    score >= 2 ? "bullish" : score <= -2 ? "bearish" : "neutral";
  return {
    lean,
    detail: parts.length ? parts.join(" · ") : f.headline ?? "Fundamentals loaded",
    score: Math.max(-2, Math.min(2, score)),
  };
}

function thermalLean(input: ReportInput): { lean: MeridianEarningsReportSignal["lean"]; detail: string; score: number } {
  if (!input.thermal_available) {
    return { lean: "neutral", detail: "Thermal structure unavailable", score: 0 };
  }
  const regime = (input.gamma_regime ?? "").toLowerCase();
  let score = 0;
  const parts: string[] = [];
  if (/positive|long gamma|support/.test(regime)) {
    score += 1;
    parts.push("Long-gamma / supportive regime");
  } else if (/negative|short gamma|vol expansion|accelerate/.test(regime)) {
    score -= 1;
    parts.push("Short-gamma — moves can extend");
  }
  if (input.spot != null && input.king_strike != null) {
    const dist = ((input.spot - input.king_strike) / input.king_strike) * 100;
    if (Math.abs(dist) <= 0.5) parts.push(`Spot pinned near king ${input.king_strike.toLocaleString()}`);
    else if (dist > 1.5) {
      score -= 1;
      parts.push(`Spot ${dist.toFixed(1)}% above king — extended`);
    } else if (dist < -1.5) {
      score += 1;
      parts.push(`Spot ${Math.abs(dist).toFixed(1)}% below king — compressed`);
    }
  }
  if (input.call_wall != null && input.put_wall != null && input.spot != null) {
    parts.push(`Band ${input.put_wall.toLocaleString()}–${input.call_wall.toLocaleString()}`);
  }
  const lean: MeridianEarningsReportSignal["lean"] =
    score >= 1 ? "bullish" : score <= -1 ? "bearish" : "neutral";
  return { lean, detail: parts.join(" · ") || "Structure loaded", score };
}

function bestPlayHint(
  verdict: MeridianEarningsReport["verdict"],
  input: ReportInput
): MeridianEarningsReport["best_play"] {
  const em = input.expected_move_pct;
  const emLabel = em != null ? `~${em}% implied band` : "options-implied band";
  if (input.days_until != null && input.days_until <= 1) {
    return {
      headline: "Wait for the print — gap risk dominates",
      structure: "Reaction trade only after guidance and initial move settle",
      risk: "Size down or skip directional bets into the release",
    };
  }
  if (verdict === "bullish") {
    return {
      headline: "Bullish lean into earnings",
      structure:
        input.king_strike != null
          ? `Directional bias above king ${input.king_strike.toLocaleString()} — keep risk inside ${emLabel}`
          : `Call-side structures inside ${emLabel}`,
      risk: "Gaps can exceed implied move — this is context, not a ticket",
    };
  }
  if (verdict === "bearish") {
    return {
      headline: "Bearish lean into earnings",
      structure:
        input.put_wall != null
          ? `Put-side or fade setups below call wall ${input.call_wall?.toLocaleString() ?? "—"} · ${emLabel}`
          : `Put-side structures inside ${emLabel}`,
      risk: "Short squeezes on beats are common — respect the band",
    };
  }
  return {
    headline: "Neutral — no clean directional edge",
    structure: em != null ? `Vol structures inside ${emLabel} if playing the event` : "Stand aside or play vol only with defined risk",
    risk: "Mixed pillars — avoid forcing a directional read",
  };
}

/**
 * BlackOut earnings report — composite verdict from live pillars.
 * Advisory context only; never a trade recommendation.
 */
/**
 * The label every pillar carries into the orbital diagram — ONE canonical list.
 *
 * These used to be eleven string literals scattered through `buildMeridianEarningsReport`, and
 * `meridian-spatial-core.test.ts` — the guard whose whole job is to prove the orbital labels do
 * not collide — carried its OWN shorter copies ("Vector" for "Vector expected move", "Thermal"
 * for "Thermal nodes"). The guard therefore laid out labels roughly HALF the width of the ones
 * that ship, found no collision, and passed while the live render overlapped. Measured on prod
 * 2026-08-21: `"Thermal nodes" ∩ "Vector expected move" 8.79x6.71px`.
 *
 * Exported so the guard consumes the shipping strings. A test that invents its own fixture for
 * the very values under test can only ever prove something about the fixture.
 */
export const REPORT_PILLAR_LABELS = {
  flow: "HELIX flow",
  dark_pool: "Dark pool",
  thermal: "Thermal nodes",
  history: "Print history",
  surprise: "Latest print",
  yoy: "YoY trajectory",
  fundamentals: "Fundamentals",
  analyst: "Street / analysts",
  news: "News & catalysts",
  vector: "Vector expected move",
  insider: "Insider activity",
} as const satisfies Record<string, string>;

export function buildMeridianEarningsReport(input: ReportInput): MeridianEarningsReport {
  const signals: MeridianEarningsReportSignal[] = [];
  let total = 0;

  const flowScore = biasScore(input.flow_bias);
  pushSignal(signals, {
    pillar: "flow",
    label: REPORT_PILLAR_LABELS.flow,
    lean: flowScore > 0 ? "bullish" : flowScore < 0 ? "bearish" : "neutral",
    weight: 2,
    detail: `Tape skew ${input.flow_bias}`,
    score: flowScore,
  });
  total += flowScore;

  if (input.dark_pool_available) {
    const dpScore = biasScore(input.dark_pool_bias);
    pushSignal(signals, {
      pillar: "dark_pool",
      label: REPORT_PILLAR_LABELS.dark_pool,
      lean: dpScore > 0 ? "bullish" : dpScore < 0 ? "bearish" : "neutral",
      weight: 1,
      detail: `Institutional prints ${input.dark_pool_bias ?? "mixed"}`,
      score: dpScore,
    });
    total += dpScore;
  }

  const thermal = thermalLean(input);
  pushSignal(signals, {
    pillar: "thermal",
    label: REPORT_PILLAR_LABELS.thermal,
    lean: thermal.lean,
    weight: 2,
    detail: thermal.detail,
    score: thermal.score,
  });
  total += thermal.score;

  if (input.beat_rate != null) {
    let score = 0;
    let lean: MeridianEarningsReportSignal["lean"] = "neutral";
    if (input.beat_rate >= 0.65) {
      score = 1;
      lean = "bullish";
    } else if (input.beat_rate <= 0.35) {
      score = -1;
      lean = "bearish";
    }
    pushSignal(signals, {
      pillar: "history",
      label: REPORT_PILLAR_LABELS.history,
      lean,
      weight: 1,
      // The cohort travels with the rate. "100% beat rate" off ONE graded print and off eight
      // are the same string, and both clear the 0.65 bullish threshold — measured live, 10.2%
      // of names that get a beat rate at all get it from one or two prints.
      detail:
        input.beat_rate_graded != null && input.beat_rate_graded > 0
          ? `${Math.round(input.beat_rate * 100)}% beat rate over ${input.beat_rate_graded} print${input.beat_rate_graded === 1 ? "" : "s"}`
          : `${Math.round(input.beat_rate * 100)}% beat rate on recent prints`,
      score,
    });
    total += score;
  }

  if (input.post_print?.headline && input.post_print.lean !== "unknown") {
    const ppScore =
      input.post_print.lean === "beat" ? 2 : input.post_print.lean === "miss" ? -2 : 0;
    pushSignal(signals, {
      pillar: "surprise",
      label: REPORT_PILLAR_LABELS.surprise,
      lean: input.post_print.lean === "beat" ? "bullish" : input.post_print.lean === "miss" ? "bearish" : "neutral",
      weight: 2,
      detail: input.post_print.headline,
      score: ppScore,
    });
    total += ppScore;
  }

  if (input.earnings_yoy?.eps_yoy_pct != null || input.earnings_yoy?.revenue_yoy_pct != null) {
    const eps = input.earnings_yoy.eps_yoy_pct;
    const rev = input.earnings_yoy.revenue_yoy_pct;
    let score = 0;
    if (eps != null && eps >= 15) score += 1;
    else if (eps != null && eps < 0) score -= 1;
    if (rev != null && rev >= 10) score += 1;
    else if (rev != null && rev < 0) score -= 1;
    const parts: string[] = [];
    if (eps != null) parts.push(`EPS est ${eps >= 0 ? "+" : ""}${eps}% YoY`);
    if (rev != null) parts.push(`Rev est ${rev >= 0 ? "+" : ""}${rev}% YoY`);
    pushSignal(signals, {
      pillar: "yoy",
      label: REPORT_PILLAR_LABELS.yoy,
      lean: score >= 1 ? "bullish" : score <= -1 ? "bearish" : "neutral",
      weight: 1,
      detail: parts.join(" · ") || "YoY estimates loaded",
      score: Math.max(-2, Math.min(2, score)),
    });
    total += Math.max(-2, Math.min(2, score));
  }

  const fund = fundamentalsLean(input.financials);
  pushSignal(signals, {
    pillar: "fundamentals",
    label: REPORT_PILLAR_LABELS.fundamentals,
    lean: fund.lean,
    weight: 2,
    detail: fund.detail,
    score: fund.score,
  });
  total += fund.score;

  const analyst = analystLean(input.analyst_revisions);
  pushSignal(signals, {
    pillar: "analyst",
    label: REPORT_PILLAR_LABELS.analyst,
    lean: analyst.lean,
    weight: 1,
    detail: analyst.detail,
    score: analyst.score,
  });
  total += analyst.score;

  const newsCount = input.earnings_headlines.length + input.catalysts.length;
  pushSignal(signals, {
    pillar: "news",
    label: REPORT_PILLAR_LABELS.news,
    lean: "neutral",
    weight: 0,
    detail: newsCount
      ? `${newsCount} recent headlines in feed`
      : "No recent catalyst headlines",
    score: 0,
  });

  if (input.vector_move_pct != null) {
    pushSignal(signals, {
      pillar: "vector",
      label: REPORT_PILLAR_LABELS.vector,
      lean: "neutral",
      weight: 0,
      detail: `Chain IV ~${input.vector_move_pct}%${input.vector_expiry ? ` · ${input.vector_expiry}` : ""}`,
      score: 0,
    });
  }

  if (input.insider_activity_count > 0) {
    pushSignal(signals, {
      pillar: "insider",
      label: REPORT_PILLAR_LABELS.insider,
      lean: "neutral",
      weight: 0,
      detail: `${input.insider_activity_count} recent insider filing(s) — review titles`,
      score: 0,
    });
  }

  /**
   * HAS THE PRINT ALREADY LANDED? Not the same question as "is it near".
   *
   * `imminent` is a distance in days, and on the day of a BMO print it stays true for the whole
   * session — including the ~6.5 hours AFTER the company has reported. Measured on prod
   * 2026-08-21 at 12:52 ET, all three names that printed that morning were still headlined
   * "Imminent print — stand aside for reaction":
   *
   *   BEKE 06:00 ET  post_print "Beat · EPS +50% · Rev +3%"    verdict bullish
   *   BJ   06:45 ET  post_print "Beat · EPS +14.3% · Rev +8.9%" verdict bullish
   *   BKE  06:50 ET  post_print "Mixed print vs street"         verdict neutral
   *
   * The contradiction is internal: `hasFreshPrint` below is derived from the SAME post-print data
   * and is used two lines down to set the verdict, so the function already knows the numbers are
   * out. It then printed a headline saying they are not, over the top of a verdict that exists
   * only because they are. `inline` counts as printed too — a mixed print is still a print, and
   * BKE is why this reads `!== "unknown"` rather than the beat/miss pair.
   */
  const printed = input.post_print != null && input.post_print.lean !== "unknown";
  // `imminent` keeps its ORIGINAL meaning — a distance in days — because the verdict branch below
  // reads it, and widening it there would silently re-route an inline print (BKE: post_print
  // "inline", so printed but not hasFreshPrint) from a neutral verdict into the pre-print signal
  // stack, flipping it bullish off a score that describes anticipation. `printed` is applied only
  // where the forward-looking CLAIM is made: the headline and the confidence hedge.
  const imminent = input.days_until != null && input.days_until <= 1;
  const hasFreshPrint = input.post_print?.lean === "beat" || input.post_print?.lean === "miss";
  let verdict: MeridianEarningsReport["verdict"] = "neutral";
  if (hasFreshPrint) {
    verdict =
      input.post_print!.lean === "beat"
        ? "bullish"
        : input.post_print!.lean === "miss"
          ? "bearish"
          : "neutral";
  } else if (!imminent) {
    if (total >= 3) verdict = "bullish";
    else if (total <= -3) verdict = "bearish";
  }

  const activeSignals = signals.filter((s) => s.weight > 0 && s.lean !== "neutral");
  // The `imminent -> low` hedge exists because an UNKNOWN upcoming print dominates any signal
  // stack. Once the numbers are out that uncertainty is resolved, so holding confidence at "low"
  // for the rest of the session understates a read the print itself has now informed.
  const confidence: MeridianEarningsReport["confidence"] = imminent && !printed
    ? "low"
    : Math.abs(total) >= 5
      ? "high"
      : Math.abs(total) >= 3
        ? "medium"
        : "low";

  // "into earnings" is also forward-looking, so a printed name cannot fall through to it either.
  // Post-print the honest headline names what the numbers did, which is the thing the reader is
  // actually looking at — and the verdict above is already derived from exactly that.
  const headline = printed
    ? verdict === "bullish"
      ? `${input.ticker} printed — beat; the reaction is the read now`
      : verdict === "bearish"
        ? `${input.ticker} printed — miss; the reaction is the read now`
        : `${input.ticker} printed — mixed vs street; the reaction is the read now`
    : imminent
      ? "Imminent print — stand aside for reaction"
      : verdict === "bullish"
        ? `${input.ticker} leans bullish into earnings`
        : verdict === "bearish"
          ? `${input.ticker} leans bearish into earnings`
          : `${input.ticker} — mixed setup, neutral lean`;

  const summaryParts = signals
    .filter((s) => s.weight > 0 && s.score !== 0)
    .slice(0, 4)
    .map((s) => s.detail);
  const summary =
    summaryParts.length > 0
      ? summaryParts.join(". ") + "."
      : "Insufficient directional agreement across flow, structure, and fundamentals.";

  return {
    available: signals.some((s) => s.weight > 0),
    verdict,
    confidence,
    score: total,
    headline,
    summary,
    signals,
    best_play: bestPlayHint(verdict, input),
    risk_note:
      "BlackOut earnings report synthesizes live flow, structure, and fundamentals. Not financial advice.",
  };
}
