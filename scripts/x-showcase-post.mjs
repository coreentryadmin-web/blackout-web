#!/usr/bin/env node
/**
 * Full-platform X showcase — prod UI screenshots → collage → optional @BlackOutTrade post.
 *
 * Defaults to DRY (screenshots + manifest only). Live posts require explicit --post
 * and timeline verification before success is reported.
 *
 * Usage:
 *   node scripts/x-showcase-post.mjs --ticker NVDA
 *   node scripts/x-showcase-post.mjs --ticker SPX --post
 *   node scripts/x-showcase-post.mjs --mode platform --steps slayer,helix,thermal --post
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
const TICKER = opt("ticker", "SPX").toUpperCase();
const MODE = opt("mode", "ticker");
const STEPS_OPT = opt("steps", "");
const POST = flag("post");
const REUSE_COLLAGE = flag("reuse-collage");
const VERIFY_WAIT_MS = Number(opt("verify-wait-ms", "90000")) || 90_000;
const VERIFY_POLL_MS = Number(opt("verify-poll-ms", "15000")) || 15_000;
const OUT = "/opt/cursor/artifacts/x-showcase";
const X_ACCOUNT_USER_ID = "2055511397338087425";
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Validate X tweet ids before persisting API payloads to disk (CodeQL taint). */
function assertSafeTweetId(id) {
  const s = String(id ?? "").trim();
  if (!/^\d{5,25}$/.test(s)) {
    throw new Error("Refusing to persist invalid tweet id from API");
  }
  return s;
}

function tweetPublicUrl(tweetId) {
  return `https://x.com/BlackOutTrade/status/${assertSafeTweetId(tweetId)}`;
}

function safeTickerSymbol(raw) {
  const t = String(raw ?? "SPX").trim().toUpperCase();
  if (!/^[A-Z0-9.$-]{1,12}$/.test(t)) {
    throw new Error("Invalid ticker symbol");
  }
  return t;
}

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

async function oauthGet(url, xCreds) {
  const u = new URL(url);
  const base = `${u.origin}${u.pathname}`;
  const queryParams = {};
  u.searchParams.forEach((v, k) => {
    queryParams[k] = v;
  });
  const auth = oauthHeader("GET", base, xCreds, queryParams);
  return fetch(url, { headers: { Authorization: auth } });
}

async function fetchTweetById(id, xCreds) {
  const safeId = assertSafeTweetId(id);
  const url = `https://api.x.com/2/tweets/${safeId}?tweet.fields=author_id,created_at`;
  const res = await oauthGet(url, xCreds);
  if (res.status === 404) return null;
  if (!res.ok) return null;
  const json = await res.json();
  return json.data ?? null;
}

async function fetchUserTweets(userId, maxResults, xCreds) {
  const params = new URLSearchParams({
    max_results: String(Math.min(Math.max(maxResults, 5), 100)),
    exclude: "retweets,replies",
    "tweet.fields": "author_id,created_at,public_metrics",
  });
  const url = `https://api.x.com/2/users/${userId}/tweets?${params}`;
  const res = await oauthGet(url, xCreds);
  if (!res.ok) return [];
  const json = await res.json();
  return json.data ?? [];
}

/** Poll until tweet is fetchable and appears on @BlackOutTrade timeline. */
async function verifyTweetPersisted(tweetId, xCreds) {
  const deadline = Date.now() + VERIFY_WAIT_MS;
  let attempts = 0;
  while (Date.now() < deadline) {
    attempts += 1;
    const direct = await fetchTweetById(tweetId, xCreds);
    const timeline = await fetchUserTweets(X_ACCOUNT_USER_ID, 10, xCreds);
    const onTimeline = timeline.some((t) => t.id === tweetId);
    if (direct?.id === tweetId && onTimeline) {
      return { verified: true, attempts, direct, onTimeline: true };
    }
    console.log(
      `  verify attempt ${attempts}: direct=${direct?.id === tweetId ? "ok" : "missing"} timeline=${onTimeline ? "ok" : "missing"}`,
    );
    await sleep(VERIFY_POLL_MS);
  }
  throw new Error(
    `Tweet ${tweetId} not verified on @BlackOutTrade after ${VERIFY_WAIT_MS}ms — do not treat as posted (X moderation or API lag)`,
  );
}

