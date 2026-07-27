#!/usr/bin/env node
/**
 * iOS P0 regression gate — fast, browser-less, run after every deploy.
 *
 * Guards the four App Store submission blockers we already fixed so they
 * cannot silently regress:
 *
 *   P0-1  /privacy is public + reachable + has real content
 *   P0-2  homepage renders NO pricing markup when the request UA is
 *         the Capacitor iOS shell (`BlackOutiOSApp`)
 *   P0-3  server-side gate: the same URL WITH a desktop UA MUST show
 *         pricing (so we haven't broken web) AND the CF cache rule
 *         must be bypassing iOS UA (cf-cache-status: MISS/DYNAMIC)
 *   P0-4  the Capacitor shell's WKWebView allowNavigation must NOT
 *         include *.whop.com — verified by reading
 *         apps/blackout-ios/capacitor.config.ts.
 *
 * No browser, no Clerk session — just raw HTTPS through the agent proxy.
 * Exits non-zero on ANY failure so CI can gate on it.
 *
 * Usage:
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *     node scripts/ios/ios-p0-regression.mjs [--base https://blackouttrades.com]
 */
import fs from "node:fs";
import http from "node:http";
import tls from "node:tls";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const BASE = opt("base", "https://blackouttrades.com").replace(/\/$/, "");

const IOS_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 BlackOutiOSApp";
const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

const CA = fs.readFileSync("/root/.ccr/ca-bundle.crt");
// Read the agent proxy address from HTTPS_PROXY — the port has changed
// between sessions (39619 → 33181), so hardcoding it would silently break
// this script every time the environment rebuilds.
const PROXY_URL = new URL(process.env.HTTPS_PROXY || process.env.https_proxy || "http://127.0.0.1:39619");
const PROXY_HOST = PROXY_URL.hostname;
const PROXY_PORT = Number(PROXY_URL.port) || 39619;

/** Fetch a URL through the agent proxy. Returns {status, headers, body}. */
function fetchThroughProxy(url, ua) {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), 20000);
    const preq = http.request({
      host: PROXY_HOST, port: PROXY_PORT, method: "CONNECT",
      path: `${u.hostname}:443`,
    });
    preq.on("connect", (res, socket) => {
      if (res.statusCode !== 200) {
        clearTimeout(t);
        reject(new Error(`CONNECT ${res.statusCode}`));
        return;
      }
      const tlsSocket = tls.connect({ socket, servername: u.hostname, ca: CA }, () => {
        const req =
          `GET ${u.pathname + u.search} HTTP/1.1\r\n` +
          `Host: ${u.hostname}\r\n` +
          `User-Agent: ${ua}\r\n` +
          `Accept: text/html\r\n` +
          `Accept-Encoding: identity\r\n` +
          `Connection: close\r\n\r\n`;
        tlsSocket.write(req);
        let raw = Buffer.alloc(0);
        tlsSocket.on("data", (c) => (raw = Buffer.concat([raw, c])));
        tlsSocket.on("end", () => {
          clearTimeout(t);
          const s = raw.toString("latin1");
          const he = s.indexOf("\r\n\r\n");
          if (he < 0) return resolve({ status: 502, headers: {}, body: "" });
          const head = s.slice(0, he);
          const status = parseInt(head.split("\r\n")[0].split(" ")[1]) || 0;
          const headers = {};
          head.split("\r\n").slice(1).forEach((l) => {
            const idx = l.indexOf(": ");
            if (idx > 0) headers[l.slice(0, idx).toLowerCase()] = l.slice(idx + 2);
          });
          let body = raw.slice(he + 4);
          if ((headers["transfer-encoding"] || "").includes("chunked")) {
            const parts = [];
            let r = body.toString("latin1");
            while (r.length) {
              const nl = r.indexOf("\r\n");
              if (nl < 0) break;
              const sz = parseInt(r.slice(0, nl), 16);
              if (!sz || isNaN(sz)) break;
              parts.push(Buffer.from(r.slice(nl + 2, nl + 2 + sz), "latin1"));
              r = r.slice(nl + 2 + sz + 2);
            }
            body = Buffer.concat(parts);
          }
          resolve({ status, headers, body: body.toString("utf8") });
        });
        tlsSocket.on("error", (e) => { clearTimeout(t); reject(e); });
      });
      tlsSocket.on("error", (e) => { clearTimeout(t); reject(e); });
    });
    preq.on("error", (e) => { clearTimeout(t); reject(e); });
    preq.end();
  });
}

