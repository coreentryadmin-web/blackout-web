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
 * The rendered article as VISIBLE TEXT — the region the numeric checks must run against.
 *
 * Scanning whole-page HTML for long floats or date-shaped strings sweeps up Next.js's inline
 * bundle and flight payload, which are full of both. That produces failures nobody can act on,
 * and a gate that cries wolf is a gate that gets ignored — so the checks are scoped to the prose
 * and the table a reader actually sees.
 *
 * THIS RETURNS TEXT, NOT HTML, and that is the point. The first version stripped `<script>` blocks
 * with `/<script[\s\S]*?<\/script>/gi` and scanned the remaining markup. CodeQL flagged it and was
 * right on the merits, though not for the reason the alert implies: nothing here is rendered or
 * evaluated, so there is no injection path — but `</script >` with a space is VALID HTML that the
 * regex does not match, so a script block could survive intact and pollute the scan. That is a
 * false-positive generator in the audit, which is the failure mode this function exists to prevent.
 *
 * Stripping tags to text removes the whole class rather than patching one regex: script and style
 * CONTENT is dropped, tag attributes (which carry URLs full of digits and dates) are dropped, and
 * what remains is what a reader actually sees — which is what the checks are asking about anyway.
 */
function articleBody(html) {
  const scoped = html.match(/<article\b[\s\S]*?<\/article\s*>/i);
  // No article element means the page is not what we think it is. Return empty rather than falling
  // back to the whole document: the callers treat "nothing parsed" as HARNESS, which is the honest
  // verdict, whereas scanning the raw page would manufacture findings from bundle contents.
  if (!scoped) return "";
  return scoped[0]
    // Tolerant of whitespace before `>` and of attributes on the open tag, but correctness no
    // longer depends on that — anything these miss is caught by the tag strip below.
    .replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ");
}

/** Escape a string for literal use inside a RegExp. */
function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A ticker is a symbol, not a pattern.
 *
 * `--tickers=` is a command-line argument that was interpolated straight into a `new RegExp`.
 * CodeQL called it regex injection; the practical harm is worse than the label suggests for an
 * audit tool — `--tickers='.*'` builds a regex matching anything, so the page-loaded gate passes
 * vacuously and every downstream check reports on a page that was never verified. A gate that
 * silently accepts is more dangerous than one that errors, which is the principle this whole
 * script is built on. So the input is validated to a real symbol shape AND escaped.
 */
const TICKER_SHAPE = /^[A-Z0-9][A-Z0-9.:-]{0,9}$/;

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
    return { present: false, tickers: [] };
  }
  // PAGE-LOADED PROOF FIRST. Without it a 404 body, an error shell or an auth bounce would all
  // report "no ticker links found", which reads as a product defect when it is a harness failure.
  if (!/Dealer Gamma Levels by Ticker/i.test(html)) {
    record("HARNESS", "hub rendered its own H1", "page returned 200 but is not the hub — not judging its contents");
    return { present: false, tickers: [] };
  }
  record("PASS", "hub rendered", "H1 present");

  const tickers = tickersFromHub(html);
  if (tickers.length === 0) record("FAIL", "hub links tickers", "no research links in the hub HTML");
  else record("PASS", "hub links tickers", `${tickers.length} linked`);
  return { present: true, tickers };
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
  if (!new RegExp(`${escapeRegExp(ticker)} Dealer Gamma Levels`, "i").test(html)) {
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

  const hub = await auditHub();
  const hubTickers = hub.tickers;

  // If the HUB itself is missing, the whole route family is absent — not deployed, or removed.
  // Auditing individual tickers then produces a column of "404 — under the publish floor" lines,
  // which is a statement about a THIN RAIL and would be false: the page does not exist for a
  // completely different reason. Stop here and say which one it is.
  if (!hub.present) {
    log("\nSkipping ticker checks — the hub is absent, so a ticker 404 would not mean what it says.");
    const fails = findings.filter((f) => f.verdict === "FAIL");
    if (JSON_OUT) console.log(JSON.stringify({ base: BASE, today, findings, failed: fails.length }, null, 2));
    else log(`\nRED — ${findings.length} checks, ${fails.length} failed (route family not present)`);
    process.exit(1);
  }

  const requested = flag("tickers");
  const candidates = requested
    ? requested.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean)
    : hubTickers.slice(0, 6);

  // Reject anything that is not symbol-shaped, LOUDLY. Silently dropping it would run the audit
  // over a smaller set than the operator asked for and still print GREEN — the same "the check did
  // not run" mistake the HARNESS verdicts exist to prevent, just moved to the input.
  const tickers = candidates.filter((t) => TICKER_SHAPE.test(t));
  const rejected = candidates.filter((t) => !TICKER_SHAPE.test(t));
  if (rejected.length > 0) {
    console.error(`Refusing ${rejected.length} malformed ticker argument(s): ${rejected.join(", ")}`);
    process.exit(2);
  }

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
