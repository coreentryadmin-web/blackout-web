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
export function buildMeridianEarningsReport(input: ReportInput): MeridianEarningsReport {
  const signals: MeridianEarningsReportSignal[] = [];
  let total = 0;

  const flowScore = biasScore(input.flow_bias);
  pushSignal(signals, {
    pillar: "flow",
    label: "HELIX flow",
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
      label: "Dark pool",
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
    label: "Thermal nodes",
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
      label: "Print history",
      lean,
      weight: 1,
      detail: `${Math.round(input.beat_rate * 100)}% beat rate on recent prints`,
      score,
    });
    total += score;
  }

  if (input.post_print?.headline && input.post_print.lean !== "unknown") {
    const ppScore =
      input.post_print.lean === "beat" ? 2 : input.post_print.lean === "miss" ? -2 : 0;
    pushSignal(signals, {
      pillar: "surprise",
      label: "Latest print",
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
      label: "YoY trajectory",
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
    label: "Fundamentals",
    lean: fund.lean,
    weight: 2,
    detail: fund.detail,
    score: fund.score,
  });
  total += fund.score;

  const analyst = analystLean(input.analyst_revisions);
  pushSignal(signals, {
    pillar: "analyst",
    label: "Street / analysts",
    lean: analyst.lean,
    weight: 1,
    detail: analyst.detail,
    score: analyst.score,
  });
  total += analyst.score;

  const newsCount = input.earnings_headlines.length + input.catalysts.length;
  pushSignal(signals, {
    pillar: "news",
    label: "News & catalysts",
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
      label: "Vector expected move",
      lean: "neutral",
      weight: 0,
      detail: `Chain IV ~${input.vector_move_pct}%${input.vector_expiry ? ` · ${input.vector_expiry}` : ""}`,
      score: 0,
    });
  }

  if (input.insider_activity_count > 0) {
    pushSignal(signals, {
      pillar: "insider",
      label: "Insider activity",
      lean: "neutral",
      weight: 0,
      detail: `${input.insider_activity_count} recent insider filing(s) — review titles`,
      score: 0,
    });
  }

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
  const confidence: MeridianEarningsReport["confidence"] = imminent
    ? "low"
    : Math.abs(total) >= 5
      ? "high"
      : Math.abs(total) >= 3
        ? "medium"
        : "low";

  const headline =
    imminent
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
