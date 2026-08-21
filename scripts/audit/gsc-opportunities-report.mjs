#!/usr/bin/env node
/**
 * GSC opportunity report — turns the live Search Console pull into a prioritized, lever-aware
 * opportunity register the SEO lane runs each cycle. It is the reproducible engine behind
 * docs/audit/SEO-GROWTH-STRATEGY.md so "where should on-page effort go?" is answered from data,
 * never from a remembered snapshot.
 *
 * The classification (scripts/audit/lib/gsc-opportunities.mjs, unit-tested) is deliberately
 * lever-aware: page-1 zero-click queries are a CTR problem, page-2 queries are the only band where
 * on-page work has a defensible shot at page 1, and page-3+ demand is authority-limited — surfaced
 * so it is not mistaken for "no demand", but flagged as out of on-page reach. Brand/site: queries
 * are excluded from every bucket (they already rank and inflate every page's numbers).
 *
 * Reads the service account from Secrets Manager, signs the JWT in Node (Python crypto is broken
 * in-sandbox), NEVER prints key material, and skips cleanly (exit 2) without AWS creds rather than
 * fabricating an empty register.
 *
 * Run:  node scripts/audit/gsc-opportunities-report.mjs [--days=90] [--json]
 */
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import crypto from "node:crypto";
import { classifyQueryOpportunities, pageOpportunities } from "./lib/gsc-opportunities.mjs";

const SITE = "sc-domain:blackouttrades.com";
const argDays = Number((process.argv.find((a) => a.startsWith("--days=")) || "").split("=")[1]) || 90;
const asJson = process.argv.includes("--json");
const b64 = (x) => Buffer.from(x).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const iso = (ms, d = 0) => { const x = new Date(ms); x.setUTCDate(x.getUTCDate() - d); return x.toISOString().slice(0, 10); };

async function main() {
  let sa;
  try {
    const sm = new SecretsManagerClient({ region: "us-east-1" });
    sa = JSON.parse((await sm.send(new GetSecretValueCommand({ SecretId: "blackout-production/seo/gsc-service-account" }))).SecretString);
  } catch (e) {
    console.error(`SKIP: cannot read the GSC service account (${e.name}). Needs valid AWS creds; not fabricating a register.`);
    process.exit(2);
  }
  const now = Math.floor(Date.now() / 1000);
  const claim = { iss: sa.client_email, scope: "https://www.googleapis.com/auth/webmasters.readonly", aud: sa.token_uri, iat: now, exp: now + 3600 };
  const h = b64(JSON.stringify({ alg: "RS256", typ: "JWT" })), c = b64(JSON.stringify(claim));
  const signer = crypto.createSign("RSA-SHA256"); signer.update(`${h}.${c}`);
  const sig = signer.sign(sa.private_key).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const tok = await (await fetch(sa.token_uri, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${h}.${c}.${sig}` }) })).json();
  if (!tok.access_token) { console.error("TOKEN FAILED:", JSON.stringify(tok).slice(0, 200)); process.exit(1); }

  const endMs = Date.now() - 3 * 86400_000;
  const range = { startDate: iso(endMs, argDays - 1), endDate: iso(endMs, 0) };
  const base = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE)}/searchAnalytics/query`;
  const q = async (body) => (await (await fetch(base, { method: "POST", headers: { Authorization: `Bearer ${tok.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ ...range, ...body }) })).json()).rows || [];
  const [byQuery, byPage] = await Promise.all([q({ dimensions: ["query"], rowLimit: 2000 }), q({ dimensions: ["page"], rowLimit: 1000 })]);

  const opp = classifyQueryOpportunities(byQuery);
  const pages = pageOpportunities(byPage);
  const out = { range, strikingDistance: opp.strikingDistance, ctrGap: opp.ctrGap, deepDemand: opp.deepDemand, strikingPages: pages };
  if (asJson) { console.log(JSON.stringify(out, null, 2)); return; }

  const line = (r) => `    pos${r.position.toFixed(1).padStart(5)} ${String(r.impressions).padStart(4)}imp ${r.clicks}cl  ${r.keys[r.keys.length - 1]}`;
  console.log(`GSC OPPORTUNITY REPORT  ${SITE}  ${range.startDate} → ${range.endDate}`);
  console.log(`\n  STRIKING DISTANCE (page 2 — on-page work can reach page 1): ${opp.strikingDistance.length}`);
  opp.strikingDistance.slice(0, 15).forEach((r) => console.log(line(r)));
  console.log(`\n  CTR GAP (page 1, zero clicks — title/meta lever): ${opp.ctrGap.length}`);
  opp.ctrGap.slice(0, 15).forEach((r) => console.log(line(r)));
  console.log(`\n  DEEP DEMAND (page 3+ — authority-limited, NOT on-page reach): ${opp.deepDemand.length}`);
  opp.deepDemand.slice(0, 15).forEach((r) => console.log(line(r)));
  console.log(`\n  PAGES hosting striking-distance demand: ${pages.length}`);
  pages.slice(0, 15).forEach((r) => console.log(`    pos${r.position.toFixed(1).padStart(5)} ${String(r.impressions).padStart(4)}imp  ${r.keys[0].replace("https://blackouttrades.com", "")}`));
}
main().catch((e) => { console.error(e.message); process.exit(1); });
