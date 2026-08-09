/**
 * Chromium-with-no-network: a Playwright context whose every request is fulfilled by Node over a
 * manual CONNECT + tls.connect() tunnel through the agent proxy.
 *
 * WHY THIS SHAPE (see docs/audit/LIVE-UI-CONNECTION.md). Chromium in this sandbox cannot reach the
 * network at all — direct, `proxy:{server}`, and `--proxy-server` all fail identically with
 * ERR_CONNECTION_RESET, while curl/fetch to the same URL through the same proxy return 200. The fix
 * is to take the network away from Chromium entirely: `context.route('**\/*')` intercepts every
 * request and Node performs it. A plain-Playwright failure here proves nothing except the egress
 * block, so never conclude "UI validation is impossible" from one.
 *
 * Extracted from proxy-browser.cjs (committed since #1188) so the screenshot tool and the
 * interaction harnesses share ONE tunnel implementation. Two copies would drift, and the tunnel is
 * the part that is subtle.
 */
const { chromium } = require("playwright");
const http = require("http");
const tls = require("tls");
const fs = require("fs");
const { URL } = require("url");

const PROXY_URL = process.env.HTTPS_PROXY || "http://127.0.0.1:42795";
const CA_PATH = "/root/.ccr/ca-bundle.crt";
const ca = fs.existsSync(CA_PATH) ? fs.readFileSync(CA_PATH) : undefined;

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1 BlackOutiOSApp/1.0";
const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

/**
 * One-shot HTTPS fetch through the CONNECT tunnel. HTTP/1.0 + Connection:close guarantees the
 * server closes the socket when the body ends — no chunked ambiguity to parse.
 */
function proxyFetch(url, method, hdrs, body, timeoutMs = 20000) {
  const u = new URL(url);
  const p = new URL(PROXY_URL);
  return new Promise((resolve, reject) => {
    const kill = setTimeout(() => reject(new Error("timeout")), timeoutMs);

    const cReq = http.request({
      host: p.hostname,
      port: +p.port || 8080,
      method: "CONNECT",
      path: `${u.hostname}:${u.port || 443}`,
    });
    cReq.on("error", (e) => {
      clearTimeout(kill);
      reject(e);
    });
    cReq.on("connect", (res, sock) => {
      if (res.statusCode !== 200) {
        clearTimeout(kill);
        sock.destroy();
        return reject(new Error(`CONNECT ${res.statusCode}`));
      }

      const ts = tls.connect({ socket: sock, host: u.hostname, servername: u.hostname, ca }, () => {
        const rh = Object.assign({}, hdrs, {
          Host: u.host,
          "Accept-Encoding": "identity",
          Connection: "close",
        });
        if (body?.length) rh["Content-Length"] = String(body.length);
        delete rh["accept-encoding"];

        let raw = `${method} ${u.pathname}${u.search} HTTP/1.0\r\n`;
        for (const [k, v] of Object.entries(rh)) if (v != null) raw += `${k}: ${v}\r\n`;
        raw += "\r\n";
        ts.write(raw);
        if (body?.length) ts.write(body);
      });

      const bufs = [];
      ts.on("data", (c) => bufs.push(c));
      ts.on("end", () => {
        clearTimeout(kill);
        const all = Buffer.concat(bufs);
        const s = all.toString("latin1");
        const sep = s.indexOf("\r\n\r\n");
        if (sep < 0) return resolve({ status: 200, headers: {}, body: Buffer.alloc(0) });
        const hdr = s.slice(0, sep);
        const bdy = all.slice(sep + 4);
        const st = +(hdr.match(/^HTTP\/[\d.]+ (\d+)/)?.[1] || 200);
        const rh2 = {};
        hdr
          .split("\r\n")
          .slice(1)
          .forEach((l) => {
            const i = l.indexOf(":");
            if (i > 0) rh2[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim();
          });
        resolve({ status: st, headers: rh2, body: bdy });
      });
      ts.on("error", (e) => {
        clearTimeout(kill);
        reject(e);
      });
    });
    cReq.end();
  });
}

/** Follow one redirect (Location header). */
async function proxyFetchFollow(url, method, hdrs, body) {
  const r = await proxyFetch(url, method, hdrs, body);
  if (r.status >= 301 && r.status <= 308 && r.headers.location) {
    const loc = new URL(r.headers.location, url).href;
    return proxyFetch(loc, "GET", hdrs, null);
  }
  return r;
}

/**
 * A never-terminating response would hang the tunnel forever.
 *
 * `proxyFetch` resolves on socket END. An SSE stream never ends by design, so its route handler
 * never settles — and Playwright serialises route handling, so ONE open stream stalls every
 * subsequent request on the page. A single screenshot survives this by accident (it fires before
 * the stall matters); a click-through does not, because every interaction after the stream opens
 * queues behind it.
 *
 * Aborting is the honest trade, and it costs less than it looks: the desk already treats SSE as
 * optional and falls back to SWR polling (the sandbox blocks WebSockets outright, so the polling
 * path is the one that has to work here anyway). What a harness CANNOT validate through this
 * tunnel is push-freshness — say so rather than implying the stream was exercised.
 */
function isStreamingRequest(req) {
  if (/\/(stream|sse|events)(\?|$)/.test(new URL(req.url()).pathname + new URL(req.url()).search)) return true;
  const accept = req.headers()["accept"] ?? "";
  return accept.includes("text/event-stream");
}

/**
 * Make an untrusted string safe to put on one line of a log.
 *
 * The failure log interpolates a request URL and an error message. Both are attacker-influenceable
 * in principle — the URL comes from whatever the page decided to request, the message can carry
 * text from a hostile server — and a CR or LF in either lets a crafted value append a forged log
 * line, which is the whole of CWE-117. The audit runs are read against prod to decide what is and
 * is not broken, so a log they can forge is a log that can mislead the next investigation.
 *
 * Strips every C0/C1 control character (not just \r\n — \b and \x1b can rewrite a terminal line
 * just as effectively) and truncates, so one enormous URL cannot bury the surrounding output.
 */
function logSafe(value, max = 200) {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, " ")
    .slice(0, max);
}

