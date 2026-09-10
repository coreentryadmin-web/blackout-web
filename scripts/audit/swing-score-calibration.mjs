#!/usr/bin/env node
/**
 * SWING SCORE-CALIBRATION RELIABILITY DIAGRAM (Night Hawk Swings v6 mandate item 3, 2026-09-10).
 *
 * v5 already asked "does score/origin predict BIG winners" (open). v6 sharpens it: does a play
 * scored ~70 at commit actually win close to 70% of the time — is the swing commit `score`
 * calibrated, or just a number? Buckets every closed chain's commit score by QUANTILE (equal
 * population per bucket, not fixed score ranges — swing's much smaller closed population than
 * Helix's makes a literal ten-way decile split dishonest at low n) and checks whether realized
 * win rate is monotonic across buckets. Same verdict discipline as `helix-score-signal.mjs`'s
 * `scoreSeparation` (a spread alone is not a ranking — RANKS requires both spread AND a monotonic
 * Spearman trend), deliberately copied rather than reinvented.
 *
 * Pure logic in scripts/audit/lib/swing-score-calibration-eval.mjs (unit-tested).
 *
 * USAGE
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *   node --import tsx scripts/audit/swing-score-calibration.mjs [--days=90] [--base=https://blackouttrades.com] [--min-n=3] [--json]
 */
import { fetchAuditJson, releaseAuditClerkSession } from "./lib/audit-auth-fetch.mjs";
import { bucketByScoreQuantile, scoreCalibrationVerdict } from "./lib/swing-score-calibration-eval.mjs";

const args = process.argv.slice(2);
const flag = (name, def) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : def;
};
const DAYS = Math.min(90, Math.max(1, Number(flag("days", "90")) || 90));
const BASE = flag("base", "https://blackouttrades.com");
const MIN_N = Math.max(1, Number(flag("min-n", "3")) || 3);
const JSON_OUT = args.includes("--json");

async function main() {
  const res = await fetchAuditJson(BASE, `/api/market/swing/record?days=${DAYS}`);
  if (!res.ok || !res.json?.closedDeck) {
    if (JSON_OUT) console.log(JSON.stringify({ ok: false, insufficient_data: true, status: res.status, via: res.via }, null, 2));
    else console.log(`INSUFFICIENT DATA — GET /api/market/swing/record?days=${DAYS} -> ${res.status} via=${res.via ?? "none"}`);
    await releaseAuditClerkSession();
    process.exitCode = 1;
    return;
  }

  const rows = (res.json.closedDeck ?? []).map((c) => ({
    ticker: c.ticker,
    score: typeof c.score === "number" ? c.score : null,
    pnlPct: typeof c.exitPnlPct === "number" ? c.exitPnlPct : null,
    archetype: c.archetype ?? null,
  }));

  const buckets = bucketByScoreQuantile(rows, { minPerBucket: MIN_N });
  const verdict = scoreCalibrationVerdict(buckets, { minN: MIN_N });

  if (JSON_OUT) {
    console.log(JSON.stringify({ ok: true, days: DAYS, population: rows.length, buckets, verdict }, null, 2));
    await releaseAuditClerkSession();
    return;
  }

  console.log(`\n=== SWING SCORE-CALIBRATION RELIABILITY DIAGRAM (${DAYS}d window, ${rows.length} closed chains) ===`);
  console.log(`Bucket count chosen: ${buckets.length} (quantile-split, minPerBucket=${MIN_N}) — NOT a forced decile if n is small.\n`);
  for (const b of buckets) {
    console.log(`${b.label}: n=${b.n} win_rate=${b.winRate != null ? b.winRate.toFixed(1) + "%" : "n/a"} avg_pnl=${b.avgPnlPct != null ? b.avgPnlPct.toFixed(1) + "%" : "n/a"}`);
  }
  console.log(`\nVerdict: ${verdict.verdict}`);
  if (verdict.verdict !== "INSUFFICIENT DATA") {
    console.log(`  spread=${verdict.spreadPp}pp rho=${verdict.rho} usable_buckets=${verdict.usableBuckets}`);
    console.log(`  best: ${verdict.best.label} (${verdict.best.winRate.toFixed(1)}%)  worst: ${verdict.worst.label} (${verdict.worst.winRate.toFixed(1)}%)`);
  }
  if (verdict.excluded?.length) console.log(`  excluded (below minN=${MIN_N}): ${verdict.excluded.join(", ")}`);
  console.log(`\nNo gate/scoring weight changed by this script — evidence only.`);
  await releaseAuditClerkSession();
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
