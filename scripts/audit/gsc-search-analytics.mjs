#!/usr/bin/env node
/**
 * GSC Search Analytics pull — the SEO lane's organic ground truth.
 *
 * WHY THIS EXISTS. Until 2026-08-21 the lane had NO impressions/clicks/CTR/position/indexed
 * data: the only credential supplied was a plain Google API key, and the Search Console API
 * rejects those ("API keys are not supported by this API. Expected OAuth2 access token …").
 * The working path is a SERVICE ACCOUNT, granted siteOwner on the property, whose JWT is
 * exchanged for an OAuth token. That account lives in Secrets Manager at
 * `blackout-production/seo/gsc-service-account`. This script is that path, committed so the
 * capability survives a container restart instead of being re-derived every cycle.
 *
 * TWO TRAPS IT ENCODES (both cost the fleet real time elsewhere):
 *   1. The property is a DOMAIN property, `sc-domain:blackouttrades.com`, encoded
 *      `sc-domain%3A…`. A wrong form returns an EMPTY result set, NOT an error — which reads
 *      as "no search data" and is indistinguishable from a real zero. encodeSiteProperty()
 *      is a named, tested function for exactly this reason.
 *   2. Python's crypto stack is broken in this sandbox, so the RS256 JWT is signed in Node.
 *
 * NEVER prints the private key or any secret material — only the search data, which is the
 * operator's own. Read-only (webmasters.readonly scope).
 *
 * Run:  node scripts/audit/gsc-search-analytics.mjs [--days=28] [--json]
 * Needs valid AWS creds (Secrets Manager read) — SKIPS cleanly, never fabricates, without them.
 */
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import crypto from "node:crypto";
import { encodeSiteProperty, reportRange, jwtClaim, brandedSplit } from "./lib/gsc-query.mjs";

const SITE = "sc-domain:blackouttrades.com";
const SECRET_ID = "blackout-production/seo/gsc-service-account";
const argDays = Number((process.argv.find((a) => a.startsWith("--days=")) || "").split("=")[1]) || 28;
const asJson = process.argv.includes("--json");

function b64url(x) {
  return Buffer.from(x).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function main() {
  let sa;
  try {
    const sm = new SecretsManagerClient({ region: "us-east-1" });
    const sec = await sm.send(new GetSecretValueCommand({ SecretId: SECRET_ID }));
    sa = JSON.parse(sec.SecretString);
  } catch (e) {
    // Absence is a finding, not a blank: say WHY there is no data rather than printing zeros.
    console.error(`SKIP: cannot read ${SECRET_ID} (${e.name}). Needs valid AWS creds; not fabricating data.`);
    process.exit(2);
  }

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify(jwtClaim(sa.client_email, sa.token_uri, now)));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  const sig = signer.sign(sa.private_key).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const jwt = `${header}.${claim}.${sig}`;

  const tokRes = await fetch(sa.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const tok = await tokRes.json();
  if (!tok.access_token) {
    console.error("TOKEN EXCHANGE FAILED:", JSON.stringify(tok).slice(0, 300));
    process.exit(1);
  }

  const range = reportRange(Date.now(), argDays);
  const base = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeSiteProperty(SITE)}/searchAnalytics/query`;
  const q = async (body) => {
    const r = await fetch(base, {
      method: "POST",
      headers: { Authorization: `Bearer ${tok.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...range, ...body }),
    });
    const json = await r.json();
    return { status: r.status, rows: json.rows || [], raw: json };
  };

  const totals = await q({});
  const byQuery = await q({ dimensions: ["query"], rowLimit: 25 });
  const byPage = await q({ dimensions: ["page"], rowLimit: 25 });
  const split = brandedSplit(byQuery.rows);
  const t = totals.rows[0];

  const out = {
    property: SITE,
    range,
    totals: t
      ? { clicks: t.clicks, impressions: t.impressions, ctrPct: +(t.ctr * 100).toFixed(2), avgPosition: +t.position.toFixed(1) }
      : null,
    brandedSplit: split,
    topQueries: byQuery.rows.map((r) => ({ q: r.keys[0], clicks: r.clicks, impressions: r.impressions, pos: +r.position.toFixed(1) })),
    topPages: byPage.rows.map((r) => ({ page: r.keys[0], clicks: r.clicks, impressions: r.impressions, pos: +r.position.toFixed(1) })),
  };

  if (asJson) {
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  console.log(`GSC ${SITE}  ${range.startDate} → ${range.endDate}`);
  console.log(out.totals
    ? `  TOTALS  clicks=${out.totals.clicks} impressions=${out.totals.impressions} ctr=${out.totals.ctrPct}% avgpos=${out.totals.avgPosition}`
    : "  TOTALS  EMPTY — check the property form (sc-domain%3A…) and that the service account is siteOwner");
  console.log(`  BRANDED     ${split.branded.clicks}cl ${split.branded.impressions}imp (${split.branded.queries} q)`);
  console.log(`  NON-BRANDED ${split.nonBranded.clicks}cl ${split.nonBranded.impressions}imp (${split.nonBranded.queries} q)`);
  console.log("  TOP PAGES:");
  out.topPages.slice(0, 12).forEach((p) => console.log(`    ${p.clicks}cl ${p.impressions}imp pos${p.pos}  ${p.page.replace("https://blackouttrades.com", "")}`));
}

main().catch((e) => { console.error(e.message); process.exit(1); });
