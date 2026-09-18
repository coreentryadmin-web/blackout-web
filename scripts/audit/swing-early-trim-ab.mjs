#!/usr/bin/env node
/**
 * SWING EARLY-TRIM A/B — does `SWING_SCALE_OUT_POLICY`'s single +100% trim rung leave real
 * winners unprotected on the way back down? (Night Hawk Swings outcome-driven improvement
 * mandate, 2026-09-10.)
 *
 * WHY. `SWING_SCALE_OUT_POLICY` (src/lib/swing/exit-policy.ts) has exactly one trim rung: bank
 * 50% at +100% premium gain, run the rest. A live loss-taxonomy pass this cycle found several
 * closed swing positions with real double-digit MFE (14-82%) that fully round-tripped into a
 * steep stop-out with ZERO intermediate protection, because none of them ever reached +100%.
 *
 * WHAT THIS MEASURES vs WHAT IT DOES NOT. Swing's real live management (`evaluateSwingManagement`,
 * manage-sync.ts) is gated on thesis-break/catalyst/regime/flow signals this script cannot
 * reconstruct for past dates without fabricating them — so this does NOT replay the real decision
 * engine (unlike e.g. tier-exit-mode-ab.mjs, which can, because 0DTE's ladder mechanics ARE its
 * status machine). What IS measurable honestly: the same MECHANICAL peak-vs-trigger math
 * `buildTerminalExitLadder` already uses, applied to the REAL entry/peak/exit premiums every
 * closed position already carries. The counterfactual assumption — banking an earlier partial does
 * not change the underlying's future price path, so the runner still closes at the real recorded
 * exitPnlPct — is stated explicitly in swing-early-trim-eval.mjs and is the one simplification this
 * measurement rests on.
 *
 * Pure comparison logic (and its honest scope note) lives in
 * scripts/audit/lib/swing-early-trim-eval.mjs (unit-tested, node --test).
 *
 * USAGE
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *   node --import tsx scripts/audit/swing-early-trim-ab.mjs [--days=90] [--base=https://blackouttrades.com] [--json]
 */
import { fetchAuditJson, releaseAuditClerkSession } from "./lib/audit-auth-fetch.mjs";
import { comparePolicies, reachRate } from "./lib/swing-early-trim-eval.mjs";

const args = process.argv.slice(2);
const flag = (name, def) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : def;
};
const DAYS = Math.min(90, Math.max(1, Number(flag("days", "90")) || 90));
const BASE = flag("base", "https://blackouttrades.com");
const JSON_OUT = args.includes("--json");

const CURRENT = [{ triggerPct: 100, fraction: 0.5 }];
const CANDIDATES = {
  "trim@30/50%": [{ triggerPct: 30, fraction: 0.5 }],
  "trim@40/50%": [{ triggerPct: 40, fraction: 0.5 }],
  "trim@50/50%": [{ triggerPct: 50, fraction: 0.5 }],
  "trim@60/50%": [{ triggerPct: 60, fraction: 0.5 }],
  "trim@80/50%": [{ triggerPct: 80, fraction: 0.5 }],
};

async function main() {
  const res = await fetchAuditJson(BASE, `/api/market/swing/record?days=${DAYS}`);
  if (!res.ok || !res.json?.closedDeck) {
    if (JSON_OUT) console.log(JSON.stringify({ ok: false, insufficient_data: true, status: res.status, via: res.via }, null, 2));
    else console.log(`INSUFFICIENT DATA — GET /api/market/swing/record?days=${DAYS} -> ${res.status} via=${res.via ?? "none"}`);
    await releaseAuditClerkSession();
    process.exitCode = 1;
    return;
  }

  const rows = (res.json.closedDeck ?? []).map((c) => ({
    ticker: c.ticker,
    entryPremium: typeof c.entryPremium === "number" ? c.entryPremium : null,
    peakPremium: typeof c.peakPremium === "number" ? c.peakPremium : null,
    exitPnlPct: typeof c.exitPnlPct === "number" ? c.exitPnlPct : null,
    closedReason: c.closedReason ?? null,
  }));

  const results = {};
  for (const [label, trims] of Object.entries(CANDIDATES)) {
    results[label] = { ...comparePolicies(rows, CURRENT, trims), reach: reachRate(rows, trims[0].triggerPct) };
  }
  const currentReach = reachRate(rows, 100);

  if (JSON_OUT) {
    console.log(JSON.stringify({ ok: true, days: DAYS, population: rows.length, currentReach, results }, null, 2));
    await releaseAuditClerkSession();
    return;
  }

  console.log(`\n=== SWING EARLY-TRIM A/B (${DAYS}d window, ${rows.length} closed chains) ===`);
  console.log(`Current policy (+100% trigger) reach rate: ${currentReach.reached}/${currentReach.n} (${currentReach.pct}%) — how often the shipped rung is even reachable.\n`);
  for (const [label, r] of Object.entries(results)) {
    console.log(`${label}: reach ${r.reach.reached}/${r.reach.n} (${r.reach.pct}%) | n=${r.n} | mean current ${r.meanCurrent}% -> mean candidate ${r.meanCandidate}% | mean delta ${r.meanDelta}pp [${r.ci?.lo}, ${r.ci?.hi}] -> ${r.verdict}`);
  }
  console.log(`\nNo gate/policy changed by this script — evidence only, per the standing "measure before touching a threshold" discipline.`);
  await releaseAuditClerkSession();
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
