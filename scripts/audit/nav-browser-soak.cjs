/**
 * Proxy-browser: Playwright screenshots through the agent proxy.
 * Chromium never touches the network — page.route('**\/*') intercepts every
 * request and fulfills it via Node's tls.connect() through the CONNECT tunnel.
 *
 * Usage: node proxy-browser.cjs <url> [output.png] [--cookie "k=v"] [--viewport WxH] [--wait ms] [--full]
 */
const { chromium } = require('playwright');
const http = require('http');
const tls = require('tls');
const fs = require('fs');
const { URL } = require('url');

const PROXY_URL = process.env.HTTPS_PROXY || 'http://127.0.0.1:42795';
const CA_PATH = '/root/.ccr/ca-bundle.crt';
const ca = fs.existsSync(CA_PATH) ? fs.readFileSync(CA_PATH) : undefined;

function parseArgs() {
  const a = process.argv.slice(2), opts = { vp: '430x932', wait: 5000, ck: '', full: false }, pos = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i]==='--cookie') opts.ck=a[++i]; else if (a[i]==='--viewport') opts.vp=a[++i];
    else if (a[i]==='--wait') opts.wait=+a[++i]; else if (a[i]==='--full') opts.full=true;
    else pos.push(a[i]);
  }
  return { ...opts, url: pos[0], out: pos[1]||'screenshot.png' };
}

/* One-shot HTTPS fetch through the CONNECT tunnel. HTTP/1.0 + Connection:close
   guarantees the server closes the socket when the body ends — no chunked ambiguity. */
function proxyFetch(url, method, hdrs, body) {
  const u = new URL(url), p = new URL(PROXY_URL);
  return new Promise((resolve, reject) => {
    const kill = setTimeout(() => reject(new Error('timeout')), 20000);

    const cReq = http.request({ host: p.hostname, port: +p.port||8080, method: 'CONNECT', path: `${u.hostname}:${u.port||443}` });
    cReq.on('error', e => { clearTimeout(kill); reject(e); });
    cReq.on('connect', (res, sock) => {
      if (res.statusCode !== 200) { clearTimeout(kill); sock.destroy(); return reject(new Error(`CONNECT ${res.statusCode}`)); }

      const ts = tls.connect({ socket: sock, host: u.hostname, servername: u.hostname, ca }, () => {
        const rh = Object.assign({}, hdrs, { Host: u.host, 'Accept-Encoding': 'identity', Connection: 'close' });
        if (body?.length) rh['Content-Length'] = String(body.length);
        // Remove headers that cause issues
        delete rh['accept-encoding'];

        let raw = `${method} ${u.pathname}${u.search} HTTP/1.0\r\n`;
        for (const [k,v] of Object.entries(rh)) if (v!=null) raw += `${k}: ${v}\r\n`;
        raw += '\r\n';
        ts.write(raw);
        if (body?.length) ts.write(body);
      });

      const bufs = [];
      ts.on('data', c => bufs.push(c));
      ts.on('end', () => {
        clearTimeout(kill);
        const all = Buffer.concat(bufs), s = all.toString('latin1');
        const sep = s.indexOf('\r\n\r\n');
        if (sep < 0) return resolve({ status: 200, headers: {}, body: Buffer.alloc(0) });
        const hdr = s.slice(0, sep), bdy = all.slice(sep + 4);
        const st = +(hdr.match(/^HTTP\/[\d.]+ (\d+)/)?.[1] || 200);
        const rh2 = {};
        hdr.split('\r\n').slice(1).forEach(l => { const i = l.indexOf(':'); if (i>0) rh2[l.slice(0,i).trim().toLowerCase()] = l.slice(i+1).trim(); });
        resolve({ status: st, headers: rh2, body: bdy });
      });
      ts.on('error', e => { clearTimeout(kill); reject(e); });
    });
    cReq.end();
  });
}

/* Follow one redirect (Location header). */
async function proxyFetchFollow(url, method, hdrs, body) {
  const r = await proxyFetch(url, method, hdrs, body);
  if (r.status >= 301 && r.status <= 308 && r.headers.location) {
    const loc = new URL(r.headers.location, url).href;
    return proxyFetch(loc, 'GET', hdrs, null);
  }
  return r;
}


