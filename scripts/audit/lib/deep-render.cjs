/**
 * Deep client-side render audit — the layer an HTTP crawl cannot see.
 *
 * Reuses proxy-browser.cjs's manual CONNECT+tls tunnel (Chromium in this sandbox
 * has no network of its own; see docs/audit/LIVE-UI-CONNECTION.md).
 *
 * TWO fixes over the naive approach, both from failures observed today:
 *
 *  1. SSE STREAMS ARE ABORTED. The desks hold open /api/**\/stream connections.
 *     The tunnel is one-shot request/response, so a stream never returns, the
 *     route handler never settles, and the page hangs until the screenshot
 *     deadline blows. That is exactly how /nighthawk and /flows failed earlier.
 *     Aborting them lets the page settle on its SSR + SWR content, which is
 *     what we are auditing. Live-tick behaviour is explicitly NOT covered.
 *
 *  2. NAVIGATION IS NOT REQUIRED TO SUCCEED. goto() rejecting on a slow
 *     subresource still leaves a rendered DOM worth inspecting, so failures are
 *     recorded and the audit continues rather than aborting the page.
 *
 * Records per page: console errors, uncaught page errors, failed requests,
 * rendered text length, visible interactive controls, and the result of
 * clicking each one (does the DOM change, does it throw).
 */
const { chromium } = require("playwright");
const http = require("http");
const tls = require("tls");
const fs = require("fs");
const { URL } = require("url");

const PROXY_URL = process.env.HTTPS_PROXY || "http://127.0.0.1:42795";
const CA_PATH = "/root/.ccr/ca-bundle.crt";
const ca = fs.existsSync(CA_PATH) ? fs.readFileSync(CA_PATH) : undefined;
const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const OUT = process.env.RENDER_OUT || "/tmp/render";
const COOKIE = process.env.AUDIT_COOKIE || "";
const PAGES = (process.env.AUDIT_PAGES || "/nighthawk,/vector,/flows,/heatmap,/terminal,/dashboard,/track-record,/account,/pricing,/").split(",");

// Endpoints that never terminate. Aborting is correct: we are auditing render,
// not the live feed, and letting them hang audits nothing at all. The pattern
// itself lives in site-audit-eval.mjs so it is unit-tested (a too-greedy
// pattern would abort real API calls and make a working page look broken).
// Loaded via dynamic import inside main() — this file is CJS and the helper is
// ESM. Sharing it matters: an inline copy would drift from the tested one.
let isStreamingUrl = () => false;

