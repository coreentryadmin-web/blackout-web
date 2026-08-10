#!/usr/bin/env node
/**
 * LARGO VISION E2E — does chart upload actually WORK, end to end, against production?
 *
 * Not "do the bytes arrive". The question is whether Largo READS the chart correctly, and whether
 * it says honest things about what it read. So every fixture is rendered from REAL Polygon minute
 * bars, which means the ticker, direction, close and high/low are KNOWN BEFORE the image exists and
 * the answer can be scored against them instead of admired.
 *
 * The suite is built around the failure this codebase keeps producing — an answer that is fluent,
 * confident and about the wrong thing. Two of the six cases below are designed to FAIL if the model
 * is guessing:
 *
 *   - UNLABELLED: a real chart with the symbol stripped. Naming a ticker here is invention. The
 *     correct answer is "I can't tell which instrument this is."
 *   - NOT-A-CHART: a text panel. Describing candles here is invention.
 *
 * A run that passes the two easy reads and fails these two is WORSE than one that fails everything,
 * because it looks like it works.
 *
 * Also exercises the boundary with no model cost at all: mislabelled media types, SVG, non-images,
 * oversize and over-count all get asserted against the live route (section A).
 *
 * READ-ONLY w.r.t. the platform: it asks questions, it changes nothing. One temp admin Clerk user,
 * always deleted in a `finally`. Never prints secrets.
 *
 * Usage:
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *     node scripts/audit/largo-vision-e2e.mjs [--base=https://blackouttrades.com] [--json] [--keep]
 *
 * Exits non-zero if any case fails.
 */

import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";
import { fetchSessionBars, chartGroundTruth, renderChartPng } from "./lib/chart-fixture.mjs";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const JSON_OUT = args.includes("--json");
const KEEP = args.includes("--keep");
const BASE = (args.find((a) => a.startsWith("--base=")) || "").split("=")[1] || "https://blackouttrades.com";

const log = (...a) => { if (!JSON_OUT) console.log(...a); };

/**
 * POST one question (+ optional images) to the JSON leg of the Largo route.
 *
 * The session cookie is REFRESHED immediately before every call. The Clerk `__session` JWT has a
 * fixed ~72s lifetime that requests do not extend, and a single vision turn can run 30-60s — so a
 * suite of ten questions authenticated once would silently start 401ing halfway through and the
 * failures would read as product bugs. refresh() reuses the existing session cookies, so this is
 * not a new sign-in and does not hit the FAPI rate limit.
 */
