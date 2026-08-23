/**
 * HELIX tape field-provenance inventory — the instrument behind docs/audit/HELIX-MAP.md.
 *
 * WHAT IT ANSWERS, and why none of it was answerable before. HELIX had NO harness of its own
 * (HELIX-MAP.md §10). Every claim about the tape rested on reading code, and the questions that
 * actually decide whether a number is trustworthy are questions about the live POPULATION:
 *
 *   1. WHO WROTE EACH ROW. The tape has two producers with different payload schemas, and the
 *      split is exact rather than statistical (live 2026-08-22: cross-tab event_at x alert_rule =
 *      1500 both / 0 / 0 / 3500 neither). Group A is the UW flow_alerts feed — 273 tickers, with
 *      alert_rule, open interest, ask side, underlying price, OTM%. Group B is SPX and SPY ONLY,
 *      carrying implied_volatility and none of the rest. Nothing in the product says so, and
 *      several HELIX numbers cannot be read correctly without knowing it.
 *
 *   2. WHAT THAT COSTS — and it is now much less than it was. Both persisted HELIX signals need a
 *      real print time; on 2026-08-22 Group B had none, so SPX and SPY — 92.1% of all tape premium
 *      — could fire NEITHER signal. #2723 found the cause was a PARSE, not the feed: `toIso` could
 *      not read the epoch those rows carry. Re-measured against the deployed fix on 2026-08-23,
 *      `event_at` presence is 100% (was 30%) and eligibility is 5000/5000 (was 1500/5000).
 *      Eligibility is therefore read from the PRODUCT's rule, never from the writer group — the
 *      two agreed only by coincidence, and the coincidence is over.
 *
 *   3. WHETHER THE ROUTE BREAKDOWN PANEL MEANS ANYTHING. Measured: 98.8% OTHER, 1.2% FLOOR,
 *      0.1% SWEEP. BLOCK / SPLIT / CROSS / MULTI never fire at all. 70% of rows carry no
 *      alert_rule (Group B), and the dominant real rule family (`RepeatedHits*`, 28.7% of rows)
 *      matches none of the six keys `executionRouteKey` scans for — even though `ruleLabel`, in
 *      the SAME file, already maps "repeated" to a REPEAT badge on the tape.
 *
 *   4. WHAT UNIT `implied_volatility` IS IN. Single fractional mode (median 0.17), long right
 *      tail (max 106.2) — not the bimodal shape a mixed-unit feed makes. That measurement is what
 *      justified #2669 replacing `fmtIv`'s per-row `iv < 3` branch with an unconditional `iv * 100`.
 *      This now CHECKS that assumption rather than accusing the retired branch: it reports 0
 *      misrendered on a uniformly fractional feed, and flags the day the distribution goes bimodal
 *      — which is the day the unconditional multiply becomes wrong.
 *
 * READ-ONLY against production. One temp Clerk user, deleted in a `finally`. Never prints a secret.
 *
 * Imports the REAL `executionRouteKey` rather than reimplementing it — a second copy of the
 * panel's vocabulary would drift from the panel and this harness would then measure a bucketing
 * nobody ships.
 *
 * Usage (Node 20, from the repo root):
 *   node --import tsx scripts/audit/helix-tape-inventory.mjs [--limit=5000] [--since-hours=168]
 *                                                            [--ticker=SPX] [--base=URL] [--json]
 */
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";
import {
  writerGroup,
  routeKeyMatches,
  ivUnitVerdict,
  impliedContracts,
  signalEligibility,
} from "./lib/helix-tape-inventory-eval.mjs";

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const flag = (name) => argv.includes(`--${name}`);

const BASE = arg("base", process.env.VALIDATE_BASE ?? "https://blackouttrades.com");
const LIMIT = Number(arg("limit", 5000));
const SINCE_HOURS = Number(arg("since-hours", 168));
const TICKER = arg("ticker", "");
const AS_JSON = flag("json");

const pct = (n, d) => (d > 0 ? Math.round((1000 * n) / d) / 10 : null);
const usd = (n) => "$" + Math.round(n).toLocaleString("en-US");

const session = await mintClerkPremiumSession({ appUrl: BASE });
if (session.skip) {
  // SKIP, not FAIL — matches every fail-open probe in this toolkit. A missing credential is not
  // a product verdict.
  console.log(`SKIP: ${session.reason}`);
  process.exit(0);
}

