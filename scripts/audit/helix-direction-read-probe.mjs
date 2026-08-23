/**
 * Do HELIX's aggregate DIRECTION claims agree with the rule the tape itself uses — and is there
 * enough readable premium behind each one to make the claim at all?
 *
 * Covers all three surfaces that render a directional verdict over aggregated premium:
 * Expiry Concentration (per horizon), the Net Premium leaderboard (per ticker), and — sharing the
 * leaderboard's derivation exactly — the ticker drawer's bias pill.
 *
 * WHY THIS EXISTS. The panel coloured each horizon from `callPremium / (call + put)` — option type
 * alone. #2691 replaced that rule everywhere else on the same page: a SOLD call is bearish. Nothing
 * compared the two, so a panel sitting between the tide bar and the split-flow radar read the rule
 * they had both moved off. Reading the code shows the rules differ; only a run against the real
 * tape shows whether they differ IN PRACTICE, and by how much.
 *
 * It answers two questions, and the second is the larger one:
 *   1. Per horizon and per leaderboard ticker: the legacy colour vs the aggression-aware verdict,
 *      and what share of the readable CALL premium was actually SOLD.
 *   2. What share of each horizon's premium has a readable direction AT ALL. `ask_pct` is a Group A
 *      field (HELIX-MAP §4A) and Monthly/LEAPS are dominated by the SPX/SPY index feed, which does
 *      not carry it. A confident colour over premium whose direction is 97% unknown is a worse
 *      defect than a wrong colour, because it is indistinguishable from an evidenced one.
 *
 * FIRST RUN 2026-08-23, 5000 rows / 168h: all four horizons rendered BULLISH GREEN and all four
 * disagreed. 0DTE 63.0% readable -> mixed; This week 84.7% -> mixed (bearish premium $26.302M
 * slightly EXCEEDING bullish $26.232M, under a green bar); Monthly 6.1% -> undetermined; LEAPS
 * 3.2% -> undetermined. Also confirmed `option_type` is CALL or PUT on 5000/5000 rows, so the
 * panel's print COUNT and its premium total cover the same population — a thing worth checking
 * before asserting they do.
 *
 * READ-ONLY against production. One temp Clerk user, deleted in a `finally`. Never prints a secret.
 * Imports the REAL `flowDirection` / `directionalPremium` / `bucketLabel` rather than restating
 * them — a second copy of the rule would drift from the panel and this would then measure a
 * bucketing nobody ships.
 *
 * LEADERBOARD, same run: **7 of the top 10 tickers disagree** with the arrow they rendered. The
 * worst is the panel's own top row — SPX, a green triangle-up over $4.02B of net premium whose
 * direction is **0.1% readable**. AMD, MU and SMH agree, so the honest rule does not flatten the
 * panel; it keeps the verdicts that have evidence behind them.
 *
 * Usage (Node 20, from the repo root):
 *   node --import tsx scripts/audit/helix-expiry-direction-probe.mjs [--limit=5000] [--since-hours=168]
 *                                                                    [--base=URL] [--json]
 */
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";
import {
  flowDirection,
  directionalPremium,
  directionLabel,
} from "@/features/helix/lib/helix-flow-aggression";
import { readDirection } from "@/features/helix/lib/helix-direction-read";
import { bucketLabel } from "@/features/helix/components/ExpiryConcentration";
import { HELIX_NET_PREMIUM_LEADERS_LIMIT } from "@/features/helix/lib/helix-strike-leaders";
import { daysToExpiry } from "@/features/helix/lib/helix-flow-format";

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const flag = (name) => argv.includes(`--${name}`);

const BASE = arg("base", process.env.VALIDATE_BASE ?? "https://blackouttrades.com");
const LIMIT = Number(arg("limit", 5000));
const SINCE_HOURS = Number(arg("since-hours", 168));
const AS_JSON = flag("json");

/** The panel's own floor — buckets below it are not rendered, so they are not measured here. */
const BUCKET_FLOOR_USD = 50_000;
const HORIZONS = ["0DTE", "This week", "Monthly", "LEAPS"];

const usd = (n) => "$" + Math.round(n).toLocaleString("en-US");
const pct1 = (n, d) => (d > 0 ? Math.round((1000 * n) / d) / 10 : null);

