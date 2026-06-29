#!/usr/bin/env node
/**
 * UW numeric cross-validator (scheduled-task: validate-numerics-uw).
 *
 * Compares our SERVED flow numerics (Postgres `flow_alerts`, the HELIX tape source)
 * against the UW REST API live values. Any divergence = stale / miscalculated / fabricated.
 *
 * Why this exists instead of the SKILL's inline PowerShell:
 *   - Env key is UW_API_KEY (not UNUSUAL_WHALES_API_KEY).
 *   - The served endpoint /api/market/flows is auth-gated (401 unauth), so served values
 *     are read straight from prod Postgres via the Railway public proxy.
 *   - UW raw fields: id / ticker / total_premium / created_at (not alert_uuid/ticker_symbol).
 *   - DB alert_id is stored "uw:"-prefixed — normalize before matching, else all rows read
 *     as "missing".
 *   - Ingest only persists total_premium >= UW_FLOW_MIN_PREMIUM (default 200k); the missing
 *     check must compare against the >=threshold subset and skip prints younger than the
 *     ~90s ingest cadence, or sub-threshold/bleeding-edge flows look like data loss.
 *
 * Run from the repo root so `pg` resolves:  node scripts/validate-uw-numerics.mjs
 * Exit code 2 if a P0 (premium mismatch >1%, or RTH tape lag >5min) is detected.
 */
import { Client } from "pg";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  try {
    return Object.fromEntries(
      readFileSync(join(REPO, ".env.local"), "utf8")
        .split(/\r?\n/)
        .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
        .map((l) => {
          const i = l.indexOf("=");
          return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
        })
    );
  } catch {
    return {};
  }
}

const env = { ...loadEnv(), ...process.env };
const UW_KEY = env.UW_API_KEY;
if (!UW_KEY) throw new Error("UW_API_KEY not configured");

// Resolve prod DB URL: prefer explicit DATABASE_URL, else Railway public proxy.
let DB_URL = env.DATABASE_PUBLIC_URL || env.DATABASE_URL;
if (!DB_URL && env.RAILWAY_TOKEN) {
  process.env.RAILWAY_TOKEN = env.RAILWAY_TOKEN;
  const vars = JSON.parse(execSync("railway variables --service Postgres --json", { cwd: REPO }).toString());
  DB_URL = vars.DATABASE_PUBLIC_URL || vars.DATABASE_URL;
}
if (!DB_URL) throw new Error("No DB URL (set DATABASE_PUBLIC_URL or RAILWAY_TOKEN)");

const MIN_PREMIUM = Number(env.UW_FLOW_MIN_PREMIUM ?? 200_000);
const INGEST_GRACE_MS = 90_000;
const norm = (s) => (s == null ? s : String(s).replace(/^uw:/, ""));

async function uw(path) {
  const r = await fetch("https://api.unusualwhales.com" + path, {
    headers: { Authorization: "Bearer " + UW_KEY },
  });
  if (!r.ok) throw new Error(`UW ${path} -> ${r.status}`);
  return r.json();
}

const out = {};

// ---- UW live flow alerts ----
const uwFlows = (await uw("/api/option-trades/flow-alerts?limit=50")).data || [];
out.uwCount = uwFlows.length;

// ---- Served (DB) flow alerts ----
const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
let dbRows;
try {
  dbRows = (
    await client.query(
      `SELECT alert_id, ticker, total_premium, created_at, inserted_at
       FROM flow_alerts ORDER BY COALESCE(created_at, inserted_at) DESC LIMIT 200`
    )
  ).rows;
} finally {
  await client.end();
}
out.dbCount = dbRows.length;
const dbById = new Map(dbRows.map((r) => [norm(r.alert_id), r]));
const dbIds = new Set(dbRows.map((r) => norm(r.alert_id)));

out.uwNewest = uwFlows[0] && { id: uwFlows[0].id, ticker: uwFlows[0].ticker, premium: Number(uwFlows[0].total_premium), created: uwFlows[0].created_at };
out.dbNewest = dbRows[0] && { alert_id: dbRows[0].alert_id, ticker: dbRows[0].ticker, premium: Number(dbRows[0].total_premium), created: dbRows[0].created_at };

// ---- Premium cross-validation (match by id) ----
let checked = 0, mismatches = 0;
const mismatchDetail = [];
for (const f of uwFlows.slice(0, 40)) {
  const m = dbById.get(norm(f.id));
  if (!m) continue;
  checked++;
  const ourP = Number(m.total_premium);
  const uwP = Number(f.total_premium);
  const diffPct = uwP > 0 ? (Math.abs(ourP - uwP) / uwP) * 100 : 0;
  if (diffPct > 1) {
    mismatches++;
    mismatchDetail.push({ ticker: f.ticker, ours: ourP, uw: uwP, diffPct: +diffPct.toFixed(2) });
  }
}
out.premiumChecked = checked;
out.premiumMismatches = mismatches;
out.mismatchDetail = mismatchDetail;

// ---- Tape lag ----
if (out.uwNewest && out.dbNewest) {
  out.tapeLagMin = +(((new Date(out.uwNewest.created) - new Date(out.dbNewest.created)) / 60000)).toFixed(1);
  out.dbNewestAgeMin = +(((Date.now() - new Date(out.dbNewest.created)) / 60000)).toFixed(1);
}

// ---- Missing / dedup (>=threshold, settled only) ----
const eligible = uwFlows.filter(
  (f) => Number(f.total_premium) >= MIN_PREMIUM && Date.now() - new Date(f.created_at).getTime() > INGEST_GRACE_MS
);
const missing = eligible.filter((f) => !dbIds.has(norm(f.id)));
out.minPremium = MIN_PREMIUM;
out.uwEligibleCount = eligible.length;
out.missingCount = missing.length;
out.missingSample = missing.slice(0, 8).map((f) => ({ id: f.id, ticker: f.ticker, premium: Number(f.total_premium), created: f.created_at }));

// ---- Verdict ----
// Tape lag is only a P0 during RTH (09:30–16:00 ET). Compute ET hour roughly via offset-free Intl.
const etHour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hour12: false }).format(new Date()));
const etDay = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" }).format(new Date());
const isRTH = !["Sat", "Sun"].includes(etDay) && etHour >= 9 && etHour < 16;
out.isRTH = isRTH;
const p0 = [];
if (mismatches > 0) p0.push(`${mismatches} premium mismatch(es) >1% vs UW`);
if (isRTH && out.tapeLagMin > 5) p0.push(`tape lag ${out.tapeLagMin}min >5min during RTH`);
out.p0 = p0;
out.verdict = p0.length ? "P0" : "PASS";

console.log(JSON.stringify(out, null, 2));
process.exit(p0.length ? 2 : 0);
