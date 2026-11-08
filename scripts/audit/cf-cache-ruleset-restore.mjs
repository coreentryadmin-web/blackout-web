#!/usr/bin/env node
// Restores the production Cloudflare `http_request_cache_settings` ruleset
// (zone-level "Cache rules for blackouttrades.com", ruleset id
// 95d2e74be110459ea6d8f0da6729dba4) to the last known-good 8-rule
// configuration, byte-for-byte as captured from the Cloudflare Rulesets API
// at version 11 (last_updated 2026-08-09T10:52:33Z) — the newest version
// before an unexplained rapid-fire wipe on 2026-10-18 (versions 12→19,
// all within ~1.3s of each other, one rule deleted per version) left the
// ruleset with ZERO rules. See docs/audit/findings-staging/2026-11-08-cf-cache-ruleset-wiped.md.
//
// Read-only by default (prints the live vs. expected diff). Pass --apply to
// actually PUT the restore payload. Never run --apply without CF_API_TOKEN /
// CF_ZONE_ID in env (same creds the rest of this toolkit's CF calls use).
//
// This does NOT touch the `/api/market/gex-positioning` rule's disabled
// state — it stays enabled:false exactly as captured, per the standing
// "do not re-enable, it's auth-gated" instruction baked into its own
// description string.

const ZONE = process.env.CF_ZONE_ID;
const TOKEN = process.env.CF_API_TOKEN;
const RULESET_ID = "95d2e74be110459ea6d8f0da6729dba4";
const JSON_MODE = process.argv.includes("--json");
const APPLY = process.argv.includes("--apply");

