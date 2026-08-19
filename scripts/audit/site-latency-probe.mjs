#!/usr/bin/env node
/**
 * Site-wide HTML TTFB probe — authenticated member session, all desk + marketing routes.
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
  const ms = [];
  let lastStatus = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const t0 = Date.now();
    const r = await fetch(`${BASE}${path}`, {
      headers: { Cookie: cookieHeader, "User-Agent": "BlackOutSiteLatency/1" },
      redirect: "manual",
    });
    await r.arrayBuffer();
    ms.push(Date.now() - t0);
    lastStatus = r.status;
  }
  ms.sort((a, b) => a - b);
  return {
    path,
    p50: ms[Math.floor(ms.length / 2)] ?? 0,
    max: ms[ms.length - 1] ?? 0,
    status: lastStatus,
  };
}

const session = await mintClerkPremiumSession({ appUrl: BASE });
if (session.skip) {
  console.log("SKIP:", session.reason);
  process.exit(0);
}

try {
  console.log(`=== site latency probe (${SAMPLES} samples, authenticated) ===\n`);
  const rows = [];
  for (const p of PATHS) {
    rows.push(await sample(p, session.cookieHeader));
  }
  rows.sort((a, b) => b.p50 - a.p50);
  for (const r of rows) {
    const flag = r.p50 > 5000 ? " SLOW" : r.p50 > 2000 ? " warn" : "";
    console.log(
      `${String(r.p50).padStart(6)}ms p50  ${String(r.max).padStart(6)}ms max  ${r.status}  ${r.path}${flag}`
    );
  }
  const slow = rows.filter((r) => r.p50 > 5000);
  process.exit(slow.length > 0 ? 1 : 0);
} finally {
  await session.cleanup?.();
}
