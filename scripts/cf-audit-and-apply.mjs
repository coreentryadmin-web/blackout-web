#!/usr/bin/env node
/**
 * Audit Cloudflare zone settings and patch static-asset cache rules so only
 * HTTP 200 is edge-cached (404/4xx/5xx → no-cache). Prevents unstyled pages
 * when ECS rolls out new hashed chunks during deploy.
 *
 * Required token permissions:
 *   Zone.Cache Rules Edit, Zone.DNS Read, Zone.Zone Settings Read, Zone.Cache Purge
 *
 * Env: CF_ZONE_ID, CF_API_TOKEN (or CLOUDFLARE_API_TOKEN + CF_AUTH_EMAIL global key)
 * Optional: PROD_ALB_DNS (terraform output), --apply, --purge
 */
import { execSync } from "node:child_process";

const ZONE = process.env.CF_ZONE_ID?.trim();
const TOKEN = process.env.CF_API_TOKEN?.trim();
const EMAIL = process.env.CF_AUTH_EMAIL?.trim() || "Coreentryadmin@gmail.com";
const GLOBAL_KEY = (
  process.env.CLOUDFLARE_API_TOKEN ||
  process.env.CLOUDFLARE_API_TOKE ||
  ""
).trim();

const APPLY = process.argv.includes("--apply");
const PURGE = process.argv.includes("--purge") || APPLY;

const PROD_ALB =
  process.env.PROD_ALB_DNS?.trim() ||
  (() => {
    try {
      const infra = new URL("../../blackout-infra/terraform", import.meta.url).pathname;
      return execSync("terraform output -raw alb_dns_name", { encoding: "utf8", cwd: infra }).trim();
    } catch {
      return null;
    }
  })();

const STATIC_EXPRS = [
  "starts_with(http.request.uri.path, \"/_next/static/\")",
  'http.request.uri.path matches "\\\\.(js|css|woff2?|ttf|eot|svg|png|jpg|jpeg|gif|webp|ico|avif)$"',
];

/** Edge TTL: cache 200 for 1y; never cache 404/4xx/5xx at edge. */
const SAFE_STATIC_EDGE_TTL = {
  mode: "override_origin",
  default: 31536000,
  status_code_ttl: [
    { status_code: 200, value: 31536000 },
    { status_code: 404, value: 0 },
    { status_code_range: { from: 400, to: 499 }, value: 0 },
    { status_code_range: { from: 500, to: 599 }, value: -1 },
  ],
};

function authHeaders() {
  if (TOKEN) return { Authorization: `Bearer ${TOKEN}` };
  if (GLOBAL_KEY && EMAIL) {
    return { "X-Auth-Email": EMAIL, "X-Auth-Key": GLOBAL_KEY };
  }
  throw new Error("Set CF_API_TOKEN or CLOUDFLARE_API_TOKEN + CF_AUTH_EMAIL");
}

