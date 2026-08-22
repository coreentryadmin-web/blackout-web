#!/usr/bin/env node
/**
 * Meridian DATA-INTEGRITY sweep against LIVE production.
 *
 * Complements `meridian-earnings-ui-audit` (did the right selectors paint?) and
 * `meridian-interaction-audit` (do the pixels behave?). Neither can see a number that is
 * internally contradictory — a headline expected move quoted from an expiry that died before the
 * print, a ratio comparing two different quarters, a coerced wall order presented as measured.
 * Those all shipped, and every one was found by hand.
 *
 * The invariants live in lib/meridian-invariants.mjs with their own unit tests; this file is only
 * the fan-out and the report. Read-only. One temp Clerk user, released in a finally.
 *
 * Run from the REPO ROOT with NODE_USE_ENV_PROXY=1:
 *   node scripts/audit/meridian-data-integrity.mjs [--base=…] [--limit=12] [--impact=high]
 */
import { fetchAuditJson, releaseAuditClerkSession } from "./lib/audit-auth-fetch.mjs";
import { eventViolations, summarize } from "./lib/meridian-invariants.mjs";

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v = "true"] = a.replace(/^--/, "").split("=");
    return [k, v];
  })
);
const BASE = args.get("base") ?? "https://blackouttrades.com";
const LIMIT = Math.max(1, Math.min(40, Number(args.get("limit") ?? 12) || 12));
const IMPACT = args.get("impact") ?? "high";

/**
 * The whole run lives in a function so an early `return` is legal, and the exit code is applied
 * AFTER cleanup — `process.exit` inside a try skips the finally, which is how a temp Clerk user
 * gets leaked. `harness-cleanup-contract.test.mjs` enforces that the header's claim is real.
 */
async function run() {
  const t = await fetchAuditJson(BASE, "/api/market/meridian/timeline?days=21");
  if (t.status !== 200) {
    // A timeline that did not load is a HARNESS condition, not a product verdict — the same rule
    // meridian-interaction-audit follows. We did not look, so we found nothing.
    console.log(`HARNESS: timeline ${t.status} — nothing was checked`);
    return 0;
  }
  const items = ((t.json ?? {}).items ?? []).filter(
    (i) => i.kind === "earnings" && (IMPACT === "any" || i.impact === IMPACT)
  );
  const cohort = items.slice(0, LIMIT);
  console.log(`MERIDIAN DATA INTEGRITY · ${cohort.length} of ${items.length} earnings events (impact=${IMPACT})\n`);

  const all = [];
  let checked = 0;
  for (const it of cohort) {
    const e = await fetchAuditJson(BASE, `/api/market/meridian/event?id=${encodeURIComponent(it.id)}`);
    if (e.status !== 200 || !e.json) {
      console.log(`  ${String(it.ticker).padEnd(6)} HARNESS event ${e.status} — not checked`);
      continue;
    }
    checked += 1;
    // The timeline row carries the print date; the event payload does not always.
    const v = eventViolations({ ...e.json, date: e.json.date ?? it.date }, it.ticker);
    all.push(...v);
    console.log(`  ${String(it.ticker).padEnd(6)} ${v.length === 0 ? "ok" : `${v.length} VIOLATION(S)`}`);
    for (const x of v) console.log(`         [${x.rule}] ${x.path} — ${x.sample}`);
  }

  console.log(`\nchecked ${checked}/${cohort.length} events · ${all.length} violations`);
  for (const [rule, n] of summarize(all)) console.log(`  ${String(n).padStart(3)}  ${rule}`);
  if (checked === 0) {
    console.log("NOTHING WAS CHECKED — this run certifies nothing.");
    return 0;
  }
  console.log(all.length ? "FAIL — the payload contradicts itself somewhere above." : "PASS — no invariant violated.");
  return all.length ? 1 : 0;
}

let exitCode = 0;
try {
  exitCode = await run();
} finally {
  // The temp Clerk user is a live admin+premium account on production Clerk with no TTL.
  await releaseAuditClerkSession().catch(() => {});
}
process.exit(exitCode);
