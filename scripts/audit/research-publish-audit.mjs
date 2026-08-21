#!/usr/bin/env node
/**
 * RESEARCH PUBLISH AUDIT — live verification of the public research pages, and specifically of the
 * delay boundary that keeps them publishable.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE UNIT TESTS. `publishable-session.test.ts` proves the cutoff
 * function is correct against injected dates. It cannot prove that the DEPLOYED pages honour it:
 * the sessions on a real page come from a real database through a real cache, and the failure this
 * guards against — a live session appearing on a public URL — is a property of the rendered HTML,
 * not of a pure function. A green unit suite and a leaking page are entirely compatible states.
 *
 * So this reads what the server actually served and asserts the boundary on the page itself.
 *
 * READ-ONLY and UNAUTHENTICATED by design. These pages are public, so the audit needs no Clerk
 * user, no temp identity and no cleanup — which also means it is testing the exact surface an
 * anonymous crawler sees, rather than an authenticated approximation of it.
 *
 * Usage:  node scripts/audit/research-publish-audit.mjs [--base=https://blackouttrades.com]
 *                                                       [--tickers=SPX,NVDA] [--json] [--quiet]
 * Exits NON-ZERO on any FAIL — safe to wire into a post-deploy gate.
 */

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const has = (name) => args.includes(`--${name}`);

const BASE = (flag("base", "https://blackouttrades.com")).replace(/\/$/, "");
const JSON_OUT = has("json");
const QUIET = has("quiet");
const HUB = "/research/gamma-levels";

const log = (...a) => {
  if (!QUIET && !JSON_OUT) console.log(...a);
};

/** Today's ET calendar date — the line no published session may reach. */
function todayEt() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function fetchPage(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "user-agent": "blackout-research-audit/1.0" },
    redirect: "follow",
  });
  return { status: res.status, html: await res.text() };
}

const findings = [];
const record = (verdict, check, detail) => {
  findings.push({ verdict, check, detail });
  if (verdict !== "PASS") log(`  ${verdict}  ${check} — ${detail}`);
  else log(`  PASS  ${check}`);
};

/**
 * Every `YYYY-MM-DD` on the page, plus every long-form date the copy renders.
 *
 * BOTH forms matter. The table prints "August 19, 2026" and the JSON-LD prints "2026-08-19"; an
 * audit that only understood one of them would pass a page leaking through the other.
 */
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
function extractSessionDates(html) {
  const out = new Set();
  for (const m of html.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) out.add(m[0]);
  for (const m of html.matchAll(/\b([A-Z][a-z]+) (\d{1,2}), (\d{4})\b/g)) {
    const mi = MONTHS.indexOf(m[1]);
    if (mi < 0) continue;
    out.add(`${m[3]}-${String(mi + 1).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}`);
  }
  return [...out];
}

/**
 * The rendered ARTICLE, with scripts removed — the region the numeric checks must run against.
 *
 * Scanning whole-page HTML for long floats or date-shaped strings sweeps up Next.js's inline
 * bundle and flight payload, which are full of both. That produces failures nobody can act on,
 * and a gate that cries wolf is a gate that gets ignored — so the checks are scoped to the prose
 * and the table a reader actually sees. Falls back to script-stripped HTML if the article element
 * is not found, rather than silently scanning nothing.
 */
function articleBody(html) {
  const noScripts = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  const m = noScripts.match(/<article[\s\S]*?<\/article>/i);
  return m ? m[0] : noScripts;
}

/** Tickers linked from the hub — the audit follows the site's own list rather than a hardcoded one. */
function tickersFromHub(html) {
  const out = new Set();
  for (const m of html.matchAll(/\/research\/gamma-levels\/([a-z0-9.:-]+)/g)) out.add(m[1].toUpperCase());
  return [...out];
}

async function auditHub() {
  log(`\nHUB ${HUB}`);
  const { status, html } = await fetchPage(HUB);
  if (status !== 200) {
    record("FAIL", "hub responds 200", `got ${status}`);
    return [];
  }
  // PAGE-LOADED PROOF FIRST. Without it a 404 body, an error shell or an auth bounce would all
  // report "no ticker links found", which reads as a product defect when it is a harness failure.
  if (!/Dealer Gamma Levels by Ticker/i.test(html)) {
    record("HARNESS", "hub rendered its own H1", "page returned 200 but is not the hub — not judging its contents");
    return [];
  }
  record("PASS", "hub rendered", "H1 present");

  const tickers = tickersFromHub(html);
  if (tickers.length === 0) record("FAIL", "hub links tickers", "no research links in the hub HTML");
  else record("PASS", "hub links tickers", `${tickers.length} linked`);
  return tickers;
}

