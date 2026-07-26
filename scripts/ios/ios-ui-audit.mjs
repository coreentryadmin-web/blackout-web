#!/usr/bin/env node
/**
 * iOS UI audit harness — the eyes of the autonomous iOS premium program.
 *
 * Renders the LIVE app (prod or staging) exactly as it appears inside the
 * Capacitor WKWebView: true iPhone device resolution, the `BlackOutiOSApp`
 * UA token (so the web app switches into its iOS-shell chrome), and an
 * authenticated premium Clerk session so every gated desk actually loads.
 *
 * Chromium can't CONNECT-tunnel through the agent proxy natively, so — like
 * scripts/proxy-browser.cjs — every request is intercepted via page.route()
 * and fulfilled through a manual CONNECT + TLS tunnel. This version supports
 * ALL methods + request bodies + the Clerk auth cookie, so POST/API/SSE-GET
 * data calls succeed and authenticated pages render with real data.
 *
 * Usage:
 *   node scripts/ios/ios-ui-audit.mjs [--base https://blackouttrades.com]
 *        [--out artifacts/ios-baseline] [--device 430x932@3]
 *        [--pages /,/desk/vector,/desk/helix]
 *
 * Env: CLERK_SECRET_KEY, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY (both required for
 * the authenticated sweep; without them it falls back to anonymous rendering).
 * Always deletes the temp Clerk user on exit.
 */
import { chromium } from "playwright";
import http from "node:http";
import tls from "node:tls";
import fs from "node:fs";
import path from "node:path";
import { mintClerkPremiumSession } from "../audit/lib/prod-clerk-session.mjs";

const CA = fs.readFileSync("/root/.ccr/ca-bundle.crt");
const PROXY_HOST = "127.0.0.1";
const PROXY_PORT = 39619;
const IOS_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 BlackOutiOSApp";

// ---- CLI ----
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const BASE = opt("base", "https://blackouttrades.com").replace(/\/$/, "");
const OUT = opt("out", "artifacts/ios-baseline");
const DEVICE = opt("device", "430x932@3"); // iPhone 15 Pro Max ≈ App Store 6.9"
const [vp, dsf] = DEVICE.split("@");
const [W, H] = vp.split("x").map(Number);
const DSF = Number(dsf || 3);
const PAGES = opt("pages", "/,/desk/vector,/desk/helix,/desk/thermal")
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean);

fs.mkdirSync(OUT, { recursive: true });

/** True only for our own domain — dot-anchored so `evilblackouttrades.com` can't match. */
function isBlackoutHost(hostname) {
  return hostname === "blackouttrades.com" || hostname.endsWith(".blackouttrades.com");
}

/** Manual CONNECT + TLS request through the agent proxy. Full method/body/headers. */
function proxyFetch(url, { method = "GET", headers = {}, body = null } = {}) {
  const u = new URL(url);
  const reqPath = u.pathname + u.search;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), 30000);
    const preq = http.request({
      host: PROXY_HOST,
      port: PROXY_PORT,
      method: "CONNECT",
      path: `${u.hostname}:443`,
    });
    preq.on("connect", (res, socket) => {
      if (res.statusCode !== 200) {
        clearTimeout(timer);
        reject(new Error(`CONNECT ${res.statusCode}`));
        return;
      }
      const t = tls.connect({ socket, servername: u.hostname, ca: CA }, () => {
        const h = {
          Host: u.hostname,
          "Accept-Encoding": "identity",
          Connection: "close",
          ...headers,
        };
        if (body) h["Content-Length"] = Buffer.byteLength(body);
        let raw = `${method} ${reqPath} HTTP/1.1\r\n`;
        for (const [k, v] of Object.entries(h)) if (v != null && v !== "") raw += `${k}: ${v}\r\n`;
        raw += "\r\n";
        t.write(raw);
        if (body) t.write(body);
        let data = Buffer.alloc(0);
        t.on("data", (c) => (data = Buffer.concat([data, c])));
        t.on("end", () => {
          clearTimeout(timer);
          const s = data.toString("latin1");
          const he = s.indexOf("\r\n\r\n");
          if (he < 0) return resolve({ status: 502, headers: {}, body: Buffer.alloc(0) });
          const headBlock = s.slice(0, he);
          const status = parseInt(headBlock.split("\r\n")[0].split(" ")[1]) || 200;
          const rh = {};
          headBlock
            .split("\r\n")
            .slice(1)
            .forEach((l) => {
              const idx = l.indexOf(": ");
              if (idx > 0) rh[l.slice(0, idx).toLowerCase()] = l.slice(idx + 2);
            });
          let bodyBuf = data.slice(he + 4);
          if ((rh["transfer-encoding"] || "").includes("chunked")) {
            const parts = [];
            let r = bodyBuf.toString("latin1");
            while (r.length) {
              const nl = r.indexOf("\r\n");
              if (nl < 0) break;
              const sz = parseInt(r.slice(0, nl), 16);
              if (!sz || isNaN(sz)) break;
              parts.push(Buffer.from(r.slice(nl + 2, nl + 2 + sz), "latin1"));
              r = r.slice(nl + 2 + sz + 2);
            }
            bodyBuf = Buffer.concat(parts);
          }
          resolve({ status, headers: rh, body: bodyBuf });
        });
        t.on("error", (e) => {
          clearTimeout(timer);
          reject(e);
        });
      });
      t.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
    });
    preq.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    preq.end();
  });
}

