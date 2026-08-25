#!/usr/bin/env node
/**
 * Leaf-style X post drafts — live API numbers + matching prod desk screenshots.
 * Output: /opt/cursor/artifacts/x-posts/social-drafts/
 *
 * Usage:
 *   node --import tsx scripts/audit/x-social-drafts.mjs
 *   node --import tsx scripts/audit/x-social-drafts.mjs --tickers TSLA,SPY,SPX
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { fetchAuditJson, releaseAuditClerkSession } from "./lib/audit-auth-fetch.mjs";
import { mintIosPlaywrightSession } from "./lib/ios-playwright-auth.mjs";
import { assertCapturableUrl } from "@/lib/x-intel/capture-guard";

const args = process.argv.slice(2);
const opt = (k, def) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};

const BASE = "https://blackouttrades.com";
const TICKERS = opt("tickers", "TSLA,SPY,SPX").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const OUT = "/opt/cursor/artifacts/x-posts/social-drafts";
const VIEWPORT = { width: 1920, height: 1080 };
const SCALE = 2;

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  if (!posR.ok) return { ok: false, ticker, status: posR.status, raw: posR.json };
  const j = posR.json;
  const heat = heatR.ok ? heatR.json : null;
  const strikeTotals = heat?.gex?.strike_totals ?? {};
  const kingStrike =
    pick(j, "gex_king_strike", "king_strike", "gex_king") ??
    pick(heat?.gex, "call_wall", "callWall");
  const kingRaw = kingStrike != null ? strikeTotals[String(kingStrike)] : null;
  const kingGamma =
    pick(j, "gex_king_gamma", "king_gamma") ??
    (kingRaw != null && Number.isFinite(Number(kingRaw)) ? Math.abs(Number(kingRaw)) : null);
  const flip =
    pick(j, "flip", "gamma_flip", "zero_gamma") ??
    pick(heat?.gex, "flip", "gamma_flip") ??
    pick(heat?.gex?.regime, "flip");
  return {
    ok: true,
    ticker,
    spot: pick(j, "spot", "underlying_price") ?? pick(heat, "spot"),
    flip,
    call_wall: pick(j, "call_wall", "callWall") ?? pick(heat?.gex, "call_wall", "callWall"),
    put_wall: pick(j, "put_wall", "putWall") ?? pick(heat?.gex, "put_wall", "putWall"),
    max_pain: pick(j, "max_pain", "maxPain") ?? pick(heat, "max_pain", "maxPain"),
    net_gex: pick(j, "net_gex", "netGex") ?? pick(heat?.gex, "total"),
    king_strike: kingStrike,
    king_gamma: kingGamma,
    posture: pick(j, "gamma_posture", "gamma_regime_read") ?? pick(heat?.gex?.regime, "read"),
    change_pct: pick(j, "change_pct", "changePct") ?? pick(heat, "change_pct"),
  };
}

async function loadHelixSummary(ticker) {
  const r = await fetchAuditJson(
    BASE,
    `/api/market/flows?limit=120&ticker=${encodeURIComponent(ticker)}&since_hours=72`,
  );
  if (!r.ok) return { ok: false, ticker, status: r.status };
  const rows = Array.isArray(r.json?.flows)
    ? r.json.flows
    : Array.isArray(r.json?.alerts)
      ? r.json.alerts
      : Array.isArray(r.json?.prints)
        ? r.json.prints
        : Array.isArray(r.json?.data)
          ? r.json.data
          : [];
  const sym = ticker.toUpperCase();
  const scoped = rows.filter((row) => {
    const t = String(row?.ticker ?? row?.symbol ?? row?.underlying ?? "").toUpperCase();
    return t === sym || t === `${sym}W`;
  });
  const prints = scoped.length ? scoped : rows;
  const top = [...prints]
    .map((p) => ({
      premium: Number(p?.premium ?? p?.total_premium ?? p?.notional ?? 0),
      side: String(p?.put_call ?? p?.option_type ?? p?.type ?? "").toUpperCase(),
      strike: p?.strike ?? p?.strike_price,
      expiry: p?.expiry ?? p?.expiration ?? p?.exp_date,
      dte: p?.dte ?? p?.days_to_expiry,
    }))
    .filter((p) => p.premium > 0)
    .sort((a, b) => b.premium - a.premium)
    .slice(0, 4);

  let callPrem = 0;
  let putPrem = 0;
  for (const p of prints) {
    const prem = Number(p?.premium ?? p?.total_premium ?? 0);
    const side = String(p?.put_call ?? p?.option_type ?? p?.type ?? "").toUpperCase();
    if (side.startsWith("C") || side === "CALL") callPrem += prem;
    else if (side.startsWith("P") || side === "PUT") putPrem += prem;
  }
  const net = callPrem - putPrem;
  const tide =
    net > 500_000 ? "BULLISH" : net < -500_000 ? "BEARISH" : net === 0 ? "FLAT" : net > 0 ? "CALL-LEAN" : "PUT-LEAN";

  return { ok: true, ticker, top, callPrem, putPrem, net, tide, count: prints.length };
}

function buildThermalTweet(p) {
  if (!p.ok) return null;
  const lines = [];
  lines.push(`${p.ticker} dealer positioning decoded`);
  const stats = [
    p.spot != null ? fmtNum(p.spot) : null,
    p.max_pain != null ? `max pain ${fmtNum(p.max_pain)}` : null,
    p.net_gex != null ? `net GEX ${fmtPremium(p.net_gex)}` : null,
    p.flip != null ? `γ-flip ${fmtNum(p.flip)}` : null,
    p.call_wall != null ? `call wall ${fmtNum(p.call_wall)}` : null,
    p.put_wall != null ? `put wall ${fmtNum(p.put_wall)}` : null,
  ].filter(Boolean);
  if (stats.length) lines.push("", stats.join(" | "));

  if (p.king_strike != null) {
    const kingAmt = p.king_gamma != null ? fmtPremium(p.king_gamma) : null;
    const side = p.spot != null && p.king_strike > p.spot ? "The ceiling." : "The magnet.";
    lines.push(
      "",
      kingAmt
        ? `King node ${fmtNum(p.king_strike)?.replace("$", "")} — ${kingAmt} gamma. ${side}`
        : `King node ${fmtNum(p.king_strike)?.replace("$", "")}. ${side}`,
    );
  }
  if (p.flip != null && p.spot != null) {
    const below = p.spot < p.flip;
    lines.push(
      below
        ? `Below ${fmtNum(p.flip)?.replace("$", "")} = negative gamma. Price accelerates.`
        : `Above ${fmtNum(p.flip)?.replace("$", "")} = positive gamma. Dealers dampen moves.`,
    );
  }
  lines.push("", "Every strike × every expiry. Live.", "", "@BlackOutTrade blackouttrades.com");
  return lines.join("\n").slice(0, 280);
}

function buildThermalShortTweet(p) {
  if (!p.ok) return null;
  const parts = [];
  if (p.flip != null) parts.push(`Gamma Flip ${fmtNum(p.flip)?.replace("$", "")}`);
  if (p.call_wall != null) parts.push(`Call Wall ${fmtNum(p.call_wall)?.replace("$", "")}`);
  if (p.put_wall != null && p.flip == null) parts.push(`Put Wall ${fmtNum(p.put_wall)?.replace("$", "")}`);
  if (p.net_gex != null) parts.push(`Net GEX ${fmtPremium(p.net_gex)}`);
  const hook = parts.length ? parts.join(". ") + "." : `${p.ticker} dealer gamma — live matrix.`;
  return `${hook}

Every strike × every expiration in one heatmap.

This is how you read dealer positioning without scrolling a single options chain.

@BlackOutTrade blackouttrades.com`.slice(0, 280);
}

function buildHelixTweet(h, p) {
  if (!h.ok || h.top.length === 0) return null;
  const topSide =
    h.top.filter((x) => x.side?.includes("P") || x.side === "PUT").length >= Math.ceil(h.top.length / 2)
      ? "puts"
      : "calls";
  const total = h.top.reduce((s, x) => s + x.premium, 0);
  const lines = [`$${(total / 1e6).toFixed(2)}M in ${h.ticker} ${topSide} on the tape`, ""];
  const seen = new Set();
  for (const row of h.top) {
    const typ = row.side?.includes("P") || row.side === "PUT" ? "P" : "C";
    const strike = row.strike != null ? row.strike : "?";
    const exp = row.dte === 0 ? "0DTE" : row.expiry ? String(row.expiry).slice(5, 10).replace("-", "/") : "";
    const key = `${row.premium}-${strike}${typ}-${exp}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`${fmtPremium(row.premium)} ${strike}${typ}${exp ? ` ${exp}` : ""}`);
    if (lines.length >= 5) break;
  }
  if (h.tide) {
    const netLabel = fmtPremium(Math.abs(h.net));
    lines.push("", `Market tide: ${h.tide}${netLabel ? ` — ${netLabel} net ${h.net < 0 ? "puts" : "calls"}` : ""}`);
  }
  lines.push("", "blackouttrades.com");
  return lines.join("\n").slice(0, 280);
}

async function dismissOverlays(page) {
  for (const sel of ['button:has-text("SKIP")', 'button:has-text("Got it")', '[aria-label="Close"]']) {
    try {
      const el = page.locator(sel).first();
      if ((await el.count()) > 0 && (await el.isVisible())) {
        await el.click({ timeout: 1500 });
        await sleep(400);
      }
    } catch {
      /* ignore */
    }
  }
}

