/**
 * 0DTE FLOW-HISTORY COLLECTOR — persists real UW flow-alert rows per real session day so every
 * point-in-time replay tool in this toolkit can grow its sample ACROSS RUNS instead of re-paying
 * the same page budget every time and topping out at whatever a single run's page cap reaches.
 * ============================================================================================
 * WHY THIS EXISTS (2026-10-20, member directive: "if three days isn't enough, build the
 * collection and replay process needed to grow the sample... keep progressing on work that
 * doesn't depend on waiting for more sessions")
 * ------------------------------------------------------------------------------------------
 * `zerodte-missed-trades-tracker.mjs`'s own `fetchMultiDayFlow` (and its sibling tools') pages
 * UW's `/api/option-trades/flow-alerts` with a FIXED page budget (24-32 pages x 200 rows). At
 * real alert volume (~2,000+ rows/session-day at min_premium=$250k), that budget runs out after
 * only ~3 real session days — which read as "that's all the history there is." It is NOT: a
 * direct probe of the UW API with `older_than` cursors back to 2025-12-31 returned real rows at
 * every cutoff tested — the data exists; the page BUDGET was the limit, not the provider.
 *
 * This script separates COLLECTION (expensive, paginated, rate-limiter-paced, run periodically)
 * from REPLAY (cheap — every sibling tool should read the growing local store instead of
 * re-fetching). Each COMPLETE real session day's rows are persisted once to
 * `docs/audit/history/zerodte-flow/<YYYY-MM-DD>.json` — idempotent (skips a day already on disk
 * unless `--force`), so re-running this script, or running it again next session, extends the
 * sample further back without re-paying for days already collected. A `--max-pages` budget keeps
 * any ONE invocation from saturating the shared UW rate limiter (same caution this toolkit's
 * other scripts already carry — see CLAUDE.md's "pace UW backtests during RTH" note); run it
 * again (same command) to keep walking further back once that budget is spent.
 *
 * The CURRENT (today's, still-open) session day is never written — a partial day cached as if it
 * were final would corrupt every tool that reads from this store believing a day's flow is
 * complete.
 *
 * USAGE
 *   POLYGON_API_BASE=https://api.massive.com \
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *   node --import tsx scripts/audit/zerodte-history-collect.mjs [options]
 * OPTIONS
 *   --days=N          how many real session days back to walk looking for NEW ones (default 30 —
 *                      a target, not a guarantee; stops early if --max-pages is spent first)
 *   --min-premium=N   min alert premium (default 250000 — matches every sibling replay tool, so
 *                      the stored rows are reusable by all of them)
 *   --max-pages=N     hard cap on UW page fetches this invocation (default 120 — ~24,000 rows,
 *                      enough for several new real session days without over-pacing the shared
 *                      rate limiter in one run)
 *   --force           re-fetch and overwrite days already on disk (normally skipped)
 *   --json
 */

if (!process.env.POLYGON_API_BASE || !/^https?:\/\//.test(process.env.POLYGON_API_BASE)) {
  process.env.POLYGON_API_BASE = "https://api.massive.com";
}

const SRC = new URL("../../src/", import.meta.url).pathname;
const HISTORY_DIR = new URL("../../docs/audit/history/zerodte-flow/", import.meta.url).pathname;

const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? "true"] : [a, "true"];
  })
);
const TARGET_DAYS = Math.max(1, Number(argv.days ?? 30));
const MIN_PREMIUM = Math.max(0, Number(argv["min-premium"] ?? 250_000));
const MAX_PAGES = Math.max(1, Number(argv["max-pages"] ?? 120));
const FORCE = Boolean(argv.force);
const RESTART = Boolean(argv.restart);
const EMIT_JSON = Boolean(argv.json);

const { fetchMarketFlowAlertRows } = await import(`${SRC}lib/providers/unusual-whales.ts`);
const { extractChainFieldsFromRaw } = await import(`${SRC}lib/flow-raw-fields.ts`);
const { dteFromExpiry } = await import(`${SRC}lib/flow-dte.ts`);

