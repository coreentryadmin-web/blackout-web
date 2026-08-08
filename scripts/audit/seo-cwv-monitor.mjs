#!/usr/bin/env node
// Recurring Core Web Vitals / Lighthouse monitor against the live site, via the PageSpeed
// Insights v5 REST API (no local browser needed — this sandbox's Chromium can only reach the
// network through a manual proxy tunnel, see docs/audit/LIVE-UI-CONNECTION.md; the PSI API sidesteps
// that entirely since it's a plain HTTPS GET this environment's normal fetch already handles).
//
// Compares each URL's scores/metrics against a committed baseline
// (docs/audit/cwv-baseline.json) and flags regressions beyond a tolerance. Exits non-zero on
// any regression so it can gate a scheduled trigger the way scripts/audit/data-validator.mjs
// gates the market-open one.
//
// Usage:
//   PAGESPEED_API_KEY=... node scripts/audit/seo-cwv-monitor.mjs [--strategy=mobile|desktop] [--json] [--write-baseline]
//
// --write-baseline overwrites docs/audit/cwv-baseline.json with this run's numbers — use once,
// deliberately, after a real improvement lands and you want the new numbers to be the floor.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { extractMetrics, compare } from "./lib/cwv-regression-eval.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const BASELINE_PATH = path.join(REPO_ROOT, "docs/audit/cwv-baseline.json");

const args = process.argv.slice(2);
const flag = (name, def) => {
  const m = args.find((a) => a.startsWith(`--${name}=`));
  return m ? m.split("=")[1] : def;
};
const has = (name) => args.includes(`--${name}`);

const STRATEGY = flag("strategy", "mobile");
const JSON_OUT = has("json");
const WRITE_BASELINE = has("write-baseline");

const API_KEY = process.env.PAGESPEED_API_KEY;
if (!API_KEY) {
  console.error("PAGESPEED_API_KEY is not set (literal value required, not a ${{...}} placeholder).");
  process.exit(2);
}

// Key public pages — homepage (highest-traffic), pricing (conversion-critical), and one
// representative /learn page (the largest content surface, ~53 near-identical templates).
const URLS = [
  { name: "Homepage", path: "/" },
  { name: "Pricing", path: "/pricing" },
  { name: "Learn hub", path: "/learn" },
  { name: "Learn guide (sample)", path: "/learn/dealer-gamma-options-flow-guide" },
  { name: "Free tool: Gamma Snapshot", path: "/tools/gamma-snapshot" },
];

async function runPsi(url) {
  const params = new URLSearchParams({
    url,
    key: API_KEY,
    strategy: STRATEGY,
    category: "performance",
  });
  params.append("category", "accessibility");
  params.append("category", "best-practices");
  params.append("category", "seo");

  const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params}`);
  const json = await res.json();
  if (!res.ok) throw new Error(`PSI ${res.status} for ${url}: ${json.error?.message ?? JSON.stringify(json)}`);
  return json;
}

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return null;
  return JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
}

async function main() {
  const baseline = loadBaseline();
  const results = {};
  let anyRegression = false;

  for (const { name, path: urlPath } of URLS) {
    const url = `https://blackouttrades.com${urlPath}`;
    if (!JSON_OUT) console.log(`Auditing ${name} (${url}, ${STRATEGY})...`);
    try {
      const psi = await runPsi(url);
      const extracted = extractMetrics(psi);
      const regressions = compare(baseline?.[urlPath]?.[STRATEGY], extracted);
      results[urlPath] = { name, [STRATEGY]: extracted };
      if (!JSON_OUT) {
        const s = extracted.scores;
        console.log(
          `  perf=${s.performance} a11y=${s.accessibility} best-practices=${s["best-practices"]} seo=${s.seo}` +
            ` lcp=${extracted.metrics.lcpMs?.toFixed(0)}ms cls=${extracted.metrics.clsScore} tbt=${extracted.metrics.tbtMs?.toFixed(0)}ms`,
        );
        if (regressions.length > 0) {
          anyRegression = true;
          console.log(`  REGRESSION vs baseline:`);
          for (const r of regressions) console.log(`    - ${r}`);
        }
      } else if (regressions.length > 0) {
        anyRegression = true;
      }
    } catch (e) {
      anyRegression = true;
      results[urlPath] = { name, [STRATEGY]: { error: e.message } };
      if (!JSON_OUT) console.log(`  FAILED: ${e.message}`);
    }
  }

  if (WRITE_BASELINE) {
    const merged = { ...(baseline ?? {}) };
    for (const [urlPath, data] of Object.entries(results)) {
      merged[urlPath] = { ...(merged[urlPath] ?? {}), ...data };
    }
    writeFileSync(BASELINE_PATH, JSON.stringify(merged, null, 2) + "\n");
    if (!JSON_OUT) console.log(`\nBaseline written to ${BASELINE_PATH}`);
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({ strategy: STRATEGY, results, anyRegression }, null, 2));
  } else {
    console.log(anyRegression ? "\nRESULT: REGRESSION DETECTED" : "\nRESULT: no regression vs baseline");
  }

  process.exit(anyRegression && !WRITE_BASELINE ? 1 : 0);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
