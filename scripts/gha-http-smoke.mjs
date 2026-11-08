#!/usr/bin/env node
/** Minimal prod HTTP smoke for GitHub Actions (no secrets except optional CRON). */
import { spxDeskCronSmokeVerdict } from "./lib/gha-http-smoke-desk-eval.mjs";

const BASE = (process.env.CRON_TARGET_BASE_URL ?? "https://blackouttrades.com").replace(/\/$/, "");
const CRON = process.env.CRON_SECRET?.trim() ?? "";

const publicChecks = [
  { path: "/api/health", expect: 200, test: (b) => b.ok === true },
  { path: "/api/ready", expect: 200, test: (b) => b.ok === true },
  { path: "/api/market/regime", expect: 200, test: (b) => b.available === true },
  { path: "/api/public/track-record", expect: 401 },
  { path: "/api/track-record", expect: 401 },
  { path: "/api/signals/open", expect: 401 },
  { path: "/api/admin/debug-uw", expect: 401 },
  { path: "/api/engine/health", expect: 401 },
  { path: "/", expect: 200 },
];

const failures = [];

async function fetchText(path, headers = {}) {
  const res = await fetch(`${BASE}${path}`, { headers });
  return { status: res.status, text: await res.text() };
}

async function fetchJson(path, headers = {}) {
  const { status, text } = await fetchText(path, headers);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 120);
  }
  return { status, body };
}

const seoTextChecks = [
  {
    path: "/robots.txt",
    expect: 200,
    test: (text) =>
      text.includes("User-Agent: *") &&
      text.includes("Allow: /") &&
      text.includes(`Sitemap: ${BASE}/sitemap.xml`),
  },
  {
    path: "/sitemap.xml",
    expect: 200,
    test: (text) => text.includes("<urlset") && text.includes(`${BASE}/learn`),
  },
];

for (const c of publicChecks) {
  const { status, body } = await fetchJson(c.path);
  const pass = status === c.expect && (c.test ? c.test(body) : true);
  if (pass) console.log(`  ✓ ${c.path} → ${status}`);
  else {
    failures.push(`${c.path} → ${status}`);
    console.log(`  ✗ ${c.path} → ${status}`);
  }
}

for (const c of seoTextChecks) {
  const { status, text } = await fetchText(c.path);
  const pass = status === c.expect && c.test(text);
  if (pass) console.log(`  ✓ ${c.path} → ${status}`);
  else {
    failures.push(`${c.path} → ${status}`);
    console.log(`  ✗ ${c.path} → ${status}`);
  }
}

if (CRON) {
  const { status, body } = await fetchJson("/api/market/spx/desk", {
    Authorization: `Bearer ${CRON}`,
  });
  const verdict = spxDeskCronSmokeVerdict(status, body);
  if (verdict.outcome === "pass") {
    console.log(`  ✓ /api/market/spx/desk → ${verdict.detail} (cron auth ok)`);
  } else if (verdict.outcome === "warn" && verdict.code === "cron_secret_drift") {
    console.warn(
      `  ⚠ /api/market/spx/desk → ${verdict.detail} (route up + gated; CI CRON_SECRET does not match the deployed value — reconcile it to restore the authenticated price check)`
    );
  } else if (verdict.outcome === "warn" && verdict.code === "off_hours_no_spot") {
    console.warn(
      `  ⚠ /api/market/spx/desk → 200 (${verdict.detail}; route up + auth ok but no grounded spot/prior_close — typical off-hours/weekend; RTH deploys should still show price>0 or prior_close)`
    );
  } else {
    failures.push(`spx/desk → ${verdict.detail}`);
    console.log(`  ✗ /api/market/spx/desk → ${verdict.detail}`);
  }
}

if (failures.length) {
  console.error(`\nHTTP smoke FAILED (${failures.length})`);
  process.exit(1);
}