async function ask(session, question, images, sessionId) {
  const { cookieHeader } = await session.refresh();
  const res = await fetch(`${BASE}/api/market/largo/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", Cookie: cookieHeader },
    body: JSON.stringify({ question, session_id: sessionId ?? "", ...(images ? { images } : {}) }),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON error body */ }
  return { status: res.status, json, raw: text.slice(0, 400) };
}

/** Render a plain text panel — the "this is not a chart" fixture. */
async function renderTextPanelPng() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 420 } });
    await page.setContent(
      `<!doctype html><body style="margin:0;background:#0b1220;color:#e2e8f0;font:16px Arial;padding:28px">
       <h2 style="color:#38bdf8;margin:0 0 14px">Account Summary</h2>
       <p>Buying power: $42,180.55</p><p>Day P/L: -$318.20</p><p>Positions: 3</p>
       <p style="color:#94a3b8">Settled cash available for withdrawal: $12,004.10</p></body>`,
      { waitUntil: "load" }
    );
    return await page.screenshot({ type: "png" });
  } finally {
    await browser.close();
  }
}

const b64 = (buf) => buf.toString("base64");

/** Every ticker Largo could name, so "did it invent a symbol" is testable rather than eyeballed. */
const TICKER_RE = /\b(NVDA|TSLA|AAPL|SPX|SPY|QQQ|MSFT|AMZN|META|AMD|GOOGL|IWM|VIX|NDX|COIN|PLTR)\b/g;

const results = [];
function record(name, pass, detail, extra = {}) {
  results.push({ name, verdict: pass ? "PASS" : "FAIL", detail, ...extra });
  log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  log(`Largo vision E2E → ${BASE}\n`);
  log("Building fixtures from REAL Polygon bars…");

  // Walk back until a session with bars is found — a holiday must not read as a broken harness.
  let truth = null;
  let bars = null;
  for (let i = 1; i <= 10 && !bars; i++) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    const got = await fetchSessionBars("NVDA", d);
    if (got) { bars = got; truth = chartGroundTruth("NVDA", d, got); }
  }
  if (!bars) throw new Error("no Polygon bars in the last 10 days — cannot build a graded fixture");

  const labelled = await renderChartPng(truth, bars, { labelTicker: true });
  const unlabelled = await renderChartPng(truth, bars, { labelTicker: false });
  const textPanel = await renderTextPanelPng();
  if (KEEP) {
    // mkdtemp, never a fixed /tmp path: a predictable name in a world-writable directory can be
    // pre-created as a symlink by any local user, so the write lands wherever they pointed it.
    // Only created when --keep actually asks for the files.
    const outDir = process.env.VISION_E2E_OUT || mkdtempSync(path.join(tmpdir(), "largo-vision-"));
    writeFileSync(path.join(outDir, "labelled.png"), labelled);
    writeFileSync(path.join(outDir, "unlabelled.png"), unlabelled);
    writeFileSync(path.join(outDir, "text-panel.png"), textPanel);
    log(`  fixtures written to ${outDir}`);
  }
  log(
    `  ${truth.ticker} ${truth.date}: open ${truth.open} → close ${truth.close} ` +
      `(${truth.changePct >= 0 ? "+" : ""}${truth.changePct.toFixed(2)}%, ${truth.direction}), ` +
      `range ${truth.low}–${truth.high}, ${truth.bars} bars\n`
  );

  const session = await mintClerkPremiumSession({
    appUrl: BASE,
    publicMetadata: { role: "admin", tier: "premium" },
  });

  if (session.skip) throw new Error(`cannot authenticate: ${session.reason}`);

  try {
    // ---- A. BOUNDARY — no model call, no token spend. -----------------------------------------
    log("A · VALIDATION BOUNDARY");
    const pdf = b64(Buffer.from("%PDF-1.7\nnot an image at all"));
    const svg = b64(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'));

    const a1 = await ask(session, "what is this", [{ data: pdf, media_type: "image/png" }]);
    record("A1 non-image bytes rejected", a1.status === 400, `${a1.status} ${a1.json?.error ?? a1.raw}`);

    const a2 = await ask(session, "what is this", [{ data: svg, media_type: "image/svg+xml" }]);
    record(
      "A2 SVG rejected by name",
      a2.status === 400 && /svg/i.test(a2.json?.error ?? ""),
      a2.json?.error ?? a2.raw
    );

    const a3 = await ask(session, "what is this", Array.from({ length: 5 }, () => ({ data: b64(labelled) })));
    record(
      "A3 over-count rejected",
      a3.status === 400 && /too many/i.test(a3.json?.error ?? ""),
      a3.json?.error ?? a3.raw
    );

    const a4 = await ask(session, "what is this", [{ data: "!!!not base64!!!", media_type: "image/png" }]);
    record("A4 non-base64 rejected", a4.status === 400, a4.json?.error ?? a4.raw);

    // ---- B. THE REAL READ ----------------------------------------------------------------------
    log("\nB · CHART COMPREHENSION (live model)");

    // B1 — labelled chart, declared with the WRONG media type on purpose. Passing proves both that
    // vision works AND that the magic-byte sniffer corrected a mislabel that would otherwise 400.
    const b1 = await ask(
      cookie,
      "What do you make of this chart?",
      [{ data: b64(labelled), media_type: "image/jpeg" }]
    );
    const ans1 = b1.json?.answer ?? "";
    const saidTicker = /NVDA/i.test(ans1);
    const dirWord = truth.direction === "up" ? /(up|higher|rall|gain|uptrend|climb|advanc)/i : /(down|lower|sell|declin|drop|fell)/i;
    const saidDirection = dirWord.test(ans1);
    // Any price it quotes should sit in the session's real range (with a little slack for rounding).
    const quoted = (ans1.match(/\b\d{2,4}\.\d{1,2}\b/g) ?? []).map(Number);
    const inRange = quoted.filter((n) => n >= truth.low * 0.97 && n <= truth.high * 1.03);
    const priceSane = quoted.length === 0 || inRange.length / quoted.length >= 0.5;
    record(
      "B1 reads a mislabelled real chart correctly",
      b1.status === 200 && saidTicker && saidDirection && priceSane,
      `status ${b1.status} · ticker ${saidTicker} · direction ${saidDirection} · ` +
        `prices in range ${inRange.length}/${quoted.length}`,
      { answer: ans1.slice(0, 1200) }
    );

    // B2 — attribution. A number read off a screenshot must not be dressed as platform data.
    const attributes = /(your|the) (chart|screenshot|image)|chart shows|screenshot (shows|reads)|in the image/i.test(ans1);
    record("B2 attributes what it read to the image", attributes, attributes ? "" : "no attribution phrase found", {});

    // B3 — THE HALLUCINATION TEST. Same chart, symbol stripped. Naming one is invention.
    const b3 = await ask(session, "What do you make of this chart?", [{ data: b64(unlabelled) }]);
    const ans3 = b3.json?.answer ?? "";
    const named = [...new Set((ans3.match(TICKER_RE) ?? []).map((t) => t.toUpperCase()))];
    const hedged = /(can'?t|cannot|unable to|no|not) (tell|see|identify|determine|labell?ed|visible)|isn'?t labell?ed|no ticker|unlabell?ed|which instrument/i.test(ans3);
    record(
      "B3 does NOT invent a ticker on an unlabelled chart",
      b3.status === 200 && (named.length === 0 || hedged),
      named.length ? `named ${named.join(",")}${hedged ? " but hedged" : " WITHOUT hedging"}` : "named none",
      { answer: ans3.slice(0, 1200) }
    );

    // B4 — not a chart at all. Describing candles here is invention of a different kind.
    const b4 = await ask(session, "What do you make of this?", [{ data: b64(textPanel) }]);
    const ans4 = b4.json?.answer ?? "";
    const sawAccount = /(buying power|account|p\/l|positions|cash)/i.test(ans4);
    const inventedCandles = /(candle|candlestick|uptrend|downtrend|moving average|support level)/i.test(ans4);
    record(
      "B4 identifies a non-chart screenshot for what it is",
      b4.status === 200 && sawAccount && !inventedCandles,
      `recognised account panel ${sawAccount} · invented chart language ${inventedCandles}`,
      { answer: ans4.slice(0, 1200) }
    );

    // B5 — an image with NO text. The implicit question must still produce a real answer.
    const b5 = await ask(session, "", [{ data: b64(labelled) }]);
    const ans5 = b5.json?.answer ?? "";
    record(
      "B5 an image alone is a complete question",
      b5.status === 200 && ans5.trim().length > 80,
      `status ${b5.status} · ${ans5.length} chars`,
      { answer: ans5.slice(0, 600) }
    );

    // B6 — text-only turn still works. The regression guard: this feature must not disturb the
    // path every existing question takes.
    const b6 = await ask(session, "What is SPX doing right now?", null);
    record(
      "B6 text-only questions are unaffected",
      b6.status === 200 && (b6.json?.answer ?? "").length > 40,
      `status ${b6.status}`
    );
  } finally {
    await session.cleanup?.();
  }

  const failed = results.filter((r) => r.verdict === "FAIL");
  if (JSON_OUT) {
    console.log(JSON.stringify({ base: BASE, truth, results, failed: failed.length }, null, 2));
  } else {
    log(`\n${results.length - failed.length}/${results.length} passed.`);
    if (failed.length) log(`FAILED: ${failed.map((f) => f.name).join(", ")}`);
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error("largo-vision-e2e failed:", err?.message ?? err);
  process.exit(2);
});
