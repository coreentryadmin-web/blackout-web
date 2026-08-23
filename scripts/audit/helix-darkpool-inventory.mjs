#!/usr/bin/env node
/**
 * HELIX dark-pool inventory — the half of the lane that never had a measurement.
 *
 * The charter defines HELIX as the options-flow AND dark-pool tape reader. `HELIX-MAP.md`'s Phase 0
 * inventory covers the options tape field by field and carries essentially ONE line about dark pool.
 * This is that missing measurement, and it is deliberately a HARNESS rather than a one-off probe so
 * the numbers below can be re-taken rather than quoted from memory.
 *
 * ── WHAT IT ASKS THAT A FILL-RATE INVENTORY CANNOT ──────────────────────────────────────────────
 *
 * Every field on a dark-pool print is 100% filled. A fill-rate inventory of the kind
 * `meridian-earnings-data-inventory.mjs` produces would report `side: 100% ALWAYS` — and every one
 * of those values is the literal string `"neutral"`. UW's market-wide endpoint omits direction, and
 * `dark-pool/route.ts:27` collapses anything that is not buy/sell into `"neutral"`.
 *
 * So this reports **fill rate beside distinct-value count**: a field that is always present and
 * never varies is `informative: false`. CLAUDE.md already records that a fill rate without its
 * COHORT is not a fact about a field; this is the same lesson one turn on — a fill rate without its
 * VARIANCE is not one either.
 *
 * It also reports whether a directional read is possible at all, and over how much of the premium.
 * `biasFromSide` in `DarkPoolPanel.tsx` guards only the NEITHER-side-present case, so a partially
 * sided population would yield a verdict computed over the minority with the rest silently dropped.
 * MEASURED 2026-08-23 that case does not occur (0 of 40 prints carry a side, so the guard fires and
 * the panel correctly renders `—`), which is why this REPORTS the risk rather than the code being
 * changed on a guess.
 *
 * READ-ONLY. One temp Clerk user, deleted before exit. No writes of any kind.
 *
 * Usage: node --import tsx scripts/audit/helix-darkpool-inventory.mjs [--limit=500] [--json]
 */
import { fieldInventory, directionalCoverage, newestPrintAgeHours, UNINFORMATIVE_SIDE } from "./lib/helix-darkpool-eval.mjs";
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";

const args = new Map(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, "").split("=");
  return [k, v ?? "true"];
}));
const LIMIT = Number(args.get("limit") ?? 500);
const AS_JSON = args.get("json") === "true";
const BASE = args.get("base") ?? "https://blackouttrades.com";

(async () => {
  const session = await mintClerkPremiumSession({ appUrl: BASE });
  try {
    const res = await fetch(`${BASE}/api/market/dark-pool?limit=${LIMIT}`, {
      headers: { Cookie: session.cookieHeader },
    });
    const body = await res.json().catch(() => ({}));
    const prints = body.prints ?? body.data ?? (Array.isArray(body) ? body : []);

    const inventory = fieldInventory(prints);
    const coverage = directionalCoverage(prints);
    const ageH = newestPrintAgeHours(prints, Date.now());

    if (AS_JSON) {
      console.log(JSON.stringify({ http: res.status, requested: LIMIT, returned: prints.length, ageHours: ageH, inventory, coverage }, null, 2));
      return;
    }

    console.log(`\n=== HELIX DARK-POOL INVENTORY — ${BASE}`);
    console.log(`HTTP ${res.status} · requested ${LIMIT} · returned ${prints.length}`);
    if (!prints.length) {
      // An empty feed is not a clean run. Say so rather than printing an all-zero inventory that
      // reads like a measurement.
      console.log(`\nNO PRINTS RETURNED — nothing was measured. This is not a PASS.`);
      process.exitCode = 1;
      return;
    }
    console.log(`newest print: ${ageH == null ? "unreadable" : `${ageH.toFixed(1)}h old`}` +
      (ageH != null && ageH > 12 ? "  (stale — normal over a weekend, not a fault)" : ""));

    console.log(`\n  field         fill%   distinct  informative  sample`);
    for (const [field, f] of Object.entries(inventory)) {
      console.log(
        `  ${field.padEnd(12)} ${f.fillPct.toFixed(1).padStart(5)}%   ${String(f.distinctValues).padStart(6)}  ` +
        `${(f.informative ? "yes" : "NO").padStart(11)}  ${f.sampleValues.join(", ").slice(0, 40)}`
      );
    }
    const dead = Object.entries(inventory).filter(([, f]) => f.fillPct === 100 && !f.informative);
    if (dead.length) {
      console.log(`\n  ${dead.length} field(s) are 100% FILLED and carry NO INFORMATION: ${dead.map(([k]) => k).join(", ")}`);
      console.log(`  A fill-rate inventory would report these as healthy. They cannot discriminate between any two rows.`);
    }

    console.log(`\ndirectional coverage: ${coverage.status}`);
    console.log(`  prints with a buy/sell side: ${coverage.sidedPrints}/${coverage.totalPrints}` +
      (coverage.sidedPremiumPct == null ? "" : ` · ${coverage.sidedPremiumPct.toFixed(1)}% of premium`));
    if (coverage.note) console.log(`  ${coverage.note}`);
    if (coverage.status === "NO_DIRECTION_REPORTED") {
      console.log(`  (every side is "${UNINFORMATIVE_SIDE}" — the endpoint omits direction, and the panel is right to say so)`);
    }
    if (coverage.status === "MINORITY_VERDICT_RISK") {
      console.log(`  ACTION: DarkPoolPanel's biasFromSide guard covers only the no-side case. This population`);
      console.log(`  would produce a bias from the minority. Worth fixing NOW that it can actually occur.`);
      process.exitCode = 1;
    }
  } finally {
    await session.cleanup?.();
    console.log("temp Clerk user released");
  }
})().catch((e) => { console.error("INVENTORY ERROR:", e.message); process.exitCode = 1; });