function writeManifest(manifest) {
  const path = join(OUT, "manifest.json");
  writeFileSync(path, JSON.stringify(manifest, null, 2));
  console.log(`Manifest: ${path}`);
  return path;
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

/** Fail fast if the UI is still on a different symbol than the post ticker. */
async function assertActiveTicker(page, ticker, surface) {
  const sym = ticker.toUpperCase();
  const ok = await page.waitForFunction(
    (expected) => {
      const checks = [
        document.querySelector('button[aria-label*="Change ticker"]')?.textContent ?? "",
        document.querySelector("#helix-ticker-search")?.value ?? "",
        document.querySelector('[data-testid="vector-ticker-search"]')?.value ?? "",
        location.search,
        location.pathname + location.search,
      ].join(" ");
      return checks.toUpperCase().includes(expected);
    },
    sym,
    { timeout: 20_000 },
  ).then(() => true).catch(() => false);

  if (!ok) {
    throw new Error(`${surface}: UI never switched to ${sym} — refusing to screenshot wrong ticker`);
  }
}

/** Thermal has no URL ticker param — must use the searchable combobox (defaults to SPY). */
async function selectThermalTicker(page, ticker) {
  const sym = ticker.toUpperCase();
  await page.goto(`${BASE}/heatmap`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await dismissOverlays(page);
  await page.waitForSelector(".gex-heatmap-desk", { timeout: 45_000 });
  await page.waitForTimeout(2000);

  const trigger = page.locator('button[aria-label*="Change ticker"]').first();
  await trigger.click();
  const search = page.locator('input[aria-label="Search any ticker"]').first();
  await search.waitFor({ state: "visible", timeout: 10_000 });
  await search.fill(sym);
  await page.waitForTimeout(1200);

  const option = page.locator("#ticker-listbox button").filter({ hasText: sym }).first();
  if (await option.count()) {
    await option.click();
  } else {
    await search.press("Enter");
  }

  await page.waitForFunction(
    (expected) =>
      (document.querySelector('button[aria-label*="Change ticker"]')?.textContent ?? "").toUpperCase()
        .includes(expected),
    sym,
    { timeout: 15_000 },
  );
  await page.waitForTimeout(5000);
  await assertActiveTicker(page, sym, "Thermal");
}

/** Helix tape filter — must set Symbol input, not screenshot default SPX/SPY tape. */
async function filterHelixTicker(page, ticker) {
  const sym = ticker.toUpperCase();
  await page.goto(`${BASE}/flows`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await dismissOverlays(page);
  await page.waitForTimeout(4000);

  const search = page.locator("#helix-ticker-search").first();
  await search.waitFor({ state: "visible", timeout: 20_000 });
  await search.click();
  await search.fill("");
  await search.pressSequentially(sym, { delay: 60 });
  await search.press("Tab");

  await page.waitForFunction(
    (expected) => document.querySelector("#helix-ticker-search")?.value === expected,
    sym,
    { timeout: 10_000 },
  );
  await page.waitForTimeout(4000);
  await assertActiveTicker(page, sym, "Helix");
}

async function waitForHelixTapeScoped(page, ticker) {
  const sym = ticker.toUpperCase();
  await page.waitForFunction(
    (expected) => {
      const input = document.querySelector("#helix-ticker-search");
      if (input?.value !== expected) return false;
      if (document.body.innerText.includes(`No prints for ${expected}`)) return true;
      const symbols = [...document.querySelectorAll(".helix-tape-symbol-text")];
      if (symbols.length === 0) return false;
      return symbols.every((el) => el.textContent?.trim().toUpperCase() === expected);
    },
    sym,
    { timeout: 45_000 },
  );
}

function resolvePlan(ticker) {
  if (MODE === "platform") {
    const steps = STEPS_OPT
      ? STEPS_OPT.split(",").map((s) => s.trim()).filter(Boolean)
      : ["slayer", "helix", "thermal"];
    return {
      title: "BlackOut — live options desk",
      footer: "SPX Slayer · HELIX · Thermal · Premium on Whop",
      steps,
    };
  }
  if (STEPS_OPT) {
    const base = showcasePlan(ticker);
    return {
      ...base,
      steps: STEPS_OPT.split(",").map((s) => s.trim()).filter(Boolean),
    };
  }
  return showcasePlan(ticker);
}

/** Which surfaces belong in a ticker-scoped post (no unrelated product dumps). */
function showcasePlan(ticker) {
  const isSpx = ticker === "SPX" || ticker === "SPXW";
  if (isSpx) {
    return {
      title: `${ticker} — 0DTE desk`,
      footer: "Vector · Helix · Thermal · SPX Slayer · Night Hawk · Largo",
      steps: ["vector", "helix", "thermal", "slayer", "nighthawk", "largo"],
    };
  }
  return {
    title: `${ticker} — dealer positioning`,
    footer: `Vector · Helix · Thermal · Largo — ${ticker} only`,
    steps: ["vector", "helix", "thermal", "largo"],
  };
}

/** Vector: 0DTE + 15m timeframe → full session beads visible in chart element. */
async function captureVector0Dte(page, ticker) {
  const url = `${BASE}/vector?ticker=${encodeURIComponent(ticker)}`;
  console.log(`  → Vector 0DTE chart: ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector(".vector-chart-wrap", { timeout: 45_000 });
  await dismissOverlays(page);
  await page.waitForTimeout(3000);

  const dteBtn = page.locator('[data-testid="vector-dte-0dte"]');
  await dteBtn.waitFor({ state: "visible", timeout: 15_000 });
  await dteBtn.click();
  await page.waitForTimeout(4000);

  const tf = page.locator("#vector-tf-select");
  await tf.selectOption("15");
  await page.waitForTimeout(5000);

  await assertActiveTicker(page, ticker, "Vector");
  const chart = page.locator(".vector-chart-wrap").first();
  await chart.waitFor({ state: "visible" });
  const buf = await chart.screenshot({ type: "png" });
  const path = join(OUT, `vector-0dte-${ticker}.png`);
  writeFileSync(path, buf);
  console.log(`    saved ${path}`);
  return { key: "vector", label: "Vector · 0DTE beads", buf, path, hero: true };
}

/** Helix: filter tape to the post ticker only. */
async function captureHelixTicker(page, ticker) {
  console.log(`  → Helix Flow (${ticker} only): ${BASE}/flows`);
  await filterHelixTicker(page, ticker);

  const hideAnalytics = page.getByRole("button", { name: "Hide analytics" });
  if (await hideAnalytics.count()) {
    await hideAnalytics.click();
    await page.waitForTimeout(800);
  }

  await waitForHelixTapeScoped(page, ticker);

  const panel = page.locator(".helix-desk-terminal").first();
  const buf = await panel.screenshot({ type: "png" });
  const path = join(OUT, `helix-${ticker}.png`);
  writeFileSync(path, buf);
  console.log(`    saved ${path}`);
  return { key: "helix", label: `Helix · ${ticker} flow`, buf, path };
}

/** Thermal heatmap — search combobox for ticker (page always boots SPY). */
async function captureThermal(page, ticker) {
  console.log(`  → Thermal (${ticker}): search + select in UI`);
  await selectThermalTicker(page, ticker);

  const panel = page.locator(".gex-heatmap-desk").first();
  const buf = await panel.screenshot({ type: "png" });
  const path = join(OUT, `thermal-${ticker}.png`);
  writeFileSync(path, buf);
  console.log(`    saved ${path}`);
  return { key: "thermal", label: `Thermal · ${ticker} GEX`, buf, path };
}

/** SPX Slayer desk — only for SPX/SPXW posts. */
async function captureSlayer(page, ticker) {
  console.log(`  → SPX Slayer: ${BASE}/dashboard`);
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await dismissOverlays(page);
  await page.waitForTimeout(7000);
  const buf = await page.screenshot({ type: "png" });
  const path = join(OUT, `slayer-${ticker}.png`);
  writeFileSync(path, buf);
  console.log(`    saved ${path}`);
  return { key: "slayer", label: "SPX Slayer", buf, path };
}

/** Night Hawk — only when SPX desk story includes overnight playbook. */
async function captureNighthawk(page, ticker) {
  console.log(`  → Night Hawk: ${BASE}/nighthawk`);
  await page.goto(`${BASE}/nighthawk`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await dismissOverlays(page);
  await page.waitForTimeout(6000);
  const buf = await page.screenshot({ type: "png" });
  const path = join(OUT, `nighthawk-${ticker}.png`);
  writeFileSync(path, buf);
  console.log(`    saved ${path}`);
  return { key: "nighthawk", label: "Night Hawk", buf, path };
}

/** Largo: ask a real ticker question and screenshot the answered thread. */
async function captureLargoAnswer(page, ticker) {
  const question = `What's the ${ticker} gamma setup right now? Flip level, call/put walls, and dealer regime.`;
  console.log(`  → Largo AI: ${question}`);
  await page.goto(`${BASE}/terminal`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await dismissOverlays(page);

  const input = page.locator('input[aria-label="Ask Largo"]').first();
  await input.waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForFunction(
    () => {
      const el = document.querySelector('input[aria-label="Ask Largo"]');
      return el && !el.disabled;
    },
    { timeout: 30_000 },
  );

  await input.fill(question);
  await page.waitForTimeout(400);
  const submit = page.locator('.largo-input-form button[type="submit"]').first();
  if (await submit.count()) await submit.click();
  else await input.press("Enter");

  await page.waitForSelector(".desk-largo-assistant, .largo-msg-assistant", {
    timeout: 60_000,
  });
  await page.waitForFunction(
    () => {
      const stopBtn = document.querySelector('.largo-stop-btn, [aria-label="Stop generating"]');
      if (stopBtn && stopBtn.offsetParent !== null) return false;
      const nodes = document.querySelectorAll(".desk-largo-assistant, .largo-msg-assistant");
      const last = nodes[nodes.length - 1];
      const text = last?.textContent?.trim() ?? "";
      return text.length > 180 && !/working|pulling live|thinking/i.test(text.slice(0, 40));
    },
    { timeout: 120_000 },
  );
  await page.waitForTimeout(2500);

  const panel = page.locator(".largo-terminal-fullpage, .desk-largo-panel, main").first();
  const buf = await panel.screenshot({ type: "png" });
  const path = join(OUT, `largo-${ticker}.png`);
  writeFileSync(path, buf);
  console.log(`    saved ${path}`);
  return { key: "largo", label: `Largo · ${ticker} read`, buf, path, wide: true };
}

async function captureStep(page, step, ticker) {
  switch (step) {
    case "vector":
      return captureVector0Dte(page, ticker);
    case "helix":
      return captureHelixTicker(page, ticker);
    case "thermal":
      return captureThermal(page, ticker);
    case "slayer":
      return captureSlayer(page, ticker);
    case "nighthawk":
      return captureNighthawk(page, ticker);
    case "largo":
      return captureLargoAnswer(page, ticker);
    default:
      throw new Error(`Unknown capture step: ${step}`);
  }
}

function escSvg(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function labelPanel(buf, label, sub, cellW, cellH, { fit = "cover" } = {}) {
  const resized = await sharp(buf)
    .resize(cellW, cellH, { fit, position: "top", background: { r: 6, g: 8, b: 12, alpha: 1 } })
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

async function buildCollage(items, ticker, plan) {
  const gridW = 1200;
  const headerH = 72;
  const footerH = 48;
  const barH = 36;
  const hero = items.find((i) => i.hero);
  const rest = items.filter((i) => !i.hero);
  const cellW = 600;
  const cellH = 360;

  const composites = [];
  let y = headerH;

  if (hero) {
    const heroH = 500;
    const heroLabeled = await labelPanel(hero.buf, hero.label, `${ticker} · 15m · full session`, gridW, heroH, {
      fit: "contain",
    });
    composites.push({ input: heroLabeled, top: y, left: 0 });
    y += heroH + barH;
  }

  const wide = rest.find((i) => i.wide);
  const gridItems = rest.filter((i) => !i.wide);

  for (let i = 0; i < gridItems.length; i++) {
    const labeled = await labelPanel(gridItems[i].buf, gridItems[i].label, ticker, cellW, cellH, { fit: "contain" });
    const row = Math.floor(i / 2);
    const col = i % 2;
    composites.push({ input: labeled, top: y + row * (cellH + barH), left: col * cellW });
  }

  let yAfterGrid = y + Math.ceil(gridItems.length / 2) * (cellH + barH);

  if (wide) {
    const wideH = 380;
    const wideLabeled = await labelPanel(wide.buf, wide.label, ticker, gridW, wideH, { fit: "contain" });
    composites.push({ input: wideLabeled, top: yAfterGrid, left: 0 });
    yAfterGrid += wideH + barH;
  }

  const totalH = yAfterGrid + footerH;

  const headerSvg = Buffer.from(`<svg width="${gridW}" height="${headerH}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${gridW}" height="${headerH}" fill="#06080c"/>
    <text x="24" y="46" fill="#e2e8f0" font-family="system-ui,sans-serif" font-size="28" font-weight="700">${escSvg(plan.title)}</text>
    <text x="${gridW - 24}" y="46" fill="#94a3b8" font-family="system-ui,sans-serif" font-size="18" text-anchor="end">LIVE · blackouttrades.com</text>
  </svg>`);

  const footerSvg = Buffer.from(`<svg width="${gridW}" height="${footerH}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${gridW}" height="${footerH}" fill="#0f172a"/>
    <text x="${gridW / 2}" y="30" fill="#cbd5e1" font-family="system-ui,sans-serif" font-size="15" text-anchor="middle">${escSvg(plan.footer)}</text>
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
      { input: footerSvg, top: totalH - footerH, left: 0 },
    ])
    .png()
    .toBuffer();
}

function buildTweet(ticker, plan) {
  if (MODE === "platform") {
    const text =
      "One Whop seat. Six live tools on one desk.\n\n" +
      "SPX Slayer matrix · HELIX whale tape · Thermal GEX — prod screenshots, one session.\n\n" +
      "Built for index / 0DTE traders. What's missing from your stack?\n\n" +
      "@BlackOutTrade · link in bio";
    return text.slice(0, 280);
  }
  const site =
    "blackouttrades.com/pricing?utm_source=x&utm_medium=social&utm_campaign=showcase";
  const isSpx = ticker === "SPX" || ticker === "SPXW";
  let text;
  if (isSpx) {
    text = `${ticker} 0DTE desk — live.\n\nGamma beads, flow tape, heatmap, Slayer signals, Night Hawk playbook, Largo read.\n\nWhat's your line into the close?\n\n@BlackOutTrade ${site}`;
  } else {
    text = `${ticker} gamma + flow on one screen — not six tabs.\n\nVector beads, Helix tape, Thermal matrix, Largo read.\n\nWhat's your flip level today?\n\n@BlackOutTrade ${site}`;
  }
  if (text.length > 280) {
    text = `${ticker}: dealer positioning + live flow on one desk. What's your read?\n\n@BlackOutTrade ${site}`;
  }
  return text.slice(0, 280);
}

async function postShowcaseCollage(collagePath, tweetText, xCreds, manifest) {
  if (!existsSync(collagePath)) {
    throw new Error(`Collage missing: ${collagePath}`);
  }
  const collage = readFileSync(collagePath);
  manifest.collagePath = collagePath;
  manifest.tweetText = tweetText;
  console.log(`Collage: ${collagePath} (${collage.length} bytes)`);
  console.log(`Tweet (${tweetText.length} chars):\n${tweetText}\n`);

  if (!POST) {
    manifest.posted = { skipped: true, reason: "dry-run default — pass --post to publish" };
    writeManifest(manifest);
    console.log("DRY — collage + manifest only (no X write).");
    return;
  }

  if (!xCreds.ck || !xCreds.at) {
    throw new Error("X API credentials missing from secrets — cannot post");
  }

  const mediaId = await uploadMedia(collage, xCreds);
  const result = await postTweet(tweetText, [mediaId], xCreds);
  const tweetId = assertSafeTweetId(result.id);
  const url = tweetPublicUrl(tweetId);
  console.log(`Tweet API accepted id=${tweetId} — verifying on timeline…`);

  const verification = await verifyTweetPersisted(tweetId, xCreds);
  manifest.posted = {
    tweetId,
    url,
    verified: true,
    verifiedAt: new Date().toISOString(),
    verification: {
      verified: verification.verified,
      attempts: verification.attempts,
      onTimeline: verification.onTimeline,
    },
  };
  writeManifest(manifest);
  writeFileSync(
    join(OUT, "post-result.json"),
    JSON.stringify(
      { tweetId, url, ticker: safeTickerSymbol(TICKER), verified: true },
      null,
      2,
    ),
  );
  console.log(`VERIFIED POST ${url}`);
}

async function main() {
  console.log(
    `[x-showcase] ticker=${TICKER} mode=${MODE} post=${POST ? "live" : "dry"} reuse=${REUSE_COLLAGE}`,
  );
  if (POST) {
    console.log(
      "  LIVE POST — review collage in artifacts before running; success requires timeline verification.",
    );
  }

  const secrets = loadSecrets();
  const xCreds = {
    ck: secrets.X_API_KEY,
    cs: secrets.X_API_KEY_SECRET,
    at: secrets.X_ACCESS_TOKEN,
    ats: secrets.X_ACCESS_TOKEN_SECRET,
  };

  const manifest = {
    ticker: TICKER,
    mode: POST ? "post" : "dry",
    createdAt: new Date().toISOString(),
    plan: null,
    captures: [],
    collagePath: null,
    tweetText: null,
    posted: null,
  };

  if (REUSE_COLLAGE) {
    const plan = resolvePlan(TICKER);
    manifest.plan = plan;
    const collagePath = join(OUT, `showcase-${TICKER}-collage.png`);
    const tweetText = buildTweet(TICKER, plan);
    try {
      await postShowcaseCollage(collagePath, tweetText, xCreds, manifest);
    } catch (err) {
      manifest.error = String(err?.message ?? err);
      writeManifest(manifest);
      throw err;
    }
    return;
  }

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

    const plan = resolvePlan(TICKER);
    manifest.plan = plan;
    console.log(`  Plan: ${plan.steps.join(" → ")}`);

    for (const step of plan.steps) {
      const shot = await captureStep(page, step, TICKER);
      captures.push(shot);
      manifest.captures.push({ key: shot.key, label: shot.label, path: shot.path });
    }

    const collage = await buildCollage(captures, TICKER, plan);
    const collagePath = join(OUT, `showcase-${TICKER}-collage.png`);
    writeFileSync(collagePath, collage);
    manifest.collagePath = collagePath;
    console.log(`Collage: ${collagePath} (${collage.length} bytes)`);

    const tweetText = buildTweet(TICKER, plan);
    await postShowcaseCollage(collagePath, tweetText, xCreds, manifest);
  } catch (err) {
    manifest.error = String(err?.message ?? err);
    writeManifest(manifest);
    throw err;
  } finally {
    await auth.cleanup();
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
