#!/usr/bin/env node
/**
 * Is SPX Slayer's entry-time `confidence` calibrated against realized outcomes? And if not, does
 * ANY entry-time score (grade, |score|) carry signal instead?
 *
 * WHY. `spx-signals.ts:706` computes `confidence = clamp(|score|*1.15 + factors.length*3, 0, 96)`
 * — a formula over a magnitude and a COUNT, fitted to no outcome data. #2646 omitted it at the
 * Largo boundary on that basis. This script asks the next question: what does it actually predict?
 *
 * FIRST RUN, 2026-08-23, 51 closed plays over 54 days of production: **every single one reported
 * confidence 96** — the clamp ceiling, 51/51, zero variance. It is not a weak predictor; it is a
 * CONSTANT rendered to members as a per-play "{n}% conviction". See `docs/spx/SLAYER-MAP.md` §7.2.
 *
 * That is why `correlate()` refuses to return a number for a constant predictor: the naive
 * point-biserial is 0/0 → NaN, and NaN reads as "no signal found" when the real finding is
 * "the input never varies".
 *
 * READ-ONLY. Goes through the app (`/api/market/spx/outcomes`), because raw Postgres is blocked
 * from this sandbox. Uses the shared audit auth (cron bearer first, Clerk temp user as fallback,
 * always released).
 *
 * Usage: node scripts/audit/spx-confidence-calibration.mjs [--limit=200] [--base=URL] [--json]
 * Exit 0 always — this is a measurement, not a gate. An empty ledger reports INSUFFICIENT DATA and
 * never a clean bill.
 */
import { fetchAuditJson, releaseAuditClerkSession } from "./lib/audit-auth-fetch.mjs";
import { bucketCalibration, correlate, informationCheck } from "./lib/calibration-eval.mjs";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const limit = Number(args.find((a) => a.startsWith("--limit="))?.slice(8) ?? 200);
const base = args.find((a) => a.startsWith("--base="))?.slice(7) ?? "https://blackouttrades.com";

const GRADE_RANK = { "A+": 4, A: 3, B: 2, C: 1, D: 0 };
const isWin = (r) => String(r.outcome ?? "").toLowerCase() === "win";

let rows = [];
let stats = null;
try {
  const res = await fetchAuditJson(base, `/api/market/spx/outcomes?limit=${limit}`);
  const body = res?.json ?? res;
  rows = (body?.rows ?? []).filter((r) => r?.outcome);
  stats = body?.stats ?? null;
} finally {
  await releaseAuditClerkSession().catch(() => {});
}

if (rows.length < 2) {
  const out = { verdict: "INSUFFICIENT DATA", closed_plays: rows.length };
  console.log(asJson ? JSON.stringify(out, null, 2) : `INSUFFICIENT DATA — ${rows.length} closed plays.`);
  process.exit(0);
}

const info = informationCheck(rows.map((r) => r.confidence));
const wins = rows.map((r) => (isWin(r) ? 1 : 0));

const predictors = {
  confidence: rows.map((r) => Number(r.confidence)),
  grade_rank: rows.map((r) => GRADE_RANK[String(r.grade).toUpperCase()] ?? 0),
  abs_score: rows.map((r) => Math.abs(Number(r.score) || 0)),
};
const correlations = Object.fromEntries(
  Object.entries(predictors).map(([k, xs]) => [k, correlate(xs, wins)])
);

const calib = bucketCalibration(rows, {
  value: (r) => Number(r.confidence),
  isWin,
  buckets: [[0, 79], [80, 89], [90, 95], [96, 100]],
});

const result = {
  closed_plays: rows.length,
  window_days: stats?.days_of_data ?? null,
  overall_win_rate: stats?.overall?.win_rate ?? null,
  confidence_information: info,
  correlations,
  calibration_buckets: calib,
};

if (asJson) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

console.log(`SPX confidence calibration — ${rows.length} closed plays over ${result.window_days ?? "?"} days\n`);

if (info.uninformative) {
  console.log(`⚠ CONFIDENCE CARRIES NO INFORMATION: every one of the ${info.n} plays reports ${info.constant}.`);
  console.log(`  Not "weakly predictive" — a CONSTANT, rendered to members as a per-play "{n}% conviction".`);
  console.log(`  Any correlation against it is 0/0; this run reports a degenerate verdict, not a number.\n`);
} else {
  console.log(`confidence takes ${info.distinct_values} distinct values across ${info.n} plays.\n`);
}

console.log("bucket        n   wins   win%");
for (const b of calib) {
  const rate = b.win_rate == null ? "  —  " : `${(100 * b.win_rate).toFixed(0).padStart(3)}%`;
  const flag = b.n === 0 ? "" : b.insufficient_sample ? "   (insufficient sample)" : "";
  console.log(`${String(b.lo + "-" + b.hi).padEnd(12)} ${String(b.n).padStart(2)}   ${String(b.wins).padStart(3)}   ${rate}${flag}`);
}

console.log("\npredictor vs realized win:");
for (const [k, c] of Object.entries(correlations)) {
  const line =
    c.verdict === "ok"
      ? `r = ${c.r.toFixed(3)}  (n=${c.n})`
      : c.verdict === "degenerate_predictor"
        ? `DEGENERATE — constant ${c.constant} across all ${c.n}; no correlation is defined`
        : `${c.verdict} (n=${c.n ?? 0})`;
  console.log(`  ${k.padEnd(14)} ${line}`);
}
console.log(
  "\nSmall-sample caveat: n is in the tens. These correlations are indicative, not established —" +
  "\nquote them with the denominator or not at all."
);
