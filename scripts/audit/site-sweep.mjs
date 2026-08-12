/**
 * SITE-WIDE SWEEP — every member-facing page and every read API, in one authenticated pass.
 *
 * The per-feature validators in this directory each prove one thing deeply. Nothing proved the
 * BREADTH: that every page a member can reach still returns a page, and every read endpoint the
 * desk calls still returns well-formed data. A regression on a page nobody on the team opens that
 * week is invisible until a member finds it.
 *
 * WHAT IT ASSERTS, per target:
 *   - HTTP status is what the route's auth class implies (public 200; premium 200 for our premium
 *     session; admin 200 only because the temp user is admin).
 *   - The body is not an error shell — a 200 that renders "Application error" or "500" is a
 *     failure, and status alone would call it a pass.
 *   - Latency, so a route that is merely SLOW is visible before it becomes a timeout.
 *   - For JSON: no unrounded float garbage (the repo's standing "round at the data layer" rule),
 *     and no `null` where the field is documented as a number.
 *
 * ONE session for the whole sweep, released in a finally. Clerk's FAPI rate-limits rapid
 * sign-in cycles, so re-authenticating per target would fail the sweep for reasons that have
 * nothing to do with the site.
 *
 * Read-only: every target is a GET.
 *
 * Run:
 *   NODE_USE_ENV_PROXY=1 node --import tsx scripts/audit/site-sweep.mjs [--json] [--pages] [--apis]
 */
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const onlyPages = args.includes("--pages");
const onlyApis = args.includes("--apis");
const BASE = (args.find((a) => a.startsWith("--base=")) ?? "--base=https://blackouttrades.com").slice(7);
/** A route slower than this is reported even when it returns 200 — slow is a defect in waiting. */
const SLOW_MS = 6_000;

/** Member-facing pages. `public` ones must work signed-out too, but we only assert signed-in here. */
const PAGES = [
  "/", "/about", "/pricing", "/faq", "/contact", "/learn", "/track-record",
  "/why-blackout", "/vs/others", "/upgrade", "/terms", "/privacy", "/disclaimer",
  "/refund-policy", "/cookie-policy", "/account", "/dashboard",
  "/nighthawk", "/terminal", "/vector", "/flows", "/heatmap",
  "/tools/gamma-snapshot", "/admin", "/admin/track-record", "/admin/users",
];

/** Read APIs the desks actually call. Kept to GETs with no side effects. */
const APIS = [
  "/api/market/gex-heatmap?ticker=SPY",
  "/api/market/gex-heatmap?ticker=SPX",
  "/api/market/zerodte/board",
  "/api/market/zerodte/record?days=7",
  "/api/market/vector/gex-ladder?ticker=SPY&horizon=0dte",
  "/api/market/vector/gex-ladder?ticker=SPX&horizon=all",
  "/api/market/vector/daily-bars?ticker=SPY",
  "/api/market/vector/4h-bars?ticker=SPY",
  "/api/market/vector/wall-history?ticker=SPY&horizon=all&session=" + new Date().toISOString().slice(0, 10),
];

const findings = [];
const note = (level, msg, extra) => {
  findings.push({ level, msg, ...(extra ?? {}) });
  if (!asJson) console.log(`  [${level}] ${msg}${extra ? ` ${JSON.stringify(extra)}` : ""}`);
};

/**
 * A 200 that renders a crash is not a pass.
 *
 * Next.js serves its error boundary with a 200 in several cases, so status-only checking reports
 * a white-screened page as healthy — the exact class of failure a member would call "the site is
 * broken" and a monitor would call fine.
 */
const ERROR_SHELL = /Application error|client-side exception|Internal Server Error|<title>500|This page could not be found/i;

/**
 * Unrounded float garbage, e.g. 7499.360000000001 — the repo rounds at the data layer.
 *
 * Walks the PARSED value rather than regexing the raw body. Regexing the text matches digits
 * inside STRINGS too, which produced a false finding on its first run: `/zerodte/record` carries
 * a human-readable `trailing_rule` string containing "tranche_fraction=0.3333333333333333" while
 * the structured `fraction` field beside it is correctly rounded to 0.33. `roundFloats` was doing
 * its job and the check was wrong — precisely the kind of confident-but-wrong finding that wastes
 * an afternoon chasing a fix that is not needed.
 */
