#!/usr/bin/env node
/**
 * TRUTH DIVERGENCE PROBE — does the platform tell itself the same story?
 *
 * The stress suite asks Largo questions and checks the answers. This asks a harder question:
 * when SEVERAL BlackOut surfaces each claim to know the same fact, do they agree — and does
 * Largo agree with them?
 *
 * That matters because Largo is now a synthesis layer over every desk. If Thermal's SPX spot and
 * Vector's SPX spot differ by 8 points, Largo will faithfully report whichever one its tool
 * happened to read, be internally consistent, pass every grounding check, and still hand a member
 * a level that the chart on their other monitor contradicts. No amount of answer-side validation
 * catches that. Only reading the SAME field from EVERY surface at the SAME moment does.
 *
 * Three classes of finding, each actionable and each invisible to a single-source check:
 *
 *   DIVERGENCE  — two surfaces give materially different values for one field. A real data bug.
 *   ABSENT      — a surface that should carry the field serves null/undefined. Usually a wiring
 *                 gap or a cold cache, and the reason a member sees an empty panel.
 *   UNREACHABLE — the endpoint errors or 404s. Either a dead route or a stale tool pointing at one.
 *
 * Read-only. One temp admin Clerk user, refreshed on a timer (the `__session` JWT dies at ~72s),
 * always deleted in a `finally`. Never prints secrets.
 *
 * Usage:
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *     node --import tsx scripts/audit/largo-truth-divergence.mjs [--json] [--ticker=NVDA]
 */

import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";
import { makeCookieJar } from "./lib/clerk-cookie-jar.mjs";

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const args = process.argv.slice(2);
const JSON_OUT = args.includes("--json");
const TICKER = (args.find((a) => a.startsWith("--ticker=")) || "").split("=")[1] || "NVDA";
const POLY_KEY = process.env.POLYGON_API_KEY?.trim();
const POLY_BASE = (() => {
  const raw = process.env.POLYGON_API_BASE?.trim();
  return raw && /^https?:/.test(raw) ? raw.replace(/\/$/, "") : "https://api.massive.com";
})();

/** Walk a dotted path, tolerating arrays via [n]. Returns undefined rather than throwing so a
 *  shape change shows up as ABSENT (a finding) instead of crashing the probe (not a finding). */
function dig(obj, path) {
  return path.split(".").reduce((acc, key) => {
    if (acc == null) return undefined;
    const m = /^(.*)\[(\d+)\]$/.exec(key);
    if (m) {
      const arr = m[1] ? acc[m[1]] : acc;
      return Array.isArray(arr) ? arr[Number(m[2])] : undefined;
    }
    return acc[key];
  }, obj);
}

/**
 * A FACT is one conceptual number, plus every place the platform claims to know it.
 *
 * `tolerancePct` is per-fact and deliberately tight. A price is a price — surfaces reading the
 * same instrument within the same few seconds should agree to well under a percent, and a looser
 * bound would let exactly the divergence this probe exists to find slip through as "close enough".
 * Gamma-derived levels get a slightly wider bound only because they are recomputed on different
 * expiry scopes by design; the comment on each says so.
 */