// Pricing-DOM tokens the reviewer would ever see. Fabricated to match the
// removed markup (RedesignHome.tsx) — any of these hitting the iOS-UA render
// means P0-2/P0-3 regressed.
const PRICING_TOKENS = [
  "$75", "$199", "$1,999", "$1999",
  "Start now →", "See pricing",
  "rl-pricing",
];

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  const badge = ok ? "PASS" : "FAIL";
  console.log(`  ${badge}  ${name}${detail ? `  — ${detail}` : ""}`);
}

async function main() {
  console.log(`iOS P0 regression gate → ${BASE}`);

  // P0-1: /privacy is public + reachable + has content.
  try {
    const r = await fetchThroughProxy(`${BASE}/privacy`, DESKTOP_UA);
    const ok = r.status === 200 && /Privacy/i.test(r.body) && /BlackOut/i.test(r.body);
    record("P0-1  /privacy public & has content", ok,
      `HTTP ${r.status}, ${r.body.length}B, contains Privacy=${/Privacy/i.test(r.body)}`);
  } catch (e) {
    record("P0-1  /privacy public & has content", false, `error: ${e.message}`);
  }

  // P0-2: iOS UA on `/` renders no pricing DOM tokens.
  try {
    const r = await fetchThroughProxy(`${BASE}/`, IOS_UA);
    const leaked = PRICING_TOKENS.filter((t) => r.body.includes(t));
    const ok = r.status === 200 && leaked.length === 0;
    record("P0-2  iOS-UA / has no pricing markup", ok,
      leaked.length ? `LEAKED: ${leaked.join(", ")}` : `clean (${r.body.length}B)`);
  } catch (e) {
    record("P0-2  iOS-UA / has no pricing markup", false, `error: ${e.message}`);
  }

  // P0-3: desktop UA on `/` MUST still have pricing (so we didn't break web).
  try {
    const r = await fetchThroughProxy(`${BASE}/`, DESKTOP_UA);
    // Look for at least ONE pricing token — desktop must still see the table.
    const hasPricing = PRICING_TOKENS.some((t) => r.body.includes(t));
    record("P0-3  desktop-UA / still shows pricing", hasPricing,
      hasPricing ? "web unchanged" : `WEB REGRESSION: no pricing tokens found (${r.body.length}B)`);
    // CF cache: iOS UA should be MISS/DYNAMIC (bypassed); desktop should HIT eventually.
    const iosCache = (await fetchThroughProxy(`${BASE}/`, IOS_UA)).headers["cf-cache-status"] || "?";
    const cfOk = iosCache !== "HIT";
    record("P0-3  CF cache bypasses iOS UA", cfOk,
      `iOS cf-cache-status=${iosCache} (must not be HIT)`);
  } catch (e) {
    record("P0-3  desktop-UA / still shows pricing", false, `error: ${e.message}`);
  }

  // P0-4: Capacitor config allowNavigation must NOT include *.whop.com.
  try {
    const cfg = fs.readFileSync("apps/blackout-ios/capacitor.config.ts", "utf8");
    const whopAllowed = /"\*\.whop\.com"/.test(cfg);
    record("P0-4  WKWebView allowNavigation excludes Whop", !whopAllowed,
      whopAllowed ? "REGRESSION: *.whop.com is back in allowNavigation" : "not present");
  } catch (e) {
    record("P0-4  WKWebView allowNavigation excludes Whop", false, `error: ${e.message}`);
  }

  const failed = results.filter((r) => !r.ok);
  console.log("");
  if (failed.length) {
    console.log(`✗ ${failed.length} of ${results.length} P0 checks FAILED`);
    process.exit(1);
  }
  console.log(`✓ all ${results.length} P0 regression checks passed`);
}

main().catch((e) => { console.error("FATAL", e); process.exit(2); });
