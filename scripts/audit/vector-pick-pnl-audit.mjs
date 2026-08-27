/**
 * Vector contract-pick PnL cross-check — live prod, many tickers (universe + dynamic).
 *
 * For each ticker: build a play snapshot from real endpoints, rank contract picks,
 * fetch live quotes, and verify premiumPctFromEntry against an independent mid-based
 * recomputation (pinnedLivePnlPct / resolveVectorPickLiveMid).
 *
 * Run: node --import tsx scripts/audit/vector-pick-pnl-audit.mjs [--json]
 * READ-ONLY. One temp Clerk user, deleted in finally.
 */
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";
import { buildVectorPlay } from "../../src/features/vector/lib/vector-play-engine.ts";
import { deriveVectorRegime } from "../../src/features/vector/lib/vector-regime.ts";
import { deriveGammaMagnet } from "../../src/features/vector/lib/vector-gamma-magnet.ts";
import { deriveWallProximity } from "../../src/features/vector/lib/vector-wall-proximity.ts";
import { pinnedLivePnlPct } from "../../src/lib/zerodte/marks-math.ts";
import { resolveVectorPickLiveMid } from "../../src/features/vector/lib/vector-pick-live-status.ts";

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const TICKERS = (
  process.env.AUDIT_TICKERS ||
  "SPY,QQQ,NVDA,TSLA,AAPL,AMD,META,PLTR,SOFI,IONQ,CRM,PATH,RKLB,HOOD,COIN"
).split(",");
const JSON_OUT = process.argv.includes("--json");

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

let session = null;
async function ensureSession() {
  if (session) return session;
  session = await mintClerkPremiumSession({ appUrl: BASE });
  if (session.skip) throw new Error("Clerk session unavailable");
  return session;
}

async function fetchJson(path, init) {
  const s = await ensureSession();
  const r = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Cookie: s.cookieHeader,
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (r.status === 401) {
    await session.cleanup?.();
    session = null;
    const s2 = await ensureSession();
    const r2 = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        Cookie: s2.cookieHeader,
        Accept: "application/json",
        ...(init?.headers ?? {}),
      },
    });
    if (!r2.ok) return { ok: false, status: r2.status, body: await r2.json().catch(() => ({})) };
    return { ok: true, body: await r2.json() };
  }
  if (!r.ok) return { ok: false, status: r.status, body: await r.json().catch(() => ({})) };
  return { ok: true, body: await r.json() };
}

async function json(path) {
  const res = await fetchJson(path);
  return res.ok ? res.body : null;
}

async function snapshotFor(ticker) {
  const t = encodeURIComponent(ticker);
  const horizon = "monthly";
  const [walls, ladder] = await Promise.all([
    json(`/api/market/vector/walls?ticker=${t}&dte=${horizon}`),
    json(`/api/market/vector/gex-ladder?ticker=${t}&dte=${horizon}`),
  ]);
  const spot = num(ladder?.spot ?? walls?.spot);
  if (spot == null) return null;
  const gexWalls = walls?.walls ?? walls?.gexWalls ?? null;
  const gammaFlip = num(walls?.flip ?? walls?.gammaFlip);
  const callWall = num(gexWalls?.callWalls?.[0]?.strike);
  const putWall = num(gexWalls?.putWalls?.[0]?.strike);
  const regime = deriveVectorRegime({
    spot,
    gammaFlip,
    topCallWall: callWall,
    topPutWall: putWall,
  });
  const play = buildVectorPlay({
    spot,
    gammaFlip,
    gexWalls,
    regime,
    magnet: deriveGammaMagnet({ spot, walls: gexWalls, posture: regime?.posture }),
    proximity: deriveWallProximity({ spot, walls: gexWalls, gammaFlip }),
    dataAgeMs: 0,
    timeframeMin: 15,
  });
  return { ticker, spot, callWall, putWall, gammaFlip, play, playEmit: play ? { play, spot, callWall, putWall, gammaFlip } : null };
}

async function auditTicker(ticker) {
  const snap = await snapshotFor(ticker);
  if (!snap?.playEmit?.play || snap.playEmit.play.bias === "neutral") {
    return { ticker, verdict: "SKIP", detail: "no directional play" };
  }
  const picksRes = await fetchJson("/api/market/vector/contract-picks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ticker,
      play: snap.playEmit.play,
      spot: snap.spot,
      callWall: snap.callWall,
      putWall: snap.putWall,
      gammaFlip: snap.gammaFlip,
      flows: [],
    }),
  });
  if (!picksRes.ok) return { ticker, verdict: "RED", detail: `contract-picks HTTP ${picksRes.status}` };
  const picks = (picksRes.body.picks ?? []).filter((p) => p.occ);
  if (!picks.length) return { ticker, verdict: "AMBER", detail: "play ok, zero ranked picks" };

  const liveRes = await fetchJson("/api/market/vector/contract-picks/live", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ticker,
      spot: snap.spot,
      play: snap.playEmit.play,
      callWall: snap.callWall,
      putWall: snap.putWall,
      gammaFlip: snap.gammaFlip,
      picks: picks.map((p) => ({
        occ: p.occ,
        side: p.side,
        strike: p.strike,
        expiry: p.expiry,
        entryMid: p.entryMid ?? p.premium,
        caveat: p.caveat,
      })),
    }),
  });
  if (!liveRes.ok) return { ticker, verdict: "RED", detail: `live HTTP ${liveRes.status}` };

  const mismatches = [];
  for (const row of liveRes.body.live ?? []) {
    const pick = picks.find((p) => p.occ === row.occ);
    if (!pick) continue;
    const entryMid = pick.entryMid ?? pick.premium;
    const recomputedMid = resolveVectorPickLiveMid({ bid: row.bid, ask: row.ask, mark: row.mid });
    const expected = pinnedLivePnlPct(entryMid, recomputedMid ?? row.mid);
    const got = row.premiumPctFromEntry;
    if (expected != null && got != null && Math.abs(expected - got) > 0.02) {
      mismatches.push({
        occ: row.occ,
        entryMid,
        bid: row.bid,
        ask: row.ask,
        mid: row.mid,
        expected,
        got,
      });
    }
  }

  if (mismatches.length) {
    return { ticker, verdict: "RED", detail: `${mismatches.length} PnL mismatch(es)`, mismatches };
  }
  return { ticker, verdict: "GREEN", picks: picks.length, detail: `${picks.length} pick(s), PnL agrees` };
}

async function main() {
  const results = [];
  try {
    for (const ticker of TICKERS) {
      results.push(await auditTicker(ticker.trim().toUpperCase()));
    }
  } finally {
    await session?.cleanup?.();
  }

  const red = results.filter((r) => r.verdict === "RED");
  const summary = {
    tickers: TICKERS.length,
    green: results.filter((r) => r.verdict === "GREEN").length,
    amber: results.filter((r) => r.verdict === "AMBER").length,
    skip: results.filter((r) => r.verdict === "SKIP").length,
    red: red.length,
    results,
  };

  if (JSON_OUT) console.log(JSON.stringify(summary, null, 2));
  else {
    for (const r of results) console.log(`${r.verdict.padEnd(5)} ${r.ticker} — ${r.detail}`);
    console.log(`\nred=${red.length} green=${summary.green} amber=${summary.amber} skip=${summary.skip}`);
  }
  process.exit(red.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
