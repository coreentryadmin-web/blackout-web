/**
 * SCORE-BAND / TIME-OF-DAY A/B — does either actually rank outcomes, or is the apparent
 * structure noise?
 *
 * THE QUESTION THIS SETTLES. The live 0DTE lane enforces a score floor of 65 (horizons.ts), and
 * the record endpoint's own aggregates make that look wrong: the 55-64 band showed +1.45% average
 * P&L against 65+'s -4.97%. Read as a point estimate that says "the floor is in the wrong place
 * and is starving the board of plays". Read with its sample size — n=10 against n=124 — it may
 * say nothing at all. The same applies to the open-window result (9:30-9:50, win rate 10%,
 * -34.8% average, n=10), which is the most alarming cell in the table and also one of the
 * smallest.
 *
 * Neither is a number to move a live gate on until a confidence interval has an opinion, so this
 * harness reports Wilson intervals per bucket and a difference-of-proportions CI per head-to-head,
 * and refuses to call anything that does not separate. It reuses the production stats in
 * `src/lib/zerodte/calibration-stats.ts` rather than reimplementing them, so a verdict here means
 * the same thing a graduation verdict means.
 *
 * READ-ONLY. One temp Clerk user via the shared audit-auth helper, released in a finally. No DB,
 * no writes, no board effect.
 *
 *   node --import tsx scripts/audit/score-band-tod-ab.mjs [--days=90] [--base=URL] [--json]
 */
import {
  SCORE_BANDS,
  TOD_WINDOWS,
  bucketBy,
  compareBuckets,
  etMinutesOf,
  nNeededForGap,
} from "./lib/band-ab-eval.mjs";
import { fetchAuditJson, releaseAuditClerkSession } from "./lib/audit-auth-fetch.mjs";
import { wilsonInterval, proportionDiffCI } from "../../src/lib/zerodte/calibration-stats.ts";

