#!/usr/bin/env node
/**
 * x-live-autopost.mjs — Playwright-driven X posting engine.
 *
 * Acts like a REAL USER: navigates the live platform, takes screenshots of real
 * data, annotates them with highlights (circles, lines, callouts), optionally
 * queries Largo, then posts the annotated screenshot + generated text to X.
 *
 * Usage:
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *     node scripts/x-live-autopost.mjs [options]
 *
 * Options:
 *   --surface vector|helix|thermal|largo|slayer  (default: auto-pick by time)
 *   --ticker  SPX|SPY|NVDA|...                   (default: SPX)
 *   --largo   "question text"                    (ask Largo, screenshot reply)
 *   --text    "tweet text"                       (override AI-generated text)
 *   --dry                                        (screenshot only, don't post)
 *   --annotate                                   (add data callouts to screenshot)
 *   --target  staging|prod                       (default: prod)
 */
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const flag = (k) => args.includes(`--${k}`);
const opt = (k, def) => { const i = args.indexOf(`--${k}`); return i >= 0 && args[i + 1] ? args[i + 1] : def; };

const TARGET = opt("target", "prod");
const BASE = TARGET === "staging"
  ? (process.env.STAGING_BASE_URL ?? "https://staging.blackouttrades.com").replace(/\/$/, "")
  : "https://blackouttrades.com";
const SURFACE = opt("surface", "auto");
const TICKER = opt("ticker", "SPX");
const LARGO_Q = opt("largo", "");
const TWEET_TEXT = opt("text", "");
const DRY = flag("dry");
const ANNOTATE = flag("annotate") || true; // default on
const OUT = process.env.SHOT_DIR || "/tmp/x-live-autopost";
const SECRET_NAME = TARGET === "staging"
  ? (process.env.STAGING_SECRET_NAME ?? "blackout-staging/app/env")
  : (process.env.PROD_SECRET_NAME ?? "blackout-production/app/env");

mkdirSync(OUT, { recursive: true });
const sh = (cmd) => execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();

// ---------------------------------------------------------------------------
// AWS Secrets
// ---------------------------------------------------------------------------
function loadSecrets() {
  const raw = sh(`aws secretsmanager get-secret-value --secret-id "${SECRET_NAME}" --query SecretString --output text`);
  return JSON.parse(raw);
}