function proxyFetch(url, method, hdrs, body) {
  const u = new URL(url), p = new URL(PROXY_URL);
  return new Promise((resolve, reject) => {
    const kill = setTimeout(() => reject(new Error("timeout")), 20000);
    const cReq = http.request({ host: p.hostname, port: +p.port || 8080, method: "CONNECT", path: `${u.hostname}:${u.port || 443}` });
    cReq.on("error", (e) => { clearTimeout(kill); reject(e); });
    cReq.on("connect", (res, sock) => {
      if (res.statusCode !== 200) { clearTimeout(kill); sock.destroy(); return reject(new Error(`CONNECT ${res.statusCode}`)); }
      const ts = tls.connect({ socket: sock, host: u.hostname, servername: u.hostname, ca }, () => {
        const rh = Object.assign({}, hdrs, { Host: u.host, "Accept-Encoding": "identity", Connection: "close" });
        if (body?.length) rh["Content-Length"] = String(body.length);
        delete rh["accept-encoding"];
        let raw = `${method} ${u.pathname}${u.search} HTTP/1.0\r\n`;
        for (const [k, v] of Object.entries(rh)) if (v != null) raw += `${k}: ${v}\r\n`;
        ts.write(raw + "\r\n");
        if (body?.length) ts.write(body);
      });
      const bufs = [];
      ts.on("data", (c) => bufs.push(c));
      ts.on("end", () => {
        clearTimeout(kill);
        const all = Buffer.concat(bufs), s = all.toString("latin1");
        const sep = s.indexOf("\r\n\r\n");
        if (sep < 0) return resolve({ status: 200, headers: {}, body: Buffer.alloc(0) });
        const hdr = s.slice(0, sep), bdy = all.slice(sep + 4);
        const st = +(hdr.match(/^HTTP\/[\d.]+ (\d+)/)?.[1] || 200);
        const rh2 = {};
        hdr.split("\r\n").slice(1).forEach((l) => { const i = l.indexOf(":"); if (i > 0) rh2[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim(); });
        resolve({ status: st, headers: rh2, body: bdy });
      });
      ts.on("error", (e) => { clearTimeout(kill); reject(e); });
    });
    cReq.end();
  });
}

async function proxyFetchFollow(url, method, hdrs, body) {
  const r = await proxyFetch(url, method, hdrs, body);
  if (r.status >= 301 && r.status <= 308 && r.headers.location) {
    return proxyFetch(new URL(r.headers.location, url).href, "GET", hdrs, null);
  }
  return r;
}

(async () => {
  ({ isStreamingUrl } = await import("./site-audit-eval.mjs"));
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--disable-background-networking"],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  });
  if (COOKIE) {
    const dom = new URL(BASE).hostname;
    await ctx.addCookies(COOKIE.split(";").map((s) => s.trim()).filter(Boolean).map((p) => {
      const [n, ...r] = p.split("=");
      return { name: n.trim(), value: r.join("=").trim(), domain: dom, path: "/", httpOnly: true, secure: true, sameSite: "Lax" };
    }));
  }

  let aborted = 0, ok = 0, fail = 0;
  await ctx.route("**/*", async (route, req) => {
    const url = req.url();
    if (/^(data|blob|about|chrome|chrome-extension):/.test(url)) return route.continue();
    if (isStreamingUrl(url)) { aborted++; return route.abort("blockedbyclient"); }
    try {
      const r = await proxyFetchFollow(url, req.method(), req.headers(), req.postDataBuffer());
      ok++;
      await route.fulfill({ status: r.status, headers: r.headers, body: r.body });
    } catch (e) {
      fail++;
      await route.abort("connectionfailed");
    }
  });

  const report = [];
  for (const path of PAGES) {
    const page = await ctx.newPage();
    const consoleErrors = [], pageErrors = [], badRequests = [];
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 220)); });
    page.on("pageerror", (e) => pageErrors.push(String(e.message).slice(0, 220)));
    page.on("response", (r) => { if (r.status() >= 400 && !isStreamingUrl(r.url())) badRequests.push(`${r.status()} ${r.url().replace(BASE, "").slice(0, 90)}`); });

    const rec = { path, navError: null };
    try {
      await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 45000 });
    } catch (e) {
      rec.navError = String(e.message).split("\n")[0].slice(0, 140);
    }
    await page.waitForTimeout(9000);

    try {
      rec.textLen = (await page.evaluate(() => document.body?.innerText?.length || 0));
      rec.title = await page.title();
      // Visible, enabled controls a member could actually click.
      rec.controls = await page.evaluate(() => {
        const sel = 'button, [role="tab"], [role="button"], a[href^="/"]';
        return [...document.querySelectorAll(sel)]
          .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 8 && r.height > 8 && !el.hasAttribute("disabled"); })
          .slice(0, 60)
          .map((el) => ({ tag: el.tagName.toLowerCase(), role: el.getAttribute("role"), label: (el.innerText || el.getAttribute("aria-label") || "").trim().slice(0, 40), href: el.getAttribute("href") }));
      });
      await page.screenshot({ path: `${OUT}/${path.replace(/\W+/g, "_") || "root"}.png`, timeout: 20000 });
    } catch (e) {
      rec.evalError = String(e.message).split("\n")[0].slice(0, 140);
    }

    // Click every non-navigating control and watch for thrown errors / dead clicks.
    const clickable = (rec.controls || []).filter((c) => c.tag === "button" || c.role === "tab" || c.role === "button");
    rec.clicks = [];
    for (const c of clickable.slice(0, 25)) {
      if (!c.label) continue;
      const before = pageErrors.length + consoleErrors.length;
      let domBefore = "";
      try {
        domBefore = await page.evaluate(() => document.body.innerText.length + "");
        const el = page.locator(`text="${c.label}"`).first();
        await el.click({ timeout: 3500, noWaitAfter: true });
        await page.waitForTimeout(700);
        const domAfter = await page.evaluate(() => document.body.innerText.length + "");
        rec.clicks.push({ label: c.label, newErrors: pageErrors.length + consoleErrors.length - before, changed: domBefore !== domAfter });
      } catch (e) {
        rec.clicks.push({ label: c.label, clickError: String(e.message).split("\n")[0].slice(0, 90) });
      }
    }

    rec.consoleErrors = [...new Set(consoleErrors)].slice(0, 12);
    rec.pageErrors = [...new Set(pageErrors)].slice(0, 12);
    rec.badRequests = [...new Set(badRequests)].slice(0, 15);
    report.push(rec);
    console.error(`${path}: text=${rec.textLen ?? "?"} controls=${(rec.controls || []).length} clicks=${rec.clicks.length} consoleErr=${rec.consoleErrors.length} pageErr=${rec.pageErrors.length} bad=${rec.badRequests.length}${rec.navError ? " NAV:" + rec.navError : ""}`);
    await page.close();
  }

  fs.writeFileSync(`${OUT}/render-report.json`, JSON.stringify(report, null, 2));
  console.error(`\nstreams aborted: ${aborted}, tunnelled ok: ${ok}, tunnel fail: ${fail}`);
  await browser.close();
})();