async function auditTicker(ticker, today) {
  const path = `/research/gamma-levels/${ticker.toLowerCase()}`;
  log(`\nTICKER ${ticker}`);
  const { status, html } = await fetchPage(path);

  if (status === 404) {
    // Below the coverage floor is the DESIGNED behaviour, not a failure — but it is reported, so
    // "half the sitemap 404s" can never hide behind a green run.
    record("INFO", `${ticker} page`, "404 — under the publish floor (expected for a thin rail)");
    return;
  }
  if (status !== 200) {
    record("FAIL", `${ticker} responds`, `status ${status}`);
    return;
  }
  if (!new RegExp(`${ticker} Dealer Gamma Levels`, "i").test(html)) {
    record("HARNESS", `${ticker} rendered its own H1`, "200 but not the research page — contents not judged");
    return;
  }
  record("PASS", `${ticker} rendered`, "H1 present");

  const body = articleBody(html);

  // ── THE BOUNDARY CHECK. This is the reason the script exists. ──────────────────────────────
  const dates = extractSessionDates(body).filter((d) => /^20\d\d-/.test(d));
  const leaked = dates.filter((d) => d >= today);
  if (leaked.length > 0) {
    record("FAIL", `${ticker} publishes only closed sessions`, `session dates at or after today (${today}): ${leaked.join(", ")}`);
  } else if (dates.length === 0) {
    record("HARNESS", `${ticker} session dates found`, "no dates parsed — the check did not actually run");
  } else {
    const newest = dates.sort().at(-1);
    record("PASS", `${ticker} publishes only closed sessions`, `newest ${newest}, today ${today}`);
  }

  // A rate must never appear without the sessions it was computed over.
  const rateClaims = [...body.matchAll(/(\d{1,3})%/g)].length;
  const denominators = /\b(\d+) sessions?\b/.test(body);
  if (rateClaims > 0 && !denominators) {
    record("FAIL", `${ticker} rates carry a denominator`, `${rateClaims} percentage(s) with no session count on the page`);
  } else {
    record("PASS", `${ticker} rates carry a denominator`, rateClaims === 0 ? "no rate claimed" : "session count present");
  }

  // Long floats are the repo's standing systemic defect; a public page is the worst place for one.
  const ugly = [...body.matchAll(/\b\d+\.\d{6,}\b/g)].map((m) => m[0]).slice(0, 5);
  if (ugly.length > 0) record("FAIL", `${ticker} numbers are rounded for reading`, `unrounded: ${ugly.join(", ")}`);
  else record("PASS", `${ticker} numbers are rounded for reading`, "no long floats");

  // The page must say what it is. A research page that reads as live guidance is the failure the
  // whole publish posture exists to avoid.
  if (!/not live levels/i.test(body)) {
    record("FAIL", `${ticker} states it is historical`, "the closed-session disclaimer is missing");
  } else {
    record("PASS", `${ticker} states it is historical`, "disclaimer present");
  }
}

async function main() {
  const today = todayEt();
  log(`Research publish audit — ${BASE} (ET today ${today})`);

  const hubTickers = await auditHub();
  const requested = flag("tickers");
  const tickers = requested
    ? requested.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean)
    : hubTickers.slice(0, 6);

  for (const t of tickers) {
    // Sequential: this hits ISR renders that may each warm a cache, and a burst would measure
    // contention rather than correctness.
    // eslint-disable-next-line no-await-in-loop
    await auditTicker(t, today);
  }

  const fails = findings.filter((f) => f.verdict === "FAIL");
  const harness = findings.filter((f) => f.verdict === "HARNESS");

  if (JSON_OUT) {
    console.log(JSON.stringify({ base: BASE, today, findings, failed: fails.length, harness: harness.length }, null, 2));
  } else {
    log(`\n${fails.length === 0 ? "GREEN" : "RED"} — ${findings.length} checks, ${fails.length} failed, ${harness.length} harness`);
    if (harness.length > 0) log("HARNESS findings are NOT product verdicts — the check could not run.");
  }
  process.exit(fails.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("research-publish-audit crashed:", err?.message ?? err);
  process.exit(1);
});