async function main() {
  console.log(`iOS UI audit → ${BASE}  device ${W}x${H}@${DSF}  pages=${PAGES.length}`);
  const session = await mintClerkPremiumSession({ appUrl: BASE });
  const cookie = session.skip ? "" : session.cookieHeader;
  if (session.skip) console.log(`  ⚠ auth skipped (${session.reason}) — anonymous render`);
  else console.log(`  ✓ premium session minted (temp user ${session.userId})`);

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const results = [];
  try {
    const ctx = await browser.newContext({
      viewport: { width: W, height: H },
      deviceScaleFactor: DSF,
      isMobile: true,
      hasTouch: true,
      userAgent: IOS_UA,
    });
    await ctx.route("**/*", async (route) => {
      const req = route.request();
      const url = req.url();
      if (url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
      if (!url.startsWith("https://")) return route.abort();
      const isOurHost = isBlackoutHost(new URL(url).hostname);
      try {
        const r = await proxyFetch(url, {
          method: req.method(),
          headers: {
            ...req.headers(),
            "user-agent": IOS_UA,
            ...(isOurHost && cookie ? { cookie } : {}),
          },
          body: ["POST", "PUT", "PATCH"].includes(req.method()) ? req.postData() : null,
        });
        const outHeaders = { "content-type": r.headers["content-type"] || "application/octet-stream" };
        if (r.headers["location"]) outHeaders["location"] = r.headers["location"];
        await route.fulfill({ status: r.status, headers: outHeaders, body: r.body });
      } catch {
        route.abort();
      }
    });

    for (const p of PAGES) {
      const page = await ctx.newPage();
      const consoleErrors = [];
      page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text().slice(0, 200)));
      page.on("pageerror", (e) => consoleErrors.push("PAGEERROR: " + e.message.slice(0, 200)));
      const name = p === "/" ? "home" : p.replace(/^\//, "").replace(/\//g, "_");
      let title = "";
      try {
        await page.goto(BASE + p, { waitUntil: "networkidle", timeout: 60000 });
        await page.waitForTimeout(2500); // let charts/canvas settle
        title = await page.title();
      } catch (e) {
        console.log(`  · ${p} partial: ${e.message.split("\n")[0]}`);
      }
      const file = path.join(OUT, `${name}.png`);
      await page.screenshot({ path: file, fullPage: false });
      results.push({ page: p, title, errors: consoleErrors.length, file });
      console.log(`  ✓ ${p}  "${title}"  errors=${consoleErrors.length}  → ${file}`);
      if (consoleErrors.length) consoleErrors.slice(0, 3).forEach((e) => console.log(`      ⚠ ${e}`));
      await page.close();
    }
  } finally {
    await browser.close();
    if (!session.skip) {
      await session.cleanup();
      console.log("  ✓ temp user deleted");
    }
  }
  fs.writeFileSync(path.join(OUT, "audit-summary.json"), JSON.stringify(results, null, 2));
  console.log(`\nDone. ${results.length} pages → ${OUT}/  (summary: audit-summary.json)`);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
