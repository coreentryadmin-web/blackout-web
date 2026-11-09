#!/usr/bin/env node
/** Minimal prod HTTP smoke for GitHub Actions (no secrets except optional CRON). */
import {
  evaluateSpxDeskSmoke,
  shouldRetrySpxDeskProbe,
} from "./lib/gha-desk-smoke-eval.mjs";

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
  const deskHeaders = { Authorization: `Bearer ${CRON}` };
  const maxAttempts = Math.max(
    1,
    Number(process.env.SPX_DESK_SMOKE_RETRIES ?? 4) || 4
  );
  const retryDelayMs = Math.max(
    0,
    Number(process.env.SPX_DESK_SMOKE_RETRY_MS ?? 15_000) || 15_000
  );
  let status = 0;
  let body;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    ({ status, body } = await fetchJson("/api/market/spx/desk", deskHeaders));
    if (shouldRetrySpxDeskProbe(status) && attempt < maxAttempts) {
      console.warn(
        `  ↻ /api/market/spx/desk → ${status} (attempt ${attempt}/${maxAttempts}, retry in ${retryDelayMs / 1000}s)`
      );
      await new Promise((r) => setTimeout(r, retryDelayMs));
      continue;
    }
    break;
  }
  const verdict = evaluateSpxDeskSmoke({ status, body });
  if (verdict.outcome === "ok") {
    console.log(`  ✓ /api/market/spx/desk → ${verdict.message}`);
  } else if (verdict.outcome === "warn") {
    console.warn(`  ⚠ /api/market/spx/desk → ${verdict.message}`);
  } else {
    failures.push(`spx/desk: ${verdict.message}`);
    console.log(`  ✗ /api/market/spx/desk → ${verdict.message}`);
  }
}

if (failures.length) {
  console.error(`\nHTTP smoke FAILED (${failures.length})`);
  process.exit(1);
}