// ---------------------------------------------------------------------------
// X API (OAuth 1.0a) — self-contained for standalone use
// ---------------------------------------------------------------------------
function pctEnc(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

function oauthHeader(method, url, xCreds, extraParams = {}) {
  const ts = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString("hex");
  const oauthParams = {
    oauth_consumer_key: xCreds.ck,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: ts,
    oauth_token: xCreds.at,
    oauth_version: "1.0",
  };
  const all = { ...oauthParams, ...extraParams };
  const paramStr = Object.keys(all).sort().map((k) => `${pctEnc(k)}=${pctEnc(all[k])}`).join("&");
  const baseStr = `${method}&${pctEnc(url)}&${pctEnc(paramStr)}`;
  const sigKey = `${pctEnc(xCreds.cs)}&${pctEnc(xCreds.ats)}`;
  const sig = crypto.createHmac("sha1", sigKey).update(baseStr).digest("base64");
  oauthParams.oauth_signature = sig;
  return "OAuth " + Object.keys(oauthParams).sort().map((k) => `${pctEnc(k)}="${pctEnc(oauthParams[k])}"`).join(", ");
}

async function uploadMedia(buf, xCreds) {
  const MEDIA_URL = "https://upload.twitter.com/1.1/media/upload.json";
  const b64 = buf.toString("base64");
  const params = { media_data: b64, media_category: "tweet_image" };
  const auth = oauthHeader("POST", MEDIA_URL, xCreds, params);
  const body = Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  const res = await fetch(MEDIA_URL, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Media upload failed (${res.status}): ${await res.text()}`);
  const json = await res.json();
  return json.media_id_string;
}

async function postTweet(text, mediaId, xCreds) {
  const TWEET_URL = "https://api.x.com/2/tweets";
  const payload = { text };
  if (mediaId) payload.media = { media_ids: [mediaId] };
  const auth = oauthHeader("POST", TWEET_URL, xCreds);
  const res = await fetch(TWEET_URL, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Tweet failed (${res.status}): ${await res.text()}`);
  return (await res.json()).data;
}

// ---------------------------------------------------------------------------
// Playwright helpers
// ---------------------------------------------------------------------------
async function proxyRoute(ctx) {
  if (!(process.env.HTTPS_PROXY || process.env.https_proxy)) return;
  await ctx.route("**/*", async (route) => {
    const req = route.request();
    try {
      const resp = await ctx.request.fetch(req, { maxRedirects: 0 });
      const loc = resp.headers()["location"];
      if (req.isNavigationRequest() && resp.status() >= 300 && resp.status() < 400 && loc) {
        await route.fulfill({ status: 200, contentType: "text/html", body: `<script>location.replace(${JSON.stringify(new URL(loc, req.url()).href)})</script>` });
        return;
      }
      await route.fulfill({ response: resp });
    } catch { await route.abort(); }
  });
}

async function dismissOnboarding(page) {
  for (const sel of ['button:has-text("SKIP")', '[aria-label="Close"]', '.modal-close', '[data-testid="dismiss"]']) {
    const el = page.locator(sel).first();
    if (await el.count().catch(() => 0)) { await el.click().catch(() => {}); }
  }
}

// ---------------------------------------------------------------------------
// Cognito auth (staging) or Clerk auth (prod)
// ---------------------------------------------------------------------------
async function loginCognito(page, secrets) {
  const poolId = secrets.COGNITO_USER_POOL_ID;
  const region = poolId?.includes("_") ? poolId.split("_")[0] : "";
  const email = `x-autopost-${Date.now()}@blackout-test.com`;
  const pw = `Aa1!${crypto.randomBytes(12).toString("hex")}`;
  const rf = region ? ` --region "${region}"` : "";

  try { sh(`aws cognito-idp admin-create-user --user-pool-id "${poolId}" --username "${email}" --message-action SUPPRESS --user-attributes Name=email,Value="${email}" Name=email_verified,Value=true Name=custom:role,Value=admin Name=custom:tier,Value=premium${rf}`); }
  catch (e) { if (!/UsernameExists/i.test(String(e.stderr ?? e.message))) throw e; }
  sh(`aws cognito-idp admin-set-user-password --user-pool-id "${poolId}" --username "${email}" --password "${pw}" --permanent${rf}`);

  await page.goto(`${BASE}/sign-in`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(4000);
  // Cognito hosted UI — DOM-level interaction bypasses visibility checks
  await page.evaluate(({ e, p }) => {
    const emailEl = document.querySelector('#signInFormUsername') || document.querySelector('input[name="username"]');
    const pwEl = document.querySelector('#signInFormPassword') || document.querySelector('input[name="password"]');
    if (emailEl) { emailEl.value = e; emailEl.dispatchEvent(new Event('input', { bubbles: true })); }
    if (pwEl) { pwEl.value = p; pwEl.dispatchEvent(new Event('input', { bubbles: true })); }
    const btn = document.querySelector('#signInFormSubmit') || document.querySelector('input[type="Submit"]') || document.querySelector('button[type="submit"]');
    if (btn) btn.click();
  }, { e: email, p: pw });
  await page.waitForTimeout(6000);

  return { email, poolId, region, cleanup: () => {
    try { sh(`aws cognito-idp admin-delete-user --user-pool-id "${poolId}" --username "${email}"${rf}`); }
    catch { /* ignore */ }
  }};
}

async function loginClerk(page, secrets) {
  const clerkSecret = secrets.CLERK_SECRET_KEY;
  const email = `x-autopost-${Date.now()}@blackout-test.com`;
  // Mint a sign-in token via Clerk Backend API
  // For prod we use Clerk token-based auth
  const clerkBase = "https://api.clerk.com/v1";
  // Create temp user
  const createRes = await fetch(`${clerkBase}/users`, {
    method: "POST",
    headers: { Authorization: `Bearer ${clerkSecret}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      email_address: [email],
      password: `Aa1!${crypto.randomBytes(12).toString("hex")}`,
      public_metadata: { role: "admin", tier: "premium" },
      skip_password_checks: true,
    }),
  });
  if (!createRes.ok) throw new Error(`Clerk user create failed: ${await createRes.text()}`);
  const user = await createRes.json();
  const userId = user.id;

  // Mint sign-in token
  const tokenRes = await fetch(`${clerkBase}/sign_in_tokens`, {
    method: "POST",
    headers: { Authorization: `Bearer ${clerkSecret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId }),
  });
  if (!tokenRes.ok) throw new Error(`Clerk sign-in token failed: ${await tokenRes.text()}`);
  const { token } = await tokenRes.json();

  // Exchange token via FAPI
  const fapiDomain = secrets.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.includes("pk_live")
    ? "clerk.blackouttrades.com"
    : "clerk.blackouttrades.com";
  await page.goto(`https://${fapiDomain}/v1/sign_in_tokens/${token}/verify`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  return { email, userId, cleanup: async () => {
    try { await fetch(`${clerkBase}/users/${userId}`, { method: "DELETE", headers: { Authorization: `Bearer ${clerkSecret}` } }); }
    catch { /* ignore */ }
  }};
}

// ---------------------------------------------------------------------------
// Surface navigation — go to a page and wait for data
// ---------------------------------------------------------------------------
const SURFACES = {
  vector: {
    url: (ticker) => `${BASE}/vector?ticker=${encodeURIComponent(ticker)}`,
    waitFor: async (page) => {
      await page.waitForTimeout(5000);
      await dismissOnboarding(page);
      await page.waitForTimeout(3000);
    },
    extractData: async (page) => page.evaluate(() => {
      const q = (s) => document.querySelector(s);
      return {
        spot: q(".vector-gex-ladder-sub")?.textContent?.trim() ?? "",
        regime: q(".vector-regime-read")?.textContent?.trim() ?? "",
        ladderRows: document.querySelectorAll(".vector-gex-ladder-row").length,
        hasCanvas: !!q("canvas"),
      };
    }),
  },
  helix: {
    url: () => `${BASE}/helix`,
    waitFor: async (page) => {
      await page.waitForTimeout(5000);
      await dismissOnboarding(page);
      await page.waitForTimeout(3000);
    },
    extractData: async (page) => page.evaluate(() => {
      const anomalies = document.querySelectorAll(".flow-anomaly-row, [class*='anomal']").length;
      const trades = document.querySelectorAll(".helix-tape-row, [class*='tape-row']").length;
      return { anomalies, trades };
    }),
  },
  thermal: {
    url: (ticker) => `${BASE}/thermal?ticker=${encodeURIComponent(ticker)}`,
    waitFor: async (page) => {
      await page.waitForTimeout(6000);
      await dismissOnboarding(page);
      await page.waitForTimeout(2000);
    },
    extractData: async (page) => page.evaluate(() => ({ hasCanvas: !!document.querySelector("canvas") })),
  },
  largo: {
    url: () => `${BASE}/largo`,
    waitFor: async (page) => {
      await page.waitForTimeout(4000);
      await dismissOnboarding(page);
      await page.waitForTimeout(2000);
    },
    extractData: async () => ({}),
  },
  slayer: {
    url: () => `${BASE}/spx-slayer`,
    waitFor: async (page) => {
      await page.waitForTimeout(5000);
      await dismissOnboarding(page);
      await page.waitForTimeout(2000);
    },
    extractData: async (page) => page.evaluate(() => {
      const signals = document.querySelectorAll("[class*='signal-row'], [class*='desk-signal']").length;
      return { signals };
    }),
  },
};

// ---------------------------------------------------------------------------
// Annotation engine — draw callouts on screenshots with Sharp + SVG
// ---------------------------------------------------------------------------
async function annotateScreenshot(buf, data, surface) {
  const meta = await sharp(buf).metadata();
  const w = meta.width, h = meta.height;
  const elements = [];

  // Watermark banner at bottom
  const bannerH = 48;
  elements.push(`<rect x="0" y="${h - bannerH}" width="${w}" height="${bannerH}" fill="rgba(0,0,0,0.75)"/>`);
  elements.push(`<text x="${w / 2}" y="${h - 16}" fill="#00ffcc" font-size="18" font-family="monospace" text-anchor="middle" font-weight="bold">LIVE from BlackOut Trades — blackouttrades.com</text>`);

  if (surface === "vector" && data.spot) {
    // Spot price callout top-right
    elements.push(`<rect x="${w - 320}" y="10" width="310" height="44" rx="8" fill="rgba(0,0,0,0.8)" stroke="#00ffcc" stroke-width="2"/>`);
    elements.push(`<text x="${w - 165}" y="38" fill="#00ffcc" font-size="20" font-family="monospace" text-anchor="middle" font-weight="bold">${data.spot}</text>`);
    if (data.regime) {
      const regimeColor = data.regime.toLowerCase().includes("negative") ? "#ff4444" : "#00ff88";
      elements.push(`<rect x="${w - 320}" y="60" width="310" height="32" rx="6" fill="rgba(0,0,0,0.8)" stroke="${regimeColor}" stroke-width="1.5"/>`);
      elements.push(`<text x="${w - 165}" y="82" fill="${regimeColor}" font-size="14" font-family="monospace" text-anchor="middle">${data.regime}</text>`);
    }
  }

  if (surface === "helix" && data.anomalies) {
    elements.push(`<rect x="10" y="10" width="260" height="36" rx="6" fill="rgba(255,50,50,0.85)"/>`);
    elements.push(`<text x="140" y="34" fill="white" font-size="16" font-family="monospace" text-anchor="middle" font-weight="bold">⚠ ${data.anomalies} Flow Anomalies</text>`);
  }

  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">${elements.join("")}</svg>`;

  return sharp(buf)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer();
}

// ---------------------------------------------------------------------------
// Largo interaction — type a question, wait for response, screenshot
// ---------------------------------------------------------------------------
async function askLargo(page, question) {
  const surface = SURFACES.largo;
  await page.goto(surface.url(), { waitUntil: "domcontentloaded", timeout: 30_000 });
  await surface.waitFor(page);

  // Find the chat input and type the question
  const input = page.locator('textarea, input[type="text"], [contenteditable="true"], [data-testid="largo-input"]').first();
  if (await input.count()) {
    await input.fill(question);
    await page.waitForTimeout(500);
    // Submit
    const submit = page.locator('button[type="submit"], [data-testid="largo-send"], button:has-text("Send"), button:has-text("Ask")').first();
    if (await submit.count()) {
      await submit.click();
    } else {
      await input.press("Enter");
    }
    // Wait for response to stream in
    await page.waitForTimeout(15000);
  }

  return page.screenshot({ type: "png" });
}

// ---------------------------------------------------------------------------
// Auto-pick surface based on time of day (ET)
// ---------------------------------------------------------------------------
function autoPickSurface() {
  const et = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const h = et.getHours();
  if (h >= 6 && h < 9) return "vector";    // Pre-market: show the walls
  if (h >= 9 && h < 10) return "vector";    // Open: Vector with live data
  if (h >= 10 && h < 12) return "helix";    // Mid-morning: flow tape
  if (h >= 12 && h < 14) return "thermal";  // Midday: heatmap
  if (h >= 14 && h < 16) return "helix";    // Afternoon: flow
  if (h >= 16 && h < 18) return "vector";   // Close: recap walls
  if (h >= 18 && h < 20) return "largo";    // Evening: Largo showcase
  if (h >= 20) return "slayer";             // Night: SPX Slayer
  return "vector";
}

// ---------------------------------------------------------------------------
// Tweet text generation
// ---------------------------------------------------------------------------
function generateText(surface, data, ticker) {
  const TAG = "@blackouttrade";
  const SITE = "www.blackouttrades.com";

  // Extract just the key numbers from the data
  const spotMatch = data.spot?.match(/([\d,]+\.\d+)/);
  const spotNum = spotMatch ? spotMatch[1] : "";
  const flipMatch = data.regime?.match(/flip\s*\(([\d,]+\.\d+)\)/i);
  const flipNum = flipMatch ? flipMatch[1] : "";
  const isShortGamma = data.regime?.toLowerCase().includes("short gamma") || data.regime?.toLowerCase().includes("negative") || data.regime?.toLowerCase().includes("below");

  const lines = {
    vector: () => {
      if (spotNum && flipNum) {
        const regime = isShortGamma ? "Short gamma" : "Long gamma";
        return `${ticker} ${spotNum} | Flip ${flipNum} | ${regime}\n\nDealers are ${isShortGamma ? "accelerating moves" : "pinning price"}. Every wall visible. Live.\n\n${TAG} ${SITE}`;
      }
      if (spotNum) {
        return `${ticker} at ${spotNum} — GEX walls, flip level, regime. All live on Vector right now.\n\n${TAG} ${SITE}`;
      }
      return `${ticker} GEX walls live on Vector. Every wall, every flip, every regime shift — real-time.\n\n${TAG} ${SITE}`;
    },
    helix: () => {
      const count = data.anomalies || "Multiple";
      return `${count} flow anomalies detected right now.\n\nWhale prints hitting the tape live. Are you watching?\n\n${TAG} ${SITE}`;
    },
    thermal: () => `The heatmap doesn't lie.\n\nSee exactly where dealers are trapped — every strike, every expiration. Live.\n\n${TAG} ${SITE}`,
    largo: () => `Asked our AI terminal. Got data back, not vibes.\n\nLargo pulls GEX, flow, regime, dark pool — answers any market question.\n\n${TAG} ${SITE}`,
    slayer: () => `SPX Slayer — live 0DTE signals with real-time P&L.\n\nTier-graded setups, auto exit intelligence.\n\n${TAG} ${SITE}`,
  };

  const text = (lines[surface] ?? lines.vector)();

  // Hard limit: 280 total, t.co wraps the URL to 23 chars
  const T_CO = 23;
  const maxChars = 280 - T_CO + SITE.length;
  if (text.length > maxChars) {
    const footer = `\n\n${TAG} ${SITE}`;
    const body = text.slice(0, text.lastIndexOf(`\n\n${TAG}`));
    return body.slice(0, maxChars - footer.length - 1).trimEnd() + "…" + footer;
  }
  return text;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log("🚀 X Live Autopost starting...");
  console.log(`   Target: ${TARGET} (${BASE})`);

  const secrets = loadSecrets();
  const xCreds = {
    ck: secrets.X_API_KEY,
    cs: secrets.X_API_KEY_SECRET,
    at: secrets.X_ACCESS_TOKEN,
    ats: secrets.X_ACCESS_TOKEN_SECRET,
  };

  if (!xCreds.ck || !xCreds.cs || !xCreds.at || !xCreds.ats) {
    console.error("❌ X API credentials not found in secrets");
    process.exit(1);
  }

  const surface = SURFACE === "auto" ? autoPickSurface() : SURFACE;
  console.log(`   Surface: ${surface}, Ticker: ${TICKER}`);

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await proxyRoute(ctx);
  const page = await ctx.newPage();

  // Capture console errors
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });

  let auth;
  try {
    // Login
    console.log("   Logging in...");
    if (TARGET === "staging") {
      auth = await loginCognito(page, secrets);
    } else {
      auth = await loginClerk(page, secrets);
    }
    console.log(`   ✓ Logged in as ${auth.email}`);

    let screenshotBuf;
    let extractedData = {};

    if (LARGO_Q) {
      // Largo mode: ask a question and screenshot the response
      console.log(`   Asking Largo: "${LARGO_Q}"`);
      screenshotBuf = await askLargo(page, LARGO_Q);
      extractedData = { question: LARGO_Q };
    } else {
      // Navigate to surface
      const surfaceCfg = SURFACES[surface];
      if (!surfaceCfg) { console.error(`Unknown surface: ${surface}`); process.exit(1); }

      const url = surfaceCfg.url(TICKER);
      console.log(`   Navigating to ${url}`);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await surfaceCfg.waitFor(page);

      // Extract live data from the page
      extractedData = await surfaceCfg.extractData(page);
      console.log(`   Data: ${JSON.stringify(extractedData)}`);

      // Take screenshot
      screenshotBuf = await page.screenshot({ type: "png" });
    }

    // Annotate
    if (ANNOTATE) {
      console.log("   Annotating screenshot...");
      screenshotBuf = await annotateScreenshot(screenshotBuf, extractedData, surface);
    }

    // Save screenshot
    const shotPath = join(OUT, `x-live-${surface}-${TICKER}-${Date.now()}.png`);
    writeFileSync(shotPath, screenshotBuf);
    console.log(`   📸 Screenshot saved: ${shotPath}`);

    // Generate tweet text
    const tweetText = TWEET_TEXT || generateText(surface, extractedData, TICKER);
    console.log(`   Tweet (${tweetText.length} chars):\n   ${tweetText.replace(/\n/g, "\n   ")}`);

    // Character safety check
    const T_CO_URL = 23;
    const maxChars = 280 - T_CO_URL + "www.blackouttrades.com".length;
    if (tweetText.length > maxChars) {
      console.warn(`   ⚠ Tweet too long (${tweetText.length}/${maxChars}), truncating...`);
    }

    if (DRY) {
      console.log("\n   🏁 DRY RUN — not posting to X");
      console.log(`   Console errors: ${consoleErrors.length}`);
      if (consoleErrors.length) consoleErrors.forEach((e) => console.log(`     ⚠ ${e}`));
    } else {
      // Upload image and post
      console.log("   Uploading image to X...");
      const mediaId = await uploadMedia(screenshotBuf, xCreds);
      console.log(`   ✓ Media uploaded: ${mediaId}`);

      console.log("   Posting tweet...");
      const result = await postTweet(tweetText, mediaId, xCreds);
      console.log(`   ✓ Tweet posted! ID: ${result.id}`);
      console.log(`   https://x.com/IHate0dte/status/${result.id}`);
    }

    console.log(`\n✅ Done (${consoleErrors.length} console errors)`);
  } catch (err) {
    // Save error screenshot
    try {
      const errShot = await page.screenshot({ type: "png" });
      const errPath = join(OUT, `x-live-error-${Date.now()}.png`);
      writeFileSync(errPath, errShot);
      console.error(`   Error screenshot: ${errPath}`);
    } catch { /* ignore */ }
    console.error(`❌ ${err.message}`);
    process.exit(1);
  } finally {
    if (auth?.cleanup) {
      console.log("   Cleaning up auth...");
      await Promise.resolve(auth.cleanup()).catch(() => {});
    }
    await browser.close();
  }
}

main();
