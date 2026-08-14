/**
 * Live validation: SSE wallTrailSec matches 5s (universe) / 15s (on-demand).
 *
 *   node --import tsx scripts/audit/vector-wall-trail-sec-validate.mjs \
 *     [--tickers=SPX,NVDA,META,SOFI] [--json]
 */
import { vectorUniverseTickers } from "../../src/lib/heatmap-allowlist.ts";
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const BASE = (args.find((a) => a.startsWith("--base="))?.slice(7) ?? "https://blackouttrades.com").replace(/\/$/, "");
const NON_UNIVERSE_PROBE = (args.find((a) => a.startsWith("--nonuniverse="))?.slice(14) ?? "ZZZZ")
  .split(",")
  .map((t) => t.trim().toUpperCase())
  .filter(Boolean);
const TICKERS = (args.find((a) => a.startsWith("--tickers="))?.slice(10) ?? "SPX,NVDA,META,AMD,TSLA")
  .split(",")
  .map((t) => t.trim().toUpperCase())
  .filter(Boolean);
const UNIVERSE = new Set(vectorUniverseTickers());

const findings = [];
const note = (level, msg, extra) => {
  findings.push({ level, msg, ...(extra ?? {}) });
  if (!asJson) console.log(`  [${level}] ${msg}${extra ? ` ${JSON.stringify(extra)}` : ""}`);
};

async function readSseWallTrailSec(base, cookieHeader, ticker) {
  const url = `${base}/api/market/vector/stream?ticker=${encodeURIComponent(ticker)}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 12_000);
  let last = null;
  try {
    const res = await fetch(url, { headers: { Cookie: cookieHeader, Accept: "text/event-stream" }, signal: ac.signal });
    if (!res.ok || !res.body) return { ok: false, status: res.status, wallTrailSec: null };
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (let i = 0; i < 25; i++) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() ?? "";
      for (const part of parts) {
        const line = part.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        try {
          last = JSON.parse(line.slice(6));
        } catch {
          /* skip */
        }
      }
      if (last?.wallTrailSec != null) break;
      if (last?.candle && i >= 8) break;
    }
    reader.cancel().catch(() => {});
  } catch {
    /* timeout ok if we got a frame */
  } finally {
    clearTimeout(timer);
  }
  return { ok: true, status: 200, wallTrailSec: last?.wallTrailSec ?? null, hasCandle: Boolean(last?.candle) };
}

let session;
try {
  session = await mintClerkPremiumSession({ appUrl: BASE });
  if (session.skip) throw new Error(session.reason ?? "Clerk session failed");
  if (!asJson) console.log(`\n=== wallTrailSec live probe (${BASE}) ===\n`);
  for (const t of TICKERS) {
    const expected = UNIVERSE.has(t) ? 5 : 15;
    const r = await readSseWallTrailSec(BASE, session.cookieHeader, t);
    if (!r.ok || r.wallTrailSec == null) {
      note("FAIL", `${t}: no wallTrailSec on SSE (http ${r.status})`, { expected });
      continue;
    }
    const ok = r.wallTrailSec === expected;
    note(ok ? "PASS" : "FAIL", `${t}: wallTrailSec=${r.wallTrailSec} (expected ${expected})`, {
      expected,
      got: r.wallTrailSec,
      membership: UNIVERSE.has(t) ? "static-universe" : "on-demand-or-dynamic",
    });
  }
  for (const t of NON_UNIVERSE_PROBE) {
    if (UNIVERSE.has(t)) continue;
    const r = await readSseWallTrailSec(BASE, session.cookieHeader, t);
    if (!r.ok || r.wallTrailSec == null) {
      note("WARN", `${t}: no wallTrailSec (http ${r.status}) — may lack chain`);
      continue;
    }
    const ok = r.wallTrailSec === 15;
    note(
      ok ? "PASS" : "WARN",
      `${t}: wallTrailSec=${r.wallTrailSec} (expect 15 unless dynamic-universe member)`,
      { got: r.wallTrailSec }
    );
  }
} finally {
  await session?.cleanup?.();
}

const fails = findings.filter((f) => f.level === "FAIL").length;
const verdict = fails === 0 ? "ALL wallTrailSec CORRECT" : `${fails} TICKER(S) WRONG`;
if (asJson) console.log(JSON.stringify({ verdict, fails, findings }, null, 2));
else console.log(`\n${verdict}\n`);
process.exit(fails > 0 ? 1 : 0);