const FACTS = [
  {
    id: "spx-spot",
    label: "SPX spot",
    tolerancePct: 0.25,
    sources: [
      { name: "indices", path: "/api/market/indices", pick: (j) => dig(j, "spx.price") ?? dig(j, "indices.spx.price") ?? dig(j, "spx") },
      { name: "gex-heatmap(SPX)", path: "/api/market/gex-heatmap?ticker=SPX", pick: (j) => dig(j, "spot") ?? dig(j, "gex.spot") ?? dig(j, "underlying_price") },
      { name: "spx/desk", path: "/api/market/spx/desk", pick: (j) => dig(j, "spot") ?? dig(j, "structure.spot") ?? dig(j, "price") },
      { name: "platform/snapshot", path: "/api/market/platform/snapshot?include=spx", pick: (j) => dig(j, "spx.spot") ?? dig(j, "spx.price") },
      { name: "quote(I:SPX)", path: "/api/market/quote?ticker=I:SPX", pick: (j) => dig(j, "price") ?? dig(j, "last") },
    ],
    external: async () => {
      const j = await polyGet(`/v3/snapshot/indices?ticker.any_of=I%3ASPX`);
      return dig(j, "results[0].value") ?? dig(j, "results[0].session.close");
    },
  },
  {
    id: "spx-gamma-flip",
    label: "SPX gamma flip",
    // Wider: the flip is recomputed per expiry scope, and the desk and the heatmap deliberately
    // scope differently (see gex-cross-validation.ts). A small spread is expected; a large one is not.
    tolerancePct: 1.0,
    sources: [
      { name: "gex-positioning", path: "/api/market/gex-positioning?ticker=SPX", pick: (j) => dig(j, "gamma_flip") ?? dig(j, "flip") ?? dig(j, "zero_gamma") },
      { name: "gex-heatmap(SPX)", path: "/api/market/gex-heatmap?ticker=SPX", pick: (j) => dig(j, "gex.gamma_flip") ?? dig(j, "gamma_flip") },
      { name: "spx/desk", path: "/api/market/spx/desk", pick: (j) => dig(j, "gammaFlip") ?? dig(j, "gamma_flip") ?? dig(j, "structure.gammaFlip") },
    ],
  },
  {
    id: "spx-call-wall",
    label: "SPX call wall",
    tolerancePct: 1.0,
    sources: [
      { name: "gex-positioning", path: "/api/market/gex-positioning?ticker=SPX", pick: (j) => dig(j, "call_wall") ?? dig(j, "callWall") },
      { name: "gex-heatmap(SPX)", path: "/api/market/gex-heatmap?ticker=SPX", pick: (j) => dig(j, "gex.call_wall") ?? dig(j, "call_wall") },
      { name: "vector(SPX)", path: "/api/market/vector/full-state?ticker=SPX", pick: (j) => dig(j, "walls.callWalls[0].strike") ?? dig(j, "call_wall") },
    ],
  },
  {
    id: "ticker-spot",
    label: `${TICKER} spot`,
    tolerancePct: 0.25,
    sources: [
      { name: "quote", path: `/api/market/quote?ticker=${TICKER}`, pick: (j) => dig(j, "price") ?? dig(j, "last") },
      { name: "gex-heatmap", path: `/api/market/gex-heatmap?ticker=${TICKER}`, pick: (j) => dig(j, "spot") ?? dig(j, "underlying_price") },
      { name: "vector", path: `/api/market/vector/full-state?ticker=${TICKER}`, pick: (j) => dig(j, "spot") ?? dig(j, "price") },
      { name: "gex-positioning", path: `/api/market/gex-positioning?ticker=${TICKER}`, pick: (j) => dig(j, "spot") ?? dig(j, "underlying_price") },
    ],
    external: async () => {
      const j = await polyGet(`/v2/snapshot/locale/us/markets/stocks/tickers/${TICKER}`);
      return dig(j, "ticker.lastTrade.p") ?? dig(j, "ticker.day.c") ?? dig(j, "ticker.prevDay.c");
    },
  },
  {
    id: "vix",
    label: "VIX",
    tolerancePct: 1.0,
    sources: [
      { name: "indices", path: "/api/market/indices", pick: (j) => dig(j, "vix.price") ?? dig(j, "vix") },
      { name: "quote(I:VIX)", path: "/api/market/quote?ticker=I:VIX", pick: (j) => dig(j, "price") ?? dig(j, "last") },
      { name: "regime", path: "/api/market/regime", pick: (j) => dig(j, "vix") ?? dig(j, "regime.vix") },
    ],
    external: async () => {
      const j = await polyGet(`/v3/snapshot/indices?ticker.any_of=I%3AVIX`);
      return dig(j, "results[0].value") ?? dig(j, "results[0].session.close");
    },
  },
  {
    id: "zerodte-record",
    label: "0DTE graded win count (30d)",
    // An integer count, not a price: any disagreement at all is a real accounting divergence.
    tolerancePct: 0,
    sources: [
      { name: "zerodte/record", path: "/api/market/zerodte/record?days=30", pick: (j) => dig(j, "wins") ?? dig(j, "summary.wins") },
      { name: "nighthawk/horizons", path: "/api/market/nighthawk/horizons?view=outcomes&days=30", pick: (j) => dig(j, "zeroDte.wins") ?? dig(j, "outcomes.zeroDte.wins") },
    ],
  },
];

async function polyGet(path) {
  if (!POLY_KEY) return null;
  const sep = path.includes("?") ? "&" : "?";
  const r = await fetch(`${POLY_BASE}${path}${sep}apiKey=${POLY_KEY}`, { headers: { Accept: "application/json" } });
  return r.ok ? r.json().catch(() => null) : null;
}

