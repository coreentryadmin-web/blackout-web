import type {
  MeridianCatalystHeadline,
  MeridianCorrelationRail,
  MeridianFlowSkew,
  MeridianMacroReport,
  MeridianMacroSurprise,
  MeridianSpxPositioning,
} from "@/features/meridian/lib/meridian-types";

type MacroReportInput = {
  event: string;
  date: string;
  time: string | null;
  impact: "high" | "medium" | "low";
  estimate: string | null;
  days_until: number | null;
  correlation_rail: MeridianCorrelationRail;
  surprise: MeridianMacroSurprise | null;
  related_headlines: MeridianCatalystHeadline[];
  spx_positioning: MeridianSpxPositioning;
  flow: MeridianFlowSkew;
};

function fmtPct(n: number | null): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function historicalExpectedMove(rail: MeridianCorrelationRail): MeridianMacroReport["expected_move"] {
  const session = rail.avg_spx_session_pct;
  const intra = rail.avg_intraday_60_pct;
  const primary = intra ?? session;
  if (primary == null) {
    return {
      available: false,
      session_pct: session,
      intraday_60_pct: intra,
      headline: null,
      source: "historical",
    };
  }
  const absMove = Math.abs(primary);
  const headline =
    intra != null
      ? `Historically SPX moves ~${absMove.toFixed(2)}% in the 60m after release (avg of ${rail.sample_size} prints)`
      : `Historically SPX moves ~${absMove.toFixed(2)}% on session (avg of ${rail.sample_size} prints)`;
  return {
    available: true,
    session_pct: session,
    intraday_60_pct: intra,
    headline,
    source: "historical",
  };
}

function buildExpectations(input: MacroReportInput): MeridianMacroReport["expectations"] {
  const parts: string[] = [];
  if (input.estimate) parts.push(`Consensus ${input.estimate}`);
  if (input.surprise?.historical) {
    const h = input.surprise.historical;
    if (h.beats + h.misses > 0) {
      parts.push(`${h.beats} beats / ${h.misses} misses in recent history`);
    }
    if (h.avg_surprise_pct != null) {
      parts.push(`Avg surprise ${h.avg_surprise_pct >= 0 ? "+" : ""}${h.avg_surprise_pct.toFixed(1)}%`);
    }
  }
  if (input.correlation_rail.regime_tag !== "unknown") {
    parts.push(`Historical regime · ${input.correlation_rail.regime_tag.replace("_", " ")}`);
  }
  return {
    available: parts.length > 0,
    consensus: input.estimate,
    headline: parts.length ? parts.join(" · ") : "No consensus loaded for this print",
    surprise_verdict: input.surprise?.verdict ?? null,
  };
}

function buildScenarios(input: MacroReportInput): string[] {
  const scenarios: string[] = [];
  const regime = input.correlation_rail.regime_tag;
  const avgSession = input.correlation_rail.avg_spx_session_pct;
  const event = input.event;

  if (input.surprise?.verdict === "beat") {
    scenarios.push(
      `Actual above consensus — watch for ${regime === "risk_off" ? "relief rally vs prior risk-off history" : "extension if momentum confirms"}`
    );
  } else if (input.surprise?.verdict === "miss") {
    scenarios.push(
      `Actual below consensus — ${regime === "risk_off" ? "aligns with historical risk-off reaction" : "vol expansion risk if short-gamma"}`
    );
  } else {
    scenarios.push(
      `Beat scenario: hot print → SPX ${avgSession != null && avgSession > 0 ? "may extend prior risk-on bias" : "reversal risk if bonds sell off"}`
    );
    scenarios.push(
      `Miss scenario: soft print → SPX ${avgSession != null && avgSession < 0 ? "may repeat risk-off drift" : "dip-buying if positioning is long-gamma"}`
    );
  }

  if (/fomc|fed|rate/i.test(event)) {
    scenarios.push("Dot plot / press tone can override the headline — watch the conference, not just the statement");
  } else if (/cpi|ppi|pce/i.test(event)) {
    scenarios.push("Core vs headline divergence matters — markets often trade the stickiest component");
  } else if (/payroll|nfp|jobs/i.test(event)) {
    scenarios.push("Wages + participation can move rates even when headline jobs look inline");
  }

  return scenarios.slice(0, 4);
}