/* ── Client-side navigation soak (REAL BROWSER) ───────────────────────────────
 * Companion to scripts/audit/nav-soak.mjs, which is HTTP-only and therefore blind
 * to client-side failures. This one drives real Chromium through the CONNECT-tunnel
 * routing from proxy-browser.cjs (Chromium has no network in this sandbox — see
 * docs/audit/LIVE-UI-CONNECTION.md), authenticates with a real Clerk cookie, then
 * navigates the desk via history.pushState + popstate so Next performs RSC
 * transitions rather than full page loads — the path a member actually takes.
 *
 * Captures: console errors, uncaught pageerrors, every response >=400, transport
 * failures, and the error-boundary copy after each transition.
 *
 * Usage (from the repo root, backgrounded — a foreground run gets killed by the
 * command timeout before it flushes):
 *   CK=$(npx tsx scripts/audit/lib/print-session-cookie.mjs)   # or mintClerkPremiumSession
 *   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
 *     node scripts/audit/nav-browser-soak.cjs https://blackouttrades.com/dashboard out.png \
 *     --cookie "$CK" --viewport 1440x900 --rounds=20 > /tmp/navlog.txt 2>&1 &
 *
 * FIRST RUN 2026-08-08 — 2 rounds, 14 client-side transitions, 192 requests:
 *   error boundaries hit: 0     uncaught page errors: 0
 * i.e. the operator's intermittent "We couldn't load this page" was NOT reproduced
 * in 14 transitions. Needs a longer run (20+ rounds) before absence means anything.
 *
 * TWO OF THE FOUR FAILED REQUESTS ARE HARNESS ARTIFACTS, NOT APP BUGS — do not
 * chase them:
 *   - `411 POST google-analytics.com/g/collect` — the CONNECT relay does not set
 *     Content-Length on POST bodies.
 *   - `ERR GET /api/market/spx/pulse/stream :: timeout` and `/api/market/flows/stream`
 *     — these are SSE endpoints. The relay does one-shot request/response and cannot
 *     hold a long-lived event stream open, so it always times them out.
 *
 * That SSE limitation is worth a second look rather than a shrug: those two streams
 * DO drop in production for real reasons (ECS task recycling on every deploy,
 * Cloudflare idle timeouts, network blips). If a dropped EventSource propagates into
 * render instead of being handled, that is a candidate mechanism for the reported
 * error page — and it would fit the symptom being intermittent and correlated with
 * deploy activity. This harness cannot test it; a browser with real network can.
 */

const PATHS = ["/dashboard","/nighthawk","/terminal","/vector","/flows","/heatmap","/dashboard"];

async function main() {
  const o = parseArgs();
  const rounds = +(process.argv.find(a=>a.startsWith("--rounds="))?.slice(9) || 4);
  const [vw,vh] = (o.vp || "1440x900").split('x').map(Number);
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    headless: true,
    args: ['--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--disable-background-networking'],
  });
  const ctx = await browser.newContext({ viewport:{width:vw,height:vh}, deviceScaleFactor:1 });
  if (o.ck) {
    const dom = new URL(o.url).hostname;
    await ctx.addCookies(o.ck.split(';').map(s=>s.trim()).filter(Boolean).map(p=>{
      const [n,...r]=p.split('='); return {name:n.trim(),value:r.join('=').trim(),domain:dom,path:'/',httpOnly:true,secure:true,sameSite:'Lax'};
    }));
  }
  let ok=0, fail=0;
  const failedReqs=[], consoleErrs=[], pageErrs=[], boundaries=[];
  await ctx.route('**/*', async (route, req) => {
    const url = req.url();
    if (/^(data|blob|about|chrome|chrome-extension):/.test(url)) return route.continue();
    try {
      const r = await proxyFetchFollow(url, req.method(), req.headers(), req.postDataBuffer());
      ok++;
      if (r.status >= 400) failedReqs.push(`${r.status} ${req.method()} ${url.slice(0,110)}`);
      await route.fulfill({ status:r.status, headers:r.headers, body:r.body });
    } catch (e) { fail++; failedReqs.push(`ERR ${req.method()} ${url.slice(0,110)} :: ${e.message}`); await route.abort('connectionfailed'); }
  });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type()==='error') consoleErrs.push(m.text().slice(0,240)); });
  page.on('pageerror', e => pageErrs.push(String(e.message).slice(0,240)));

  const base = new URL(o.url).origin;
  await page.goto(base + PATHS[0], { waitUntil:'domcontentloaded', timeout:45000 }).catch(e=>console.warn('initial nav:', e.message.split('\n')[0]));
  await page.waitForTimeout(4000);

  for (let r=0; r<rounds; r++) {
    for (const p of PATHS) {
      // Client-side transition: Next intercepts pushState and does an RSC fetch.
      await page.evaluate((path)=>{ window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')); }, p).catch(()=>{});
      await page.waitForTimeout(1800);
      const txt = await page.evaluate(()=>document.body?.innerText?.slice(0,400) || '').catch(()=>'');
      if (/We couldn't load this page|SOMETHING WENT WRONG/i.test(txt)) {
        boundaries.push(`round ${r} at ${p}`);
        console.log(`  !! ERROR BOUNDARY at ${p} (round ${r})`);
      }
    }
    console.log(`round ${r+1}/${rounds} done — routed ${ok} ok / ${fail} fail`);
  }

  console.log(`\n=== client-side nav soak ===`);
  console.log(`routed: ${ok} ok, ${fail} transport-fail`);
  console.log(`error boundaries hit: ${boundaries.length}`, boundaries.slice(0,10));
  console.log(`failed requests (>=400 or transport): ${failedReqs.length}`);
  [...new Set(failedReqs)].slice(0,25).forEach(f=>console.log('   ', f));
  console.log(`console errors: ${consoleErrs.length}`);
  [...new Set(consoleErrs)].slice(0,15).forEach(f=>console.log('   ', f));
  console.log(`uncaught page errors: ${pageErrs.length}`);
  [...new Set(pageErrs)].slice(0,15).forEach(f=>console.log('   ', f));
  await browser.close();

}

main().catch(e => { console.error(e.message); process.exit(1); });
