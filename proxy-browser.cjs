/**
 * Proxy-browser: Playwright screenshots through the agent proxy.
 * Chromium never touches the network — page.route('**\/*') intercepts every
 * request and fulfills it via Node's tls.connect() through the CONNECT tunnel.
 *
 * Usage: node proxy-browser.cjs <url> [output.png] [--cookie "k=v"] [--viewport WxH] [--wait ms] [--full]
 *        [--desktop] [--seed-storage '{"key":"value"}']
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
  const a = process.argv.slice(2), opts = { vp: '430x932', wait: 5000, ck: '', full: false, seed: '', desktop: false }, pos = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i]==='--cookie') opts.ck=a[++i]; else if (a[i]==='--viewport') opts.vp=a[++i];
    else if (a[i]==='--wait') opts.wait=+a[++i]; else if (a[i]==='--full') opts.full=true;
    else if (a[i]==='--seed-storage') opts.seed=a[++i]; else if (a[i]==='--desktop') opts.desktop=true;
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

async function main() {
  const o = parseArgs();
  if (!o.url) { console.error('Usage: node proxy-browser.cjs <url> [out.png]'); process.exit(1); }
  const [vw,vh] = o.vp.split('x').map(Number);

  // Launch Chromium with NO network access (it won't need it)
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    headless: true,
    args: ['--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--disable-background-networking'],
  });

  const ctx = await browser.newContext({
    viewport: { width: vw, height: vh },
    userAgent: o.desktop
      ? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
      : 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1 BlackOutiOSApp/1.0',
    deviceScaleFactor: o.desktop ? 1 : 3,
    isMobile: !o.desktop,
  });

  // Seed localStorage BEFORE any navigation. Preferences the app persists (chart timeframe, wall
  // density) are read during first render, so setting them after goto() would capture the default
  // state and then a re-render — or nothing at all, for values only read once on mount.
  if (o.seed) {
    try {
      const entries = Object.entries(JSON.parse(o.seed));
      await ctx.addInitScript((kv) => {
        for (const [k, v] of kv) {
          try { window.localStorage.setItem(k, String(v)); } catch { /* storage blocked */ }
        }
      }, entries);
    } catch (e) {
      console.error(`--seed-storage ignored (not valid JSON): ${e.message}`);
    }
  }

  if (o.ck) {
    const dom = new URL(o.url).hostname;
    await ctx.addCookies(o.ck.split(';').map(s=>s.trim()).filter(Boolean).map(p => {
      const [n,...r] = p.split('=');
      const name = n.trim();
      // httpOnly ONLY for __session. Clerk deliberately leaves __client_uat readable by JS — the
      // nav's cookie self-heal (Nav.tsx readClientSignedIn) reads it to decide signed-in state
      // before Clerk's client finishes loading. Marking it httpOnly here hid it from document.cookie
      // and made EVERY authenticated capture render "Sign In / Get access →" over live premium
      // content. That was a harness artifact reported as a site bug more than once; it is not one.
      return { name, value:r.join('=').trim(), domain:dom, path:'/', httpOnly:name === '__session', secure:true, sameSite:'Lax' };
    }));
  }

  let ok = 0, fail = 0;

  // Intercept ALL requests at the CONTEXT level — before any page exists,
  // so even the very first navigation goes through Node, not Chromium.
  await ctx.route('**/*', async (route, req) => {
    const url = req.url();
    if (/^(data|blob|about|chrome|chrome-extension):/.test(url)) return route.continue();
    try {
      const r = await proxyFetchFollow(url, req.method(), req.headers(), req.postDataBuffer());
      ok++;
      await route.fulfill({ status: r.status, headers: r.headers, body: r.body });
    } catch (e) {
      fail++;
      console.error(`  FAIL [${req.method()}] ${url.slice(0,80)}: ${e.message}`);
      await route.abort('connectionfailed');
    }
  });

  const page = await ctx.newPage();
  console.log(`→ ${o.url}`);
  try {
    await page.goto(o.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log('DOM loaded');
  } catch (e) {
    console.warn(`nav: ${e.message.split('\n')[0]}`);
  }

  await page.waitForTimeout(o.wait);
  console.log(`Routed: ${ok} ok, ${fail} fail`);

  await page.screenshot({ path: o.out, fullPage: o.full, timeout: 10000 });
  console.log(`Saved: ${o.out}`);
  await browser.close();
}

main().catch(e => { console.error(e.message); process.exit(1); });
