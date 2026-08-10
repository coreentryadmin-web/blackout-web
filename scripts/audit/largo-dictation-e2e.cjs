#!/usr/bin/env node
/**
 * LARGO DICTATION E2E — drive the real mic button, in real Chromium, on the real deployed page.
 *
 * WHAT IS AND IS NOT SIMULATED, because this is the whole question.
 *
 * `SpeechRecognition` is a browser API backed by a VENDOR ASR SERVICE — Chrome ships the object
 * and streams your microphone to Google to turn audio into words. Two consequences:
 *
 *   1. There is no microphone in this sandbox, and Chromium here has no network of its own
 *      (docs/audit/LIVE-UI-CONNECTION.md), so the audio->words leg physically cannot run.
 *   2. Even where it can run, it is a remote statistical model. Asserting on its output would be
 *      asserting on Google's accuracy, not on this product's correctness.
 *
 * So this harness replaces exactly that one leg: a scripted SpeechRecognition is installed before
 * the app's JS loads, and it emits the LITERAL raw transcripts a real speech model returns for
 * these sentences — "in video", "by calls", "zero d t e" — with the same interim-then-final event
 * shape and the same whole-transcript-resent-each-time behaviour as the real API.
 *
 * EVERYTHING ELSE IS REAL: the deployed bundle, the real React component, the real useDictation
 * hook, the real repair, the real composer. What is asserted is what a member would SEE in the box
 * after speaking — which is the part that is ours to get right.
 *
 * Usage:
 *   node scripts/audit/largo-dictation-e2e.cjs --cookie "$CK" [--base=https://blackouttrades.com]
 *
 * Exits non-zero on any failed case.
 */

const { createTunneledContext } = require("./lib/proxy-tunnel-context.cjs");

const args = process.argv.slice(2);
const arg = (n, d) => { const h = args.find((a) => a.startsWith(`--${n}=`)); return h ? h.split("=").slice(1).join("=") : d; };
const COOKIE = arg("cookie", args[args.indexOf("--cookie") + 1] || "");
const BASE = arg("base", "https://blackouttrades.com");

/**
 * The cases. Left column is the RAW transcript a speech model returns; right column is what must
 * end up in the composer. Anything the member would have to fix by hand is a failure here.
 */
const CASES = [
  { say: "what is in video doing today", want: "what is NVDA doing today" },
  { say: "show me the S and P 500 gamma flip", want: "show me the SPX gamma flip" },
  { say: "any zero d t e plays right now", want: "any 0DTE plays right now" },
  { say: "should I by calls on tesla", want: "should I buy calls on TSLA" },
  { say: "um where is the gex on Q Q Q", want: "where is the GEX on QQQ" },
];

/**
 * The stand-in for the vendor service. Matches the real API's contract in the ways the hook
 * depends on: `results` is an array-like of alternatives, the WHOLE transcript is re-sent on every
 * result, and `onend` fires once after the final one.
 */
const FAKE_RECOGNITION = `
window.__dictate = null;
class ScriptedRecognition {
  constructor() { this.lang = ""; this.continuous = false; this.interimResults = false;
    this.onresult = null; this.onerror = null; this.onend = null; }
  start() {
    window.__dictate = (phrase) => {
      const words = phrase.split(" ");
      // Interim results: the whole transcript so far, re-sent as it grows — exactly what Chrome does.
      words.forEach((_, i) => {
        const soFar = words.slice(0, i + 1).join(" ");
        this.onresult && this.onresult({ results: [[{ transcript: soFar }]] });
      });
      this.onend && this.onend();
    };
    window.__listening = true;
  }
  stop()  { window.__listening = false; this.onend && this.onend(); }
  abort() { window.__listening = false; }
}
window.SpeechRecognition = ScriptedRecognition;
window.webkitSpeechRecognition = ScriptedRecognition;
`;

async function main() {
  if (!COOKIE) throw new Error("--cookie is required (mint one with lib/prod-clerk-session.mjs)");

  // The shared tunnel — Chromium here cannot reach the network at all, and this helper is the ONE
  // implementation that works (see docs/audit/LIVE-UI-CONNECTION.md). Reused rather than
  // reimplemented so a fix to the tunnel reaches every harness at once.
  const { browser, ctx, counts } = await createTunneledContext({
    url: `${BASE}/terminal`,
    cookie: COOKIE,
    viewport: "1440x900",
    desktop: true,
  });

  // Installed BEFORE any app code runs, so the hook's mount-time support check sees it.
  await ctx.addInitScript(FAKE_RECOGNITION);

  const page = await ctx.newPage();
  const results = [];
  try {
    await page.goto(`${BASE}/terminal`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(9000); // hydration + the hook's mount-time support check
    console.log(`Routed: ${counts.ok} ok, ${counts.fail} fail`);

    const mic = page.locator('button[aria-label="Ask by voice"], button[aria-label="Stop dictation"]').first();
    const micVisible = await mic.isVisible().catch(() => false);
    results.push({ name: "mic button is present and visible", pass: micVisible });
    if (!micVisible) {
      const buttons = await page.locator("button").evaluateAll((els) =>
        els.map((e) => e.getAttribute("aria-label") || e.textContent?.trim()).filter(Boolean).slice(0, 25)
      );
      console.log("  buttons on page:", JSON.stringify(buttons));
    }

    const input = page.locator('input[aria-label="Ask Largo"]').first();

    for (const c of CASES) {
      await input.fill("");
      await mic.click();
      await page.waitForTimeout(150);
      await page.evaluate((phrase) => window.__dictate && window.__dictate(phrase), c.say);
      await page.waitForTimeout(250);
      const got = await input.inputValue();
      results.push({ name: `"${c.say}"`, pass: got === c.want, detail: got === c.want ? "" : `got "${got}" want "${c.want}"` });
    }

    // Dictation must CONTINUE a half-typed question, not overwrite it — the base-snapshot rule.
    await input.fill("compare");
    await mic.click();
    await page.waitForTimeout(150);
    await page.evaluate(() => window.__dictate && window.__dictate("in video and tesla"));
    await page.waitForTimeout(250);
    const appended = await input.inputValue();
    results.push({
      name: "dictation appends to typed text, never overwrites it",
      pass: appended === "compare NVDA and TSLA",
      detail: appended === "compare NVDA and TSLA" ? "" : `got "${appended}"`,
    });
  } finally {
    await browser.close();
  }

  for (const r of results) console.log(`  ${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed.`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error("largo-dictation-e2e failed:", e.message); process.exit(2); });