const args = new Map(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const DAYS = Number(args.get("days") ?? 90);
const BASE = args.get("base") ?? "https://blackouttrades.com";
const JSON_OUT = args.has("json");

/**
 * MULTIPLICITY. This harness runs eight head-to-heads in one pass. At a 95% level that is ~0.4
 * expected false positives per run, so a lone "SEPARATED" among eight is exactly what noise looks
 * like — reporting it as a finding would reintroduce, one level up, the same small-sample error
 * this tool exists to catch.
 *
 * So every comparison is reported twice: at the nominal z=1.96, and at a Bonferroni-corrected
 * level for the number of comparisons actually made. A result that survives the corrected z is
 * one I am willing to call real; one that only survives the nominal z is a candidate that needs
 * more sessions, and is labelled that way rather than quietly promoted.
 */
const COMPARISONS = 8;
/** Two-sided normal quantile for alpha/2, by bisection — no stats dependency for one number. */
function zForAlpha(alpha) {
  const target = 1 - alpha / 2;
  const cdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
  let lo = 0, hi = 6;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (cdf(mid) < target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
/** Abramowitz & Stegun 7.1.26 — max abs error 1.5e-7, far tighter than these sample sizes need. */
function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
  return sign * y;
}
const Z_BONF = zForAlpha(0.05 / COMPARISONS);

const pct = (x) => (x == null ? "   -  " : `${(x * 100).toFixed(1)}%`.padStart(6));
const sgn = (x) => (x == null ? "     - " : `${x >= 0 ? "+" : ""}${x.toFixed(2)}%`.padStart(7));

function table(title, buckets) {
  console.log(`\n=== ${title}`);
  console.log("  bucket                 n   wins     WR    Wilson 95%        avg P&L");
  for (const b of buckets) {
    const w = wilsonInterval(b.wins, b.n);
    const band = b.n ? `[${pct(w.lo)}, ${pct(w.hi)}]` : "[  -  ,   -  ]";
    console.log(`  ${b.label.padEnd(20)} ${String(b.n).padStart(3)}   ${String(b.wins).padStart(4)}  ${pct(b.winRate)}  ${band}   ${sgn(b.avgPnl)}`);
  }
}

/** Head-to-heads that would actually change a decision, rather than every pair. */
function heads(buckets, pairs) {
  console.log("  ── head-to-head (win-rate difference, 95% CI) ──");
  for (const [aLabel, bLabel] of pairs) {
    const a = buckets.find((x) => x.label === aLabel);
    const b = buckets.find((x) => x.label === bLabel);
    if (!a || !b) continue;
    const c = compareBuckets(a, b, proportionDiffCI);
    const cb = compareBuckets(a, b, (k1, n1, k2, n2) => proportionDiffCI(k1, n1, k2, n2, Z_BONF));
    const strength =
      cb.verdict.includes("SEPARATED") ? "REAL (survives Bonferroni)"
      : c.verdict.includes("SEPARATED") ? "CANDIDATE (nominal only — needs more sessions)"
      : c.verdict;
    console.log(
      `  ${aLabel.padEnd(18)} vs ${bLabel.padEnd(18)} ${(c.diffPts >= 0 ? "+" : "") + c.diffPts.toFixed(1)}pt  ` +
        `[${c.loPts.toFixed(1)}, ${c.hiPts.toFixed(1)}]  ${strength}`
    );
  }
}

async function main() {
  const res = await fetchAuditJson(BASE, `/api/market/zerodte/record?days=${DAYS}`);
  const j = res?.json ?? {};
  const raw = j.plays ?? [];

  // AS-MANAGED is the lane the member actually traded, with the mechanical grade as fallback for
  // rows that predate the executable lane. Mixing them silently would compare two different
  // questions, so the fallback is counted and reported.
  let fellBack = 0;
  const plays = raw.map((p) => {
    const managed = Number.isFinite(p.managed_pnl_pct) ? p.managed_pnl_pct : null;
    const mech = Number.isFinite(p.plan_pnl_pct) ? p.plan_pnl_pct : null;
    if (managed == null && mech != null) fellBack += 1;
    return {
      score: Number.isFinite(p.score) ? p.score : null,
      etMinutes: etMinutesOf(p.flagged_et),
      pnlPct: managed ?? mech,
      direction: typeof p.direction === "string" ? p.direction : null,
    };
  });

  const graded = plays.filter((p) => p.pnlPct != null);
  const noScore = graded.filter((p) => p.score == null).length;
  const noTime = graded.filter((p) => p.etMinutes == null).length;

  console.log(`=== SCORE-BAND / TIME-OF-DAY A/B — ${BASE} · ${DAYS}d`);
  console.log(`sessions=${j.window?.sessions} plays=${raw.length} graded=${graded.length} (mechanical fallback on ${fellBack})`);
  console.log(`dropped from score analysis: ${noScore} (no score) · from time analysis: ${noTime} (unparseable ET stamp)`);
  console.log(`for reference, separating a 15pt win-rate gap at 95% needs ~${nNeededForGap(15)} plays PER BUCKET`);
  console.log(`multiplicity: ${COMPARISONS} comparisons -> Bonferroni z=${Z_BONF.toFixed(3)} (nominal 1.960)`);

  const bands = bucketBy(graded, SCORE_BANDS, (p) => p.score);
  table("BY SCORE BAND", bands);
  heads(bands, [
    ["55-64", "65-74"],
    ["55-64", "85+"],
    ["65-74", "85+"],
    ["<45", "85+"],
  ]);

  const tod = bucketBy(graded, TOD_WINDOWS, (p) => p.etMinutes);
  table("BY TIME OF DAY", tod);
  heads(tod, [
    ["open 9:30-9:50", "prime 9:50-11:00"],
    ["open 9:30-9:50", "midday 11:00-14:00"],
    ["late 14:00-15:30", "midday 11:00-14:00"],
  ]);

  const dir = bucketBy(
    graded.map((p) => ({ ...p, dirNum: p.direction === "long" ? 0 : p.direction === "short" ? 1 : null })),
    [
      { label: "long", lo: 0, hi: 1 },
      { label: "short", lo: 1, hi: 2 },
    ],
    (p) => p.dirNum
  );
  table("BY DIRECTION", dir);
  heads(dir, [["short", "long"]]);

  if (JSON_OUT) console.log(JSON.stringify({ bands, tod, dir }, null, 2));
}

try {
  await main();
} finally {
  await releaseAuditClerkSession();
}
