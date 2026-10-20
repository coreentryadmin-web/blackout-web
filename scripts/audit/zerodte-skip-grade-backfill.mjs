/**
 * 0DTE SKIP-GRADE BACKFILL — independently grades real hard-gate rejections the live
 * `zerodte-skip-grade` cron hasn't reached yet, using PRODUCTION'S OWN pure grading function.
 * ============================================================================================
 * WHY THIS EXISTS (2026-10-20, member directive: "backfill older records where reliable
 * historical data allows, clearly marking anything ungradable... identify which filters avoided
 * losses and which blocked profitable setups")
 * ------------------------------------------------------------------------------------------
 * `fix/zerodte-skip-grading-backlog` (PR #6301) fixes the live cron's own throughput (raised
 * MAX_SKIP_GRADE_DAYS 14->35, MAX_ROWS_PER_RUN 200->500) — but that fix needs to merge and
 * deploy before the live system starts clearing its real backlog, and even then only grades
 * 500 rows/day against a real ~2,000+/day volume. This script does the SAME grading NOW, from
 * this sandbox, against whatever rejection rows the admin export can see and whatever real
 * historical minute bars Polygon still serves — read-only w.r.t. the app (never writes to the
 * live `zerodte_scan_rejections` table; no DB write path is available from here), reported for
 * analysis rather than persisted.
 *
 * IMPORTS `gradeSkippedPlay` DIRECTLY FROM `skip-grading.ts` — never reimplements it. Same
 * entry-is-first-real-bar-at/after-block discipline, same PLAN_RULES stop/target, same
 * underlying-basis-only (premium only when an OCC is pinned, which rejection rows never carry)
 * honesty rule as the production grader. A result from this script and a result the live cron
 * eventually produces for the SAME row are the same number, because it is the same function.
 *
 * WHAT THIS CANNOT DO: persist back to the live DB (no write path from this sandbox) — so this
 * is evidence for THIS investigation, not a substitute for the real fix actually running in
 * production. Flagged in every run's output, not quietly implied.
 *
 * USAGE
 *   POLYGON_API_BASE=https://api.massive.com \
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *   node --import tsx scripts/audit/zerodte-skip-grade-backfill.mjs [options]
 * OPTIONS
 *   --days=N          how many real session days back to backfill (default 20)
 *   --max-per-day=N   cap on rows graded per day (default 400 — this sandbox's own budget,
 *                      unrelated to the production MAX_ROWS_PER_RUN)
 *   --base=URL
 *   --json
 */

if (!process.env.POLYGON_API_BASE || !/^https?:\/\//.test(process.env.POLYGON_API_BASE)) {
  process.env.POLYGON_API_BASE = "https://api.massive.com";
}

const APP_BASE = process.env.AUDIT_BASE || "https://blackouttrades.com";
const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? "true"] : [a, "true"];
  })
);
const DAYS = Math.max(1, Number(argv.days ?? 20));
const MAX_PER_DAY = Math.max(1, Number(argv["max-per-day"] ?? 400));
const EMIT_JSON = Boolean(argv.json);
const BASE = argv.base ?? APP_BASE;

const { fetchAuditJson, releaseAuditClerkSession } = await import("./lib/audit-auth-fetch.mjs");
const SRC = new URL("../../src/", import.meta.url).pathname;
const { gradeSkippedPlay } = await import(`${SRC}lib/zerodte/skip-grading.ts`);
const { polygonSpotTicker } = await import(`${SRC}lib/zerodte/board.ts`);
const { fetchStockMinuteBars, fetchIndexMinuteBars } = await import(`${SRC}lib/providers/polygon.ts`);

const line = (c = "─", w = 112) => c.repeat(w);
function etYmd(ms) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(ms));
}

console.log(line("═"));
console.log(`  0DTE SKIP-GRADE BACKFILL — grades real rejections the live cron hasn't reached yet`);
console.log(`  (READ-ONLY — reports results here, does NOT write to the live DB; see header)`);
console.log(`  window ${DAYS}d back · cap ${MAX_PER_DAY}/day · base ${BASE}`);
console.log(line("═"));

