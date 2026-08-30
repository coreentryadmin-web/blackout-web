#!/usr/bin/env node
/** Night Hawk 0DTE single-panel Command — clean screenshots (onboarding dismissed). */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "playwright";
import { mintIosPlaywrightSession, onboardingInitScript } from "./lib/ios-playwright-auth.mjs";

(globalThis).React = React;

const BASE = process.env.VALIDATE_BASE || "https://blackouttrades.com";
const OUT = process.env.OUT || "/opt/cursor/artifacts/nighthawk-command-panel";

const THESIS = {
  thesis: {
    ticker: "NVDA",
    direction: "long",
    rail_scores: { FLOW: 78, BREAKOUT: 72, POSITIONING: 70 },
    rails_fired: ["FLOW", "BREAKOUT", "POSITIONING"],
    systems_aligned: 3,
    trade_archetype: "BREAKOUT",
    archetype_score: 82,
    structural_state: "TRIGGERED",
    trigger_price: 875,
    summaries: {
      FLOW: "quality sweep · CAMPAIGN",
      BREAKOUT: "TRIGGERED · RVOL 2.4×",
      POSITIONING: "VACUUM · γ long",
    },
    disagreeing_rails: [
      { rail: "MOMENTUM", direction: "short", score: 62, summary: "intraday fade" },
    ],
  },
  archetype_gates: { verdict: "PASS", archetype: "BREAKOUT", blocks: [], notes: [] },
  expression: {
    horizon: "ZERO_DTE",
    dte_target: 0,
    contract: {
      expiry: "2026-08-25",
      strike: 875,
      dte: 0,
      side: "call",
      bid: 2.1,
      ask: 2.15,
      oi: 12000,
      score: 88,
      spread_pct: 2.3,
      reasons: ["liquid"],
    },
    contract_score: 88,
    alternatives: [],
    vol_rationale: null,
    rationale: "0DTE call at trigger",
  },
  rank_tier: "A",
  desk_evidence: [
    { desk: "HELIX", status: "aligned", text: "$2.1M tape · 6 prints · call-side bias · CAMPAIGN" },
    { desk: "THERMAL", status: "aligned", text: "long-gamma · above 875 call wall · VACUUM" },
    { desk: "VECTOR", status: "aligned", text: "TRIGGERED · RVOL 2.4× · bead 872 · EM ±2.4%" },
    { desk: "NIGHTHAWK", status: "aligned", text: "tier A · 4/5 gates · confluence 2/2" },
    { desk: "MERIDIAN", status: "neutral", text: "no catalyst this session" },
  ],
};

async function dismissOnboarding(page) {
  for (const sel of ['button:has-text("SKIP")', ".onboarding-btn-ghost", '[aria-label="Close"]']) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible({ timeout: 800 }).catch(() => false)) {
      await btn.click();
      await page.waitForTimeout(400);
      break;
    }
  }
}

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
    factors: [
      { label: "Flow quality", points: 18 },
      { label: "Breakout", points: 14 },
      { label: "Positioning", points: 12 },
    ],
    gates: [
      { label: "Hard gate", ok: true },
      { label: "Tape align", ok: true },
    ],
    recommendation: "HOLD",
    recNote: "Thesis intact — hold per ratchet plan.",
    entry: 2.1,
    mark: 2.65,
    pnlPct: 26,
    peak: 42,
    trough: -8,
    stockPrice: 876.42,
    rrRatio: 2.4,
    thesisFirst: THESIS,
    thesisHealth: {
      health: 78,
      currentIndex: 82,
      advisory: "Flow + structure aligned; VWAP holding.",
      pillars: [
        { id: "flow", label: "Flow", status: "intact" },
        { id: "dealer", label: "Dealer", status: "intact" },
        { id: "vwap", label: "VWAP", status: "intact" },
      ],
      committedAtEt: "10:15",
    },
    tierLabel: "A",
    confluence: 2,
    discoveryOrigin: ["FLOW", "BREAKOUT"],
    whyNow: { reason: "breakout", label: "breakout trigger · RVOL 2.4×" },
    firstFlaggedAt: "2026-08-25T10:15:00-04:00",
    markAsOf: new Date().toISOString(),
  };

  const panelHtml = renderToStaticMarkup(
    React.createElement(PlayTerminal, {
      play,
      nowMs: Date.now(),
      convictionRank: { rank: 1, total: 12, isHighestToday: true },
    }),
  );

  const auth = await mintIosPlaywrightSession({ appUrl: BASE });
  if (auth.skip) {
    console.error("AUTH SKIP:", auth.reason);
    process.exit(1);
  }

  try {
    const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(onboardingInitScript());
    await context.addCookies(auth.cookies);
    const page = await context.newPage();
    await page.goto(`${BASE}/nighthawk`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForSelector(".nh-deck-right, .nh-deck-empty", { timeout: 45000 }).catch(() => {});
    await dismissOnboarding(page);
    await page.waitForTimeout(2000);

    await page.evaluate((html) => {
      const rail = document.querySelector(".nh-deck-right");
      if (rail) rail.outerHTML = html;
    }, panelHtml);

    await page.screenshot({
      path: join(OUT, "01-command-panel-verdict-evidence.png"),
      fullPage: false,
    });

    await page.locator(".nh-deck-command-panel").evaluate((el) => {
      el.scrollTop = 280;
    });
    await page.waitForTimeout(300);
    await page.screenshot({
      path: join(OUT, "02-command-panel-live-management.png"),
      fullPage: false,
    });

    await page.locator(".nh-deck-command-technicals").evaluate((el) => {
      el.open = true;
    });
    await page.waitForTimeout(200);
    await page.locator(".nh-deck-command-panel").evaluate((el) => {
      el.scrollTop = el.scrollHeight - 400;
    });
    await page.waitForTimeout(300);
    await page.screenshot({
      path: join(OUT, "03-command-panel-technicals.png"),
      fullPage: false,
    });

    await page.locator(".nh-deck-command-log").evaluate((el) => {
      el.open = true;
    });
    await page.waitForTimeout(200);
    await page.screenshot({
      path: join(OUT, "04-command-panel-session-log.png"),
      fullPage: false,
    });

    const evidence = page.locator(".nh-deck-evidence-stack");
    if (await evidence.count()) {
      await evidence.screenshot({ path: join(OUT, "05-desk-evidence-stack.png") });
    }

    await browser.close();
    console.log("saved screenshots to", OUT);
  } finally {
    await auth.cleanup();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
