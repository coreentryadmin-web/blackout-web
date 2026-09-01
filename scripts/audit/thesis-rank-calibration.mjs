#!/usr/bin/env node
/**
 * Thesis-first rank calibration — WR by rank_tier / systems_aligned / archetype.
 * Read-only; uses graded ledger via audit auth. Exits 0 always (research output).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { fetchAuditJson, releaseAuditClerkSession } from "./lib/audit-auth-fetch.mjs";

const BASE = (process.env.VALIDATE_BASE ?? "https://blackouttrades.com").replace(/\/$/, "");
const OUT = process.env.OUT ?? "/opt/cursor/artifacts/thesis-rank-calibration";
const DAYS = Number(process.env.DAYS ?? 90);

function isGradedWin(row: Record<string, unknown>): boolean {
  const outcome = String(row.plan_outcome ?? "");
  if (outcome === "win" || outcome === "doubled" || outcome === "trim") return true;
  if (outcome === "loss" || outcome === "stopped" || outcome === "time_stop_loss") return false;
  const pnl = row.plan_pnl_pct;
  if (typeof pnl === "number" && Number.isFinite(pnl)) return pnl > 0;
  return false;
}

function bucket(rows: Record<string, unknown>[], key: (r: Record<string, unknown>) => string) {
  const map = new Map<string, { n: number; wins: number }>();
  for (const r of rows) {
    const k = key(r) || "?";
    const b = map.get(k) ?? { n: 0, wins: 0 };
    b.n += 1;
    if (isGradedWin(r)) b.wins += 1;
    map.set(k, b);
  }
  return [...map.entries()]
    .map(([label, { n, wins }]) => ({
      label,
      n,
      wins,
      wr_pct: n > 0 ? Math.round((wins / n) * 1000) / 10 : null,
    }))
    .sort((a, b) => b.n - a.n);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const report = { base: BASE, days: DAYS, at: new Date().toISOString(), graded: 0, buckets: {} as Record<string, unknown> };

  try {
    const record = await fetchAuditJson(BASE, `/api/market/zerodte/record?days=${DAYS}`);
    if (!record.ok) {
      report.error = "record unreachable";
      writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
      console.log(JSON.stringify(report, null, 2));
      process.exit(1);
    }
    const rows = (record.json?.rows ?? record.json?.record ?? []).filter(
      (r: Record<string, unknown>) => r.plan_outcome && r.plan_outcome !== "open"
    );
    report.graded = rows.length;

    const withThesis = rows.filter((r: Record<string, unknown>) => r.entry_context?.thesis_first);
    report.buckets = {
      rank_tier: bucket(withThesis, (r) => String(r.entry_context?.thesis_first?.rank_tier ?? "?")),
      systems_aligned: bucket(withThesis, (r) =>
        String(r.entry_context?.thesis_first?.systems_aligned ?? "?")
      ),
      trade_archetype: bucket(withThesis, (r) =>
        String(r.entry_context?.thesis_first?.trade_archetype ?? "?")
      ),
      has_disagreeing_rails: bucket(withThesis, (r) =>
        (r.entry_context?.thesis_first?.disagreeing_rails?.length ?? 0) > 0 ? "yes" : "no"
      ),
    };

    writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  } finally {
    await releaseAuditClerkSession();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
