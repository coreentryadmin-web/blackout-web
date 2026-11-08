#!/usr/bin/env node
/** Minimal prod HTTP smoke for GitHub Actions (no secrets except optional CRON). */
import { evaluateSpxDeskSmokeProbe } from "./audit/lib/gha-spx-desk-smoke-eval.mjs";

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
  const verdict = evaluateSpxDeskSmokeProbe({ status, body });
  if (verdict.outcome === "pass") {
    const spot =
      typeof body?.price === "number" && body.price > 0
        ? `SPX ${body.price}`
        : `prior_close ${body?.prior_close}`;
    console.log(`  ✓ /api/market/spx/desk → ${spot} (cron auth ok)`);
  } else if (verdict.outcome === "warn" && verdict.detail?.startsWith("route_gated_")) {
    console.warn(
      `  ⚠ /api/market/spx/desk → ${status} (route up + gated; CI CRON_SECRET does not match the deployed value — reconcile it to re-enable the authenticated price check)`
    );
  } else if (verdict.outcome === "warn" && verdict.detail === "desk_degraded_unavailable") {
    console.warn(
      `  ⚠ /api/market/spx/desk → 200 (honest unavailable desk — route + cron auth ok; upstream spot not grounded: available=false source=${body?.source ?? "?"})`
    );
  } else if (verdict.outcome === "warn") {
    console.warn(`  ⚠ /api/market/spx/desk → ${status} (${verdict.detail})`);
  } else {
    failures.push(`spx/desk → ${status} (${verdict.detail ?? "unknown"})`);
    console.log(`  ✗ /api/market/spx/desk → ${status} (${verdict.detail ?? "unknown"})`);
  }
}

if (failures.length) {
  console.error(`\nHTTP smoke FAILED (${failures.length})`);
  process.exit(1);
}