// Captured verbatim from GET /zones/{zone}/rulesets/{id}/versions/11 on
// 2026-11-08, with only the server-generated id/ref/version/last_updated
// fields stripped (PUT assigns fresh ones on restore).
const EXPECTED_RULES = [
  {
    description: "Cache Next.js static assets 1 year (4xx/5xx not cached)",
    enabled: true,
    expression: '(http.request.uri.path contains "/_next/static/")',
    action: "set_cache_settings",
    action_parameters: {
      cache: true,
      edge_ttl: {
        mode: "override_origin",
        default: 31536000,
        status_code_ttl: [
          { status_code_range: { from: 400, to: 499 }, value: -1 },
          { status_code_range: { from: 500, to: 599 }, value: -1 },
        ],
      },
      browser_ttl: { mode: "override_origin", default: 31536000 },
    },
  },
  {
    description: "DISABLED — gex-positioning is auth-gated; do not edge-cache (was 60s override_origin)",
    enabled: false,
    expression: '(http.request.uri.path eq "/api/market/gex-positioning")',
    action: "set_cache_settings",
    action_parameters: { cache: false },
  },
  {
    description: "Cache market news 2 minutes at edge",
    enabled: true,
    expression: '(http.request.uri.path eq "/api/market/news")',
    action: "set_cache_settings",
    action_parameters: {
      cache: true,
      edge_ttl: { mode: "override_origin", default: 120 },
      browser_ttl: { mode: "bypass" },
    },
  },
  {
    description: "Cache regime data 30s at edge",
    enabled: true,
    expression: '(http.request.uri.path eq "/api/market/regime")',
    action: "set_cache_settings",
    action_parameters: {
      cache: true,
      edge_ttl: { mode: "override_origin", default: 30 },
      browser_ttl: { mode: "bypass" },
    },
  },
  {
    description: "Bypass cache for all other API routes",
    enabled: true,
    expression: '(http.request.uri.path wildcard "/api/*")',
    action: "set_cache_settings",
    action_parameters: { cache: false },
  },
  {
    description: "Cache marketing HTML pages (bypass auth + bots)",
    enabled: true,
    expression:
      '(http.host eq "blackouttrades.com") and ((http.request.uri.path eq "/") or (http.request.uri.path eq "/upgrade") or (starts_with(http.request.uri.path, "/learn")) or (http.request.uri.path eq "/why-blackout")) and (not http.cookie contains "__session") and (not http.user_agent contains "BlackOutiOSApp") and (not http.user_agent contains "Googlebot") and (not http.user_agent contains "Bingbot") and (not http.user_agent contains "Yandex") and (not http.user_agent contains "DuckDuckBot") and (not http.user_agent contains "Baiduspider") and (not http.user_agent contains "Twitterbot") and (not http.user_agent contains "facebookexternalhit") and (not http.user_agent contains "LinkedInBot") and (not http.user_agent contains "Slackbot") and (not http.user_agent contains "WhatsApp") and (not http.user_agent contains "Discordbot") and (not http.user_agent contains "GPTBot") and (not http.user_agent contains "ChatGPT-User") and (not http.user_agent contains "ClaudeBot") and (not http.user_agent contains "PerplexityBot") and (not http.user_agent contains "Applebot") and (not http.user_agent contains "Google-Extended") and (not http.user_agent contains "CCBot") and (not http.user_agent contains "anthropic-ai") and (not http.user_agent contains "Bytespider") and (not http.user_agent contains "cohere-ai")',
    action: "set_cache_settings",
    action_parameters: {
      cache: true,
      edge_ttl: { mode: "override_origin", default: 7200 },
      browser_ttl: { mode: "respect_origin" },
    },
  },
  {
    description: "Cache Next image optimizer (/_next/image) 1 day at edge",
    enabled: true,
    expression: '(starts_with(http.request.uri.path, "/_next/image"))',
    action: "set_cache_settings",
    action_parameters: {
      cache: true,
      edge_ttl: {
        mode: "override_origin",
        default: 86400,
        status_code_ttl: [
          { status_code_range: { from: 400, to: 499 }, value: -1 },
          { status_code_range: { from: 500, to: 599 }, value: -1 },
        ],
      },
      browser_ttl: { mode: "respect_origin" },
    },
  },
  {
    description: "Cache public static assets (icons/images/fonts/manifest/robots) 1 day at edge",
    enabled: true,
    expression:
      '(not starts_with(http.request.uri.path, "/api/")) and (not starts_with(http.request.uri.path, "/_next/")) and ((http.request.uri.path eq "/favicon.ico") or (http.request.uri.path eq "/manifest.webmanifest") or (http.request.uri.path eq "/robots.txt") or (http.request.uri.path eq "/sitemap.xml") or (starts_with(http.request.uri.path, "/icon")) or (starts_with(http.request.uri.path, "/apple-icon")) or (starts_with(http.request.uri.path, "/images/")) or (ends_with(http.request.uri.path, ".woff2")) or (ends_with(http.request.uri.path, ".woff")))',
    action: "set_cache_settings",
    action_parameters: {
      cache: true,
      edge_ttl: {
        mode: "override_origin",
        default: 86400,
        status_code_ttl: [
          { status_code_range: { from: 400, to: 499 }, value: -1 },
          { status_code_range: { from: 500, to: 599 }, value: -1 },
        ],
      },
      browser_ttl: { mode: "respect_origin" },
    },
  },
];

function log(obj) {
  if (JSON_MODE) console.log(JSON.stringify(obj));
  else console.log(typeof obj === "string" ? obj : JSON.stringify(obj, null, 2));
}

async function main() {
  if (!ZONE || !TOKEN) {
    log({ skip: true, reason: "CF_ZONE_ID / CF_API_TOKEN not set" });
    return;
  }
  const getRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${ZONE}/rulesets/${RULESET_ID}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const getJson = await getRes.json();
  const liveRules = getJson.result?.rules ?? [];
  log({
    live_rule_count: liveRules.length,
    expected_rule_count: EXPECTED_RULES.length,
    live_version: getJson.result?.version,
  });

  if (liveRules.length === EXPECTED_RULES.length) {
    log("Live rule count already matches expected — no restore needed. Re-run with no flags to re-check, or inspect manually before assuming parity.");
    return;
  }

  if (!APPLY) {
    log(`DRY RUN — live ruleset has ${liveRules.length} rule(s), expected ${EXPECTED_RULES.length}. Re-run with --apply to PUT the restore payload.`);
    return;
  }

  const putRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${ZONE}/rulesets/${RULESET_ID}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ rules: EXPECTED_RULES }),
  });
  const putJson = await putRes.json();
  log({
    status: putRes.status,
    success: putJson.success,
    errors: putJson.errors,
    new_version: putJson.result?.version,
    restored_rule_count: putJson.result?.rules?.length,
  });
}

main();
