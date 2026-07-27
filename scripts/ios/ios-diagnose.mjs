#!/usr/bin/env node
/**
 * REAL diagnosis of what's broken in the iOS WKWebView shell.
 *
 * Not just screenshots — this hits every page a real TestFlight user
 * touches under the iOS UA and captures:
 *   - HTTP status of the top-level request
 *   - Every console.error + pageerror
 *   - Every network failure (blocked / 4xx / 5xx / aborted)
 *   - Whether critical DOM landmarks rendered (Clerk widget on sign-in,
 *     data grids on desks, etc.)
 *   - Snapshot of visible text (so we can see "Sign in" vs an empty page)
 *   - Screenshot for visual check
 *
 * Uses the proxy-bridge pattern already proven in ios-ui-audit.mjs.
 * Runs authed + unauthed so we see BOTH the pre-signin experience and
 * the post-signin desk experience — the union of what a member sees.
 */
import { chromium } from "playwright";
import http from "node:http";
import tls from "node:tls";
import fs from "node:fs";
import path from "node:path";
import { mintClerkPremiumSession } from "../audit/lib/prod-clerk-session.mjs";

const CA = fs.readFileSync("/root/.ccr/ca-bundle.crt");
const PROXY_URL = new URL(process.env.HTTPS_PROXY || process.env.https_proxy || "http://127.0.0.1:39619");
const PROXY_HOST = PROXY_URL.hostname;
const PROXY_PORT = Number(PROXY_URL.port) || 39619;
const IOS_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 BlackOutiOSApp";
const BASE = "https://blackouttrades.com";
const OUT = "artifacts/ios-diagnose";
fs.mkdirSync(OUT, { recursive: true });

// Which pages to test and what "success" looks like for each.
const PAGES = [
  {
    path: "/",
    signedIn: false,
    checks: {
      mustContain: ["BLACKOUT"],
      mustNotContain: ["$75", "$199", "$1,999", "$1999", "See pricing"],
      // On the homepage the primary CTA when NOT signed in should be
      // clear — either "Sign in" or "Open desk" if already authed.
      landmark: ".rl-hero, .rl-btn, main",
    },
  },
  {
    path: "/sign-in",
    signedIn: false,
    checks: {
      mustContain: ["Sign", "email"],
      // Clerk widget renders as .cl-signIn-start or .cl-formContainer
      landmark: ".cl-signIn-start, .cl-formContainer, form",
    },
  },
  {
    path: "/pricing",
    signedIn: false,
    // Pricing page is a marketing page — must still work on web BUT the
    // iOS UA server-gate might redirect or hide. Note what happens.
    checks: { landmark: "main" },
  },
  {
    path: "/dashboard",
    signedIn: true,
    checks: {
      mustContain: ["SPX"],
      landmark: ".spx-hero-metric-block, .page-shell, main",
    },
  },
  {
    path: "/flows",
    signedIn: true,
    checks: {
      landmark: ".helix-tide-bar, .page-shell, main",
    },
  },
  {
    path: "/heatmap",
    signedIn: true,
    checks: { landmark: ".page-shell, main" },
  },
  {
    path: "/vector",
    signedIn: true,
    checks: { landmark: ".page-shell, main" },
  },
  {
    path: "/account",
    signedIn: true,
    checks: { landmark: ".ios-account-page, .page-shell, main" },
  },
];

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
        const h = { Host: u.hostname, "Accept-Encoding": "identity", Connection: "close", ...headers };
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
        t.on("error", (e) => { clearTimeout(timer); reject(e); });
      });
      t.on("error", (e) => { clearTimeout(timer); reject(e); });
    });
    preq.on("error", (e) => { clearTimeout(timer); reject(e); });
    preq.end();
  });
}

