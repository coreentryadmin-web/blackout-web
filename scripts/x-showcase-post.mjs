#!/usr/bin/env node
/**
 * Full-platform X showcase — prod UI screenshots → collage → @BlackOutTrade post.
 *
 * Usage:
 *   node scripts/x-showcase-post.mjs --ticker NVDA [--dry]
 */
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";
import crypto from "node:crypto";

const args = process.argv.slice(2);
const flag = (k) => args.includes(`--${k}`);
const opt = (k, def) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};

const BASE = "https://blackouttrades.com";
const TICKER = opt("ticker", "NVDA").toUpperCase();
const DRY = flag("dry");
const OUT = "/opt/cursor/artifacts/x-showcase";
mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------------------
// Secrets + X OAuth (from x-live-autopost.mjs)
// ---------------------------------------------------------------------------
function loadSecrets() {
  const raw = execSync(
    "aws secretsmanager get-secret-value --secret-id blackout-production/app/env --query SecretString --output text",
    { encoding: "utf8" },
  ).trim();
  return JSON.parse(raw);
}

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
  const paramStr = Object.keys(all)
    .sort()
    .map((k) => `${pctEnc(k)}=${pctEnc(all[k])}`)
    .join("&");
  const baseStr = `${method}&${pctEnc(url)}&${pctEnc(paramStr)}`;
  const sigKey = `${pctEnc(xCreds.cs)}&${pctEnc(xCreds.ats)}`;
  const sig = crypto.createHmac("sha1", sigKey).update(baseStr).digest("base64");
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
  const params = { media_data: buf.toString("base64"), media_category: "tweet_image" };
  const auth = oauthHeader("POST", MEDIA_URL, xCreds, params);
  const body = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  const res = await fetch(MEDIA_URL, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Media upload failed: ${await res.text()}`);
  return (await res.json()).media_id_string;
}

async function postTweet(text, mediaIds, xCreds) {
  const TWEET_URL = "https://api.x.com/2/tweets";
  const payload = { text };
  if (mediaIds?.length) payload.media = { media_ids: mediaIds.slice(0, 4) };
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
// Clerk session mint
// ---------------------------------------------------------------------------
const CLERK_API = "https://api.clerk.com/v1";
const CLERK_JS_VERSION = "5.57.0";

function fapiHost(publishableKey) {
  try {
    const decoded = Buffer.from(publishableKey.replace(/^pk_(live|test)_/, ""), "base64")
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
  const tag = crypto.randomInt(1000, 9999);
  const email = `showcase.${tag}@gmail.com`;
  const phone = `+1415555${String(crypto.randomInt(0, 10000)).padStart(4, "0")}`;

  const backend = (method, path, body) =>
    fetch(`${CLERK_API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });

  const createRes = await backend("POST", "/users", {
    email_address: [email],
    phone_number: [phone],
    public_metadata: { role: "admin", tier: "premium" },
    skip_password_requirement: true,
    skip_legal_checks: true,
  });
  const created = await createRes.json();
  const userId = created?.id;
  if (!userId) throw new Error("Clerk user create failed");

  const ticket = (await (await backend("POST", "/sign_in_tokens", { user_id: userId })).json())?.token;
  if (!ticket) throw new Error("sign_in_token failed");

  return {
    userId,
    ticket,
    cleanup: () => backend("DELETE", `/users/${userId}`),
  };
}

async function signInWithTicket(page, ticket) {
  await page.goto(`${BASE}/sign-in?__clerk_ticket=${encodeURIComponent(ticket)}`, {
    waitUntil: "networkidle",
    timeout: 90_000,
  });
  if (page.url().includes("/sign-in") && !page.url().includes("accounts.")) {
    throw new Error(`Sign-in did not complete: ${page.url()}`);
  }
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(2000);
}

async function dismissOverlays(page) {
  for (const sel of [
    'button:has-text("SKIP")',
    'button:has-text("Got it")',
    '[aria-label="Close"]',
  ]) {
    try {
      const el = page.locator(sel).first();
      if ((await el.count()) > 0 && (await el.isVisible())) {
        await el.click({ timeout: 1500 });
        await page.waitForTimeout(400);
      }
    } catch {
      /* ignore */
    }
  }
}

const PANELS = [
  { key: "vector", label: "Vector GEX", url: (t) => `${BASE}/vector?ticker=${t}`, wait: 8000 },
  { key: "helix", label: "Helix Flow", url: () => `${BASE}/flows`, wait: 7000 },
  { key: "thermal", label: "Thermal", url: (t) => `${BASE}/heatmap?ticker=${t}`, wait: 8000 },
  { key: "slayer", label: "SPX Slayer", url: () => `${BASE}/dashboard`, wait: 7000 },
  { key: "largo", label: "Largo AI", url: () => `${BASE}/terminal`, wait: 6000 },
  { key: "nighthawk", label: "Night Hawk", url: () => `${BASE}/nighthawk`, wait: 6000 },
];

