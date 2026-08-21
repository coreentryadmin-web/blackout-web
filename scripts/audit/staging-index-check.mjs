/**
 * staging-index-check — is decommissioned staging.blackouttrades.com still indexed by Google?
 *
 * Background: staging was fully decommissioned 2026-07-25, but its DNS record still resolves
 * (proxied through Cloudflare with no origin → HTTP 530) and Google still serves staging URLs in
 * results — dead links carrying the brand. This is an open P2 SEO finding. The removal cannot be
 * done from code (there is no staging origin to serve a redirect/410, and the GSC Removals API does
 * not exist); the durable fix is a Cloudflare-side 301 `staging.*→prod` redirect rule OR deleting
 * the staging DNS record — both require Cloudflare scope beyond the cache-rules token available here
 * (measured: the token is refused the http_request_dynamic_redirect ruleset and DNS records API).
 *
 * So this script's job is not to FIX but to give the finding a one-command truth check every cycle:
 * it queries GSC for staging pages and probes the host, then prints an OPEN/CLOSEABLE verdict so the
 * finding auto-closes the day Google finally drops staging — instead of being carried on memory.
 *
 * Absence is the close condition and is reported as such, never as a blank.
 *
 * Run: node scripts/audit/staging-index-check.mjs [--days=90] [--json]   (needs AWS creds for the
 * GSC service-account secret; exits 2 if it cannot read them rather than fabricating "clean").
 */
import crypto from "node:crypto";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { encodeSiteProperty, reportRange, jwtClaim } from "./lib/gsc-query.mjs";
import { filterStagingRows, summarizeStaging, stagingVerdict } from "./lib/staging-index-eval.mjs";

const SITE = "sc-domain:blackouttrades.com";
const SECRET_ID = "blackout-production/seo/gsc-service-account";
const HOST = "staging.blackouttrades.com";
const days = Number((process.argv.find((a) => a.startsWith("--days=")) || "").split("=")[1]) || 90;
const asJson = process.argv.includes("--json");
const b64url = (x) => Buffer.from(x).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function gscToken(sa) {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify(jwtClaim(sa.client_email, sa.token_uri, Math.floor(Date.now() / 1000))));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  const sig = signer.sign(sa.private_key).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const jwt = `${header}.${claim}.${sig}`;
  const tok = await (await fetch(sa.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  })).json();
  if (!tok.access_token) throw new Error(`token exchange failed: ${JSON.stringify(tok).slice(0, 200)}`);
  return tok.access_token;
}

async function hostResolves() {
  // Any answer at all (incl. the 530 it serves today) counts as "still resolving". A network
  // failure / NXDOMAIN is what we are waiting for before the finding can close.
  try {
    const res = await fetch(`https://${HOST}/`, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(12000) });
    return { resolves: true, status: res.status };
  } catch {
    return { resolves: false, status: null };
  }
}

async function main() {
  let sa;
  try {
    const sm = new SecretsManagerClient({ region: "us-east-1" });
    sa = JSON.parse((await sm.send(new GetSecretValueCommand({ SecretId: SECRET_ID }))).SecretString);
  } catch (e) {
    console.error(`SKIP: cannot read ${SECRET_ID} (${e.name}). Needs valid AWS creds; not fabricating a clean result.`);
    process.exit(2);
  }

  const token = await gscToken(sa);
  const range = reportRange(Date.now(), days);
  const base = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeSiteProperty(SITE)}/searchAnalytics/query`;
  const j = await (await fetch(base, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...range, dimensions: ["page"], rowLimit: 1000 }),
  })).json();

  const rows = filterStagingRows(j.rows || [], HOST).sort((a, b) => b.impressions - a.impressions);
  const totals = summarizeStaging(rows);
  const host = await hostResolves();
  const verdict = stagingVerdict({ served: totals.urls, hostResolves: host.resolves });

  if (asJson) {
    console.log(JSON.stringify({ window: range, host: { name: HOST, ...host }, totals, verdict, urls: rows.map((r) => ({ url: r.keys[0], clicks: r.clicks, impressions: r.impressions, position: r.position })) }, null, 2));
  } else {
    console.log(`STAGING INDEX CHECK  ${SITE}  ${range.startDate}..${range.endDate}`);
    console.log(`  host ${HOST}: ${host.resolves ? `resolves (HTTP ${host.status})` : "does NOT resolve"}`);
    console.log(`  Google still serves ${totals.urls} staging URL(s): ${totals.clicks} clicks, ${totals.impressions} impressions`);
    for (const r of rows) console.log(`    ${r.clicks}cl ${String(r.impressions).padStart(4)}imp pos${r.position.toFixed(1)}  ${r.keys[0]}`);
    console.log(`  VERDICT: ${verdict.status} — ${verdict.reason}`);
    if (verdict.status === "OPEN") {
      console.log(`  FIX (needs Cloudflare scope this cache-token lacks): add a Single Redirect rule on the zone,`);
      console.log(`       phase http_request_dynamic_redirect, expr (http.host eq "${HOST}"),`);
      console.log(`       action redirect 301 to concat("https://blackouttrades.com", http.request.uri.path), preserve_query_string.`);
      console.log(`       Fallback: delete the staging.* DNS record so it NXDOMAINs.`);
    }
  }
  process.exit(verdict.status === "CLOSEABLE" ? 0 : 1);
}

main().catch((e) => { console.error(e.message); process.exit(2); });