async function warmThermalChain(page, sym) {
  await page.evaluate(async (t) => {
    await fetch(`/api/market/gex-heatmap?ticker=${encodeURIComponent(t)}&force=1`, {
      credentials: "include",
    });
  }, sym);
}

async function captureThermal(page, sym) {
  await page.goto(`${BASE}/heatmap`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await dismissOverlays(page);
  await page.waitForSelector(".gex-heatmap-desk", { timeout: 60_000 });
  await sleep(2000);
  await warmThermalChain(page, sym);
  const trigger = page.locator('button[aria-label*="Change ticker"]').first();
  await trigger.click();
  const search = page.locator('input[aria-label="Search any ticker"]').first();
  await search.waitFor({ state: "visible", timeout: 15_000 });
  await search.fill(sym);
  await sleep(1200);
  const option = page.locator("#ticker-listbox button").filter({ hasText: sym }).first();
  if (await option.count()) await option.click();
  else await search.press("Enter");
  await sleep(6000);
  assertCapturableUrl(page.url(), `Thermal ${sym}`);
  const panel = page.locator(".gex-heatmap-desk").first();
  await panel.waitFor({ state: "visible", timeout: 30_000 });
  return panel.screenshot({ type: "png", animations: "disabled" });
}

async function shotPanel(page, locator, maxH = 900) {
  const el = locator.first();
  await el.waitFor({ state: "visible", timeout: 30_000 });
  await el.evaluate((node) => {
    node.scrollTop = 0;
  });
  await sleep(500);
  const clip = await el.evaluate((node, h) => {
    const r = node.getBoundingClientRect();
    return {
      x: Math.max(0, r.x),
      y: Math.max(0, r.y),
      width: Math.min(r.width, 1880),
      height: Math.min(r.height, h),
    };
  }, maxH);
  assertCapturableUrl(page.url(), "helix panel clip");
  return page.screenshot({ type: "png", animations: "disabled", clip });
}

async function captureHelix(page, sym) {
  await page.goto(`${BASE}/flows`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await dismissOverlays(page);
  await sleep(3000);
  const search = page.locator("#helix-ticker-search").first();
  await search.waitFor({ state: "visible", timeout: 20_000 });
  await search.click();
  await search.fill("");
  await search.pressSequentially(sym, { delay: 50 });
  await search.press("Tab");
  await sleep(5000);
  const hide = page.getByRole("button", { name: "Hide analytics" });
  if (await hide.count()) {
    await hide.click();
    await sleep(800);
  }
  assertCapturableUrl(page.url(), `Helix ${sym}`);
  const panel = page.locator(".helix-desk-terminal, .helix-pro-desk").first();
  return shotPanel(page, panel, 860);
}

async function main() {
  console.log(`[x-social-drafts] tickers=${TICKERS.join(",")}`);
  const posts = [];

  for (const ticker of TICKERS) {
    console.log(`\n── ${ticker} ──`);
    const positioning = await loadPositioning(ticker);
    const helix = await loadHelixSummary(ticker);
    console.log("positioning", positioning.ok ? "ok" : positioning.status);
    console.log("helix", helix.ok ? `${helix.count} prints` : helix.status ?? "fail");

    posts.push({
      ticker,
      data: { positioning, helix },
      drafts: {
        thermal_long: buildThermalTweet(positioning),
        thermal_short: buildThermalShortTweet(positioning),
        helix_flow: buildHelixTweet(helix, positioning),
      },
    });
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

  try {
    for (const pack of posts) {
      const sym = pack.ticker;
      const dir = join(OUT, sym.toLowerCase());
      mkdirSync(dir, { recursive: true });

      if (pack.data.positioning.ok) {
        console.log(`  capture thermal ${sym}…`);
        const buf = await captureThermal(page, sym);
        const path = join(dir, "thermal-matrix.png");
        writeFileSync(path, buf);
        pack.attachments = pack.attachments ?? {};
        pack.attachments.thermal = path;
        console.log(`  ✓ ${path}`);
      }

      if (pack.data.helix.ok && pack.data.helix.count > 0) {
        console.log(`  capture helix ${sym}…`);
        const buf = await captureHelix(page, sym);
        const path = join(dir, "helix-flow.png");
        writeFileSync(path, buf);
        pack.attachments = pack.attachments ?? {};
        pack.attachments.helix = path;
        console.log(`  ✓ ${path}`);
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
    posts: posts.map((p) => ({
      ticker: p.ticker,
      attachments: p.attachments ?? {},
      data: p.data,
      readyPosts: [
        p.drafts.thermal_long && p.attachments?.thermal
          ? { style: "thermal-dealer-positioning", screenshot: p.attachments.thermal, text: p.drafts.thermal_long }
          : null,
        p.drafts.thermal_short && p.attachments?.thermal
          ? { style: "thermal-flip-walls", screenshot: p.attachments.thermal, text: p.drafts.thermal_short }
          : null,
        p.drafts.helix_flow && p.attachments?.helix
          ? { style: "helix-whale-tape", screenshot: p.attachments.helix, text: p.drafts.helix_flow }
          : null,
      ].filter(Boolean),
    })),
  };

  writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));

  const mdLines = ["# X post drafts — live numbers + matching screenshots", "", `Generated ${manifest.createdAt}`, ""];
  for (const p of manifest.posts) {
    for (const rp of p.readyPosts) {
      mdLines.push(`## ${p.ticker} · ${rp.style}`, "", "**Copy:**", "", "```", rp.text, "```", "", "**Attach:**", rp.screenshot, "", "---", "");
    }
  }
  writeFileSync(join(OUT, "POSTS.md"), mdLines.join("\n"));

  console.log(`\nDone → ${OUT}/POSTS.md`);
  for (const p of manifest.posts) {
    console.log(`${p.ticker}: ${p.readyPosts.length} ready post(s)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