try {
  const nowMs = Date.now();
  const days = [];
  for (let i = 1; i <= DAYS; i++) {
    const d = etYmd(nowMs - i * 86_400_000);
    days.push(d);
  }

  const allGraded = [];
  const barCache = new Map(); // `${ticker}|${day}` -> bars

  for (const day of days) {
    const res = await fetchAuditJson(BASE, `/api/admin/zerodte/rejection-export?limit=2000&session_date=${day}`).catch(() => null);
    const rows = res?.json?.rows ?? [];
    const ungraded = rows.filter((r) => r.counterfactual == null).slice(0, MAX_PER_DAY);
    if (!rows.length) continue;
    console.log(`\n  ${day}: ${rows.length} total rejections, ${ungraded.length}/${rows.length - (rows.length - ungraded.length)} ungraded (grading up to ${MAX_PER_DAY})`);

    let graded = 0, ungradeable = 0, errors = 0;
    for (const r of ungraded) {
      const ticker = r.ticker;
      const blockedAtMs = Date.parse(r.observed_at);
      const cacheKey = `${ticker}|${day}`;
      let bars = barCache.get(cacheKey);
      if (bars === undefined) {
        try {
          const spot = polygonSpotTicker(ticker);
          bars = spot.startsWith("I:")
            ? await fetchIndexMinuteBars(spot, day, day).catch(() => [])
            : await fetchStockMinuteBars(spot, day, day).catch(() => []);
        } catch {
          bars = [];
        }
        barCache.set(cacheKey, bars);
      }
      let counterfactual;
      try {
        counterfactual = gradeSkippedPlay({
          direction: r.direction,
          blockedAtMs,
          premiumBars: null, // rejection rows never carry an OCC — underlying basis only, same as production
          underlyingBars: bars,
          nowMs,
        });
      } catch (e) {
        errors++;
        continue;
      }
      if (counterfactual.verdict === "ungradeable") ungradeable++;
      else graded++;
      allGraded.push({
        day, ticker, direction: r.direction, gate_failed: r.gate_failed,
        gross_premium: r.gross_premium, blocks: r.blocks, counterfactual,
      });
    }
    console.log(`    graded ${graded}, ungradeable ${ungradeable}, errors ${errors}`);
    await new Promise((r) => setTimeout(r, 150)); // pace vs the shared Polygon/UW rate limiter
  }

  console.log(`\n${line("═")}`);
  console.log(`  BACKFILL SUMMARY (this script's own grading — NOT yet persisted to the live DB)`);
  console.log(line("═"));
  const verdictCounts = new Map();
  for (const g of allGraded) verdictCounts.set(g.counterfactual.verdict, (verdictCounts.get(g.counterfactual.verdict) ?? 0) + 1);
  console.log(`  total rows graded this run: ${allGraded.length}`);
  console.log(`  verdict breakdown: ${JSON.stringify(Object.fromEntries(verdictCounts))}`);

  console.log(`\n  PER-GATE: which filters blocked winners vs losers (would_have_won / would_have_lost)`);
  const byGate = new Map();
  for (const g of allGraded) {
    if (g.counterfactual.verdict === "ungradeable") continue;
    const gate = g.gate_failed;
    const t = byGate.get(gate) ?? { won: 0, lost: 0 };
    if (g.counterfactual.verdict === "would_have_won") t.won++;
    else t.lost++;
    byGate.set(gate, t);
  }
  for (const [gate, t] of [...byGate.entries()].sort((a, b) => b[1].won + b[1].lost - (a[1].won + a[1].lost))) {
    const n = t.won + t.lost;
    const falseBlockRate = n ? (t.won / n) * 100 : 0;
    console.log(`    ${gate.padEnd(28)} n=${String(n).padStart(4)}  would_have_won=${String(t.won).padStart(4)}  would_have_lost=${String(t.lost).padStart(4)}  false_block_rate=${falseBlockRate.toFixed(1)}%`);
  }

  console.log(`\n  No gate/filter/threshold changed by this run — evidence-gathering only. Results`);
  console.log(`  above are NOT written to the live DB (no write path from this sandbox) — they are`);
  console.log(`  this investigation's own evidence, computed with production's own pure grading`);
  console.log(`  function, not a claim that the live system's counterfactual_json has been updated.`);
  console.log(line("═"));

  if (EMIT_JSON) {
    console.log("\n<<<JSON>>>");
    console.log(JSON.stringify({ days, totalGraded: allGraded.length, byGate: Object.fromEntries(byGate), rows: allGraded }, null, 2));
  }
} finally {
  await releaseAuditClerkSession();
}