async function readSource(cookie, src) {
  try {
    const r = await fetch(`${BASE}${src.path}`, { headers: { Cookie: cookie, Accept: "application/json" } });
    if (!r.ok) return { name: src.name, status: r.status, state: "UNREACHABLE", value: null };
    const j = await r.json().catch(() => null);
    const raw = src.pick(j);
    const value = typeof raw === "string" ? Number(raw) : raw;
    if (!Number.isFinite(value)) return { name: src.name, status: 200, state: "ABSENT", value: null };
    return { name: src.name, status: 200, state: "OK", value: Number(value) };
  } catch (e) {
    return { name: src.name, status: 0, state: "UNREACHABLE", value: null, error: e instanceof Error ? e.message : String(e) };
  }
}

async function main() {
  const session = await mintClerkPremiumSession({ appUrl: BASE });
  if (!session || session.skip) {
    console.error(`SKIP — could not mint a Clerk session: ${session?.reason ?? "unknown"}`);
    process.exit(2);
  }
  const jar = makeCookieJar(session);
  const out = [];

  try {
    for (const fact of FACTS) {
      const cookie = await jar.get();
      // Sequential, not parallel: the point is comparing values read at the SAME moment, and a
      // burst of concurrent requests against one origin invites rate-limiting that would show up
      // as a fake UNREACHABLE.
      const reads = [];
      for (const src of fact.sources) reads.push(await readSource(cookie, src));

      const external = fact.external ? await fact.external().catch(() => null) : null;
      const ok = reads.filter((r) => r.state === "OK");
      const values = ok.map((r) => r.value);
      const min = values.length ? Math.min(...values) : null;
      const max = values.length ? Math.max(...values) : null;
      const spreadPct = min != null && max != null && min !== 0 ? ((max - min) / Math.abs(min)) * 100 : 0;

      const findings = [];
      if (values.length >= 2 && spreadPct > fact.tolerancePct) {
        findings.push(`DIVERGENCE ${spreadPct.toFixed(3)}% across ${ok.map((r) => `${r.name}=${r.value}`).join(", ")}`);
      }
      for (const r of reads) {
        if (r.state === "ABSENT") findings.push(`ABSENT ${r.name} served 200 but no value`);
        if (r.state === "UNREACHABLE") findings.push(`UNREACHABLE ${r.name} (HTTP ${r.status})`);
      }
      if (Number.isFinite(external) && values.length) {
        const worst = values.reduce((w, v) => (Math.abs(v - external) > Math.abs(w - external) ? v : w), values[0]);
        const offPct = Math.abs((worst - external) / external) * 100;
        if (offPct > Math.max(fact.tolerancePct, 0.5)) {
          findings.push(`EXTERNAL MISMATCH worst internal ${worst} vs Polygon ${external} (${offPct.toFixed(3)}%)`);
        }
      }

      out.push({ id: fact.id, label: fact.label, tolerancePct: fact.tolerancePct, reads, external: Number.isFinite(external) ? external : null, spreadPct: Number(spreadPct.toFixed(4)), findings });
    }
  } finally {
    await session.cleanup?.().catch(() => {});
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({ base: BASE, ticker: TICKER, at: new Date().toISOString(), facts: out }, null, 2));
  } else {
    console.log(`\nTRUTH DIVERGENCE — ${BASE}  (ticker ${TICKER})`);
    console.log("=".repeat(96));
    for (const f of out) {
      console.log(`\n${f.label}   tolerance ${f.tolerancePct}%   spread ${f.spreadPct}%${f.external != null ? `   Polygon ${f.external}` : ""}`);
      for (const r of f.reads) {
        console.log(`   ${String(r.state).padEnd(12)} ${String(r.name).padEnd(22)} ${r.value ?? "—"}${r.status && r.status !== 200 ? `  HTTP ${r.status}` : ""}`);
      }
      for (const fi of f.findings) console.log(`   ⚠ ${fi}`);
      if (!f.findings.length) console.log("   ✓ consistent");
    }
    const total = out.reduce((n, f) => n + f.findings.length, 0);
    console.log("\n" + "=".repeat(96));
    console.log(`${total} finding(s) across ${out.length} facts`);
  }
  process.exit(out.some((f) => f.findings.length) ? 1 : 0);
}

main().catch((e) => {
  console.error("largo-truth-divergence failed:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
