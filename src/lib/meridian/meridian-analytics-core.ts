import type {
  MeridianMacroRelease,
  MeridianOpexHistoryRow,
} from "@/features/meridian/lib/meridian-types";

export type MacroCorrelationRail = {
  sample_size: number;
  avg_spx_session_pct: number | null;
  avg_spx_next_day_pct: number | null;
  avg_intraday_60_pct: number | null;
  regime_tag: "risk_on" | "risk_off" | "mixed" | "unknown";
  headline: string;
};

export type MacroSurpriseScore = {
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

export type OpexPinAccuracy = {
  graded: number;
  held: number;
  accuracy_pct: number | null;
  tolerance_pct: number;
  headline: string;
};

export type ExpectedVsRealized = {
  expected_move_pct: number | null;
  realized_move_pct: number | null;
  ratio: number | null;
  verdict: "under" | "over" | "inline" | "unknown";
  headline: string | null;
};

function avg(nums: number[]): number | null {
  if (!nums.length) return null;
  return Number((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2));
}

function regimeFromAvgSession(avgSession: number | null): MacroCorrelationRail["regime_tag"] {
  if (avgSession == null) return "unknown";
  if (avgSession <= -0.25) return "risk_off";
  if (avgSession >= 0.25) return "risk_on";
  return "mixed";
}

/** Aggregate prior macro prints into a correlation rail (session + optional intraday). */
export function buildMacroCorrelationRail(
  releases: Array<
    MeridianMacroRelease & { spx_intraday_60_pct?: number | null }
  >,
  eventLabel: string
): MacroCorrelationRail {
  const withSession = releases
    .map((r) => r.spx_session_pct)
    .filter((v): v is number => v != null && Number.isFinite(v));
  const withNext = releases
    .map((r) => r.spx_next_day_pct)
    .filter((v): v is number => v != null && Number.isFinite(v));
  const withIntra = releases
    .map((r) => r.spx_intraday_60_pct)
    .filter((v): v is number => v != null && Number.isFinite(v));

  const avgSession = avg(withSession);
  const avgNext = avg(withNext);
  const avgIntra = avg(withIntra);
  const regime = regimeFromAvgSession(avgSession);
  const n = withSession.length;

  let headline = `Insufficient history for ${eventLabel}`;
  if (n > 0 && avgSession != null) {
    const sign = avgSession >= 0 ? "+" : "";
    headline = `Last ${n} ${eventLabel} prints: avg SPX ${sign}${avgSession}% session`;
    if (avgIntra != null) headline += ` · ${avgIntra >= 0 ? "+" : ""}${avgIntra}% in 60m`;
    if (regime !== "unknown") {
      headline += regime === "risk_off" ? " · risk-off regime" : regime === "risk_on" ? " · risk-on regime" : " · mixed regime";
    }
  }

  return {
    sample_size: n,
    avg_spx_session_pct: avgSession,
    avg_spx_next_day_pct: avgNext,
    avg_intraday_60_pct: avgIntra,
    regime_tag: regime,
    headline,
  };
}

export function macroSurpriseScore(
  actual: number | null,
  estimate: number | null,
  history: MeridianMacroRelease[]
): MacroSurpriseScore {
  let surprise_pct: number | null = null;
  let verdict: MacroSurpriseScore["verdict"] = "unknown";
  if (actual != null && estimate != null && estimate !== 0) {
    surprise_pct = Number((((actual - estimate) / Math.abs(estimate)) * 100).toFixed(2));
    if (Math.abs(surprise_pct) < 1) verdict = "inline";
    else verdict = surprise_pct > 0 ? "beat" : "miss";
  }

  const graded = history.filter((h) => h.actual != null && h.estimate != null && h.estimate !== 0);
  let beats = 0;
  let misses = 0;
  const surprises: number[] = [];
  for (const row of graded) {
    const s = ((row.actual! - row.estimate!) / Math.abs(row.estimate!)) * 100;
    surprises.push(s);
    if (s >= 1) beats += 1;
    else if (s <= -1) misses += 1;
  }

  return {
    actual,
    estimate,
    surprise_pct,
    verdict,
    historical: {
      beats,
      misses,
      avg_surprise_pct: avg(surprises),
    },
  };
}

/** Max pain held if SPX close within tolerance of max pain on OpEx day. */
export function opexPinHeld(
  spxClose: number | null,
  maxPain: number | null,
  tolerancePct = 0.35
): boolean | null {
  if (spxClose == null || maxPain == null || maxPain === 0) return null;
  const diffPct = (Math.abs(spxClose - maxPain) / maxPain) * 100;
  return diffPct <= tolerancePct;
}

export function buildOpexPinAccuracy(
  rows: Array<MeridianOpexHistoryRow & { spx_close?: number | null }>,
  tolerancePct = 0.35
): OpexPinAccuracy {
  let held = 0;
  let graded = 0;
  for (const row of rows) {
    const close = row.spx_close ?? null;
    if (close == null || row.max_pain == null) continue;
    graded += 1;
    if (opexPinHeld(close, row.max_pain, tolerancePct)) held += 1;
  }
  const accuracy_pct = graded > 0 ? Number(((held / graded) * 100).toFixed(1)) : null;
  const headline =
    graded > 0 && accuracy_pct != null
      ? `Max pain held ${held}/${graded} prior OpEx (${accuracy_pct}% within ${tolerancePct}%)`
      : "OpEx pin accuracy — insufficient graded history";
  return { graded, held, accuracy_pct, tolerance_pct: tolerancePct, headline };
}

export function buildExpectedVsRealized(
  expectedMovePct: number | null,
  realizedMovePct: number | null
): ExpectedVsRealized {
  if (expectedMovePct == null || realizedMovePct == null) {
    return {
      expected_move_pct: expectedMovePct,
      realized_move_pct: realizedMovePct,
      ratio: null,
      verdict: "unknown",
      headline: null,
    };
  }
  const absReal = Math.abs(realizedMovePct);
  const ratio = expectedMovePct > 0 ? Number((absReal / expectedMovePct).toFixed(2)) : null;
  let verdict: ExpectedVsRealized["verdict"] = "inline";
  if (ratio != null) {
    if (ratio < 0.75) verdict = "under";
    else if (ratio > 1.25) verdict = "over";
  }
  const headline = `Realized ${realizedMovePct >= 0 ? "+" : ""}${realizedMovePct}% vs ~${expectedMovePct}% implied${
    ratio != null ? ` (${ratio}×)` : ""
  }`;
  return {
    expected_move_pct: expectedMovePct,
    realized_move_pct: realizedMovePct,
    ratio,
    verdict,
    headline,
  };
}
