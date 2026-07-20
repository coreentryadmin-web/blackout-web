#!/usr/bin/env node
/**
 * Production X marketing health — dry-run autopost + budget probe.
 * Usage: npm run validate:x-marketing
 */
import { execSync } from "node:child_process";

const BASE = process.env.X_AUTOPOST_APP_URL ?? "https://blackouttrades.com";

function loadSecrets() {
  if (process.env.CRON_SECRET?.trim()) return process.env;
  const raw = execSync(
    "aws secretsmanager get-secret-value --secret-id blackout-production/app/env --query SecretString --output text",
    { encoding: "utf8" },
  );
  return { ...process.env, ...JSON.parse(raw) };
}

async function hit(path, { retries = 4 } = {}) {
  const secret = loadSecrets().CRON_SECRET?.trim();
  if (!secret) throw new Error("CRON_SECRET missing");
  let last;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(`${BASE}${path}`, {
      headers: {
        Authorization: `Bearer ${secret}`,
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
      signal: AbortSignal.timeout(120_000),
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text.slice(0, 400) };
    }
    last = { status: res.status, json };
    if (res.status === 200 && json.ok !== false) return last;
    if (attempt < retries && (res.status === 404 || res.status >= 502)) {
      await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
      continue;
    }
    return last;
  }
  return last;
}

const checks = [];

async function check(name, fn) {
  try {
    await fn();
    checks.push({ name, ok: true });
    console.log(`PASS ${name}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    checks.push({ name, ok: false, msg });
    console.error(`FAIL ${name}: ${msg}`);
  }
}

await check("health", async () => {
  const res = await fetch(`${BASE}/api/health`);
  if (!res.ok) throw new Error(`health ${res.status}`);
});

await check("x-autopost-dry", async () => {
  const { status, json } = await hit("/api/cron/x-autopost?dry=1&type=desk_midday");
  if (status !== 200 || !json.ok) throw new Error(JSON.stringify(json));
  if (!json.content || typeof json.content !== "string") {
    throw new Error("missing content");
  }
  if (!json.draftBody) throw new Error("missing draftBody — human pipeline");
});

await check("x-growth-dry", async () => {
  const { status, json } = await hit("/api/cron/x-growth?dry=1");
  if (status !== 200 || !json.ok) throw new Error(JSON.stringify(json));
});

await check("x-replies-dry", async () => {
  const { status, json } = await hit("/api/cron/x-replies?dry=1");
  if (status !== 200 || !json.ok) throw new Error(JSON.stringify(json));
});

await check("x-analytics-dry", async () => {
  const { status, json } = await hit("/api/cron/x-analytics?dry=1");
  if (status !== 200 || !json.ok) throw new Error(JSON.stringify(json));
});

const failed = checks.filter((c) => !c.ok);
if (failed.length) {
  console.error(`\n${failed.length} FAIL / ${checks.length} checks`);
  process.exit(1);
}
console.log(`\nAll ${checks.length} X marketing checks PASS`);
