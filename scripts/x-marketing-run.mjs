#!/usr/bin/env node
/**
 * Controlled @BlackOutTrade growth run — uses prod cron routes (quality gates included).
 *
 * Usage:
 *   node scripts/x-marketing-run.mjs dry-post     # preview tweet via prod dry-run
 *   node scripts/x-marketing-run.mjs dry-engage   # preview engagement sweep
 *   node scripts/x-marketing-run.mjs post         # live post (respects daily cap on server)
 *   node scripts/x-marketing-run.mjs engage       # live engagement sweep
 *
 * Requires CRON_SECRET (env or AWS Secrets Manager blackout-production/app/env).
 */
import { execSync } from "node:child_process";

const APP_BASE = process.env.X_AUTOPOST_APP_URL ?? "https://blackouttrades.com";

function loadSecrets() {
  if (process.env.CRON_SECRET?.trim()) return process.env;
  try {
    const raw = execSync(
      "aws secretsmanager get-secret-value --secret-id blackout-production/app/env --query SecretString --output text",
      { encoding: "utf8" },
    );
    return { ...process.env, ...JSON.parse(raw) };
  } catch {
    return process.env;
  }
}

async function hit(path) {
  const env = loadSecrets();
  const secret = env.CRON_SECRET?.trim();
  if (!secret) throw new Error("CRON_SECRET not configured");
  const url = `${APP_BASE}${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 500) };
  }
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${text.slice(0, 300)}`);
  return json;
}

const mode = process.argv[2] ?? "dry-post";

try {
  let result;
  switch (mode) {
    case "dry-post":
      result = await hit("/api/cron/x-autopost?dry=1");
      break;
    case "post":
      result = await hit("/api/cron/x-autopost");
      break;
    case "dry-engage":
      result = await hit("/api/cron/x-engage?dry=1&manual=1");
      break;
    case "engage":
      result = await hit("/api/cron/x-engage?manual=1");
      break;
    case "replies":
      result = await hit("/api/cron/x-replies?manual=1");
      break;
    case "engage-all":
      result = {
        engage: await hit("/api/cron/x-engage?manual=1"),
        replies: await hit("/api/cron/x-replies?manual=1"),
      };
      break;
    case "growth":
      result = await hit("/api/cron/x-growth?manual=1");
      break;
    case "dry-growth":
      result = await hit("/api/cron/x-growth?dry=1&manual=1");
      break;
    case "dry-replies":
      result = await hit("/api/cron/x-replies?dry=1&manual=1");
      break;
    default:
      console.error("Unknown mode:", mode);
      process.exit(1);
  }
  console.log(JSON.stringify(result, null, 2));
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
