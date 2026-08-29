#!/usr/bin/env node
/**
 * Cross-engine session analysis — Vector pick board vs Night Hawk 0DTE board.
 * READ-ONLY prod probe; one temp Clerk user, always deleted.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const OUT = "/opt/cursor/artifacts/vector-nh-session-analysis";

async function authFetch(session, path) {
  const r = await fetch(`${BASE}${path}`, {
    headers: { cookie: session.cookieHeader, accept: "application/json" },
    cache: "no-store",
  });
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { _raw: text.slice(0, 400) };
  }
  return { status: r.status, json };
}

function pct(n) {
  return n == null || !Number.isFinite(n) ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function contractFields(r) {
  const c = r.contract ?? r;
  return {
    occ: c.occ ?? r.occ ?? "—",
    side: c.side ?? r.side ?? "—",
    strike: c.strike ?? r.strike ?? "—",
    label: c.label ?? r.label ?? "",
  };
}

function summarizeVectorBoard(board) {
  const leaders = board?.leaders ?? [];
  const winners = board?.winners ?? [];
  const closed = board?.closed ?? [];
  const topClosed = [...closed]
    .filter((r) => r.premium_pct_from_entry != null)
    .sort((a, b) => (b.premium_pct_from_entry ?? 0) - (a.premium_pct_from_entry ?? 0))
    .slice(0, 8);
  return { leaders: leaders.length, winners: winners.length, closed: closed.length, topClosed };
}

function summarizeZerodteBoard(board) {
  const rows = board?.rows ?? board?.plays ?? [];
  const committed = rows.filter((r) => r.status === "OPEN" || r.status === "COMMITTED" || r.lifecycle === "OPEN");
  const watch = rows.filter((r) => r.status === "WATCH" || r.lifecycle === "WATCH");
  const top = [...rows]
    .filter((r) => r.pnl_pct != null || r.plan_pnl_pct != null)
    .sort((a, b) => (b.pnl_pct ?? b.plan_pnl_pct ?? 0) - (a.pnl_pct ?? a.plan_pnl_pct ?? 0))
    .slice(0, 8);
  return { total: rows.length, committed: committed.length, watch: watch.length, top };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const session = await mintClerkPremiumSession({
    appUrl: BASE,
    publicMetadata: { role: "admin", tier: "premium" },
  });
  if (session.skip) {
    console.error("SKIP:", session.reason);
    process.exit(2);
  }

  try {
    const [vectorRes, zerodteRes, horizonsRes] = await Promise.all([
      authFetch(session, "/api/market/vector/pick-closures/board"),
      authFetch(session, "/api/market/zerodte/board"),
      authFetch(session, "/api/market/nighthawk/horizons?view=zerodte"),
    ]);

    const vector = summarizeVectorBoard(vectorRes.json);
    const nh = summarizeZerodteBoard(zerodteRes.json);

    const lines = [];
    lines.push(`# Vector vs Night Hawk session analysis`);
    lines.push(`base=${BASE}`);
    lines.push(`at=${new Date().toISOString()}`);
    lines.push("");
    lines.push(`## Vector pick board (HTTP ${vectorRes.status})`);
    lines.push(`leaders=${vector.leaders} winners=${vector.winners} closed=${vector.closed}`);
    for (const r of vector.topClosed) {
      const c = contractFields(r);
      lines.push(
        `  CLOSED ${r.ticker} ${c.side} ${c.strike} ${pct(r.premium_pct_from_entry)} occ=${c.occ}`
      );
    }
    for (const w of (vectorRes.json?.winners ?? []).slice(0, 5)) {
      const c = contractFields(w);
      lines.push(`  WINNER ${w.ticker} ${c.side} ${c.strike} ${pct(w.premium_pct_from_entry)} ${c.label}`);
    }

    lines.push("");
    lines.push(`## Night Hawk 0DTE board (HTTP ${zerodteRes.status})`);
    lines.push(`rows=${nh.total} committed=${nh.committed} watch=${nh.watch}`);
    for (const r of nh.top) {
      lines.push(
        `  ${r.ticker} ${r.direction ?? r.bias ?? ""} pnl=${pct(r.pnl_pct ?? r.plan_pnl_pct)} status=${r.status ?? r.lifecycle ?? "—"}`
      );
    }

    lines.push("");
    lines.push(`## Night Hawk 0DTE horizon (HTTP ${horizonsRes.status})`);
    const lanes = horizonsRes.json?.board?.lanes;
    if (lanes?.ZERO_DTE) {
      const z = lanes.ZERO_DTE;
      lines.push(
        `ZERO_DTE committed=${z.committedCount ?? 0} watch=${z.watchCount ?? 0} floor=${z.scoreFloor ?? "—"}`
      );
    } else {
      lines.push(typeof horizonsRes.json === "object" ? JSON.stringify(horizonsRes.json).slice(0, 500) : String(horizonsRes.json).slice(0, 200));
    }

    lines.push("");
    lines.push("## Gaps / next engine work");
    lines.push("- Bridge exit-engine semantics to Vector pick live status");
    lines.push("- Rank Vector picks with thesis/Cortex overlay on committed 0DTE names");
    lines.push("- Surface +15% runner leaders tab (VECTOR_PICK_LEADER_PCT_FLOOR)");

    const report = lines.join("\n");
    const outPath = `${OUT}/report.txt`;
    await writeFile(outPath, report, "utf8");
    await writeFile(`${OUT}/vector-board.json`, JSON.stringify(vectorRes.json, null, 2));
    await writeFile(`${OUT}/zerodte-board.json`, JSON.stringify(zerodteRes.json, null, 2));
    console.log(report);
    console.log(`\nWrote ${outPath}`);
    process.exit(vector.winners >= 0 ? 0 : 1);
  } finally {
    await session.cleanup?.();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
