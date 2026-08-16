#!/usr/bin/env node
/**
 * Meridian upstream data audit — probes UW/Polygon/Benzinga fields Meridian consumes.
 * Exits non-zero on any REQUIRED RED. Run: node --import tsx scripts/audit/meridian-data-audit.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const POLY = process.env.POLYGON_API_KEY;
const UW = process.env.UW_API_KEY;
const POLY_BASE = (process.env.POLYGON_API_BASE || "https://api.polygon.io").replace(/\/$/, "");
const OUT = process.env.AUDIT_OUT || join(process.cwd(), "audit-output");

function req(name) {
  const v = process.env[name];
  if (!v || v.includes("${{")) {
    console.error(`SKIP upstream probe: ${name} missing`);
    return null;
  }
  return v;
}

async function probe(label, url, headers = {}) {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* non-json */
    }
    const ok = res.ok && json != null;
    const rows =
      json?.results ??
      json?.data ??
      (Array.isArray(json) ? json : null);
    const count = Array.isArray(rows) ? rows.length : rows ? 1 : 0;
    return { label, status: ok ? (count > 0 ? "GREEN" : "AMBER") : "RED", http: res.status, count, sample: rows?.[0] ?? null };
  } catch (e) {
    return { label, status: "RED", http: 0, error: String(e) };
  }
}

async function main() {
  const polyKey = req("POLYGON_API_KEY");
  const uwKey = req("UW_API_KEY");
  mkdirSync(OUT, { recursive: true });

  const checks = [];

  if (polyKey) {
    checks.push(
      await probe(
        "Polygon SPX daily bars",
        `${POLY_BASE}/v2/aggs/ticker/SPX/range/1/day/2026-07-01/2026-07-10?limit=5&apiKey=${polyKey}`
      )
    );
    checks.push(
      await probe(
        "Polygon SPX minute bars",
        `${POLY_BASE}/v2/aggs/ticker/SPX/range/1/minute/2026-07-10/2026-07-10?limit=50&sort=asc&apiKey=${polyKey}`
      )
    );
    checks.push(
      await probe(
        "Benzinga economics headlines",
        `${POLY_BASE}/benzinga/v2/news?limit=5&channels.any_of=economics&apiKey=${polyKey}`
      )
    );
    checks.push(
      await probe(
        "Benzinga analyst ratings NVDA",
        `${POLY_BASE}/benzinga/v2/news?limit=5&tickers=NVDA&channels.any_of=analyst%20ratings,upgrades,downgrades&apiKey=${polyKey}`
      )
    );
    checks.push(
      await probe(
        "Benzinga FDA catalysts",
        `${POLY_BASE}/benzinga/v2/news?limit=5&channels.any_of=fda&apiKey=${polyKey}`
      )
    );
  }

  if (uwKey) {
    const uwHeaders = { Authorization: `Bearer ${uwKey}`, Accept: "application/json" };
    checks.push(
      await probe("UW economic calendar", "https://api.unusualwhales.com/api/market/economic-calendar", uwHeaders)
    );
    checks.push(
      await probe("UW economy CPI", "https://api.unusualwhales.com/api/economy/CPI", uwHeaders)
    );
    checks.push(
      await probe("UW earnings NVDA", "https://api.unusualwhales.com/api/earnings/NVDA", uwHeaders)
    );
    checks.push(
      await probe("UW FDA calendar", "https://api.unusualwhales.com/api/market/fda-calendar", uwHeaders)
    );
    checks.push(
      await probe("UW congress trades", "https://api.unusualwhales.com/api/congress/recent-trades?limit=5", uwHeaders)
    );
    checks.push(
      await probe("UW insider NVDA", "https://api.unusualwhales.com/api/stock/NVDA/insider-buy-sells", uwHeaders)
    );
  }

  const required = checks.filter((c) => c.status === "RED");
  const report = {
    as_of: new Date().toISOString(),
    checks,
    summary: {
      green: checks.filter((c) => c.status === "GREEN").length,
      amber: checks.filter((c) => c.status === "AMBER").length,
      red: required.length,
    },
  };

  const md = [
    "# Meridian data audit",
    "",
    `Generated ${report.as_of}`,
    "",
    "| Probe | Status | HTTP | Count |",
    "|-------|--------|------|-------|",
    ...checks.map((c) => `| ${c.label} | ${c.status} | ${c.http ?? "—"} | ${c.count ?? "—"} |`),
    "",
    "## Field map",
    "",
    "- **Macro timeline**: UW economic calendar + literal FOMC fallback",
    "- **Macro history**: UW economy rows + Polygon SPX daily/minute bars",
    "- **Earnings**: UW earnings history + Benzinga earnings/analyst + Polygon stock daily bars",
    "- **FDA**: UW FDA calendar + Benzinga FDA channel",
    "- **OpEx**: Polygon GEX heatmap max_pain_by_expiry + SPX desk net flow cache",
    "- **GEX/positioning**: getGexPositioning() shared cache (Polygon heatmap + WS override)",
    "- **Insider/congress**: UW insider-buy-sells + congress/recent-trades + Benzinga insider channel",
    "- **Board tickers**: Redis zerodte:board:snapshot:v1 (Night Hawk)",
    "",
    "## Alerts (#7)",
    "",
    "Meridian catalyst alerts (24h/1h Discord/push) are NOT shipped yet — reuse vector-alerts / gex-alerts cron pattern when prioritized.",
  ].join("\n");

  writeFileSync(join(OUT, "meridian-data-audit.json"), JSON.stringify(report, null, 2));
  writeFileSync(join(OUT, "MERIDIAN-DATA-AUDIT.md"), md);
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`Wrote ${join(OUT, "MERIDIAN-DATA-AUDIT.md")}`);

  if (required.length && polyKey && uwKey) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