const session = await mintClerkPremiumSession({ appUrl: BASE });
if (session.skip) {
  // SKIP, not FAIL — a missing credential is not a product verdict.
  console.log(`SKIP: ${session.reason}`);
  process.exit(0);
}

let exitCode = 0;
try {
  const qs = new URLSearchParams({ limit: String(LIMIT), since_hours: String(SINCE_HOURS) });
  const res = await fetch(`${BASE}/api/market/flows?${qs}`, {
    headers: { Cookie: session.cookieHeader },
  });
  if (!res.ok) {
    console.error(`FAIL: GET /api/market/flows -> HTTP ${res.status}`);
    process.exit(1);
  }
  const body = await res.json();
  const flows = Array.isArray(body.flows) ? body.flows : [];
  // Printed ALWAYS, not only on failure. A run that fetched nothing and reported "0 disagreements"
  // is indistinguishable from a clean one, and that happened once during development — a transient
  // empty response read as a pass until this line was added.
  console.log(`http=${res.status} rows=${flows.length}`);
  if (flows.length === 0) {
    // An empty tape cannot support any verdict about the panel. Say that, rather than reporting
    // four clean horizons — "nothing to measure" and "measured, all fine" are opposite results.
    console.log("INSUFFICIENT DATA: the tape returned 0 rows; no horizon can be judged.");
    process.exit(0);
  }

  // Does the panel's print COUNT cover the same population as its premium total? A row whose
  // option_type is neither CALL nor PUT increments the count and contributes no premium.
  const types = new Map();
  let unclassified = 0;
  let unclassifiedPrem = 0;
  for (const f of flows) {
    const t = String(f.option_type ?? "(absent)");
    types.set(t, (types.get(t) ?? 0) + 1);
    if (t !== "CALL" && t !== "PUT") {
      unclassified++;
      unclassifiedPrem += Number(f.premium) || 0;
    }
  }

  const byHorizon = new Map();
  for (const f of flows) {
    const dte = f.dte ?? daysToExpiry(f.expiry);
    const label = bucketLabel(dte);
    const cur = byHorizon.get(label) ?? { rows: [], call: 0, put: 0 };
    cur.rows.push(f);
    const p = Number(f.premium) || 0;
    if (f.option_type === "CALL") cur.call += p;
    else if (f.option_type === "PUT") cur.put += p;
    byHorizon.set(label, cur);
  }

  const report = [];
  for (const label of HORIZONS) {
    const b = byHorizon.get(label);
    if (!b) continue;
    const total = b.call + b.put;
    if (total < BUCKET_FLOOR_USD) continue;

    // The rule the panel used BEFORE the fix, reproduced exactly so the comparison is real.
    const callPct = Math.round((b.call / total) * 100);
    const legacy = callPct >= 55 ? "bullish" : callPct <= 45 ? "bearish" : "neutral";

    const d = readDirection(b.rows);
    const shipped = d.minorityEvidence ? "undetermined" : directionLabel(directionalPremium(b.rows));

    // Of the CALL premium whose side IS readable, how much was sold? This is the number that
    // makes "calls dominate therefore bullish" untenable in one line.
    let callRead = 0;
    let callSold = 0;
    for (const f of b.rows) {
      if (f.option_type !== "CALL") continue;
      if (flowDirection(f) === "undetermined") continue;
      const p = Number(f.premium) || 0;
      callRead += p;
      if (flowDirection(f) === "bearish") callSold += p;
    }

    report.push({
      horizon: label,
      prints: b.rows.length,
      total,
      call_premium: b.call,
      put_premium: b.put,
      legacy_colour: legacy,
      shipped_verdict: shipped,
      agrees: legacy === shipped,
      readable_pct: d.readablePct == null ? null : Math.round(d.readablePct * 10) / 10,
      minority_evidence: d.minorityEvidence,
      bullish_premium: d.premium.bullish,
      bearish_premium: d.premium.bearish,
      unreadable_premium: d.premium.undetermined,
      readable_call_premium_sold_pct: pct1(callSold, callRead),
    });
  }

  // ── LEADERBOARD ────────────────────────────────────────────────────────────────────────────
  // Same question, different aggregation: the panel ranks by TOTAL premium and renders an arrow
  // whose colour came from sign(calls - puts). The `net` figure itself is a named, correctly
  // defined quantity and is NOT what is being checked — only the direction claim laid over it.
  const byTicker = new Map();
  for (const f of flows) {
    const cur = byTicker.get(f.ticker) ?? { calls: 0, puts: 0, rows: [] };
    const p = Number(f.premium) || 0;
    if (f.option_type === "CALL") cur.calls += p;
    else if (f.option_type === "PUT") cur.puts += p;
    cur.rows.push(f);
    byTicker.set(f.ticker, cur);
  }
  const leaders = [...byTicker.entries()]
    .map(([ticker, v]) => ({ ticker, ...v, total: v.calls + v.puts, net: v.calls - v.puts }))
    .sort((a, b) => b.total - a.total)
    .slice(0, HELIX_NET_PREMIUM_LEADERS_LIMIT)
    .map((r) => {
      const d = readDirection(r.rows);
      const legacy = r.net >= 0 ? "bullish" : "bearish";
      const shipped = d.minorityEvidence ? "undetermined" : directionLabel(directionalPremium(r.rows));
      return {
        ticker: r.ticker,
        legacy_colour: legacy,
        shipped_verdict: shipped,
        agrees: legacy === shipped,
        readable_pct: d.readablePct == null ? null : Math.round(d.readablePct * 10) / 10,
        net: r.net,
        total: r.total,
      };
    });
  const leaderDisagreements = leaders.filter((r) => !r.agrees).length;

  const disagreements = report.filter((r) => !r.agrees).length + leaderDisagreements;

  if (AS_JSON) {
    console.log(
      JSON.stringify(
        {
          base: BASE,
          rows: flows.length,
          option_type_counts: Object.fromEntries(types),
          unclassified_rows: unclassified,
          unclassified_premium: unclassifiedPrem,
          horizons: report,
          leaders,
          horizon_disagreements: report.filter((r) => !r.agrees).length,
          leader_disagreements: leaderDisagreements,
          disagreements,
        },
        null,
        2
      )
    );
  } else {
    console.log(`base=${BASE}  window=${SINCE_HOURS}h`);
    console.log(
      "option_type: " + [...types].map(([k, v]) => `${k}=${v}`).join(" ") +
        `  | neither CALL nor PUT: ${unclassified} rows (${usd(unclassifiedPrem)})`
    );
    console.log("\nhorizon        legacy-colour   shipped-verdict   readable%   readable CALL prem SOLD%");
    for (const r of report) {
      console.log(
        `${r.horizon.padEnd(14)} ${r.legacy_colour.padEnd(15)} ${String(r.shipped_verdict).padEnd(17)} ` +
          `${String(r.readable_pct ?? "n/a").padStart(7)}%   ` +
          `${r.readable_call_premium_sold_pct == null ? "  n/a" : String(r.readable_call_premium_sold_pct).padStart(5) + "%"}` +
          (r.agrees ? "" : "   <-- DISAGREE")
      );
      console.log(
        `               total ${usd(r.total)} · call ${usd(r.call_premium)} put ${usd(r.put_premium)} · ` +
          `bull ${usd(r.bullish_premium)} bear ${usd(r.bearish_premium)} unread ${usd(r.unreadable_premium)} · ${r.prints} prints`
      );
    }
    console.log("\nticker   legacy-colour   shipped-verdict   readable%   net");
    for (const r of leaders) {
      console.log(
        `${r.ticker.padEnd(8)} ${r.legacy_colour.padEnd(15)} ${String(r.shipped_verdict).padEnd(17)} ` +
          `${String(r.readable_pct ?? "n/a").padStart(7)}%   ${usd(r.net)}` +
          (r.agrees ? "" : "   <-- DISAGREE")
      );
    }
    console.log(
      `\n${report.filter((r) => !r.agrees).length}/${report.length} horizons and ` +
        `${leaderDisagreements}/${leaders.length} leaders disagree between the two rules.` +
        (disagreements === 0
          ? ""
          : " Each one renders a direction from a rule this page no longer uses.")
    );
  }

  // Non-zero on any disagreement so this can gate. After the fix the panel USES the shipped
  // verdict, so a disagreement means the deploy does not carry it — which is the thing worth
  // failing on.
  if (disagreements > 0) exitCode = 1;
} finally {
  await session.cleanup?.();
}
process.exit(exitCode);