const fs = await import("node:fs");
const path = await import("node:path");

const line = (c = "─", w = 112) => c.repeat(w);
function etYmd(ms) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

fs.mkdirSync(HISTORY_DIR, { recursive: true });
const existingDays = new Set(
  fs.readdirSync(HISTORY_DIR).filter((f) => f.endsWith(".json") && !f.startsWith(".")).map((f) => f.replace(/\.json$/, ""))
);

const nowMs = Date.now();
const todayYmd = etYmd(nowMs);
const cutoffMs = nowMs - TARGET_DAYS * 86_400_000;

// CORRECTNESS NOTE (caught live, 2026-10-20): every invocation used to start `olderThan` fresh
// from "now" — so a SECOND run just re-walked the same most-recent ~MAX_PAGES pages, confirmed
// every day it found was already on disk, and wrote ZERO new days despite burning its whole page
// budget. "Re-run this same command to keep walking further back" was a false promise with no
// persisted state to make it true. Fixed with a resume cursor: the frontier (the oldest
// `older_than` this run actually reached) is saved to `.collector-cursor.json` and the NEXT
// run resumes from there instead of "now" — `--restart` opts back into the old from-now behavior
// (e.g. to re-check for any newly-collected gap near the present).
const CURSOR_FILE = path.join(HISTORY_DIR, ".collector-cursor.json");
let resumeFrom = null;
if (!RESTART) {
  try {
    const saved = JSON.parse(fs.readFileSync(CURSOR_FILE, "utf8"));
    if (saved?.olderThan && Date.parse(saved.olderThan) < nowMs) resumeFrom = saved.olderThan;
  } catch {
    /* no cursor yet — start from now, same as --restart */
  }
}

console.log(line("═"));
console.log(`  0DTE FLOW-HISTORY COLLECTOR — grows the persisted replay sample across runs`);
console.log(`  target ${TARGET_DAYS}d back · min premium $${(MIN_PREMIUM / 1000).toFixed(0)}k · page budget ${MAX_PAGES} · force=${FORCE}`);
console.log(`  already on disk: ${existingDays.size} day(s)${existingDays.size ? ` (${[...existingDays].sort().join(", ")})` : ""}`);
console.log(`  resuming from saved cursor: ${resumeFrom ?? "(none — starting from now)"}`);
console.log(line("═"));

const byDay = new Map(); // day -> rows (only for days not yet fully written)
let olderThan = resumeFrom ?? new Date(nowMs).toISOString();
let pages = 0;
let totalRows = 0;
const seen = new Set();
let daysWrittenThisRun = 0;

function rowToCompact(mr) {
  const f = mr.flow;
  const raw = mr.raw ?? {};
  if (!f?.ticker || !f.option_type || f.option_type === "UNKNOWN") return null;
  const chain = extractChainFieldsFromRaw(raw, { strike: f.strike, option_type: f.option_type });
  return {
    ticker: f.ticker,
    premium: f.premium,
    option_type: f.option_type,
    strike: f.strike,
    expiry: f.expiry,
    dte: f.expiry ? dteFromExpiry(f.expiry) ?? undefined : undefined,
    alert_rule: chain.alert_rule ?? f.alert_rule ?? undefined,
    ask_pct: chain.ask_pct,
    underlying_price: chain.underlying_price,
    fill_price: chain.fill_price,
    open_interest: chain.open_interest,
    alerted_at: f.alerted_at,
  };
}

