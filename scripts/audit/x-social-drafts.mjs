#!/usr/bin/env node
/**
 * Leaf-style X post drafts — live API numbers + EVERY major desk panel screenshot.
 *
 * Captures Thermal (matrix, VEX/DEX/CHARM, all sector grids, profile, depth) +
 * Helix (tape filters, whales, 0DTE, analytics) + Vector + Largo Q&A + Meridian +
 * SPX Slayer + Night Hawk.
 *
 * Output: /opt/cursor/artifacts/x-posts/social-drafts/
 *
 * Usage:
 *   node --import tsx scripts/audit/x-social-drafts.mjs
 *   node --import tsx scripts/audit/x-social-drafts.mjs --tickers TSLA,SPX --panels all
 *   node --import tsx scripts/audit/x-social-drafts.mjs --panels thermal-grid,helix-analytics
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { fetchAuditJson, releaseAuditClerkSession } from "./lib/audit-auth-fetch.mjs";
import { mintIosPlaywrightSession } from "./lib/ios-playwright-auth.mjs";
import {
  ALL_PRODUCT_SHOTS,
  THERMAL_SHOTS,
  HELIX_SHOTS,
  captureThermalShot,
  captureHelixShot,
  captureVectorShot,
  captureLargoShot,
  captureMeridianShot,
  captureSlayerShot,
  captureNighthawkShot,
} from "./x-social-captures.mjs";

const args = process.argv.slice(2);
const opt = (k, def) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};

const BASE = "https://blackouttrades.com";
const TICKERS = opt("tickers", "TSLA,SPY,SPX").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const PANELS = opt("panels", "all");
const OUT = "/opt/cursor/artifacts/x-posts/social-drafts";
const PANELS_DIR = join(OUT, "panels");
const VIEWPORT = { width: 1920, height: 1080 };
const SCALE = 2;

mkdirSync(PANELS_DIR, { recursive: true });

function fmtNum(n) {
  if (n == null || !Number.isFinite(Number(n))) return null;
  const v = Number(n);
  if (v >= 1000) return `$${Math.round(v).toLocaleString("en-US")}`;
  return `$${v % 1 === 0 ? v : v.toFixed(2)}`;
}

function fmtPremium(n) {
  if (n == null || !Number.isFinite(Number(n))) return null;
  const abs = Math.abs(Number(n));
  if (abs >= 1e9) return `${Number(n) < 0 ? "-" : ""}$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${Number(n) < 0 ? "-" : ""}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${Number(n) < 0 ? "-" : ""}$${Math.round(abs / 1e3)}K`;
  return `${Number(n) < 0 ? "-" : ""}$${Math.round(abs)}`;
}

function pick(obj, ...keys) {
  for (const k of keys) {
    if (obj?.[k] != null) return obj[k];
  }
  return null;
}

async function loadPositioning(ticker) {
  const [posR, heatR] = await Promise.all([
    fetchAuditJson(BASE, `/api/market/gex-positioning?ticker=${encodeURIComponent(ticker)}`),
    fetchAuditJson(BASE, `/api/market/gex-heatmap?ticker=${encodeURIComponent(ticker)}`),
  ]);
  if (!posR.ok) return { ok: false, ticker, status: posR.status };
  const j = posR.json;
  const heat = heatR.ok ? heatR.json : null;
  const strikeTotals = heat?.gex?.strike_totals ?? {};
  const kingStrike =
    pick(j, "gex_king_strike", "king_strike", "gex_king") ?? pick(heat?.gex, "call_wall", "callWall");
  const kingRaw = kingStrike != null ? strikeTotals[String(kingStrike)] : null;
  return {
    ok: true,
    ticker,
    spot: pick(j, "spot", "underlying_price") ?? pick(heat, "spot"),
    flip: pick(j, "flip", "gamma_flip", "zero_gamma") ?? pick(heat?.gex, "flip"),
    call_wall: pick(j, "call_wall", "callWall") ?? pick(heat?.gex, "call_wall"),
    put_wall: pick(j, "put_wall", "putWall") ?? pick(heat?.gex, "put_wall"),
    max_pain: pick(j, "max_pain", "maxPain") ?? pick(heat, "max_pain"),
    net_gex: pick(j, "net_gex", "netGex") ?? pick(heat?.gex, "total"),
    king_strike: kingStrike,
    king_gamma:
      pick(j, "gex_king_gamma", "king_gamma") ??
      (kingRaw != null && Number.isFinite(Number(kingRaw)) ? Math.abs(Number(kingRaw)) : null),
  };
}

async function loadHelixSummary(ticker) {
  const r = await fetchAuditJson(
    BASE,
    `/api/market/flows?limit=120&ticker=${encodeURIComponent(ticker)}&since_hours=72`,
  );
  if (!r.ok) return { ok: false, ticker, status: r.status };
  const rows = Array.isArray(r.json?.flows) ? r.json.flows : [];
  const sym = ticker.toUpperCase();
  const prints = rows.filter((row) => {
    const t = String(row?.ticker ?? row?.symbol ?? "").toUpperCase();
    return t === sym || t === `${sym}W`;
  });
  const top = [...prints]
    .map((p) => ({
      premium: Number(p?.premium ?? 0),
      side: String(p?.option_type ?? p?.put_call ?? "").toUpperCase(),
      strike: p?.strike,
      expiry: p?.expiry,
      dte: p?.dte,
    }))
    .filter((p) => p.premium > 0)
    .sort((a, b) => b.premium - a.premium)
    .slice(0, 4);
  let callPrem = 0;
  let putPrem = 0;
  for (const p of prints) {
    const prem = Number(p?.premium ?? 0);
    const side = String(p?.option_type ?? p?.put_call ?? "").toUpperCase();
    if (side.includes("CALL") || side.startsWith("C")) callPrem += prem;
    else if (side.includes("PUT") || side.startsWith("P")) putPrem += prem;
  }
  const net = callPrem - putPrem;
  const tide = net > 500_000 ? "BULLISH" : net < -500_000 ? "BEARISH" : net > 0 ? "CALL-LEAN" : "PUT-LEAN";
  return { ok: true, ticker, top, callPrem, putPrem, net, tide, count: prints.length };
}

function buildThermalDecodedTweet(p) {
  if (!p?.ok) return null;
  const stats = [
    p.spot != null ? fmtNum(p.spot) : null,
    p.max_pain != null ? `max pain ${fmtNum(p.max_pain)}` : null,
    p.net_gex != null ? `net GEX ${fmtPremium(p.net_gex)}` : null,
    p.flip != null ? `γ-flip ${fmtNum(p.flip)}` : null,
    p.call_wall != null ? `call wall ${fmtNum(p.call_wall)}` : null,
    p.put_wall != null ? `put wall ${fmtNum(p.put_wall)}` : null,
  ].filter(Boolean);
  let body = `${p.ticker} dealer positioning decoded`;
  if (stats.length) body += `\n\n${stats.join(" | ")}`;
  if (p.king_strike != null) {
    const kingAmt = p.king_gamma != null ? fmtPremium(p.king_gamma) : null;
    body += kingAmt
      ? `\n\nKing node ${fmtNum(p.king_strike)?.replace("$", "")} — ${kingAmt} gamma.`
      : `\n\nKing node ${fmtNum(p.king_strike)?.replace("$", "")}.`;
  }
  body += `\n\nEvery strike × every expiry. Live.\n\n@BlackOutTrade blackouttrades.com`;
  return body.slice(0, 280);
}

function buildGridTweet(presetLabel, tickers) {
  return `${presetLabel} — dealer gamma side by side.

${tickers.join(" · ")} nearest expiry in one grid.

Stop opening six tabs to compare sector positioning.

@BlackOutTrade blackouttrades.com`.slice(0, 280);
}

function buildLensTweet(ticker, lens, p) {
  const lensName = lens.toUpperCase();
  const net =
    lens === "vex"
      ? "Net vanna"
      : lens === "dex"
        ? "Net dealer delta"
        : "Net GEX";
  const val = p?.net_gex != null ? fmtPremium(p.net_gex) : "live";
  return `Same ${ticker} book — ${lensName} lens.

${net}: ${val}. Flip + walls on the matrix.

One ticker, four dealer-greek views. Same desk.

@BlackOutTrade blackouttrades.com`.slice(0, 280);
}

function buildHelixTweet(h) {
  if (!h?.ok || h.top.length === 0) return null;
  const topSide =
    h.top.filter((x) => x.side?.includes("P")).length >= Math.ceil(h.top.length / 2) ? "puts" : "calls";
  const total = h.top.reduce((s, x) => s + x.premium, 0);
  const lines = [`$${(total / 1e6).toFixed(2)}M in ${h.ticker} ${topSide} on the tape`, ""];
  const seen = new Set();
  for (const row of h.top) {
    const typ = row.side?.includes("P") ? "P" : "C";
    const exp = row.dte === 0 ? "0DTE" : row.expiry ? String(row.expiry).slice(5, 10).replace("-", "/") : "";
    const key = `${row.premium}-${row.strike}${typ}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`${fmtPremium(row.premium)} ${row.strike}${typ}${exp ? ` ${exp}` : ""}`);
    if (lines.length >= 5) break;
  }
  if (h.tide) {
    lines.push("", `Market tide: ${h.tide} — ${fmtPremium(Math.abs(h.net))} net ${h.net < 0 ? "puts" : "calls"}`);
  }
  lines.push("", "blackouttrades.com");
  return lines.join("\n").slice(0, 280);
}

function buildHelixAnalyticsTweet() {
  return `Whale tape + net premium leaderboard + conviction prints — one HELIX desk.

Every block/sweep as it hits. Ranked by size. Filter any ticker.

This is the flow panel without a scraper.

@BlackOutTrade blackouttrades.com`.slice(0, 280);
}

function buildDepthTweet(p) {
  if (!p?.ok) return null;
  return `SPX forced dealer flow — depth ladder.

Where hedging pressure concentrates strike by strike. Same book as the matrix, different lens.

Spot ${fmtNum(p.spot) ?? "live"} · net GEX ${fmtPremium(p.net_gex) ?? "live"}

@BlackOutTrade blackouttrades.com`.slice(0, 280);
}

function buildProfileTweet(p) {
  if (!p?.ok) return null;
  return `${p.ticker} gamma profile + curve + intraday shift.

Shape of dealer positioning — not just the heatmap cells.

Flip ${p.flip != null ? fmtNum(p.flip) : "—"} · walls ${fmtNum(p.call_wall) ?? "—"} / ${fmtNum(p.put_wall) ?? "—"}

@BlackOutTrade blackouttrades.com`.slice(0, 280);
}

function buildHelixFilterTweet(shot, h) {
  const parts = [];
  if (shot.whales) parts.push("whale prints only");
  if (shot.dte0) parts.push("0DTE");
  if (shot.indicesOnly) parts.push("indices");
  if (shot.minPremium >= 1_000_000) parts.push("$1M+ floor");
  if (shot.side === "CALL") parts.push("calls only");
  const filterLine = parts.length ? parts.join(" · ") : "live tape";
  if (h?.ok && h.top.length) return buildHelixTweet(h);
  return `HELIX ${filterLine} — every block and sweep as it hits.

Filter any ticker. Rank by size. No scraper.

@BlackOutTrade blackouttrades.com`.slice(0, 280);
}

function buildLargoTweet(shot) {
  return `Ask Largo anything across the desk — flow, gamma, plays, catalysts.

"${shot.question.slice(0, 90)}${shot.question.length > 90 ? "…" : ""}"

Live numbers. One answer.

@BlackOutTrade blackouttrades.com`.slice(0, 280);
}

function buildMeridianTweet(shot) {
  const sym = shot.ticker ?? "macro";
  return `Meridian ${sym} catalyst brief — earnings positioning, expected move, history.

One timeline. Every pillar in one panel.

@BlackOutTrade blackouttrades.com`.slice(0, 280);
}

function buildVectorTweet(shot) {
  const sym = shot.ticker ?? "SPX";
  return `${sym} 0DTE structure — walls, beads, gamma flip on one chart.

Same book as Thermal. Different lens.

@BlackOutTrade blackouttrades.com`.slice(0, 280);
}

function buildSlayerTweet() {
  return `SPX Slayer — play engine + live GEX matrix in one desk.

Phase, grade, gates, and dealer gamma side by side.

@BlackOutTrade blackouttrades.com`.slice(0, 280);
}

function buildNighthawkTweet(shot) {
  const lane = shot.view === "SWING" ? "Swing horizon" : shot.view === "BANGER" ? "Banger board" : "0DTE command deck";
  return `Night Hawk ${lane} — committed plays, live marks, discovery funnel.

Whole-market 0DTE in one board.

@BlackOutTrade blackouttrades.com`.slice(0, 280);
}

function resolveProducts(panels) {
  if (panels === "all") return Object.keys(ALL_PRODUCT_SHOTS);
  return panels
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p in ALL_PRODUCT_SHOTS || p.startsWith("thermal") || p.startsWith("helix"));
}

function productsFromFlag(panels) {
  const raw = resolveProducts(panels);
  const out = new Set();
  for (const p of raw) {
    if (p === "all") {
      for (const k of Object.keys(ALL_PRODUCT_SHOTS)) out.add(k);
      continue;
    }
    if (p.startsWith("thermal")) out.add("thermal");
    else if (p.startsWith("helix")) out.add("helix");
    else if (ALL_PRODUCT_SHOTS[p]) out.add(p);
  }
  return [...out];
}

function copyForShot(product, shot, positioningCache, helixCache) {
  if (shot.id.startsWith("grid-")) {
    const labels = {
      "grid-mag7": ["Mag 7", "NVDA · AAPL · MSFT · GOOG · AMZN · META · TSLA"],
      "grid-semis": ["Semis", "NVDA · AMD · AVGO · MU · SMCI · INTC · TSM"],
      "grid-indices": ["Indices", "SPY · SPX · QQQ · IWM"],
      "grid-ai": ["AI infra", "PLTR · ORCL · ANET · VRT · ARM"],
      "grid-macro": ["Macro", "TLT · GLD · IBIT"],
      "grid-space": ["Space", "RKLB · ASTS · LUNR · BA"],
      "grid-crypto": ["Crypto", "COIN · MSTR · HOOD · MARA · RIOT"],
      "grid-energy": ["Energy", "XOM · CVX · OXY · SLB · COP"],
      "grid-financials": ["Financials", "JPM · GS · BAC · MS · V"],
      "grid-healthcare": ["Healthcare", "LLY · UNH · MRK · ABBV · GILD"],
    };
    const [title, tickers] = labels[shot.id] ?? [shot.label, ""];
    return buildGridTweet(title, tickers.split(" · "));
  }
  if (shot.id.startsWith("matrix-vex") || shot.id.startsWith("matrix-dex") || shot.id.startsWith("matrix-charm")) {
    const t = shot.ticker ?? "SPY";
    return buildLensTweet(t, shot.lens, positioningCache[t]);
  }
  if (shot.id.startsWith("matrix-gex")) {
    const t = shot.ticker ?? "SPX";
    return buildThermalDecodedTweet(positioningCache[t]);
  }
  if (shot.id === "depth-ladder-spx") return buildDepthTweet(positioningCache.SPX);
  if (shot.id === "profile-curve-spy") return buildProfileTweet(positioningCache.SPY);
  if (shot.id.startsWith("desk-analytics") || shot.id.startsWith("analytics-")) {
    return buildHelixAnalyticsTweet();
  }
  if (product === "largo") return buildLargoTweet(shot);
  if (product === "meridian") return buildMeridianTweet(shot);
  if (product === "vector") return buildVectorTweet(shot);
  if (product === "slayer") return buildSlayerTweet();
  if (product === "nighthawk") return buildNighthawkTweet(shot);
  if (shot.ticker && helixCache[shot.ticker]) {
    return buildHelixTweet(helixCache[shot.ticker]);
  }
  if (product === "helix") return buildHelixFilterTweet(shot, helixCache[shot.ticker ?? "SPX"]);
  return `@BlackOutTrade · ${shot.label} — live desk screenshot.\n\nblackouttrades.com`.slice(0, 280);
}

const CAPTURE_FN = {
  thermal: captureThermalShot,
  helix: captureHelixShot,
  vector: captureVectorShot,
  largo: captureLargoShot,
  meridian: captureMeridianShot,
  slayer: captureSlayerShot,
  nighthawk: captureNighthawkShot,
};

async function main() {
  console.log(`[x-social-drafts] panels=${PANELS} tickers=${TICKERS.join(",")}`);

  const positioningCache = {};
  for (const t of [...new Set([...TICKERS, "TSLA", "SPY", "SPX", "NVDA"])]) {
    positioningCache[t] = await loadPositioning(t);
    console.log(`data ${t}`, positioningCache[t].ok ? "ok" : positioningCache[t].status);
  }

  const helixCache = {};
  for (const t of [...new Set([...TICKERS, "TSLA", "SPX"])]) {
    helixCache[t] = await loadHelixSummary(t);
    console.log(`helix ${t}`, helixCache[t].ok ? `${helixCache[t].count} prints` : "fail");
  }

  const auth = await mintIosPlaywrightSession({ appUrl: BASE });
  if (auth.skip) throw new Error(auth.reason ?? "Clerk unavailable");

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: SCALE,
    colorScheme: "dark",
  });
  if (auth.cookies?.length) await ctx.addCookies(auth.cookies);
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("blackout:onboarding:v", "2");
    } catch {
      /* ignore */
    }
  });
  const page = await ctx.newPage();

  const captured = [];
  const products = productsFromFlag(PANELS);
  console.log(`products: ${products.join(", ")}`);

  try {
    for (const product of products) {
      const shots = ALL_PRODUCT_SHOTS[product] ?? [];
      const capture = CAPTURE_FN[product];
      if (!capture) continue;
      for (const shot of shots) {
        console.log(`\n▸ ${product} · ${shot.label}`);
        try {
          const buf = await capture(page, BASE, shot);
          const path = join(PANELS_DIR, `${shot.id}.png`);
          writeFileSync(path, buf);
          captured.push({
            tool: product,
            id: shot.id,
            label: shot.label,
            path,
            bytes: buf.length,
            text: copyForShot(product, shot, positioningCache, helixCache),
          });
          console.log(`  ✓ ${path} (${buf.length})`);
        } catch (err) {
          console.warn(`  ✗ ${shot.id}: ${err?.message ?? err}`);
        }
      }
    }
  } finally {
    await browser.close();
    await auth.cleanup();
    await releaseAuditClerkSession();
  }

  const manifest = {
    createdAt: new Date().toISOString(),
    base: BASE,
    panelsDir: PANELS_DIR,
    captured: captured.length,
    shots: captured,
  };
  writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));

  const md = [
    "# X post drafts — all desk panels",
    "",
    `Generated ${manifest.createdAt}`,
    "",
    `${captured.length} screenshots with matching copy. Attach the PNG listed under each post.`,
    "",
  ];
  for (const s of captured) {
    md.push(
      `## ${s.tool.toUpperCase()} · ${s.label}`,
      "",
      "**Copy:**",
      "",
      "```",
      s.text,
      "```",
      "",
      "**Attach:**",
      s.path,
      "",
      "---",
      "",
    );
  }
  writeFileSync(join(OUT, "POSTS.md"), md.join("\n"));

  console.log(`\nDone — ${captured.length} panels → ${OUT}/POSTS.md`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
