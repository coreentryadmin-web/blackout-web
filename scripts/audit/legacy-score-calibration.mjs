#!/usr/bin/env node
/**
 * NIGHT HAWK LEGACY SCORE-CALIBRATION RELIABILITY DIAGRAM (tier-narrative-staleness idea, step 2,
 * logged 2026-09-15 in docs/audit/nighthawk-legacy-live-journal.json's knownOpenItems). Step 1
 * (GET /api/admin/nighthawk/tier-export, PR #5018) shipped the per-play score+outcome data this
 * script needs; the public /api/market/nighthawk/record route only ever returns aggregate stats.
 *
 * THE QUESTION. Every Legacy play's tier factor text cites a hardcoded, one-time historical
 * measurement to members verbatim — "Score 42 sits in 40-55 — the overnight sweet spot (B-tier ran
 * +2.99% avg)" (nighthawk-tiers.ts, first committed 2026-07-17, never recalibrated). This asks the
 * same question the Swing lane's swing-score-calibration.mjs already answers for Swings: does a
 * play scored 42 actually win at the rate the narrative implies, or is `score` just a number?
 *
 * REUSES the Swing lane's own pure eval module (bucketByScoreQuantile / scoreCalibrationVerdict,
 * scripts/audit/lib/swing-score-calibration-eval.mjs) UNCHANGED rather than duplicating it —
 * both functions are generic over {score, pnlPct} rows / {label,n,winRate,avgPnlPct} summaries,
 * nothing swing-specific in the pure logic itself, and the verdict discipline (spread AND a
 * monotonic Spearman trend both required for RANKS, never spread alone) must not drift between the
 * two lanes asking the identical question.
 *
 * Legacy's outcome model is BINARY (outcome: "target" | "stop"), unlike Swing's continuous
 * exitPnlPct, so `pnlPct` here is a SIGN-ONLY proxy (+1 for a target hit, -1 for a stop hit) fed
 * into the reused module purely so it can read the win/loss sign — `avg_pnl` in the printed output
 * is this proxy's own average, NOT a real dollar or percent return, and is labeled as such.
 * Only DECIDED rows (outcome target/stop, not pulled) are usable — open/ambiguous/pending/unfilled
 * rows have no realized win/loss yet and are correctly excluded, never coerced into a bucket.
 *
 * USAGE
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *   node --import tsx scripts/audit/legacy-score-calibration.mjs [--days=90] [--base=https://blackouttrades.com] [--min-n=3] [--json]
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
  const res = await fetchAuditJson(BASE, `/api/admin/nighthawk/tier-export?days=${DAYS}`);
  if (!res.ok || !Array.isArray(res.json?.plays)) {
    if (JSON_OUT) console.log(JSON.stringify({ ok: false, insufficient_data: true, status: res.status, via: res.via }, null, 2));
    else console.log(`INSUFFICIENT DATA — GET /api/admin/nighthawk/tier-export?days=${DAYS} -> ${res.status} via=${res.via ?? "none"}`);
    await releaseAuditClerkSession();
    process.exitCode = 1;
    return;
  }

  // DECIDED only: a real target/stop outcome, never pulled (a pulled play's grade is
  // counterfactual-only and must never be counted as a real win/loss by this study).
  const decided = (res.json.plays ?? []).filter(
    (p) => !p.pulled && (p.outcome === "target" || p.outcome === "stop")
  );
  const rows = decided.map((p) => ({
    ticker: p.ticker,
    score: typeof p.score === "number" ? p.score : null,
    // Sign-only proxy — see file header. Never treated as a real return.
    pnlPct: p.outcome === "target" ? 1 : -1,
  }));

  const buckets = bucketByScoreQuantile(rows, { minPerBucket: MIN_N });
  const verdict = scoreCalibrationVerdict(buckets, { minN: MIN_N });

  if (JSON_OUT) {
    console.log(
      JSON.stringify(
        { ok: true, days: DAYS, total_plays: res.json.plays.length, decided_population: rows.length, buckets, verdict },
        null,
        2
      )
    );
    await releaseAuditClerkSession();
    return;
  }

  console.log(`\n=== NIGHT HAWK LEGACY SCORE-CALIBRATION RELIABILITY DIAGRAM (${DAYS}d window, ${rows.length} decided plays of ${res.json.plays.length} total) ===`);
  console.log(`Bucket count chosen: ${buckets.length} (quantile-split, minPerBucket=${MIN_N}) — NOT a forced decile if n is small.\n`);
  for (const b of buckets) {
    console.log(`${b.label}: n=${b.n} win_rate=${b.winRate != null ? b.winRate.toFixed(1) + "%" : "n/a"}`);
  }
  console.log(`\nVerdict: ${verdict.verdict}`);
  if (verdict.verdict !== "INSUFFICIENT DATA") {
    console.log(`  spread=${verdict.spreadPp}pp rho=${verdict.rho} usable_buckets=${verdict.usableBuckets}`);
    console.log(`  best: ${verdict.best.label} (${verdict.best.winRate.toFixed(1)}%)  worst: ${verdict.worst.label} (${verdict.worst.winRate.toFixed(1)}%)`);
  }
  if (verdict.excluded?.length) console.log(`  excluded (below minN=${MIN_N}): ${verdict.excluded.join(", ")}`);
  console.log(`\nNo gate/scoring weight/tier-narrative constant changed by this script — evidence only.`);
  await releaseAuditClerkSession();
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