function flushCompleteDaysExcept(activeDay) {
  for (const [day, rows] of [...byDay.entries()]) {
    if (day === activeDay || day === todayYmd) continue; // never persist the still-open day
    const filePath = path.join(HISTORY_DIR, `${day}.json`);
    if (existingDays.has(day) && !FORCE) {
      byDay.delete(day);
      continue;
    }
    fs.writeFileSync(filePath, JSON.stringify(rows.sort((a, b) => Date.parse(a.alerted_at) - Date.parse(b.alerted_at)), null, 0));
    existingDays.add(day);
    daysWrittenThisRun++;
    console.log(`    wrote ${day}.json — ${rows.length} rows`);
    byDay.delete(day);
  }
}

while (pages < MAX_PAGES) {
  let batch;
  try {
    batch = await fetchMarketFlowAlertRows({ limit: 200, min_premium: MIN_PREMIUM, older_than: olderThan });
  } catch (e) {
    console.warn(`  [flow] page ${pages + 1} failed: ${e instanceof Error ? e.message : e}`);
    break;
  }
  pages++;
  if (!batch?.length) {
    console.log(`  [flow] page ${pages}: 0 rows — exhausted upstream history`);
    break;
  }
  let oldestIso = null;
  let oldestMs = Infinity;
  for (const mr of batch) {
    const iso = mr.flow?.alerted_at;
    const ms = Date.parse(iso ?? "");
    if (Number.isFinite(ms) && ms < oldestMs) { oldestMs = ms; oldestIso = iso; }
    const key = `${mr.flow?.ticker}|${mr.flow?.expiry}|${mr.flow?.strike}|${mr.flow?.option_type}|${mr.flow?.alerted_at}|${mr.flow?.premium}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!Number.isFinite(ms)) continue;
    const day = etYmd(ms);
    if (existingDays.has(day) && !FORCE) continue; // already collected — don't bother compacting
    const compact = rowToCompact(mr);
    if (!compact) continue;
    (byDay.get(day) ?? byDay.set(day, []).get(day)).push(compact);
    totalRows++;
  }
  // Flush any day we've now fully walked past. The OLDEST day touched in this batch (derived
  // from the batch's real minimum timestamp, never assumed from row order — UW's own ordering
  // guarantee isn't documented, same caution the sibling tools' own min-scan already takes) may
  // still gain more rows from the NEXT (older) page, so it alone stays unflushed; every day newer
  // than it has no more forthcoming rows, since olderThan only moves backward from here.
  const activeDay = Number.isFinite(oldestMs) ? etYmd(oldestMs) : null;
  flushCompleteDaysExcept(activeDay);
  if (!oldestIso || oldestMs === Infinity) break;
  if (oldestMs < cutoffMs) break;
  if (oldestIso === olderThan) break; // no forward progress — stop rather than loop forever
  olderThan = oldestIso;
  await new Promise((r) => setTimeout(r, 200)); // pace vs the shared UW rate limiter
}
// Final flush — whatever's left in byDay is complete (we've walked past it or hit the budget).
flushCompleteDaysExcept(null);

// Persist the frontier reached so the NEXT invocation resumes here instead of restarting from
// "now" (the bug this cursor fixes — see the correctness note above). Saved unconditionally,
// including the "exhausted upstream history" exit, so a future run fails fast there too instead
// of re-paying the same walk.
fs.writeFileSync(CURSOR_FILE, JSON.stringify({ olderThan, updatedAt: new Date().toISOString() }));

console.log(`\n${line()}`);
console.log(`  fetched ${pages} page(s), ${totalRows} new rows, wrote ${daysWrittenThisRun} new day file(s)`);
console.log(`  total days now on disk: ${existingDays.size}`);
if (pages >= MAX_PAGES) {
  console.log(`  hit the --max-pages budget (${MAX_PAGES}) before reaching --days=${TARGET_DAYS} — re-run this`);
  console.log(`  same command again to keep walking further back (already-collected days are skipped).`);
}
console.log(line());

if (EMIT_JSON) {
  console.log("\n<<<JSON>>>");
  console.log(JSON.stringify({ pages, totalRows, daysWrittenThisRun, totalDaysOnDisk: existingDays.size, days: [...existingDays].sort() }, null, 2));
}
