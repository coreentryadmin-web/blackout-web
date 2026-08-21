#!/usr/bin/env node
/**
 * Site-wide HTML latency probe — authenticated member session, desk + marketing routes.
 *
 * Reports TRUE TTFB (headers received) separately from total download time. The old probe
 * conflated the two via arrayBuffer(), so /vector's multi-MB SSR seed looked like "13s TTFB".
 *
 * Usage: npx tsx scripts/audit/site-latency-probe.mjs [--samples=3]
 */
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";

const BASE = (process.env.VALIDATE_BASE ?? "https://blackouttrades.com").replace(/\/$/, "");
const SAMPLES = Number(process.argv.find((a) => a.startsWith("--samples="))?.slice(10) ?? 3);

const PATHS = [
  "/",
  "/pricing",
  "/learn",
  "/sign-in",
  "/dashboard",
  "/flows",
  "/heatmap",
  "/terminal",
  "/nighthawk",
  "/vector",
  "/meridian",
  "/account",
];

async function sample(path, cookieHeader) {
  const ttfb = [];
  const total = [];
  let lastStatus = 0;
  let lastBytes = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const t0 = Date.now();
    const r = await fetch(`${BASE}${path}`, {
      headers: { Cookie: cookieHeader, "User-Agent": "BlackOutSiteLatency/2" },
      redirect: "manual",
    });
    ttfb.push(Date.now() - t0);
    const buf = await r.arrayBuffer();
    total.push(Date.now() - t0);
    lastStatus = r.status;
    lastBytes = buf.byteLength;
  }
  const p50 = (arr) => {
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)] ?? 0;
  };
  return {
    path,
    ttfbP50: p50(ttfb),
    totalP50: p50(total),
    totalMax: Math.max(...total),
    bytes: lastBytes,
    status: lastStatus,
  };
}

const session = await mintClerkPremiumSession({ appUrl: BASE });
if (session.skip) {
  console.log("SKIP:", session.reason);
  process.exit(0);
}

try {
  console.log(`=== site latency probe v2 (${SAMPLES} samples, authenticated) ===\n`);
  console.log("columns: ttfb_p50 | total_p50 | total_max | bytes | status | path\n");
  const rows = [];
  for (const p of PATHS) {
    rows.push(await sample(p, session.cookieHeader));
  }
  rows.sort((a, b) => b.totalP50 - a.totalP50);
  for (const r of rows) {
    const flag =
      r.totalP50 > 5000 ? " SLOW(total)" : r.ttfbP50 > 2000 ? " warn(ttfb)" : "";
    const kb = r.bytes > 0 ? `${Math.round(r.bytes / 1024)}KB` : "—";
    console.log(
      `${String(r.ttfbP50).padStart(5)}ms ttfb  ${String(r.totalP50).padStart(5)}ms total  ${String(r.totalMax).padStart(5)}ms max  ${kb.padStart(6)}  ${r.status}  ${r.path}${flag}`
    );
  }
  const slowTotal = rows.filter((r) => r.totalP50 > 5000);
  const slowTtfb = rows.filter((r) => r.ttfbP50 > 2000);
  if (slowTotal.length) {
    console.log(`\n${slowTotal.length} route(s) with total_p50 > 5s`);
  }
  if (slowTtfb.length) {
    console.log(`${slowTtfb.length} route(s) with ttfb_p50 > 2s`);
  }
  process.exit(slowTotal.length > 0 || slowTtfb.length > 0 ? 1 : 0);
} finally {
  await session.cleanup?.();
}