function escSvg(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function labelPanel(buf, label, sub, cellW, cellH) {
  const resized = await sharp(buf)
    .resize(cellW, cellH, { fit: "cover", position: "top" })
    .png()
    .toBuffer();
  const barH = 36;
  const barSvg = Buffer.from(`<svg width="${cellW}" height="${barH}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${cellW}" height="${barH}" fill="#0a0e14"/>
    <text x="12" y="24" fill="#6ee7b7" font-family="system-ui,sans-serif" font-size="16" font-weight="700">${escSvg(label)}</text>
    <text x="${cellW - 12}" y="24" fill="#64748b" font-family="system-ui,sans-serif" font-size="13" text-anchor="end">${escSvg(sub)}</text>
  </svg>`);
  return sharp({
    create: { width: cellW, height: cellH + barH, channels: 4, background: "#0a0e14" },
  })
    .composite([
      { input: resized, top: 0, left: 0 },
      { input: barSvg, top: cellH, left: 0 },
    ])
    .png()
    .toBuffer();
}

async function buildCollage(buffers, ticker) {
  const cellW = 600;
  const cellH = 380;
  const labeled = [];
  for (const item of buffers) {
    labeled.push(await labelPanel(item.buf, item.label, ticker, cellW, cellH));
  }

  const rowH = cellH + 36;
  const gridW = cellW * 2;
  const gridH = rowH * 3;
  const headerH = 72;
  const footerH = 48;
  const totalH = headerH + gridH + footerH;

  const composites = labeled.map((buf, i) => ({
    input: buf,
    top: headerH + Math.floor(i / 2) * rowH,
    left: (i % 2) * cellW,
  }));

  const headerSvg = Buffer.from(`<svg width="${gridW}" height="${headerH}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${gridW}" height="${headerH}" fill="#06080c"/>
    <text x="24" y="46" fill="#e2e8f0" font-family="system-ui,sans-serif" font-size="28" font-weight="700">${escSvg(ticker)} — full desk snapshot</text>
    <text x="${gridW - 24}" y="46" fill="#94a3b8" font-family="system-ui,sans-serif" font-size="18" text-anchor="end">LIVE · blackouttrades.com</text>
  </svg>`);

  const footerSvg = Buffer.from(`<svg width="${gridW}" height="${footerH}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${gridW}" height="${footerH}" fill="#0f172a"/>
    <text x="${gridW / 2}" y="30" fill="#cbd5e1" font-family="system-ui,sans-serif" font-size="15" text-anchor="middle">Vector · Helix · Thermal · SPX Slayer · Largo · Night Hawk</text>
  </svg>`);

  const base = await sharp({
    create: { width: gridW, height: totalH, channels: 4, background: "#06080c" },
  })
    .png()
    .toBuffer();

  return sharp(base)
    .composite([
      { input: headerSvg, top: 0, left: 0 },
      ...composites,
      { input: footerSvg, top: headerH + gridH, left: 0 },
    ])
    .png()
    .toBuffer();
}

function buildTweet(ticker) {
  const whop = "whop.com/blackout-2d9c?utm_source=x&utm_medium=social&utm_campaign=showcase";
  const lines = [
    `${ticker} isn't moving on vibes.`,
    "",
    "Six tools. One desk. Real dealer positioning, live flow, GEX heat, 0DTE signals, AI reads, overnight playbook.",
    "",
    "This is what we see before the candle prints.",
    "",
    `@BlackOutTrade ${whop}`,
  ];
  let text = lines.join("\n");
  if (text.length > 280) {
    text = `${ticker} isn't moving on vibes.\n\nSix tools on one desk — GEX, flow, heatmap, 0DTE signals, Largo AI, Night Hawk.\n\nThis is what we see before the candle.\n\n@BlackOutTrade ${whop}`;
  }
  if (text.length > 280) text = text.slice(0, 277) + "…";
  return text;
}

async function main() {
  console.log(`[x-showcase] ticker=${TICKER} dry=${DRY}`);
  const secrets = loadSecrets();
  const xCreds = {
    ck: secrets.X_API_KEY,
    cs: secrets.X_API_KEY_SECRET,
    at: secrets.X_ACCESS_TOKEN,
    ats: secrets.X_ACCESS_TOKEN_SECRET,
  };

  const auth = await mintClerkSession(secrets);
  console.log(`Clerk user ${auth.userId}`);

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await ctx.addInitScript(() => {
    try {
      window.localStorage.setItem("blackout:onboarding:v", "2");
    } catch {
      /* ignore */
    }
  });
  const page = await ctx.newPage();

  const captures = [];
  try {
    await signInWithTicket(page, auth.ticket);
    console.log("  Signed in via Clerk ticket");
    for (const panel of PANELS) {
      const url = panel.url(TICKER);
      console.log(`  → ${panel.label}: ${url}`);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForTimeout(panel.wait);
      await dismissOverlays(page);
      await page.waitForTimeout(1500);
      const buf = await page.screenshot({ type: "png" });
      const path = join(OUT, `${panel.key}-${TICKER}.png`);
      writeFileSync(path, buf);
      captures.push({ label: panel.label, buf, path });
      console.log(`    saved ${path}`);
    }

    const collage = await buildCollage(captures, TICKER);
    const collagePath = join(OUT, `showcase-${TICKER}-collage.png`);
    writeFileSync(collagePath, collage);
    console.log(`Collage: ${collagePath} (${collage.length} bytes)`);

    const tweetText = buildTweet(TICKER);
    console.log(`Tweet (${tweetText.length} chars):\n${tweetText}\n`);

    if (DRY) {
      console.log("DRY — not posting");
      return;
    }

    const mediaId = await uploadMedia(collage, xCreds);
    const result = await postTweet(tweetText, [mediaId], xCreds);
    const url = `https://x.com/BlackOutTrade/status/${result.id}`;
    console.log(`POSTED ${url}`);
    writeFileSync(join(OUT, "post-result.json"), JSON.stringify({ tweetId: result.id, url, ticker: TICKER }, null, 2));
  } finally {
    await auth.cleanup();
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