function buildWatchList(input: MacroReportInput): string[] {
  const watch: string[] = [];
  if (input.time) watch.push(`Release clock · ${input.time} ET`);
  if (input.estimate) watch.push(`Consensus · ${input.estimate}`);
  if (input.spx_positioning.available) {
    if (input.spx_positioning.flip != null) {
      watch.push(
        `SPX flip ${input.spx_positioning.flip.toLocaleString()} (${input.spx_positioning.flip_distance_pts ?? "—"} pts away)`
      );
    }
    if (input.spx_positioning.call_wall != null && input.spx_positioning.put_wall != null) {
      watch.push(
        `Walls ${input.spx_positioning.put_wall.toLocaleString()} – ${input.spx_positioning.call_wall.toLocaleString()}`
      );
    }
    if (input.spx_positioning.gamma_regime) watch.push(`Gamma · ${input.spx_positioning.gamma_regime}`);
  }
  if (input.flow.available && input.flow.call_put_ratio != null) {
    watch.push(`HELIX SPX flow C/P ${input.flow.call_put_ratio.toFixed(2)} · ${input.flow.bias}`);
  }
  const intra = input.correlation_rail.avg_intraday_60_pct;
  if (intra != null) watch.push(`Prior avg 60m SPX move ${fmtPct(intra)} after this event family`);
  if (input.related_headlines.length) {
    watch.push(`News feed · ${input.related_headlines.length} related headline(s) loaded`);
  }
  return watch.slice(0, 7);
}

function buildWarnings(input: MacroReportInput): string[] {
  const warnings: string[] = [];
  if (input.impact === "high") {
    warnings.push("High-impact print — spreads widen and liquidity thins into the release");
  }
  if (input.days_until != null && input.days_until <= 0) {
    warnings.push("Release window is live or imminent — first print dominates, fades are dangerous");
  }
  const regime = (input.spx_positioning.gamma_regime ?? "").toLowerCase();
  if (/negative|short gamma|vol expansion/.test(regime)) {
    warnings.push("SPX in short-gamma — post-release moves can accelerate through walls");
  }
  if (input.correlation_rail.sample_size > 0 && input.correlation_rail.sample_size < 3) {
    warnings.push("Thin historical sample — expected-move stats are low confidence");
  }
  if (/fomc|fed/i.test(input.event)) {
    warnings.push("Fed events: statement + dots + presser — do not trade the headline alone");
  }
  return warnings.slice(0, 5);
}

function buildOutlook(input: MacroReportInput): MeridianMacroReport["outlook"] {
  const regime = input.correlation_rail.regime_tag;
  const flowBias = input.flow.bias;
  let lean: MeridianMacroReport["outlook"]["lean"] = "neutral";
  if (regime === "risk_on" && flowBias === "bullish") lean = "risk_on";
  else if (regime === "risk_off" && flowBias === "bearish") lean = "risk_off";
  else if (regime === "risk_on") lean = "risk_on";
  else if (regime === "risk_off") lean = "risk_off";

  const headline =
    lean === "risk_on"
      ? "Setup skews risk-on into the print"
      : lean === "risk_off"
        ? "Setup skews risk-off into the print"
        : "Mixed macro + structure — no clean pre-release lean";

  const summaryParts: string[] = [input.correlation_rail.headline];
  if (input.flow.available) summaryParts.push(`Flow ${input.flow.summary}`);
  return { lean, headline, summary: summaryParts.filter(Boolean).join(". ") + "." };
}

/** BlackOut macro event report — expectations, historical move, watch list, warnings. */
export function buildMeridianMacroReport(input: MacroReportInput): MeridianMacroReport {
  const expected_move = historicalExpectedMove(input.correlation_rail);
  const expectations = buildExpectations(input);
  const outlook = buildOutlook(input);
  const watch_list = buildWatchList(input);
  const warnings = buildWarnings(input);
  const scenarios = buildScenarios(input);

  const news_context =
    input.related_headlines.length > 0
      ? input.related_headlines.slice(0, 6).map((h) => h.title)
      : [];

  return {
    available: true,
    expected_move,
    expectations,
    outlook,
    watch_list,
    warnings,
    scenarios,
    news_context,
    disclaimer:
      "Macro report uses live consensus, historical SPX reactions, and structure context. Not financial advice.",
  };
}