try {
  const { executionRouteKey } = await import(
    new URL("../../src/features/helix/lib/helix-flow-format.ts", import.meta.url).pathname
  );
  // The REAL horizon bucketer. `ExpiryConcentration.tsx`'s `bucketLabel` is byte-identical and
  // documented as such, but it lives in a component file; this is the importable twin. Imported
  // rather than restated for the reason this whole file exists: the previous line here ASSERTED
  // that the panel files negative-DTE prints under "This week", which stopped being true when
  // §9.5 changed the test to `dte <= 0`. A harness that states what a panel does, instead of
  // asking it, accuses fixed code.
  const { expiryHorizonLabel } = await import(
    new URL("../../src/lib/largo/helix-tape-analytics.ts", import.meta.url).pathname
  );

  const qs = new URLSearchParams({ limit: String(LIMIT), since_hours: String(SINCE_HOURS) });
  if (TICKER) qs.set("ticker", TICKER.toUpperCase());
  const url = `${BASE}/api/market/flows?${qs}`;

  const t0 = Date.now();
  const res = await fetch(url, { headers: { Cookie: session.cookieHeader } });
  const fetchMs = Date.now() - t0;
  if (!res.ok) {
    console.error(`FAIL: GET /api/market/flows -> HTTP ${res.status} in ${fetchMs}ms`);
    process.exit(1);
  }
  const body = await res.json();
  const flows = Array.isArray(body.flows) ? body.flows : [];

  const groups = { A: [], B: [], mixed: [], unknown: [] };
  for (const f of flows) groups[writerGroup(f)].push(f);

  const has = (f, k) => f[k] != null && f[k] !== "";
  const FIELDS = [
    "event_at", "alert_rule", "implied_volatility", "open_interest", "ask_pct",
    "underlying_price", "otm_pct", "fill_price", "alert_id", "score", "gex_proximity",
  ];
  const presence = {};
  for (const k of FIELDS) {
    presence[k] = {
      all: pct(flows.filter((f) => has(f, k)).length, flows.length),
      A: pct(groups.A.filter((f) => has(f, k)).length, groups.A.length),
      B: pct(groups.B.filter((f) => has(f, k)).length, groups.B.length),
    };
  }

  const buckets = new Map();
  const multiMatch = new Map();
  const rules = new Map();
  for (const f of flows) {
    const k = executionRouteKey(f);
    buckets.set(k, (buckets.get(k) ?? 0) + 1);
    const label = has(f, "alert_rule") ? f.alert_rule : "(absent)";
    rules.set(label, (rules.get(label) ?? 0) + 1);
    const m = routeKeyMatches(f.alert_rule);
    if (m.length > 1) {
      const sig = `${f.alert_rule} matches ${m.join("+")} -> filed as ${k}`;
      multiMatch.set(sig, (multiMatch.get(sig) ?? 0) + 1);
    }
  }

  const iv = ivUnitVerdict(flows.map((f) => f.implied_volatility));
  const eligibility = signalEligibility(flows);

  const sumPrem = (g) => g.reduce((t, f) => t + (Number(f.premium) || 0), 0);
  const premA = sumPrem(groups.A);
  const premB = sumPrem(groups.B);

  const contracts = flows.map(impliedContracts).filter((v) => v != null).sort((a, b) => a - b);
  const cq = (p) => (contracts.length ? contracts[Math.min(contracts.length - 1, Math.floor(p * contracts.length))] : null);

  const negDte = flows.filter((f) => typeof f.dte === "number" && f.dte < 0).length;
  const tickers = new Set(flows.map((f) => f.ticker));
  const dated = flows.map((f) => Date.parse(f.event_at ?? "")).filter(Number.isFinite).sort((a, b) => a - b);
  const spanMin = dated.length ? Math.round((dated[dated.length - 1] - dated[0]) / 60_000) : null;

  const report = {
    as_of: new Date().toISOString(),
    request: { base: BASE, limit: LIMIT, since_hours: SINCE_HOURS, ticker: TICKER || null, fetch_ms: fetchMs },
    response: { source: body.source, count: body.count, has_more: body.has_more, degraded: body.degraded ?? false, rows: flows.length },
    writers: {
      A: { rows: groups.A.length, tickers: new Set(groups.A.map((f) => f.ticker)).size, premium: premA },
      B: { rows: groups.B.length, tickers: new Set(groups.B.map((f) => f.ticker)).size, premium: premB },
      mixed: groups.mixed.length,
      unknown: groups.unknown.length,
      B_premium_share_pct: pct(premB, premA + premB),
    },
    field_presence_pct: presence,
    signal_eligibility: eligibility,
    route_breakdown: Object.fromEntries([...buckets.entries()].sort((a, b) => b[1] - a[1])),
    alert_rules: Object.fromEntries([...rules.entries()].sort((a, b) => b[1] - a[1])),
    route_multi_match: Object.fromEntries(multiMatch),
    iv_units: iv,
    implied_contracts: contracts.length
      ? { n: contracts.length, median: Math.round(cq(0.5)), p99: Math.round(cq(0.99)), max: Math.round(contracts[contracts.length - 1]) }
      : null,
    tape_shape: {
      distinct_tickers: tickers.size,
      gex_enrichment_cap: 100,
      tickers_beyond_gex_cap: Math.max(0, tickers.size - 100),
      negative_dte_rows: negDte,
      negative_dte_pct: pct(negDte, flows.length),
      dated_prints: dated.length,
      real_print_span_minutes: spanMin,
      requested_hours: SINCE_HOURS,
      newest_print_age_minutes: dated.length ? Math.round((Date.now() - dated[dated.length - 1]) / 60_000) : null,
    },
  };

  if (AS_JSON) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const L = (s = "") => console.log(s);
    L(`HELIX TAPE INVENTORY — ${BASE}`);
    L(`  HTTP 200 in ${fetchMs}ms · source=${report.response.source} · rows=${flows.length} · has_more=${report.response.has_more}`);
    L();
    L(`## WRITERS  (the tape has two producers with different payload schemas)`);
    L(`  A  UW flow_alerts   ${String(groups.A.length).padStart(5)} rows · ${report.writers.A.tickers} tickers · ${usd(premA)}   [alert_rule]`);
    L(`  B  index-only feed  ${String(groups.B.length).padStart(5)} rows · ${report.writers.B.tickers} tickers · ${usd(premB)}   [implied_volatility]`);
    if (groups.mixed.length) L(`  !! MIXED (breaks the clean split — this is news): ${groups.mixed.length}`);
    L(`  Group B carries ${report.writers.B_premium_share_pct}% of ALL premium on this tape`);
    L();
    L(`## FIELD PRESENCE %   (all / group A / group B)`);
    for (const k of FIELDS) {
      const p = presence[k];
      L(`  ${k.padEnd(20)} ${String(p.all).padStart(6)} ${String(p.A).padStart(7)} ${String(p.B).padStart(7)}`);
    }
    L();
    L(`## SIGNAL ELIGIBILITY   (velocity + split both require a real print time)`);
    // Read from the PRODUCT's rule, not this harness's own — see helix-tape-inventory-eval.mjs.
    // The ineligible clause is printed only when there ARE ineligible rows: a blanket "the rest can
    // never fire either signal" is how this harness reported #2723 as having changed nothing.
    L(`  eligible ${eligibility.eligible}/${eligibility.total} rows (${eligibility.eligible_pct}%)`);
    if (eligibility.ineligible > 0) {
      const names = eligibility.ineligibleTickers.slice(0, 8).join(", ");
      const more = eligibility.ineligibleTickers.length > 8 ? ` +${eligibility.ineligibleTickers.length - 8} more` : "";
      L(`  !! ${eligibility.ineligible} rows carry no placeable print time and can fire NEITHER signal: ${names}${more}`);
    }
    L();
    L(`## ROUTE BREAKDOWN   (what the member panel shows)`);
    for (const [k, n] of Object.entries(report.route_breakdown)) L(`  ${String(n).padStart(5)} ${String(pct(n, flows.length)).padStart(6)}%  ${k}`);
    const dead = ["SWEEP", "BLOCK", "SPLIT", "CROSS", "FLOOR", "MULTI"].filter((k) => !buckets.has(k));
    if (dead.length) L(`  buckets that never fired: ${dead.join(", ")}`);
    L();
    L(`## alert_rule VALUES`);
    for (const [r, n] of Object.entries(report.alert_rules)) // Ask the REAL function for the absent case too. This line used to hardcode "OTHER" — written
    // before UNREPORTED existed — so the same run printed UNREPORTED in the bucket table above and
    // OTHER here, for the same 3500 rows. A harness that contradicts itself in one output teaches
    // whoever reads it the wrong answer.
    L(`  ${String(n).padStart(5)} ${String(pct(n, flows.length)).padStart(6)}%  ${r} -> ${executionRouteKey({ alert_rule: r === "(absent)" ? undefined : r })}`);
    for (const [sig, n] of Object.entries(report.route_multi_match)) L(`  !! ${n}x ${sig}`);
    L();
    L(`## implied_volatility UNITS`);
    if (iv.verdict == null) L(`  verdict WITHHELD — ${iv.reason} (${iv.sample}/${iv.min_sample})`);
    else if (iv.shipped_renderer_ok)
      L(`  ${iv.verdict}: median ${iv.median}, max ${iv.max} · fmtIv's unconditional x100 (#2669) suits this feed — 0 misrendered`);
    else
      L(`  ${iv.verdict}: median ${iv.median}, max ${iv.max} · !! NOT uniformly fractional — fmtIv multiplies unconditionally, so all ${iv.sample} rows are suspect (upper lump ${iv.above_branch} above ${iv.branch_at})`);
    L();
    L(`## TAPE SHAPE`);
    L(`  distinct tickers ${tickers.size} (GEX enrichment caps at 100 — ${report.tape_shape.tickers_beyond_gex_cap} never evaluated)`);
    // Ask the panel's own function what it does with an expired print, rather than asserting it.
    const negBucket = expiryHorizonLabel(-1);
    L(
      `  negative-DTE rows ${negDte} (${report.tape_shape.negative_dte_pct}%) — expired; panel files them under "${negBucket}"` +
        (negBucket === "0DTE" ? "  (correct since §9.5)" : `  !! a FUTURE horizon for an expired contract`)
    );
    L(`  real-print span ${spanMin} min over ${dated.length} dated prints — REQUESTED ${SINCE_HOURS}h`);
    L(`  newest real print ${report.tape_shape.newest_print_age_minutes} min old`);
  }
} finally {
  await session.cleanup?.();
}
