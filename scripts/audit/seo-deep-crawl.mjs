#!/usr/bin/env node
/**
 * Deep SEO crawl — every sitemap URL + key gated routes.
 * Fetches live HTML as Googlebot and verifies title, description, canonical,
 * OG image, JSON-LD, and noindex on public vs gated surfaces.
 *
 * Usage:
 *   node scripts/audit/seo-deep-crawl.mjs
 *   node scripts/audit/seo-deep-crawl.mjs --base=https://blackouttrades.com --json
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const JSON_OUT = args.includes("--json");
const BASE = (
  args.find((a) => a.startsWith("--base="))?.slice(7) ??
  process.env.CRON_TARGET_BASE_URL ??
  "https://blackouttrades.com"
).replace(/\/$/, "");
const UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const OUT = join(process.cwd(), "audit-output");

function curl(url, follow = false) {
  const tmp = join(OUT, ".seo-crawl.tmp.html");
  const curlArgs = ["-sS", "-A", UA, "-o", tmp, "-w", "%{http_code}", "--max-time", "45", url];
  if (follow) curlArgs.splice(1, 0, "-L");
  const code = execFileSync("curl", curlArgs, { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 }).trim();
  const html = readFileSync(tmp, "utf8");
  return { code: Number(code), html };
}

function analyze(path, html, code) {
  const row = { path, http: code };
  if (code !== 200) return { ...row, ok: false, issue: `HTTP_${code}` };
  row.title = /<title[^>]*>([^<]+)<\/title>/i.exec(html)?.[1]?.trim();
  row.desc = /name="description" content="([^"]*)"/i.exec(html)?.[1];
  row.canonical = /rel="canonical" href="([^"]*)"/i.exec(html)?.[1];
  row.noindex = /noindex/i.test(html);
  row.ogImage = /property="og:image" content="([^"]*)"/i.exec(html)?.[1];
  row.jsonLd = (html.match(/application\/ld\+json/g) || []).length;
  return row;
}

function publicIssue(row) {
  if (row.noindex) return "NOINDEX_ON_PUBLIC";
  if (!row.title) return "MISSING_TITLE";
  if (!row.desc) return "MISSING_DESCRIPTION";
  if (!row.canonical) return "MISSING_CANONICAL";
  if (!row.ogImage) return "MISSING_OG_IMAGE";
  return null;
}

async function main() {
  mkdirSync(OUT, { recursive: true });

  const { html: sitemapXml, code: smCode } = curl(`${BASE}/sitemap.xml`);
  if (smCode !== 200 || !sitemapXml.includes("<urlset")) {
    console.error(`FAIL sitemap.xml HTTP ${smCode}`);
    process.exit(1);
  }

  const paths = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(BASE, ""));
  const publicRows = [];
  const issues = [];

  for (const path of paths) {
    const bust = path.includes("?") ? "&" : "?";
    const { code, html } = curl(`${BASE}${path}${bust}_=${Date.now()}`);
    const row = analyze(path, html, code);
    publicRows.push(row);
    const issue = publicIssue(row);
    if (issue) issues.push({ path, issue });
  }

  const gatedChecks = [
    { path: "/upgrade", expectNoindex: true },
    { path: "/sign-in", expectNoindex: true },
    { path: "/dashboard", expectNoindex: true, followRedirect: true },
  ];
  const gatedRows = [];
  for (const g of gatedChecks) {
    const url = `${BASE}${g.path}`;
    const { code, html } = curl(url, g.followRedirect);
    const row = analyze(g.path, html, code);
    row.followedRedirect = g.followRedirect;
    gatedRows.push(row);
    if (g.expectNoindex && !row.noindex) {
      issues.push({ path: g.path, issue: "GATED_MISSING_NOINDEX" });
    }
    if (row.canonical === `${BASE}/` && g.path !== "/") {
      issues.push({ path: g.path, issue: "WRONG_CANONICAL_HOMEPAGE", canonical: row.canonical });
    }
  }

  const report = {
    checkedAt: new Date().toISOString(),
    base: BASE,
    publicCount: paths.length,
    issueCount: issues.length,
    issues,
    public: publicRows,
    gated: gatedRows,
  };

  writeFileSync(join(OUT, "seo-deep-crawl.json"), JSON.stringify(report, null, 2));

  if (JSON_OUT) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`\n=== SEO deep crawl ===\nTarget: ${BASE}\nPublic URLs: ${paths.length}\nIssues: ${issues.length}\n`);
    for (const i of issues) console.log(`  [FAIL] ${i.path} — ${i.issue}${i.canonical ? ` (${i.canonical})` : ""}`);
    if (issues.length === 0) console.log("  All public sitemap URLs have title, description, canonical, OG, and no noindex.");
    console.log(`\nReport: audit-output/seo-deep-crawl.json\n`);
  }

  process.exit(issues.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
