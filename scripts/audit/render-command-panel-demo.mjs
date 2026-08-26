#!/usr/bin/env node
/** SSR-render 0DTE command single-panel + inject into live Night Hawk shell for screenshot. */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "playwright";
import { mintIosPlaywrightSession } from "./lib/ios-playwright-auth.mjs";

(globalThis).React = React;

const BASE = process.env.VALIDATE_BASE || "https://blackouttrades.com";
const OUT = process.env.OUT || "/opt/cursor/artifacts/nighthawk-command-panel";

const THESIS = {
  thesis: {
    ticker: "NVDA",
    direction: "long",
    rail_scores: { FLOW: 78, BREAKOUT: 72 },
    rails_fired: ["FLOW", "BREAKOUT"],
    systems_aligned: 2,
    trade_archetype: "BREAKOUT",
    archetype_score: 82,
    structural_state: "TRIGGERED",
    trigger_price: 875,
    summaries: { FLOW: "campaign", BREAKOUT: "TRIGGERED" },
    disagreeing_rails: [],
  },
  archetype_gates: { verdict: "PASS", archetype: "BREAKOUT", blocks: [], notes: [] },
  expression: null,
  rank_tier: "A",
  desk_evidence: [
    { desk: "HELIX", status: "aligned", text: "$2.1M tape · call-side bias" },
    { desk: "THERMAL", status: "aligned", text: "long-gamma · above call wall" },
    { desk: "VECTOR", status: "aligned", text: "TRIGGERED · RVOL 2.4×" },
    { desk: "NIGHTHAWK", status: "aligned", text: "tier A · 4/5 gates" },
    { desk: "MERIDIAN", status: "neutral", text: "no catalyst this session" },
  ],
};

async function main() {
  await mkdir(OUT, { recursive: true });
  const { PlayTerminal } = await import("../../src/features/nighthawk/command-deck/PlayTerminal.tsx");
  const play = {
    id: "0DTE:NVDA",
    ticker: "NVDA",
    direction: "LONG",
    contract: "875C · 0DTE",
    occ: "NVDA260825C00875000",
    score: 82,
    status: "OPEN",
    horizon: "ZERO_DTE",
    exitModel: "RATCHET",
    factors: [{ label: "Flow quality", points: 18 }, { label: "Breakout", points: 14 }],
    gates: [{ label: "Hard gate", ok: true }, { label: "Tape align", ok: true }],
    recommendation: "HOLD",
    recNote: "Thesis intact — hold per ratchet plan.",
    entry: 2.1,
    mark: 2.65,
    pnlPct: 26,
    peak: 42,
    trough: -8,
    thesisFirst: THESIS,
    thesisHealth: {
      health: 78,
      currentIndex: 82,
      advisory: "Flow + structure aligned; VWAP holding.",
      pillars: [{ id: "flow", label: "Flow", status: "intact" }],
      committedAtEt: "10:15",
    },
    tierLabel: "A",
  };
  const panelHtml = renderToStaticMarkup(
    React.createElement(PlayTerminal, { play, nowMs: Date.now(), convictionRank: { rank: 1, total: 12, isHighestToday: true } }),
  );
  await writeFile(join(OUT, "panel-ssr.html"), panelHtml);

  const auth = await mintIosPlaywrightSession({ appUrl: BASE });
  if (auth.skip) {
    console.log("skip live screenshot:", auth.reason);
    return;
  }
  try {
    const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.context().addCookies(auth.cookies);
    await page.goto(`${BASE}/nighthawk`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForTimeout(4000);
    await page.evaluate((html) => {
      const rail = document.querySelector(".nh-deck-right");
      if (rail) rail.outerHTML = html;
    }, panelHtml);
    const shot = join(OUT, "01-zero-dte-command-single-panel.png");
    await page.screenshot({ path: shot, fullPage: false });
    await browser.close();
    console.log("saved", shot);
  } finally {
    await auth.cleanup();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
