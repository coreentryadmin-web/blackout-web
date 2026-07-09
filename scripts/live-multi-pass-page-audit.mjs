#!/usr/bin/env node
/**
 * Live multi-pass page audit — hits every app route N times, checks status/CSS/consistency.
 * Usage: node scripts/live-multi-pass-page-audit.mjs [--base=https://blackouttrades.com] [--passes=3]
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const baseArg = process.argv.find((a) => a.startsWith("--base="));
const passesArg = process.argv.find((a) => a.startsWith("--passes="));
const BASE = (baseArg ? baseArg.slice(7) : "https://blackouttrades.com").replace(/\/$/, "");
const PASSES = Math.max(1, parseInt(passesArg?.slice(9) ?? "3", 10));

const PAGES = [
  "/",
  "/sign-in",
  "/sign-up",
  "/track-record",
  "/faq",
  "/pricing",
  "/upgrade",
  "/offline",
  "/embed/track-record",
  "/learn",
  "/learn/getting-started",
  "/learn/glossary",
  "/learn/heat-maps",
  "/learn/helix-flows",
  "/learn/largo-ai",
  "/learn/night-hawk",
  "/learn/spx-slayer",
  "/dashboard",
  "/flows",
  "/heatmap",
  "/terminal",
  "/nighthawk",
  "/vector",
  "/account",
  "/admin",
  "/admin/track-record",
];

const OUT = join(process.cwd(), "audit-output");
mkdirSync(OUT, { recursive: true });

const BAD_MARKERS = [
  { re: /\bNaN\b/g, label: "NaN" },
  { re: /\[object Object\]/g, label: "[object Object]" },
  { re: /Application error/gi, label: "Application error" },
  { re: /Internal Server Error/gi, label: "Internal Server Error" },
];

function visibleHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
}

function extractCssPaths(html) {
  return [...html.matchAll(/href="(\/_next\/static\/[^"]+\.css)"/g)].map((m) => m[1]);
}

async function fetchPage(path) {
  const url = `${BASE}${path}`;
  const t0 = Date.now();
  const res = await fetch(url, {
    headers: { Accept: "text/html", "Cache-Control": "no-cache" },
    redirect: "follow",
  });
  const html = await res.text();
  const ms = Date.now() - t0;
  const cssPaths = extractCssPaths(html);
  const cssResults = [];
  for (const p of cssPaths) {
    const cr = await fetch(`${BASE}${p}`, { method: "HEAD" });
    cssResults.push({ path: p, status: cr.status, cache: cr.headers.get("cf-cache-status") });
  }
  const visible = visibleHtml(html);
  const markers = [];
  for (const { re, label } of BAD_MARKERS) {
    re.lastIndex = 0;
    if (re.test(visible)) markers.push(label);
  }
  const hasTitle = /<title[^>]*>[^<]+<\/title>/i.test(html);
  const hasNextRoot = html.includes("__next") || html.includes("id=\"__next\"");
  const unstyledHint =
    visible.includes("Skip to content") &&
    !html.includes("globals") &&
    cssPaths.length === 0;

  return {
    path,
    status: res.status,
    ms,
    finalUrl: res.url.replace(BASE, "") || path,
    cssPaths,
    cssResults,
    markers,
    hasTitle,
    hasNextRoot,
    unstyledHint,
    cfCache: res.headers.get("cf-cache-status"),
    contentLength: html.length,
  };
}

async function main() {
  console.log(`\n=== Live multi-pass page audit ===`);
  console.log(`Target: ${BASE}`);
  console.log(`Passes per page: ${PASSES}`);
  console.log(`Pages: ${PAGES.length}\n`);

  const results = [];
  const issues = [];

  for (const path of PAGES) {
    const passResults = [];
    for (let i = 1; i <= PASSES; i++) {
      try {
        const r = await fetchPage(path);
        passResults.push({ pass: i, ...r });
        process.stdout.write(
          r.status < 400 && r.cssResults.every((c) => c.status === 200) && r.markers.length === 0
            ? "."
            : "X"
        );
      } catch (e) {
        passResults.push({ pass: i, path, error: e.message });
        process.stdout.write("E");
        issues.push({ path, pass: i, error: e.message });
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    console.log(` ${path}`);

    const statuses = new Set(passResults.map((p) => p.status).filter(Boolean));
    const cssBroken = passResults.some((p) =>
      p.cssResults?.some((c) => c.status !== 200)
    );
    const inconsistent = statuses.size > 1;
    const markerHits = passResults.flatMap((p) => p.markers ?? []);
    const unstyled = passResults.some((p) => p.unstyledHint);

    if (inconsistent) issues.push({ path, type: "inconsistent-status", statuses: [...statuses] });
    if (cssBroken) {
      const bad = passResults.flatMap((p) =>
        (p.cssResults ?? []).filter((c) => c.status !== 200).map((c) => ({ pass: p.pass, ...c }))
      );
      issues.push({ path, type: "css-missing", bad });
    }
    if (markerHits.length) issues.push({ path, type: "bad-markers", markers: [...new Set(markerHits)] });
    if (unstyled) issues.push({ path, type: "unstyled-hint" });

    const avgMs = Math.round(
      passResults.filter((p) => p.ms).reduce((s, p) => s + p.ms, 0) /
        Math.max(1, passResults.filter((p) => p.ms).length)
    );

    results.push({
      path,
      passes: passResults,
      summary: {
        statuses: [...statuses],
        avgMs,
        cssCount: passResults[0]?.cssPaths?.length ?? 0,
        ok: !inconsistent && !cssBroken && markerHits.length === 0 && !unstyled,
      },
    });
  }

  const report = {
    ts: new Date().toISOString(),
    base: BASE,
    passes: PASSES,
    totalRequests: PAGES.length * PASSES,
    pages: results,
    issues,
    passCount: results.filter((r) => r.summary.ok).length,
    failCount: results.filter((r) => !r.summary.ok).length,
  };

  const outPath = join(OUT, `live-multi-pass-${Date.now()}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log(`\n--- Summary ---`);
  console.log(`Pages OK: ${report.passCount}/${PAGES.length}`);
  console.log(`Issues: ${issues.length}`);
  console.log(`Report: ${outPath}\n`);

  if (issues.length) {
    console.log("--- Issues ---");
    for (const i of issues) {
      console.log(`  ✗ ${i.path}: ${i.type ?? i.error} ${JSON.stringify(i).slice(0, 200)}`);
    }
  }

  for (const r of results) {
    const icon = r.summary.ok ? "✓" : "✗";
    console.log(
      `  ${icon} ${r.path} — HTTP ${r.summary.statuses.join("/")} avg ${r.summary.avgMs}ms css×${r.summary.cssCount}`
    );
  }

  console.log("");
  process.exit(issues.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
