#!/usr/bin/env node
/**
 * x-live-autopost.mjs — Playwright-driven X posting engine for BlackOut Trades.
 *
 * Navigates the PRODUCTION platform as a real premium member, takes live
 * screenshots, annotates them with Sharp, and posts to @IHate0dte on X.
 *
 * Auth: Clerk Backend API → sign_in_token → FAPI ticket exchange → cookie injection
 * Target: https://blackouttrades.com (production only)
 *
 * Usage:
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *     node scripts/x-live-autopost.mjs [options]
 *
 * Options:
 *   --surface vector|helix|thermal|largo|slayer|nighthawk  (default: auto)
 *   --ticker  SPX|SPY|NVDA|...   (default: SPX)
 *   --largo   "question text"    (ask Largo, screenshot reply)
 *   --text    "tweet text"       (override generated text)
 *   --dry                        (screenshot only, don't post)
 *   --no-annotate                (skip annotation overlay)
 */
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright";
import sharp from "sharp";
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const flag = (k) => args.includes(`--${k}`);
const opt = (k, def) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};

const BASE = "https://blackouttrades.com";
const SURFACE = opt("surface", "auto");
const TICKER = opt("ticker", "SPX");
const LARGO_Q = opt("largo", "");
const TWEET_TEXT = opt("text", "");
const DRY = flag("dry");
const ANNOTATE = !flag("no-annotate");
// Secure temp dir — mkdtempSync creates a unique directory with restricted perms
const OUT = process.env.SHOT_DIR || mkdtempSync(join(tmpdir(), "x-live-autopost-"));
const HISTORY_FILE = join(OUT, "post-history.json");

mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------------------
// Post history — prevents duplicate content
// ---------------------------------------------------------------------------
function loadHistory() {
  try { return JSON.parse(readFileSync(HISTORY_FILE, "utf8")); }
  catch { return { posts: [] }; }
}
function saveHistory(h) { writeFileSync(HISTORY_FILE, JSON.stringify(h, null, 2)); }