async function main() {
  console.log(`\n=== BlackOut iOS shell diagnosis ===\n`);
  console.log(`  UA:   ${IOS_UA}`);
  console.log(`  BASE: ${BASE}\n`);

  const session = await mintClerkPremiumSession({ appUrl: BASE });
  const cookie = session.skip ? "" : session.cookieHeader;
  if (session.skip) console.log(`  ⚠ auth skipped (${session.reason})`);
  else console.log(`  ✓ premium session minted for authed pages\n`);

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const report = [];
  try {
    const ctx = await browser.newContext({
      viewport: { width: 430, height: 932 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
      userAgent: IOS_UA,
    });
    await ctx.route("**/*", async (route) => {
      const req = route.request();
      const url = req.url();
      if (url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
      if (!url.startsWith("https://")) return route.abort();
      const isOurHost = /(^|\.)blackouttrades\.com$/.test(new URL(url).hostname);
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

    for (const spec of PAGES) {
      const consoleErrors = [];
      const netFailures = [];
      const page = await ctx.newPage();
      page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text().slice(0, 300)));
      page.on("pageerror", (e) => consoleErrors.push("PAGEERROR: " + e.message.slice(0, 300)));
      page.on("requestfailed", (req) => {
        const f = req.failure();
        netFailures.push(`${req.method()} ${req.url().slice(0, 120)} — ${f?.errorText || "?"}`);
      });
      page.on("response", (resp) => {
        if (resp.status() >= 400) netFailures.push(`HTTP ${resp.status()} ${resp.url().slice(0, 120)}`);
      });

      const url = BASE + spec.path;
      let httpStatus = 0;
      let title = "";
      let bodyText = "";
      let landmarkFound = false;
      try {
        const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
        httpStatus = resp?.status() ?? 0;
        await page.waitForTimeout(4500);
        try { title = await page.title(); } catch {}
        // Extract visible text (first 400 chars) + check landmark presence.
        try {
          bodyText = await page.evaluate(() => (document.body?.innerText || "").slice(0, 800));
        } catch {}
        if (spec.checks.landmark) {
          try {
            landmarkFound = await page.evaluate(
              (sel) => !!document.querySelector(sel),
              spec.checks.landmark
            );
          } catch {}
        }
      } catch (e) {
        consoleErrors.push("NAV: " + (e.message || String(e)).slice(0, 200));
      }
      const file = path.join(OUT, (spec.path === "/" ? "home" : spec.path.replace(/^\//, "").replace(/\//g, "_")) + ".png");
      try { await page.screenshot({ path: file, fullPage: false }); } catch {}

      // Scoring
      const mustContain = spec.checks.mustContain ?? [];
      const mustNotContain = spec.checks.mustNotContain ?? [];
      const missingMust = mustContain.filter((s) => !bodyText.includes(s));
      const foundBad = mustNotContain.filter((s) => bodyText.includes(s));

      const record = {
        path: spec.path,
        signedIn: !!spec.signedIn,
        httpStatus,
        title,
        landmarkFound: spec.checks.landmark ? landmarkFound : null,
        visibleTextLength: bodyText.length,
        visibleTextPreview: bodyText.replace(/\s+/g, " ").slice(0, 160),
        consoleErrors,
        netFailures: netFailures.slice(0, 20),
        missingRequiredText: missingMust,
        pricingLeaked: foundBad,
        file,
      };
      report.push(record);

      const status =
        (httpStatus >= 200 && httpStatus < 400) &&
        landmarkFound !== false &&
        missingMust.length === 0 &&
        foundBad.length === 0 &&
        bodyText.length > 100
          ? "PASS"
          : "FAIL";
      console.log(
        `  ${status === "PASS" ? "✓" : "✗"} ${spec.path.padEnd(14)} http=${httpStatus} text=${bodyText.length}B ` +
        `landmark=${spec.checks.landmark ? (landmarkFound ? "yes" : "NO") : "-"} ` +
        `errors=${consoleErrors.length} netFail=${netFailures.length}`
      );
      if (status === "FAIL") {
        if (missingMust.length) console.log(`      MISSING: ${missingMust.join(", ")}`);
        if (foundBad.length) console.log(`      PRICING LEAKED: ${foundBad.join(", ")}`);
        if (bodyText.length < 100) console.log(`      TEXT BODY: "${bodyText.replace(/\s+/g, " ").slice(0, 100)}"`);
        consoleErrors.slice(0, 3).forEach((e) => console.log(`      ! ${e}`));
        netFailures.slice(0, 3).forEach((e) => console.log(`      ! ${e}`));
      }
      await page.close();
    }
  } finally {
    await browser.close();
    if (!session.skip) {
      await session.cleanup();
      console.log(`\n  ✓ temp user deleted`);
    }
  }
  fs.writeFileSync(path.join(OUT, "diagnose-report.json"), JSON.stringify(report, null, 2));
  console.log(`\nReport: ${OUT}/diagnose-report.json\n`);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