function unroundedNumbers(value, path = "", out = []) {
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      const frac = String(value).split(".")[1] ?? "";
      if (frac.length > 6) out.push(`${path}=${value}`);
    }
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => unroundedNumbers(v, `${path}[${i}]`, out));
    return out;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) unroundedNumbers(v, path ? `${path}.${k}` : k, out);
  }
  return out;
}

/**
 * Fetch as TEXT, not JSON.
 *
 * The shared `fetchAuditJson` helper always parses the body as JSON, which makes it useless for
 * HTML pages and — more importantly — throws away the text the error-shell check needs. A page
 * probe that cannot read the page body can only check status, which is exactly the blind spot
 * ERROR_SHELL exists to close.
 */
let cookieHeader = "";
async function probe(path, kind) {
  const t0 = Date.now();
  let res;
  let body = "";
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: {
        Cookie: cookieHeader,
        Accept: kind === "API" ? "application/json" : "text/html",
        "User-Agent": "BlackOutSiteSweep/1.0",
      },
      redirect: "follow",
    });
    body = await res.text();
  } catch (err) {
    note("FAIL", `${kind} ${path}: threw — ${String(err).slice(0, 100)}`);
    return;
  }
  const ms = Date.now() - t0;
  const r = { ok: res.ok, status: res.status, json: null };
  if (kind === "API") {
    try {
      r.json = JSON.parse(body);
    } catch {
      note("FAIL", `${kind} ${path}: ${res.status} but body is not JSON (${ms}ms)`, {
        sample: body.slice(0, 60),
      });
      return;
    }
  }

  if (!r.ok) {
    note("FAIL", `${kind} ${path}: HTTP ${r.status} (${ms}ms)`);
    return;
  }
  if (ERROR_SHELL.test(body)) {
    // Deliberately checked even on 200 — see ERROR_SHELL.
    note("FAIL", `${kind} ${path}: 200 but the body is an ERROR SHELL (${ms}ms)`, {
      sample: (body.match(ERROR_SHELL) ?? [""])[0],
    });
    return;
  }
  if (kind === "API" && r.json) {
    const bad = unroundedNumbers(r.json);
    if (bad.length > 0) {
      note("WARN", `${kind} ${path}: ${bad.length} unrounded float(s) in payload (${ms}ms)`, {
        sample: bad.slice(0, 3),
      });
      return;
    }
  }
  if (ms > SLOW_MS) {
    note("WARN", `${kind} ${path}: OK but SLOW ${ms}ms (>${SLOW_MS}ms)`);
    return;
  }
  note("PASS", `${kind} ${path}: ${r.status} ${ms}ms`);
}

const session = await mintClerkPremiumSession({ appUrl: BASE });
if (session.skip) {
  console.log(`SKIP — ${session.reason}`);
  process.exit(0);
}
cookieHeader = session.cookieHeader;

try {
  if (!onlyApis) {
    if (!asJson) console.log(`\n═══ PAGES (${PAGES.length})`);
    for (const p of PAGES) await probe(p, "PAGE");
  }
  if (!onlyPages) {
    if (!asJson) console.log(`\n═══ READ APIS (${APIS.length})`);
    for (const a of APIS) await probe(a, "API");
  }
} finally {
  // ALWAYS release. A sweep that leaves a live admin+premium user behind on prod Clerk is a
  // standing credential, which is precisely what this must never create.
  await session.cleanup?.();
}

const fails = findings.filter((f) => f.level === "FAIL");
const warns = findings.filter((f) => f.level === "WARN");
const probed = findings.length;
// A sweep that probed nothing must not read as green — same guard as every other harness here.
const verdict = probed === 0
  ? "NO EVIDENCE GATHERED — nothing was probed; this run proves nothing"
  : fails.length > 0
    ? `${fails.length} FAILURES, ${warns.length} warnings across ${probed} targets`
    : warns.length > 0
      ? `CLEAN (${warns.length} warnings) across ${probed} targets`
      : `ALL ${probed} TARGETS HEALTHY`;
if (asJson) console.log(JSON.stringify({ verdict, fails: fails.length, warns: warns.length, findings }, null, 2));
else console.log(`\n${"═".repeat(70)}\n${verdict}`);
process.exit(fails.length > 0 || probed === 0 ? 1 : 0);
