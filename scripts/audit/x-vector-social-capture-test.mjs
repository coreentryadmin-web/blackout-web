#!/usr/bin/env node
/** One-shot Vector social capture — validates zoom/bead legibility after prep changes. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { mintIosPlaywrightSession, onboardingInitScript } from "./lib/ios-playwright-auth.mjs";
import { captureByCatalogId } from "./lib/x-capture-runner.mjs";

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const OUT = process.env.VECTOR_CAPTURE_OUT || "/opt/cursor/artifacts/x-posts/vector-fix-test";
const ticker = process.env.TICKER || "SPX";
const horizon = process.env.HORIZON || "weekly";

async function main() {
  mkdirSync(OUT, { recursive: true });
  const session = await mintIosPlaywrightSession({ appUrl: BASE });
  if (session.skip) {
    console.error("SKIP:", session.reason);
    process.exit(2);
  }
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 2,
      colorScheme: "dark",
    });
    await context.addInitScript(onboardingInitScript());
    await context.addCookies(session.cookies);
    const page = await context.newPage();
    const buf = await captureByCatalogId(page, BASE, `vector.desk.${ticker.toLowerCase()}.${horizon}.15m`, {
      ticker,
      horizon,
      timeframe: "3",
      nodes: "20",
      wait_beads: true,
    });
    const outPath = join(OUT, `${ticker.toLowerCase()}-${horizon}-vector.png`);
    writeFileSync(outPath, buf);
    console.log(JSON.stringify({ ok: true, bytes: buf.length, path: outPath }, null, 2));
  } finally {
    await browser.close();
    await session.cleanup?.();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
