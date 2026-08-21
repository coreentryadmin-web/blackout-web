/**
 * Is a bead ROW actually dynamic, or is it a flat bar the whole session?
 *
 * Member report (2026-08-19): the SPY 765 put-wall rail paints as one continuous bar of uniform
 * thickness and brightness from the open to the close — "I can imagine at the start of the day the
 * node was strong, so it painted big and contrast, but it got continued throughout the day which is
 * absolutely false".
 *
 * Two very different things produce that picture and a screenshot cannot tell them apart:
 *   (A) the DATA is flat — every bucket for that strike carries the same notional, so a faithful
 *       renderer correctly draws a flat bar, and the bug is upstream in the recorder; or
 *   (B) the data VARIES and the renderer is flattening it — the swell/alpha mapping is saturating,
 *       or is being fed a session-wide max instead of a per-bucket value.
 *
 * So this reads the raw per-bucket series the client renders from and reports the DISTRIBUTION for
 * the strike in question: min/median/max, the spread ratio, and how many distinct values there are.
 * A row whose values are genuinely constant is (A). A row spanning an order of magnitude that still
 * paints flat is (B). It never guesses which.
 *
 * Read-only. ONE temp Clerk user, deleted in a `finally`. Never prints secrets.
 *
 * Run from the REPO ROOT:
 *   NODE_USE_ENV_PROXY=1 node scripts/audit/vector-bead-dynamism-probe.mjs \
 *     [--ticker=SPY] [--strikes=765,770] [--interval=3] [--json]
 */
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const argv = process.argv.slice(2);
const arg = (n, d) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const TICKER = arg("ticker", "SPY").toUpperCase();
const WANT = arg("strikes", "").split(",").map((s) => Number(s.trim())).filter(Number.isFinite);
const INTERVAL = arg("interval", "3");
const JSON_OUT = argv.includes("--json");

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Pull whatever per-bucket magnitude the payload carries, without assuming one field name —
 *  the recorder has changed shape more than once and a hard-coded key would silently read null
 *  and report "flat" for a row that is perfectly dynamic. */
function magnitudeOf(point) {
  for (const k of ["notional", "gex", "value", "magnitude", "size", "oi", "strength", "weight"]) {
    const v = num(point?.[k]);
    if (v != null) return { key: k, value: v };
  }
  return { key: null, value: null };
}

function describe(values) {
  const v = values.filter((x) => x != null).slice().sort((a, b) => a - b);
  if (!v.length) return null;
  const min = v[0];
  const max = v[v.length - 1];
  const median = v[Math.floor(v.length / 2)];
  const distinct = new Set(v.map((x) => x.toFixed(6))).size;
  return {
    n: v.length,
    min,
    median,
    max,
    distinct,
    // The headline number: how much the row actually moves across the session.
    spreadRatio: min > 0 ? max / min : null,
  };
}

const session = await mintClerkPremiumSession({ appUrl: BASE });
if (session.skip) {
  console.error(`SKIP: ${session.reason}`);
  process.exit(2);
}

try {
  const url = `${BASE}/api/market/vector/wall-history?ticker=${encodeURIComponent(TICKER)}&interval=${encodeURIComponent(INTERVAL)}`;
  const res = await fetch(url, { headers: { Cookie: session.cookieHeader } });
  if (!res.ok) {
    console.error(`wall-history ${res.status}`);
    process.exit(1);
  }
  const body = await res.json();

  // Normalise: the payload is a set of per-strike series, but the exact envelope has moved around.
  const series =
    body?.strikes ?? body?.rows ?? body?.series ?? body?.walls ?? body?.data ?? null;
  if (!series) {
    console.error(`unrecognised payload shape; top-level keys: ${Object.keys(body || {}).join(", ")}`);
    process.exit(1);
  }

  const entries = Array.isArray(series)
    ? series.map((s) => [s.strike ?? s.price ?? s.key, s.points ?? s.buckets ?? s.history ?? s.values ?? []])
    : Object.entries(series).map(([k, v]) => [Number(k), Array.isArray(v) ? v : (v?.points ?? [])]);

  const report = [];
  for (const [strike, points] of entries) {
    if (WANT.length && !WANT.includes(Number(strike))) continue;
    if (!Array.isArray(points) || !points.length) continue;
    const keyed = points.map(magnitudeOf);
    const field = keyed.find((k) => k.key)?.key ?? null;
    const stats = describe(keyed.map((k) => k.value));
    if (!stats) continue;
    report.push({ strike: Number(strike), field, ...stats });
  }
  report.sort((a, b) => (b.spreadRatio ?? 0) - (a.spreadRatio ?? 0));

  if (JSON_OUT) {
    console.log(JSON.stringify({ ticker: TICKER, interval: INTERVAL, rows: report }, null, 2));
  } else {
    console.log(`${TICKER} @ ${INTERVAL}m — per-bucket magnitude distribution per strike`);
    console.log("strike    field       n   distinct        min     median        max   max/min");
    for (const r of report.slice(0, 25)) {
      console.log(
        `${String(r.strike).padStart(7)}  ${String(r.field).padEnd(10)} ${String(r.n).padStart(3)}  ${String(r.distinct).padStart(8)}  ${r.min.toExponential(2).padStart(9)}  ${r.median.toExponential(2).padStart(9)}  ${r.max.toExponential(2).padStart(9)}  ${r.spreadRatio != null ? r.spreadRatio.toFixed(2).padStart(7) : "      -"}`
      );
    }
    console.log("");
    console.log("distinct==1  -> the DATA is flat for that row (recorder side)");
    console.log("distinct>>1 with a flat-looking bar -> the RENDERER is flattening it (paint side)");
  }
} finally {
  await session.cleanup();
  console.error("temp Clerk user deleted");
}
