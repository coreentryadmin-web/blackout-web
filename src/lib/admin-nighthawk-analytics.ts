import { dbConfigured, ensureSchema, fetchNighthawkOutcomeAnalytics, type NighthawkPlayOutcomeRow } from "@/lib/db";

const WINDOW_DAYS = 30;

export type NighthawkTierWinRate = {
  label: string;
  total: number;
  targets: number;
  win_rate: number;
};

export type NighthawkScoreBucket = {
  bucket: string;
  min: number;
  max: number;
  total: number;
  targets: number;
  win_rate: number;
};

export type NighthawkScatterPoint = {
  score: number;
  outcome: "target" | "stop" | "open";
  ticker: string;
  edition_for: string;
};

export type NighthawkAdminAnalytics = {
  db_configured: boolean;
  window_days: number;
  overall: { total: number; targets: number; win_rate: number };
  by_conviction: NighthawkTierWinRate[];
  by_direction: NighthawkTierWinRate[];
  by_sector: NighthawkTierWinRate[];
  avg_return_pct: number | null;
  score_buckets: NighthawkScoreBucket[];
  scatter: NighthawkScatterPoint[];
  pending_count: number;
  insights: string[];
};

const SCORE_BUCKETS: Array<{ bucket: string; min: number; max: number }> = [
  { bucket: "0–39", min: 0, max: 39 },
  { bucket: "40–54", min: 40, max: 54 },
  { bucket: "55–69", min: 55, max: 69 },
  { bucket: "70+", min: 70, max: 999 },
];

function tierWinRate(label: string, rows: NighthawkPlayOutcomeRow[]): NighthawkTierWinRate {
  const total = rows.length;
  const targets = rows.filter((r) => r.outcome === "target").length;
  return { label, total, targets, win_rate: total > 0 ? targets / total : 0 };
}

function entryMid(row: NighthawkPlayOutcomeRow): number | null {
  if (row.entry_range_low == null || row.entry_range_high == null) return null;
  return (row.entry_range_low + row.entry_range_high) / 2;
}

function playReturnPct(row: NighthawkPlayOutcomeRow): number | null {
  const entry = entryMid(row);
  const target = row.target;
  if (entry == null || target == null || entry === 0) return null;
  if (row.direction === "LONG") return ((target - entry) / entry) * 100;
  return ((entry - target) / entry) * 100;
}

function insightsFrom(rows: NighthawkPlayOutcomeRow[], byConviction: NighthawkTierWinRate[]): string[] {
  const lines: string[] = [];
  if (rows.length === 0) {
    lines.push("No resolved Night Hawk plays in the last 30 days — outcomes seed when editions publish.");
    return lines;
  }

  const overall = rows.filter((r) => r.outcome === "target").length / rows.length;
  lines.push(`Overall target hit rate ${(overall * 100).toFixed(0)}% across ${rows.length} resolved plays.`);

  const aPlus = byConviction.find((t) => t.label === "A+");
  const a = byConviction.find((t) => t.label === "A");
  if (aPlus && a && aPlus.total >= 2 && a.total >= 2) {
    const gap = aPlus.win_rate - a.win_rate;
    if (gap >= 0.1) {
      lines.push(`A+ conviction outperforms A by ${(gap * 100).toFixed(0)} pts — tier scoring is validated.`);
    } else if (gap <= -0.1) {
      lines.push(`A tier beating A+ — review conviction thresholds or regime multiplier.`);
    }
  }

  const long = rows.filter((r) => r.direction === "LONG");
  const short = rows.filter((r) => r.direction === "SHORT");
  if (long.length >= 3 && short.length >= 3) {
    const longWr = long.filter((r) => r.outcome === "target").length / long.length;
    const shortWr = short.filter((r) => r.outcome === "target").length / short.length;
    if (Math.abs(longWr - shortWr) >= 0.15) {
      const better = longWr > shortWr ? "LONG" : "SHORT";
      lines.push(`${better} bias stronger this window — directional flow weighting may need tuning.`);
    }
  }

  return lines;
}

export async function fetchNighthawkAdminAnalytics(): Promise<NighthawkAdminAnalytics> {
  const configured = dbConfigured();
  if (!configured) {
    return {
      db_configured: false,
      window_days: WINDOW_DAYS,
      overall: { total: 0, targets: 0, win_rate: 0 },
      by_conviction: [],
      by_direction: [],
      by_sector: [],
      avg_return_pct: null,
      score_buckets: [],
      scatter: [],
      pending_count: 0,
      insights: ["DATABASE_URL not set — Night Hawk outcome analytics require Postgres."],
    };
  }

  await ensureSchema();
  const { rows, pending_count } = await fetchNighthawkOutcomeAnalytics(WINDOW_DAYS);

  const targets = rows.filter((r) => r.outcome === "target");
  const winningReturns = targets.map(playReturnPct).filter((v): v is number => v != null);
  const avg_return_pct =
    winningReturns.length > 0
      ? winningReturns.reduce((sum, v) => sum + v, 0) / winningReturns.length
      : null;

  const convictionOrder = ["A+", "A", "B", "C"];
  const by_conviction = convictionOrder.map((label) =>
    tierWinRate(label, rows.filter((r) => r.conviction.toUpperCase() === label))
  );

  const by_direction = (["LONG", "SHORT"] as const).map((label) =>
    tierWinRate(label, rows.filter((r) => r.direction === label))
  );

  const sectorMap = new Map<string, NighthawkPlayOutcomeRow[]>();
  for (const row of rows) {
    const sector = row.sector?.trim() || "Unknown";
    const bucket = sectorMap.get(sector) ?? [];
    bucket.push(row);
    sectorMap.set(sector, bucket);
  }
  const by_sector = Array.from(sectorMap.entries())
    .map(([label, group]) => tierWinRate(label, group))
    .filter((t) => t.total > 0)
    .sort((a, b) => b.win_rate - a.win_rate || b.total - a.total);

  const score_buckets = SCORE_BUCKETS.map(({ bucket, min, max }) => {
    const group = rows.filter((r) => {
      const score = r.score ?? 0;
      return score >= min && score <= max;
    });
    return { bucket, min, max, ...tierWinRate(bucket, group) };
  }).filter((b) => b.total > 0);

  const scatter: NighthawkScatterPoint[] = rows
    .filter((r): r is NighthawkPlayOutcomeRow & { outcome: "target" | "stop" | "open" } => r.outcome !== "pending")
    .map((r) => ({
      score: r.score ?? 0,
      outcome: r.outcome,
      ticker: r.ticker,
      edition_for: r.edition_for,
    }));

  const overall = tierWinRate("overall", rows);

  return {
    db_configured: true,
    window_days: WINDOW_DAYS,
    overall: { total: overall.total, targets: overall.targets, win_rate: overall.win_rate },
    by_conviction,
    by_direction,
    by_sector,
    avg_return_pct,
    score_buckets,
    scatter,
    pending_count,
    insights: insightsFrom(rows, by_conviction),
  };
}
