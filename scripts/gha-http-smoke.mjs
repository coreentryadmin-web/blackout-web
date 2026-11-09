#!/usr/bin/env node
/** Minimal prod HTTP smoke for GitHub Actions (no secrets except optional CRON). */
import {
  evaluateSpxDeskSmoke,
  isTransientDeskProbeStatus,
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
  const deskAttempts = Math.max(1, Number(process.env.SPX_DESK_SMOKE_ATTEMPTS ?? 5));
  const deskIntervalMs = Number(process.env.SPX_DESK_SMOKE_INTERVAL_MS ?? 8_000);
  let status = 0;
  let body;
  let verdict = { outcome: "fail", message: "no probe" };

  for (let attempt = 1; attempt <= deskAttempts; attempt++) {
    ({ status, body } = await fetchJson("/api/market/spx/desk", deskHeaders));
    verdict = evaluateSpxDeskSmoke({ status, body });
    const retryable = verdict.outcome === "fail" && isTransientDeskProbeStatus(status);
    if (!retryable || attempt === deskAttempts) break;
    console.log(
      `  … /api/market/spx/desk → HTTP ${status} (transient; retry ${attempt}/${deskAttempts - 1} in ${deskIntervalMs / 1000}s)`
    );
    await new Promise((r) => setTimeout(r, deskIntervalMs));
  }

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
