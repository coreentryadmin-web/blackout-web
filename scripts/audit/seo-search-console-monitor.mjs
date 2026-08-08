#!/usr/bin/env node
// Recurring Search Console monitor: index-coverage sweep (every canonical URL, via URL
// Inspection) + search-performance summary (clicks/impressions/position, via searchAnalytics).
// Flags any canonical URL that is NOT indexed, and reports the query/page performance the way
// a human would check GSC by hand — but on a schedule, not a one-off audit.
//
// Auth: a GCP service-account JWT self-signed with node:crypto (no external OAuth library),
// scoped to https://www.googleapis.com/auth/webmasters.readonly — read-only, cannot modify
// Search Console settings. Same approach as scripts/seo/indexnow-ping.mjs's sibling scripts.
//
// Usage:
//   GSC_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}' node scripts/audit/seo-search-console-monitor.mjs [--json] [--skip-inspect]
//
// --skip-inspect skips the per-URL URL Inspection sweep (slow — rate-limited, ~1 req/sec) and
// only reports search-performance; use for a quick check, omit for the full weekly sweep.

import { publicSitemapEntries } from "../../src/lib/seo/sitemap-urls.ts";

const args = process.argv.slice(2);
const JSON_OUT = args.includes("--json");
const SKIP_INSPECT = args.includes("--skip-inspect");

const SITE_PROPERTY = "sc-domain:blackouttrades.com";
const SITE_URL = "https://blackouttrades.com";

const raw = process.env.GSC_SERVICE_ACCOUNT_JSON;
if (!raw) {
  console.error("GSC_SERVICE_ACCOUNT_JSON is not set (literal service-account JSON required, not a ${{...}} placeholder).");
  process.exit(2);
}
let sa;
try {
  sa = JSON.parse(raw);
} catch (e) {
  console.error(`GSC_SERVICE_ACCOUNT_JSON is not valid JSON: ${e.message}`);
  process.exit(2);
}

function b64url(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function getAccessToken(scope) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = { iss: sa.client_email, scope, aud: sa.token_uri, iat: now, exp: now + 3600 };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claim))}`;
  const { createSign } = await import("node:crypto");
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(sa.private_key).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const jwt = `${unsigned}.${signature}`;
  const res = await fetch(sa.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`token error ${res.status}: ${JSON.stringify(json)}`);
  return json.access_token;
}

async function inspectUrl(token, url) {
  const res = await fetch("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ inspectionUrl: url, siteUrl: SITE_PROPERTY }),
  });
  const json = await res.json();
  if (!res.ok) return { url, error: json.error?.message ?? JSON.stringify(json) };
  const r = json.inspectionResult?.indexStatusResult ?? {};
  return { url, verdict: r.verdict, coverageState: r.coverageState, lastCrawlTime: r.lastCrawlTime };
}

async function searchAnalytics(token, dims, days, rowLimit = 25) {
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400000);
  const fmt = (d) => d.toISOString().slice(0, 10);
  const res = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE_PROPERTY)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ startDate: fmt(start), endDate: fmt(end), dimensions: dims, rowLimit }),
    },
  );
  const json = await res.json();
  if (!res.ok) throw new Error(`searchAnalytics ${res.status}: ${JSON.stringify(json)}`);
  return json.rows ?? [];
}

async function main() {
  const token = await getAccessToken("https://www.googleapis.com/auth/webmasters.readonly");

  const canonicalPaths = publicSitemapEntries().map((e) => e.path);
  const report = { indexCoverage: [], byQuery: [], byPage: [], unindexed: [] };

  if (!SKIP_INSPECT) {
    if (!JSON_OUT) console.log(`Inspecting ${canonicalPaths.length} canonical URLs (rate-limited, ~1/sec)...\n`);
    for (const p of canonicalPaths) {
      const url = `${SITE_URL}${p}`;
      const result = await inspectUrl(token, url);
      report.indexCoverage.push(result);
      if (result.error || result.coverageState !== "Submitted and indexed") {
        report.unindexed.push(result);
        if (!JSON_OUT) console.log(`  ✗ ${p} — ${result.error ?? result.coverageState}`);
      } else if (!JSON_OUT) {
        console.log(`  ✓ ${p}`);
      }
      await new Promise((r) => setTimeout(r, 1100));
    }
  }

  report.byQuery = await searchAnalytics(token, ["query"], 28, 25);
  report.byPage = await searchAnalytics(token, ["page"], 28, 25);

  if (JSON_OUT) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`\n=== Top queries (28d) ===`);
    for (const row of report.byQuery.slice(0, 15)) {
      console.log(`  ${row.keys[0]} — impr=${row.impressions} clicks=${row.clicks} pos=${row.position.toFixed(1)}`);
    }
    console.log(`\n=== Index coverage: ${report.unindexed.length} of ${canonicalPaths.length} NOT indexed ===`);
    for (const u of report.unindexed) console.log(`  ${u.url} — ${u.error ?? u.coverageState}`);
  }

  process.exit(report.unindexed.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