// ---------------------------------------------------------------------------
// AWS Secrets Manager
// ---------------------------------------------------------------------------
function loadSecrets() {
  const raw = execSync(
    "aws secretsmanager get-secret-value --secret-id blackout-production/app/env --query SecretString --output text",
    { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  ).trim();
  return JSON.parse(raw);
}

// ---------------------------------------------------------------------------
// X API (OAuth 1.0a) — self-contained for standalone use
// ---------------------------------------------------------------------------
function pctEnc(s) {
  return encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
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
  const paramStr = Object.keys(all)
    .sort()
    .map((k) => `${pctEnc(k)}=${pctEnc(all[k])}`)
    .join("&");
  const baseStr = `${method}&${pctEnc(url)}&${pctEnc(paramStr)}`;
  const sigKey = `${pctEnc(xCreds.cs)}&${pctEnc(xCreds.ats)}`;
  const sig = crypto
    .createHmac("sha1", sigKey)
    .update(baseStr)
    .digest("base64");
  oauthParams.oauth_signature = sig;
  return (
    "OAuth " +
    Object.keys(oauthParams)
      .sort()
      .map((k) => `${pctEnc(k)}="${pctEnc(oauthParams[k])}"`)
      .join(", ")
  );
}

async function uploadMedia(buf, xCreds) {
  const MEDIA_URL = "https://upload.twitter.com/1.1/media/upload.json";
  const b64 = buf.toString("base64");
  const params = { media_data: b64, media_category: "tweet_image" };
  const auth = oauthHeader("POST", MEDIA_URL, xCreds, params);
  const body = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  const res = await fetch(MEDIA_URL, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok)
    throw new Error(`Media upload failed (${res.status}): ${await res.text()}`);
  return (await res.json()).media_id_string;
}

async function postTweet(text, mediaId, xCreds) {
  const TWEET_URL = "https://api.x.com/2/tweets";
  const payload = { text };
  if (mediaId) payload.media = { media_ids: [mediaId] };
  const auth = oauthHeader("POST", TWEET_URL, xCreds);
  const res = await fetch(TWEET_URL, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok)
    throw new Error(`Tweet failed (${res.status}): ${await res.text()}`);
  return (await res.json()).data;
}

// ---------------------------------------------------------------------------
// Clerk auth — mint session cookie, inject into Playwright
// ---------------------------------------------------------------------------
const CLERK_API = "https://api.clerk.com/v1";
const CLERK_JS_VERSION = "5.57.0";

function fapiHost(publishableKey) {
  try {
    const decoded = Buffer.from(
      publishableKey.replace(/^pk_(live|test)_/, ""),
      "base64",
    )
      .toString("utf8")
      .replace(/\$$/, "");
    if (decoded.includes(".")) return `https://${decoded}`;
  } catch {
    /* fall through */
  }
  return "https://clerk.blackouttrades.com";
}

function collectSetCookies(res) {
  const raw =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : [res.headers.get("set-cookie")].filter(Boolean);
  return raw.map((c) => c.split(";")[0]).filter(Boolean);
}

async function mintClerkSession(secrets) {
  const secret = secrets.CLERK_SECRET_KEY;
  const publishableKey = secrets.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (!secret || !publishableKey)
    throw new Error("CLERK_SECRET_KEY or NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY missing from secrets");

  const fapi = fapiHost(publishableKey);
  const email = `x-autopost-${Date.now()}@blackout-bot.com`;
  const suffix = String(crypto.randomInt(0, 10000)).padStart(4, "0");
  const phone = `+1415555${suffix}`;

  const backend = (method, path, body) =>
    fetch(`${CLERK_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

  // 1. Create temp user
  const createRes = await backend("POST", "/users", {
    email_address: [email],
    phone_number: [phone],
    public_metadata: { role: "admin", tier: "premium" },
    skip_password_requirement: true,
    skip_legal_checks: true,
  });
  const created = await createRes.json().catch(() => null);
  let userId = created?.id;
  if (!userId && /form_identifier_exists/.test(JSON.stringify(created?.errors))) {
    const lookup = await fetch(
      `${CLERK_API}/users?email_address=${encodeURIComponent(email)}`,
      { headers: { Authorization: `Bearer ${secret}` } },
    );
    const existing = (await lookup.json().catch(() => []))?.[0];
    if (existing?.id) {
      userId = existing.id;
      await backend("PATCH", `/users/${userId}`, {
        public_metadata: { role: "admin", tier: "premium" },
      });
    }
  }
  if (!userId) throw new Error("Failed to create temp Clerk user");

  // 2. Mint sign-in token
  const tokenRes = await backend("POST", "/sign_in_tokens", { user_id: userId });
  const ticket = (await tokenRes.json().catch(() => null))?.token;
  if (!ticket) throw new Error("sign_in_tokens mint failed");

  // 3. FAPI ticket exchange
  const signInRes = await fetch(
    `${fapi}/v1/client/sign_ins?_clerk_js_version=${CLERK_JS_VERSION}`,
    {
      method: "POST",
      headers: {
        Origin: BASE,
        Referer: `${BASE}/`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ strategy: "ticket", ticket }),
    },
  );
  const signInCookies = collectSetCookies(signInRes);
  const signInJson = await signInRes.json().catch(() => null);
  const sessionId = signInJson?.response?.created_session_id;
  if (!sessionId) throw new Error("FAPI ticket exchange failed — no session ID");

  // 4. Mint session JWT
  const clientUat = Math.floor(Date.now() / 1000);
  const mintRes = await fetch(
    `${fapi}/v1/client/sessions/${sessionId}/tokens?_clerk_js_version=${CLERK_JS_VERSION}`,
    {
      method: "POST",
      headers: {
        Origin: BASE,
        Referer: `${BASE}/`,
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: signInCookies.join("; "),
      },
    },
  );
  const jwt = (await mintRes.json().catch(() => null))?.jwt;
  if (!jwt) throw new Error("Session token mint failed");

  return {
    userId,
    email,
    jwt,
    clientUat,
    cleanup: async () => {
      try {
        await backend("DELETE", `/users/${userId}`);
      } catch {
        /* best-effort */
      }
    },
  };
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
      if (
        req.isNavigationRequest() &&
        resp.status() >= 300 &&
        resp.status() < 400 &&
        loc
      ) {
        await route.fulfill({
          status: 200,
          contentType: "text/html",
          body: `<script>location.replace(${JSON.stringify(new URL(loc, req.url()).href)})</script>`,
        });
        return;
      }
      await route.fulfill({ response: resp });
    } catch {
      await route.abort();
    }
  });
}

async function dismissOverlays(page) {
  for (const sel of [
    'button:has-text("SKIP")',
    'button:has-text("Skip")',
    'button:has-text("Got it")',
    'button:has-text("Close")',
    '[aria-label="Close"]',
    '[aria-label="close"]',
    ".modal-close",
    '[data-testid="dismiss"]',
    'button:has-text("Dismiss")',
  ]) {
    try {
      const el = page.locator(sel).first();
      if ((await el.count()) > 0 && (await el.isVisible())) {
        await el.click({ timeout: 2000 });
        await page.waitForTimeout(500);
      }
    } catch {
      /* ignore */
    }
  }
}

// ---------------------------------------------------------------------------
// Surface definitions
// ---------------------------------------------------------------------------
const SURFACES = {
  vector: {
    url: (ticker) => `${BASE}/vector?ticker=${encodeURIComponent(ticker)}`,
    waitFor: async (page) => {
      await page.waitForTimeout(6000);
      await dismissOverlays(page);
      await page.waitForTimeout(3000);
    },
    extractData: async (page) =>
      page.evaluate(() => {
        const q = (s) => document.querySelector(s);
        const all = (s) => document.querySelectorAll(s);
        return {
          spot: q("[class*='spot'], [class*='price-display'], .vector-gex-ladder-sub")?.textContent?.trim() ?? "",
          regime: q("[class*='regime'], .vector-regime-read")?.textContent?.trim() ?? "",
          ladderRows: all("[class*='ladder-row'], .vector-gex-ladder-row").length,
          hasCanvas: !!q("canvas"),
          terminal: q("[class*='terminal'], [class*='desk-terminal']")?.textContent?.trim()?.slice(0, 200) ?? "",
        };
      }),
    describe: "Vector GEX",
  },
  helix: {
    url: () => `${BASE}/helix`,
    waitFor: async (page) => {
      await page.waitForTimeout(6000);
      await dismissOverlays(page);
      await page.waitForTimeout(3000);
    },
    extractData: async (page) =>
      page.evaluate(() => {
        const all = (s) => document.querySelectorAll(s);
        return {
          anomalies: all("[class*='anomal'], .flow-anomaly-row").length,
          trades: all("[class*='tape-row'], .helix-tape-row, tr").length,
          topFlow: document.querySelector("[class*='tape-row'], .helix-tape-row")?.textContent?.trim()?.slice(0, 100) ?? "",
        };
      }),
    describe: "Helix Flow",
  },
  thermal: {
    url: (ticker) => `${BASE}/thermal?ticker=${encodeURIComponent(ticker)}`,
    waitFor: async (page) => {
      await page.waitForTimeout(7000);
      await dismissOverlays(page);
      await page.waitForTimeout(2000);
    },
    extractData: async (page) =>
      page.evaluate(() => ({
        hasCanvas: !!document.querySelector("canvas"),
        cells: document.querySelectorAll("[class*='cell'], td").length,
      })),
    describe: "Thermal Heatmap",
  },
  largo: {
    url: () => `${BASE}/largo`,
    waitFor: async (page) => {
      await page.waitForTimeout(5000);
      await dismissOverlays(page);
      await page.waitForTimeout(2000);
    },
    extractData: async () => ({}),
    describe: "Largo AI",
  },
  slayer: {
    url: () => `${BASE}/spx-slayer`,
    waitFor: async (page) => {
      await page.waitForTimeout(6000);
      await dismissOverlays(page);
      await page.waitForTimeout(2000);
    },
    extractData: async (page) =>
      page.evaluate(() => {
        const signals = document.querySelectorAll(
          "[class*='signal'], [class*='desk-signal'], [class*='trade-row']",
        ).length;
        return { signals };
      }),
    describe: "SPX Slayer",
  },
  nighthawk: {
    url: () => `${BASE}/night-hawk`,
    waitFor: async (page) => {
      await page.waitForTimeout(5000);
      await dismissOverlays(page);
      await page.waitForTimeout(2000);
    },
    extractData: async (page) =>
      page.evaluate(() => ({
        hasPlaybook: !!document.querySelector("[class*='playbook'], [class*='night-hawk']"),
        sections: document.querySelectorAll("section, [class*='section']").length,
      })),
    describe: "Night Hawk",
  },
};

// ---------------------------------------------------------------------------
// Surface auto-picker — rotates products, avoids repeats
// ---------------------------------------------------------------------------
function autoPickSurface() {
  const et = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/New_York" }),
  );
  const h = et.getHours();
  const dow = et.getDay();
  const isWeekend = dow === 0 || dow === 6;
  const history = loadHistory();
  const recent = (history.posts || []).slice(-5).map((p) => p.surface);

  // Weekend: educational / showcase surfaces
  if (isWeekend) {
    const weekendPool = ["vector", "thermal", "largo", "nighthawk", "helix"];
    const unused = weekendPool.filter((s) => !recent.includes(s));
    return unused.length ? unused[0] : weekendPool[Math.floor(Math.random() * weekendPool.length)];
  }

  // Weekday time-based with rotation
  const timeSlots = [
    { hours: [4, 7], pool: ["vector", "nighthawk"] },
    { hours: [7, 9], pool: ["vector", "thermal"] },
    { hours: [9, 11], pool: ["vector", "helix", "slayer"] },
    { hours: [11, 13], pool: ["helix", "thermal", "largo"] },
    { hours: [13, 15], pool: ["thermal", "helix", "vector"] },
    { hours: [15, 17], pool: ["vector", "slayer", "helix"] },
    { hours: [17, 19], pool: ["vector", "nighthawk"] },
    { hours: [19, 21], pool: ["largo", "thermal", "nighthawk"] },
    { hours: [21, 24], pool: ["nighthawk", "largo", "slayer"] },
    { hours: [0, 4], pool: ["nighthawk", "largo"] },
  ];

  const slot = timeSlots.find((s) => h >= s.hours[0] && h < s.hours[1]);
  const pool = slot ? slot.pool : ["vector"];
  const unused = pool.filter((s) => !recent.includes(s));
  return unused.length ? unused[0] : pool[0];
}

// ---------------------------------------------------------------------------
// Annotation engine — Sharp + SVG overlays
// ---------------------------------------------------------------------------
async function annotateScreenshot(buf, data, surface) {
  const meta = await sharp(buf).metadata();
  const w = meta.width;
  const h = meta.height;
  const els = [];

  // Bottom banner
  const bH = 52;
  els.push(
    `<rect x="0" y="${h - bH}" width="${w}" height="${bH}" fill="rgba(0,0,0,0.82)"/>`,
  );
  els.push(
    `<text x="${w / 2}" y="${h - 18}" fill="#00ffcc" font-size="19" font-family="monospace" text-anchor="middle" font-weight="bold">LIVE from BlackOut Trades  —  blackouttrades.com</text>`,
  );

  // Surface-specific callouts
  if (surface === "vector" && data.spot) {
    els.push(
      `<rect x="${w - 340}" y="12" width="325" height="46" rx="8" fill="rgba(0,0,0,0.85)" stroke="#00ffcc" stroke-width="2"/>`,
    );
    els.push(
      `<text x="${w - 178}" y="42" fill="#00ffcc" font-size="21" font-family="monospace" text-anchor="middle" font-weight="bold">${escSvg(data.spot)}</text>`,
    );
    if (data.regime) {
      const col = data.regime.toLowerCase().includes("negative") ||
        data.regime.toLowerCase().includes("short")
        ? "#ff4444"
        : "#00ff88";
      els.push(
        `<rect x="${w - 340}" y="64" width="325" height="34" rx="6" fill="rgba(0,0,0,0.85)" stroke="${col}" stroke-width="1.5"/>`,
      );
      els.push(
        `<text x="${w - 178}" y="87" fill="${col}" font-size="14" font-family="monospace" text-anchor="middle">${escSvg(data.regime.slice(0, 50))}</text>`,
      );
    }
  }

  if (surface === "helix") {
    const label = data.anomalies
      ? `${data.anomalies} Flow Anomalies Detected`
      : `${data.trades || "?"} Live Trades on Tape`;
    els.push(
      `<rect x="12" y="12" width="320" height="38" rx="6" fill="rgba(255,50,50,0.88)"/>`,
    );
    els.push(
      `<text x="172" y="37" fill="white" font-size="16" font-family="monospace" text-anchor="middle" font-weight="bold">${escSvg(label)}</text>`,
    );
  }

  if (surface === "thermal") {
    els.push(
      `<rect x="12" y="12" width="280" height="38" rx="6" fill="rgba(180,60,255,0.85)"/>`,
    );
    els.push(
      `<text x="152" y="37" fill="white" font-size="16" font-family="monospace" text-anchor="middle" font-weight="bold">GEX Heatmap — LIVE</text>`,
    );
  }

  if (surface === "slayer") {
    const ct = data.signals || "?";
    els.push(
      `<rect x="12" y="12" width="300" height="38" rx="6" fill="rgba(255,165,0,0.88)"/>`,
    );
    els.push(
      `<text x="162" y="37" fill="black" font-size="16" font-family="monospace" text-anchor="middle" font-weight="bold">${ct} Live 0DTE Signals</text>`,
    );
  }

  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">${els.join("")}</svg>`;

  return sharp(buf)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer();
}

function escSvg(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Largo interaction
// ---------------------------------------------------------------------------
async function askLargo(page, question) {
  const surface = SURFACES.largo;
  await page.goto(surface.url(), {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await surface.waitFor(page);

  const input = page
    .locator(
      'textarea, input[type="text"], [contenteditable="true"], [data-testid="largo-input"]',
    )
    .first();
  if (await input.count()) {
    await input.fill(question);
    await page.waitForTimeout(500);
    const submit = page
      .locator(
        'button[type="submit"], [data-testid="largo-send"], button:has-text("Send"), button:has-text("Ask")',
      )
      .first();
    if (await submit.count()) {
      await submit.click();
    } else {
      await input.press("Enter");
    }
    await page.waitForTimeout(18000);
  }

  return page.screenshot({ type: "png" });
}

// ---------------------------------------------------------------------------
// Tweet text templates — unique, creative, product-specific
// ---------------------------------------------------------------------------
const TAG = "@blackouttrade";
const SITE = "www.blackouttrades.com";

function buildTweetText(surface, data, ticker) {
  const history = loadHistory();
  const recentTexts = (history.posts || []).slice(-10).map((p) => p.textHash);

  const templates = {
    vector: [
      (d) => {
        const spot = extractNum(d.spot);
        const regime = d.regime?.toLowerCase().includes("negative") ? "short gamma" : "long gamma";
        if (spot) return `${ticker} ${spot} in ${regime}\n\nEvery wall. Every flip. Real-time.\nThis is what the other side of your trade sees.`;
        return `${ticker} GEX walls forming live on Vector right now\n\nThe walls don't lie. Neither does the flip level.`;
      },
      (d) => {
        const spot = extractNum(d.spot);
        return spot
          ? `${ticker} at ${spot}\n\nDealer positioning just shifted. The walls tell you where price goes next.\nWe just show it.`
          : `Real-time dealer positioning on ${ticker}\n\nWalls forming, fading, growing — you're watching market makers hedge live.`;
      },
      (d) => {
        const rows = d.ladderRows || 0;
        return rows > 3
          ? `${rows} active GEX levels on ${ticker} right now\n\nEach one is a wall market makers are defending. You seeing this?`
          : `The ${ticker} GEX ladder is live\n\nFlip level, call walls, put walls — animated beads showing dealer flow in real-time.`;
      },
    ],
    helix: [
      (d) => {
        const n = d.anomalies || d.trades;
        return n
          ? `${n} prints just hit the Helix tape\n\nWhen someone drops size, we see it first. Every. Single. Trade.`
          : `The flow tape never sleeps\n\nEvery large trade, every anomaly, every whale print — live on Helix.`;
      },
      () => `Something just hit the tape\n\nHelix caught it. Did you?\nLive options flow — filtered by size, sentiment, unusual activity.`,
      () => `You ever wonder what the smart money is doing right now?\n\nWe literally show you. Every print. Real-time.\nHelix flow tape.`,
    ],
    thermal: [
      () => `The heatmap just went dark red\n\nThermal shows where dealers are TRAPPED — every strike, every expiration.\nOne glance tells you more than an hour of scrolling.`,
      () => `GEX Thermal — the positioning heatmap\n\nHot zones = dealer exposure. Red = danger. Green = pinned.\nYou're looking at the battlefield from above.`,
      () => `If you're not reading the heatmap you're trading blind\n\nBlackOut Thermal: GEX across dozens of strikes and expirations at once.\nThe heat doesn't lie.`,
    ],
    largo: [
      () => `Just asked our AI terminal a question\n\nLargo pulled GEX data, flow analysis, regime status, and dark pool levels.\nAnswered in 3 seconds. With sources.`,
      () => `"What's the play on SPX today?"\n\nLargo doesn't guess. It pulls from every data source we have and gives you a straight answer.\nLike having a quant on speed dial.`,
      () => `Largo just dropped a take\n\nReal data, not vibes. Real analysis, not hopium.\nAsk it anything about the market. It reads.`,
    ],
    slayer: [
      (d) => {
        const ct = d.signals || "";
        return ct
          ? `${ct} live 0DTE signals on the desk right now\n\nTier-graded. Auto-exits. Real-time P&L.\nSPX Slayer doesn't sleep.`
          : `SPX Slayer — the 0DTE trading desk\n\nAI signals with live P&L tracking. A+ through F tier grades.\nYour 0DTE edge, automated.`;
      },
      () => `The desk is running\n\nLive 0DTE signals. Tier-graded setups. Automatic exit intelligence.\nSPX Slayer tracks everything so you don't have to.`,
      () => `Your 0DTE trading desk just got an upgrade\n\nSPX Slayer: AI signals, real-time P&L, merit-based tier grading.\nEvery signal earned its grade.`,
    ],
    nighthawk: [
      () => `While you were sleeping, Night Hawk was building your playbook\n\nOvernight positioning shifts → AI-generated 0DTE game plan.\nEntry levels. Targets. Stops. Before the bell.`,
      () => `The Night Hawk playbook just dropped\n\nOvernight GEX shifts, positioning changes, AI game plan for tomorrow.\nPrepared traders win. Unprepared traders donate.`,
      () => `Night Hawk sees what happens after hours\n\nEvery positioning shift overnight, turned into a 0DTE playbook by open.\nThe market sleeps. Your edge doesn't.`,
    ],
  };

  const pool = templates[surface] || templates.vector;
  // Pick a template that hasn't been used recently
  for (const fn of pool) {
    const text = fn(data);
    const hash = crypto.createHash("md5").update(text.slice(0, 60)).digest("hex").slice(0, 8);
    if (!recentTexts.includes(hash)) {
      return { text: `${text}\n\n${TAG} ${SITE}`, hash };
    }
  }
  // Fallback: use first template anyway
  const text = pool[0](data);
  const hash = crypto.createHash("md5").update(text.slice(0, 60)).digest("hex").slice(0, 8);
  return { text: `${text}\n\n${TAG} ${SITE}`, hash };
}

function extractNum(s) {
  const m = s?.match(/([\d,]+\.\d+)/);
  return m ? m[1] : "";
}

function truncateTweet(text) {
  const T_CO = 23;
  const maxTotal = 280 - T_CO + SITE.length;
  if (text.length <= maxTotal) return text;
  const footerIdx = text.lastIndexOf(`\n\n${TAG}`);
  if (footerIdx < 0) return text.slice(0, maxTotal);
  const footer = text.slice(footerIdx);
  const body = text.slice(0, footerIdx);
  return body.slice(0, maxTotal - footer.length - 1).trimEnd() + "…" + footer;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log("[x-live-autopost] Starting...");
  console.log(`  Target: PRODUCTION (${BASE})`);

  const secrets = loadSecrets();
  const xCreds = {
    ck: secrets.X_API_KEY,
    cs: secrets.X_API_KEY_SECRET,
    at: secrets.X_ACCESS_TOKEN,
    ats: secrets.X_ACCESS_TOKEN_SECRET,
  };
  if (!xCreds.ck || !xCreds.cs || !xCreds.at || !xCreds.ats) {
    console.error("[x-live-autopost] X API credentials not found in secrets");
    process.exit(1);
  }

  const surface = SURFACE === "auto" ? autoPickSurface() : SURFACE;
  console.log(`  Surface: ${surface}, Ticker: ${TICKER}`);

  // Clerk auth
  console.log("  Minting Clerk session...");
  const auth = await mintClerkSession(secrets);
  console.log(`  Logged in as ${auth.email} (user ${auth.userId})`);

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox"],
    executablePath: existsSync("/opt/pw-browsers/chromium")
      ? (() => {
          try {
            const entries = execSync(
              "find /opt/pw-browsers/chromium -name chrome -o -name chromium -o -name headless_shell",
              { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
            ).trim().split("\n").filter(Boolean);
            return entries[0] || undefined;
          } catch { return undefined; }
        })()
      : undefined,
  });

  const ctx = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
  });

  // Inject Clerk session cookies
  await ctx.addCookies([
    {
      name: "__session",
      value: auth.jwt,
      domain: ".blackouttrades.com",
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
    {
      name: "__client_uat",
      value: String(auth.clientUat),
      domain: ".blackouttrades.com",
      path: "/",
      httpOnly: false,
      secure: true,
      sameSite: "Lax",
    },
  ]);

  await proxyRoute(ctx);
  const page = await ctx.newPage();

  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
  });

  try {
    let screenshotBuf;
    let extractedData = {};

    if (LARGO_Q) {
      console.log(`  Asking Largo: "${LARGO_Q}"`);
      screenshotBuf = await askLargo(page, LARGO_Q);
      extractedData = { question: LARGO_Q };
    } else {
      const surfaceCfg = SURFACES[surface];
      if (!surfaceCfg) {
        console.error(`Unknown surface: ${surface}`);
        process.exit(1);
      }
      const url = surfaceCfg.url(TICKER);
      console.log(`  Navigating to ${url}`);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await surfaceCfg.waitFor(page);
      extractedData = await surfaceCfg.extractData(page);
      console.log(`  Data: ${JSON.stringify(extractedData)}`);
      screenshotBuf = await page.screenshot({ type: "png" });
    }

    if (ANNOTATE) {
      console.log("  Annotating...");
      screenshotBuf = await annotateScreenshot(
        screenshotBuf,
        extractedData,
        surface,
      );
    }

    const shotPath = join(
      OUT,
      `x-live-${surface}-${TICKER}-${Date.now()}.png`,
    );
    writeFileSync(shotPath, screenshotBuf);
    console.log(`  Screenshot: ${shotPath}`);

    const { text: rawText, hash: textHash } =
      TWEET_TEXT
        ? { text: `${TWEET_TEXT}\n\n${TAG} ${SITE}`, hash: "manual" }
        : buildTweetText(surface, extractedData, TICKER);
    const tweetText = truncateTweet(rawText);
    console.log(
      `  Tweet (${tweetText.length} chars):\n  ${tweetText.replace(/\n/g, "\n  ")}`,
    );

    if (DRY) {
      console.log("\n  DRY RUN — not posting");
    } else {
      console.log("  Uploading image...");
      const mediaId = await uploadMedia(screenshotBuf, xCreds);
      console.log(`  Media: ${mediaId}`);
      console.log("  Posting tweet...");
      const result = await postTweet(tweetText, mediaId, xCreds);
      console.log(`  Posted! https://x.com/IHate0dte/status/${result.id}`);

      // Record in history
      const history = loadHistory();
      history.posts = history.posts || [];
      history.posts.push({
        id: result.id,
        surface,
        ticker: TICKER,
        textHash,
        ts: new Date().toISOString(),
      });
      if (history.posts.length > 100) history.posts = history.posts.slice(-100);
      saveHistory(history);
    }

    console.log(`Done (${consoleErrors.length} console errors)`);
  } catch (err) {
    try {
      const errShot = await page.screenshot({ type: "png" });
      const errPath = join(OUT, `x-live-error-${Date.now()}.png`);
      writeFileSync(errPath, errShot);
      console.error(`  Error screenshot: ${errPath}`);
    } catch {
      /* ignore */
    }
    console.error(`ERROR: ${err.message}`);
    process.exit(1);
  } finally {
    console.log("  Cleaning up Clerk user...");
    await auth.cleanup();
    await browser.close();
  }
}

main();