async function cf(path, init = {}) {
  const url = `https://api.cloudflare.com/client/v4${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...(init.headers || {}),
    },
  });
  const json = await res.json();
  if (!json.success) {
    const msg = json.errors?.map((e) => e.message).join("; ") || JSON.stringify(json);
    throw new Error(msg);
  }
  return json;
}

function isStaticRule(rule) {
  const expr = rule.expression || "";
  return STATIC_EXPRS.some((e) => expr.includes(e.replace(/\\\\/g, "\\"))) ||
    expr.includes("/_next/static/") ||
    /\.(js|css|woff)/.test(expr);
}

function patchStaticRule(rule) {
  const ap = rule.action_parameters || {};
  const edge = ap.edge_ttl || {};
  const hasSafeTtl =
    Array.isArray(edge.status_code_ttl) &&
    edge.status_code_ttl.some((s) => s.status_code === 404 && s.value === 0);
  if (hasSafeTtl) return { rule, changed: false };

  return {
    rule: {
      ...rule,
      action_parameters: {
        ...ap,
        cache: ap.cache !== false,
        edge_ttl: SAFE_STATIC_EDGE_TTL,
        browser_ttl: ap.browser_ttl || { mode: "override_origin", default: 31536000 },
      },
    },
    changed: true,
  };
}

async function auditZone() {
  try {
    const z = await cf(`/zones/${ZONE}`);
    console.log(`\n✓ Zone: ${z.result.name} (${z.result.status}, ${z.result.plan?.name})`);
    return true;
  } catch (e) {
    console.log(`\n✗ Zone: ${e.message}`);
    return false;
  }
}

async function auditDns() {
  try {
    const j = await cf(`/zones/${ZONE}/dns_records?per_page=100`);
    const apex = j.result.find((r) => r.name === "blackouttrades.com" && r.type === "CNAME");
    const www = j.result.find((r) => r.name === "www.blackouttrades.com" && r.type === "CNAME");
    const clerk = j.result.filter((r) => r.name.includes("clerk") || r.content?.includes("clerk"));

    console.log("\n── DNS ──");
    for (const r of [apex, www].filter(Boolean)) {
      const okAlb =
        (PROD_ALB && r.content?.includes(PROD_ALB.replace(/\.$/, ""))) ||
        r.content?.includes("elb.amazonaws.com");
      const flag = okAlb ? "✓" : r.content?.includes("railway.app") ? "⚠ still Railway" : "?";
      console.log(`${flag} ${r.name} → ${r.content} (proxied=${r.proxied})`);
    }
    if (PROD_ALB) console.log(`  Expected ALB: ${PROD_ALB}`);
    for (const r of clerk) {
      const ok = !r.proxied;
      console.log(`${ok ? "✓" : "✗"} ${r.name} proxied=${r.proxied} (Clerk must be DNS-only)`);
    }
    return { apex, www };
  } catch (e) {
    console.log(`\n── DNS ──\n  ✗ ${e.message} (token needs Zone.DNS Read)`);
    return null;
  }
}

async function auditSsl() {
  console.log("\n── SSL / edge ──");
  const keys = ["ssl", "always_use_https", "min_tls_version", "tls_1_3"];
  for (const k of keys) {
    try {
      const j = await cf(`/zones/${ZONE}/settings/${k}`);
      const v = j.result?.value;
      const note =
        k === "ssl" && v === "full"
          ? " (consider strict)"
          : k === "ssl" && v === "strict"
            ? " ✓"
            : "";
      console.log(`  ${k}: ${v}${note}`);
    } catch (e) {
      console.log(`  ${k}: ✗ ${e.message}`);
    }
  }
}

async function auditCacheRules() {
  console.log("\n── Cache rules (http_request_cache_settings) ──");
  let ruleset;
  try {
    ruleset = await cf(`/zones/${ZONE}/rulesets/phases/http_request_cache_settings/entrypoint`);
  } catch (e) {
    console.log(`  ✗ Cannot read ruleset: ${e.message}`);
    return null;
  }

  const rules = ruleset.result?.rules || [];
  rules.forEach((r, i) => {
    const ttl = r.action_parameters?.edge_ttl;
    const safe404 =
      ttl?.status_code_ttl?.some((s) => s.status_code === 404 && s.value === 0) ?? false;
    console.log(
      `  ${i + 1}. [${r.enabled !== false ? "on" : "off"}] ${r.description || r.expression}`,
    );
    console.log(`     expr: ${r.expression}`);
    console.log(`     cache: ${r.action_parameters?.cache}, edge_ttl mode: ${ttl?.mode}, 404-safe: ${safe404}`);
  });
  return ruleset.result;
}

async function applyCacheFix(ruleset) {
  const rules = [...(ruleset.rules || [])];
  let anyChanged = false;
  const patched = rules.map((r) => {
    if (!isStaticRule(r)) return r;
    const { rule, changed } = patchStaticRule(r);
    if (changed) {
      anyChanged = true;
      console.log(`\n→ Patching static rule: ${r.description || r.expression}`);
    } else {
      console.log(`\n✓ Static rule already 404-safe: ${r.description || r.expression}`);
    }
    return rule;
  });

  if (!anyChanged) {
    console.log("\nNo cache rule changes needed.");
    return false;
  }

  if (!APPLY) {
    console.log("\nDry-run only. Re-run with --apply to push changes.");
    return false;
  }

  await cf(`/zones/${ZONE}/rulesets/${ruleset.id}`, {
    method: "PUT",
    body: JSON.stringify({ rules: patched }),
  });
  console.log("\n✓ Cache rules updated.");
  return true;
}

async function purgeAll() {
  if (!PURGE) return;
  await cf(`/zones/${ZONE}/purge_cache`, {
    method: "POST",
    body: JSON.stringify({ purge_everything: true }),
  });
  console.log("✓ Full cache purge requested.");
}

async function liveProbe() {
  console.log("\n── Live probes (no API) ──");
  const fake = `https://blackouttrades.com/_next/static/css/probe-${Date.now()}.css`;
  const h1 = await fetch(fake, { method: "HEAD" });
  const h2 = await fetch(fake, { method: "HEAD" });
  const c1 = h1.headers.get("cf-cache-status");
  const c2 = h2.headers.get("cf-cache-status");
  const bad = c2 === "HIT" && h2.status === 404;
  console.log(`  404 probe: first=${c1} second=${c2} status=${h2.status} ${bad ? "✗ 404 IS EDGE-CACHED" : "✓"}`);

  const home = await fetch("https://blackouttrades.com/");
  const css = [...home.body ? [] : []];
  const html = await home.text();
  const paths = [...html.matchAll(/\/_next\/static\/[^"']+\.css/g)].map((m) => m[0]);
  for (const p of [...new Set(paths)]) {
    const r = await fetch(`https://blackouttrades.com${p}`, { method: "HEAD" });
    console.log(`  ${p} → ${r.status} ${r.headers.get("cf-cache-status")}`);
  }

  const api = await fetch("https://blackouttrades.com/api/health", { method: "HEAD" });
  console.log(`  /api/health → cf-cache=${api.headers.get("cf-cache-status")} (want DYNAMIC)`);
}

async function main() {
  if (!ZONE) throw new Error("CF_ZONE_ID unset");
  console.log(`Cloudflare audit${APPLY ? " + apply" : ""} for zone ${ZONE}`);
  if (PROD_ALB) console.log(`Prod ALB: ${PROD_ALB}`);

  await auditZone();
  await auditDns();
  await auditSsl();
  const ruleset = await auditCacheRules();
  if (ruleset) await applyCacheFix(ruleset);
  await liveProbe();

  let exitCode = 0;
  try {
    await purgeAll();
  } catch (e) {
    console.log(`\nPurge skipped: ${e.message}`);
  }

  if (APPLY && !ruleset) exitCode = 1;
  console.log("\nDone.");
  process.exit(exitCode);
}

main().catch((e) => {
  console.error("\nFAILED:", e.message);
  console.error(
    "\nIf auth failed: create a CF API token with Zone.Cache Rules Edit, Zone.DNS Read, Zone Settings Read, Zone.Cache Purge.",
  );
  process.exit(1);
});