/**
 * Build a tunneled browser + context. Caller owns closing `browser`.
 *
 * `counts` is live — read it after the run to confirm assets actually loaded. A screenshot taken
 * with a non-zero `fail` is a half-empty page and is not evidence of anything.
 */
async function createTunneledContext({
  url,
  cookie = "",
  viewport = "430x932",
  desktop = false,
  seedStorage = null,
} = {}) {
  const [vw, vh] = String(viewport).split("x").map(Number);

  const browser = await chromium.launch({
    executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--disable-background-networking"],
  });

  const ctx = await browser.newContext({
    viewport: { width: vw, height: vh },
    userAgent: desktop ? DESKTOP_UA : IPHONE_UA,
    deviceScaleFactor: desktop ? 1 : 3,
    isMobile: !desktop,
  });

  if (seedStorage) {
    // BEFORE navigation: a preference read during first render cannot be set after goto().
    await ctx.addInitScript((kv) => {
      for (const [k, v] of Object.entries(kv)) {
        try {
          window.localStorage.setItem(k, v);
        } catch {
          /* storage disabled — the page's own fallback applies */
        }
      }
    }, seedStorage);
  }

  if (cookie) {
    const dom = new URL(url).hostname;
    await ctx.addCookies(
      cookie
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((p) => {
          const [n, ...r] = p.split("=");
          const name = n.trim();
          // httpOnly ONLY for __session. Clerk deliberately leaves __client_uat readable by JS —
          // Nav.tsx's readClientSignedIn() uses it to resolve signed-in state before Clerk's client
          // loads. Marking it httpOnly hides it from document.cookie and makes every authenticated
          // capture render "Sign In / Get access →" over live premium content. That artifact has
          // been mistaken for a Cloudflare cache bug more than once; it is not one.
          return {
            name,
            value: r.join("=").trim(),
            domain: dom,
            path: "/",
            httpOnly: name === "__session",
            secure: true,
            sameSite: "Lax",
          };
        })
    );
  }

  const counts = { ok: 0, fail: 0, streamsAborted: 0 };

  // CONTEXT level, before any page exists, so even the first navigation goes through Node.
  await ctx.route("**/*", async (route, req) => {
    const reqUrl = req.url();
    if (/^(data|blob|about|chrome|chrome-extension):/.test(reqUrl)) return route.continue();
    if (isStreamingRequest(req)) {
      counts.streamsAborted++;
      return route.abort("connectionfailed");
    }
    try {
      const r = await proxyFetchFollow(reqUrl, req.method(), req.headers(), req.postDataBuffer());
      counts.ok++;
      await route.fulfill({ status: r.status, headers: r.headers, body: r.body });
    } catch (e) {
      counts.fail++;
      console.error(`  FAIL [${logSafe(req.method(), 8)}] ${logSafe(reqUrl, 80)}: ${logSafe(e?.message, 200)}`);
      await route.abort("connectionfailed");
    }
  });

  return { browser, ctx, counts };
}

module.exports = { createTunneledContext, proxyFetch, proxyFetchFollow, IPHONE_UA, DESKTOP_UA };
