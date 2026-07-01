#!/usr/bin/env node
/**
 * Post-merge QQQ GEX heatmap spot-check (#198).
 * Builds a fresh matrix via fetchGexHeatmap (same path as production) and reports:
 *   - strike band vs spot (expect ~±6% default)
 *   - far monthly column strike coverage (expect >>12 non-zero / full axis)
 *   - zero-cell ratio on the matrix
 *
 * Usage: node --import tsx scripts/spot-check-qqq-gex.mjs [--prod]
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const useProd = process.argv.includes("--prod");
const APP = process.env.AUDIT_APP_URL || "https://blackouttrades.com";
const OUT = process.env.AUDIT_OUT || join(process.cwd(), "audit-output");

function thirdFridayYmd(year, month0) {
  const first = new Date(Date.UTC(year, month0, 1));
  const dow = first.getUTCDay();
  const firstFriday = 1 + ((5 - dow + 7) % 7);
  const thirdFriday = firstFriday + 14;
  const mm = String(month0 + 1).padStart(2, "0");
  const dd = String(thirdFriday).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

function farMonthlyCandidates(expiries, todayYmd) {
  const [ty, tm] = todayYmd.split("-").map(Number);
  const monthlies = new Set();
  for (let i = 0; i < 8; i++) {
    const d = new Date(Date.UTC(ty, tm - 1 + i, 1));
    monthlies.add(thirdFridayYmd(d.getUTCFullYear(), d.getUTCMonth()));
  }
  return expiries.filter((e) => monthlies.has(e) && e > todayYmd);
}

function analyzeHeatmap(hm, label) {
  if (!hm || !(hm.spot > 0) || !hm.strikes?.length) {
    return { label, ok: false, error: "empty or unavailable heatmap" };
  }
  const spot = hm.spot;
  const strikes = hm.strikes.slice().sort((a, b) => a - b);
  const minS = strikes[0];
  const maxS = strikes[strikes.length - 1];
  const bandLoPct = (spot - minS) / spot;
  const bandHiPct = (maxS - spot) / spot;
  const bandPct = Math.max(bandLoPct, bandHiPct);

  const expiries = hm.expiries ?? [];
  const cells = hm.gex?.cells ?? {};
  let totalCells = 0;
  let zeroCells = 0;
  let nonZeroCells = 0;
  for (const strike of strikes) {
    const row = cells[String(strike)] ?? {};
    for (const exp of expiries) {
      totalCells++;
      const v = row[exp];
      if (v == null || v === 0) zeroCells++;
      else nonZeroCells++;
    }
  }

  const todayEt = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const farMonthlies = farMonthlyCandidates(expiries, todayEt);
  const farColStats = farMonthlies.map((exp) => {
    let nz = 0;
    let z = 0;
    for (const strike of strikes) {
      const v = cells[String(strike)]?.[exp];
      if (v == null || v === 0) z++;
      else nz++;
    }
    return { expiry: exp, nonZero: nz, zeros: z, axisLen: strikes.length };
  });

  const bandOk = bandPct >= 0.055 && bandPct <= 0.075;
  const farOk = farColStats.every((c) => c.nonZero >= 20) || farColStats.length === 0;
  const zeroPct = totalCells ? (zeroCells / totalCells) * 100 : 0;

  return {
    label,
    ok: bandOk && farOk,
    spot: Number(spot.toFixed(2)),
    strikeCount: strikes.length,
    minStrike: minS,
    maxStrike: maxS,
    bandLoPct: Number((bandLoPct * 100).toFixed(2)),
    bandHiPct: Number((bandHiPct * 100).toFixed(2)),
    bandMaxPct: Number((bandPct * 100).toFixed(2)),
    bandOk,
    expiryCount: expiries.length,
    expiries,
    farMonthlies: farColStats,
    farOk,
    matrixCells: totalCells,
    zeroCells,
    zeroPct: Number(zeroPct.toFixed(1)),
    nonZeroCells,
    asof: hm.asof,
  };
}

async function buildLocal() {
  const { fetchGexHeatmap } = await import("../src/lib/providers/polygon-options-gex.ts");
  console.log("Building fresh QQQ heatmap locally (forceRefresh)…");
  const hm = await fetchGexHeatmap("QQQ", { forceRefresh: true });
  return analyzeHeatmap(hm, "local-build-main");
}

async function fetchProd() {
  const { execFileSync } = await import("node:child_process");
  const SECRET = process.env.CLERK_SECRET_KEY;
  const PUB = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || "";
  if (!SECRET) return { label: "production-api", ok: false, error: "no CLERK_SECRET_KEY" };

  const d = Buffer.from(PUB.replace(/^pk_(live|test)_/, ""), "base64").toString("utf8").replace(/\$$/, "");
  const FAPI = d.includes(".") ? `https://${d}` : "https://clerk.blackouttrades.com";
  const EMAIL = `qqq-spot-${Date.now()}@blackouttrades.com`;
  const TMP = `/tmp/qqq-spot-${process.pid}`;
  mkdirSync(TMP, { recursive: true });
  const JAR = `${TMP}/cookies.txt`;

  const curl = (args) =>
    execFileSync("curl", ["-sS", "--max-time", "60", ...args], { encoding: "utf8" });

  const user = JSON.parse(
    curl([
      "-X",
      "POST",
      "-H",
      `Authorization: Bearer ${SECRET}`,
      "-H",
      "Content-Type: application/json",
      "--data",
      JSON.stringify({
        email_address: [EMAIL],
        phone_number: ["+14155550199"],
        skip_password_requirement: true,
        skip_password_checks: true,
      }),
      "https://api.clerk.com/v1/users",
    ])
  );
  const uid = user.id;
  try {
    const tok = JSON.parse(
      curl([
        "-X",
        "POST",
        "-H",
        `Authorization: Bearer ${SECRET}`,
        "-H",
        "Content-Type: application/json",
        "--data",
        JSON.stringify({ user_id: uid, expires_in_seconds: 300 }),
        "https://api.clerk.com/v1/sign_in_tokens",
      ])
    );
    curl([
      "-c",
      JAR,
      "-L",
      "-o",
      "/dev/null",
      `${FAPI}/v1/client/sign_ins?__clerk_api_version=2025-04-10`,
      "-H",
      "Content-Type: application/x-www-form-urlencoded",
      "--data-urlencode",
      `strategy=ticket`,
      "--data-urlencode",
      `ticket=${tok.token}`,
    ]);
    const body = curl(["-b", JAR, `${APP}/api/market/gex-heatmap?ticker=QQQ&force=1`]);
    const json = JSON.parse(body);
    if (!json.available) return { label: "production-api", ok: false, error: "available=false", raw: json };
    return analyzeHeatmap(json, "production-api");
  } finally {
    try {
      curl([
        "-X",
        "DELETE",
        "-H",
        `Authorization: Bearer ${SECRET}`,
        `https://api.clerk.com/v1/users/${uid}`,
      ]);
    } catch {
      /* best effort */
    }
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const results = [];

  try {
    results.push(await buildLocal());
  } catch (e) {
    results.push({ label: "local-build-main", ok: false, error: String(e.message || e) });
  }

  if (useProd) {
    try {
      results.push(await fetchProd());
    } catch (e) {
      results.push({ label: "production-api", ok: false, error: String(e.message || e) });
    }
  }

  const report = { at: new Date().toISOString(), ticker: "QQQ", results };
  const outPath = join(OUT, "qqq-gex-spot-check.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log("\n=== QQQ GEX spot-check (#198 post-merge) ===\n");
  for (const r of results) {
    console.log(`--- ${r.label} ---`);
    if (r.error) {
      console.log(`  FAIL: ${r.error}`);
      continue;
    }
    console.log(`  spot: ${r.spot}  strikes: ${r.strikeCount}  expiries: ${r.expiryCount}`);
    console.log(`  band: -${r.bandLoPct}% / +${r.bandHiPct}% (max ${r.bandMaxPct}%) → ${r.bandOk ? "PASS (~±6%)" : "FAIL (expected ~6%)"}`);
    console.log(`  matrix zeros: ${r.zeroPct}% (${r.zeroCells}/${r.matrixCells})`);
    if (r.farMonthlies?.length) {
      console.log("  far monthly columns:");
      for (const c of r.farMonthlies) {
        console.log(`    ${c.expiry}: ${c.nonZero} non-zero / ${c.axisLen} axis → ${c.nonZero >= 20 ? "OK" : "SPARSE"}`);
      }
      console.log(`  far columns: ${r.farOk ? "PASS" : "FAIL"}`);
    } else {
      console.log("  far monthly columns: (none on axis today)");
    }
    console.log(`  overall: ${r.ok ? "PASS" : "FAIL"}`);
    console.log("");
  }
  console.log(`Report: ${outPath}`);

  const allOk = results.some((r) => r.ok);
  process.exit(allOk ? 0 : 1);
}

main();
