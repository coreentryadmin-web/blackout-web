/**
 * LIVE UI AUDIT — accessibility, mobile-layout and runtime-error sweep of the REAL rendered desk.
 *
 * Same transport as proxy-browser.cjs (see docs/audit/LIVE-UI-CONNECTION.md): Chromium in this
 * sandbox cannot reach the network at all, so context.route('**\/*') intercepts every request and
 * Node fulfills it over a manual CONNECT + tls.connect() tunnel. That is the ONLY way to render a
 * live page here — a plain-Playwright failure proves nothing but the egress block.
 *
 * Where proxy-browser screenshots, this evaluates the HYDRATED DOM and reports what a static SSR
 * fetch cannot see: controls a screen reader would announce as nothing, inputs with no accessible
 * name, images with no alt attribute, heading-order jumps, tap targets under the 44x44 iOS minimum,
 * horizontal body overflow (with the specific offending elements), DOM size, and every console /
 * page error the route threw.
 *
 * Usage: node scripts/audit/live-ui-audit.cjs <url> [out.png] --cookie "$CK" [--viewport WxH] [--wait ms]
 * Cookie comes from scripts/audit/lib/prod-clerk-session.mjs (mintClerkPremiumSession -> cookieHeader).
 * Run from the REPO ROOT and look for `Routed: N ok, 0 fail`.
 *
 * Original transport doc:
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

/** Strip CR/LF (and truncate) before anything reaches a log line.
 *  A page can request a URL it chose, so an unsanitised interpolation lets that page forge extra
 *  log records — CodeQL js/log-injection. Cheap to satisfy, and it keeps the audit output honest
 *  when a route really does carry odd characters. */
function safeLog(value, max = 110) {
  // Sequential single-character replaces, not one character class: this is the shape CodeQL's
  // js/log-injection sanitizer model recognises, and a combined class left the alert open.
  return String(value).replace(/\n/g, '').replace(/\r/g, '').replace(/\t/g, ' ').slice(0, max);
}

function parseArgs() {
  const a = process.argv.slice(2), opts = { vp: '430x932', wait: 5000, ck: '', full: false }, pos = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i]==='--cookie') opts.ck=a[++i]; else if (a[i]==='--viewport') opts.vp=a[++i];
    else if (a[i]==='--wait') opts.wait=+a[++i]; else if (a[i]==='--full') opts.full=true;
    else if (a[i]==='--inject-css') opts.css=a[++i];
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
  let cleanupSession = null;

  // Launch Chromium with NO network access (it won't need it)
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    headless: true,
    args: ['--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--disable-background-networking'],
  });

  const ctx = await browser.newContext({
    viewport: { width: vw, height: vh },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1 BlackOutiOSApp/1.0',
    deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  });

  // Mint the Clerk session INSIDE this run unless one was passed.
  //
  // WHY: the `__session` JWT Clerk mints has a ~60s lifetime (CLAUDE.md, "authenticate once per
  // run"). A cookie minted in an earlier shell command is already dead by the time Chromium
  // navigates, and the failure mode is not a 401 — Clerk's middleware sees `__client_uat > 0` with
  // no valid `__session` and issues a **307 handshake redirect whose Location is the SAME URL**.
  // A browser follows it, gets another 307, and the navigation dies as ERR_CONNECTION_RESET, which
  // looks exactly like the sandbox egress block and sends you chasing the transport instead of the
  // clock. Minting here keeps the JWT seconds old at first byte.
  if (!o.ck) {
    const { mintClerkPremiumSession } = await import('./lib/prod-clerk-session.mjs');
    const s = await mintClerkPremiumSession({ appUrl: new URL(o.url).origin });
    if (s.skip) { console.error(`mint skipped: ${s.reason}`); process.exit(1); }
    o.ck = s.cookieHeader;
    cleanupSession = s.cleanup;
    console.log(`minted temp session ${safeLog(s.userId, 60)}`);
  }

  if (o.ck) {
    const dom = new URL(o.url).hostname;
    await ctx.addCookies(o.ck.split(';').map(s=>s.trim()).filter(Boolean).map(p => {
      const [n,...r] = p.split('=');
      const name = n.trim();
      // Only __session is httpOnly in production. __client_uat is deliberately readable by JS —
      // Nav.tsx's cookie self-heal (readClientSignedIn) uses it to decide whether to render
      // "Open desk" or "Get access". Marking it httpOnly here makes document.cookie blind to it, so
      // every capture renders SIGNED-OUT nav chrome over a live gated board and the audit reports a
      // member-facing auth bug that does not exist. Match production's flags exactly.
      return { name, value:r.join('=').trim(), domain:dom, path:'/', httpOnly: name === '__session', secure:true, sameSite:'Lax' };
    }));
  }

  let ok = 0, fail = 0;
  const selfRedirects = [];

  // Intercept ALL requests at the CONTEXT level — before any page exists,
  // so even the very first navigation goes through Node, not Chromium.
  await ctx.route('**/*', async (route, req) => {
    const url = req.url();
    if (/^(data|blob|about|chrome|chrome-extension):/.test(url)) return route.continue();
    try {
      const r = await proxyFetchFollow(url, req.method(), req.headers(), req.postDataBuffer());
      ok++;
      const loc = r.headers['location'] || r.headers['Location'];
      if (r.status >= 300 && r.status < 400 && loc && new URL(loc, url).href === new URL(url).href) {
        selfRedirects.push(`${r.status} ${safeLog(url, 160)}`);
      }
      await route.fulfill({ status: r.status, headers: r.headers, body: r.body });
    } catch (e) {
      fail++;
      console.error(`  FAIL [${safeLog(req.method(), 8)}] ${safeLog(url, 80)}: ${safeLog(e.message, 120)}`);
      await route.abort('connectionfailed');
    }
  });

  const page = await ctx.newPage();

  // Everything the page complains about, captured from the first byte.
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 300)));

  console.log(`→ ${safeLog(o.url, 200)}`);
  try {
    await page.goto(o.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch (e) {
    console.warn(`nav: ${e.message.split('\n')[0]}`);
  }
  await page.waitForTimeout(o.wait);
  console.log(`Routed: ${ok} ok, ${fail} fail`);

  // Apply a not-yet-deployed stylesheet to the LIVE rendered DOM. This is how a CSS fix gets
  // measured before it ships — production cannot show you the "after" of a change that is still
  // on a branch, and re-measuring prod post-deploy is too late to catch a fix that does nothing.
  if (o.css) {
    await page.addStyleTag({ content: require('fs').readFileSync(o.css, 'utf8') });
    await page.waitForTimeout(500);
    console.log(`injected CSS: ${safeLog(o.css, 200)}`);
  }

  const report = await page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return false;
      const cs = getComputedStyle(el);
      return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
    };
    const label = (el) =>
      (el.getAttribute('aria-label') || '').trim() ||
      (el.getAttribute('title') || '').trim() ||
      (el.getAttribute('aria-labelledby') ? 'labelledby' : '') ||
      (el.textContent || '').trim() ||
      (el.querySelector('img[alt]')?.getAttribute('alt') || '').trim();

    const out = { a11y: {}, layout: {}, dom: {} };

    // --- a11y: interactive controls a screen reader would announce as nothing ---
    const controls = [...document.querySelectorAll('button, a[href], [role="button"], [role="tab"], summary')];
    out.a11y.unlabeledControls = controls.filter((el) => vis(el) && !label(el))
      .slice(0, 25).map((el) => `${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ').filter(Boolean).slice(0, 3).join('.')}`);

    // --- a11y: inputs with no accessible name ---
    out.a11y.unlabeledInputs = [...document.querySelectorAll('input, select, textarea')]
      .filter((el) => vis(el) && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby') &&
        !(el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) && !el.closest('label') &&
        !el.getAttribute('placeholder') && el.type !== 'hidden')
      .slice(0, 25).map((el) => `${el.tagName.toLowerCase()}[type=${el.getAttribute('type') || '-'}]`);

    // --- a11y: images with no alt attribute at all (null, not "") ---
    out.a11y.imgsMissingAlt = [...document.querySelectorAll('img')]
      .filter((el) => vis(el) && el.getAttribute('alt') === null)
      .slice(0, 25).map((el) => (el.getAttribute('src') || '').slice(-60));

    // --- a11y: heading order (a jump from h1 to h3 breaks screen-reader navigation) ---
    const hs = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(vis).map((h) => +h.tagName[1]);
    const jumps = [];
    for (let i = 1; i < hs.length; i++) if (hs[i] - hs[i - 1] > 1) jumps.push(`h${hs[i - 1]}→h${hs[i]}`);
    out.a11y.headingJumps = jumps.slice(0, 10);
    out.a11y.h1Count = hs.filter((n) => n === 1).length;

    // --- a11y: tap targets under the 44x44 iOS minimum ---
    //
    // Measured by HIT TEST, not border box. The standard way to enlarge a dense glyph control is a
    // transparent absolutely-positioned ::after — it takes the touch but contributes nothing to the
    // element's own rect, so a box-only check reports the fix as a no-op and would argue for
    // wrecking the layout instead. What a fingertip actually experiences is what
    // document.elementFromPoint returns, so that is what this asks: probe the four corners of the
    // 44x44 box centred on the control and require every one to land on the control or a descendant
    // (a child <span aria-hidden> glyph counts — the click still reaches the button).
    const hitsControl = (el, dx, dy) => {
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2 + dx;
      const y = r.top + r.height / 2 + dy;
      if (x < 0 || y < 0 || x > document.documentElement.clientWidth || y > window.innerHeight) return true;
      const hit = document.elementFromPoint(x, y);
      return !!hit && (hit === el || el.contains(hit));
    };
    const PROBE = 21; // just inside the 44px half-extent, so a rounding hair does not fail it
    out.a11y.tinyTapTargets = controls.filter(vis).filter((el) => {
      // A visually-hidden skip link is 1x1 BY DESIGN and only becomes a real target on focus.
      // Reporting it on every run trains the reader to skim past the whole list.
      if (el.className && /\bsr-only\b/.test(el.className.toString())) return false;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      if (r.width >= 44 && r.height >= 44) return false; // box alone is already big enough
      return !(
        hitsControl(el, -PROBE, -PROBE) && hitsControl(el, PROBE, -PROBE) &&
        hitsControl(el, -PROBE, PROBE) && hitsControl(el, PROBE, PROBE)
      );
    }).slice(0, 20).map((el) => {
      const r = el.getBoundingClientRect();
      return `${el.tagName.toLowerCase()}"${label(el).slice(0, 18)}" ${Math.round(r.width)}x${Math.round(r.height)}`;
    });

    // --- layout: the page body must never scroll horizontally on mobile ---
    const de = document.documentElement;
    out.layout.horizontalOverflowPx = Math.max(0, de.scrollWidth - de.clientWidth);
    out.layout.viewportWidth = de.clientWidth;
    if (out.layout.horizontalOverflowPx > 0) {
      out.layout.offenders = [...document.querySelectorAll('*')].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.right > de.clientWidth + 1 && vis(el);
      }).slice(0, 12).map((el) => {
        const r = el.getBoundingClientRect();
        return `${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ').filter(Boolean).slice(0, 2).join('.')} right=${Math.round(r.right)}`;
      });
    }

    out.dom.nodeCount = document.querySelectorAll('*').length;
    out.dom.title = document.title;
    out.dom.lang = document.documentElement.getAttribute('lang') || null;
    return out;
  });

  if (selfRedirects.length) {
    console.error(`\nSELF-REDIRECT LOOP (${selfRedirects.length}) — the origin 3xx'd a URL back to itself.`);
    console.error(`This is almost always an EXPIRED __session JWT hitting Clerk's handshake, not a`);
    console.error(`transport problem. Re-run without --cookie so the harness mints a fresh one.`);
    for (const l of selfRedirects.slice(0, 5)) console.error(`  ${safeLog(l, 180)}`);
  }
  console.log(JSON.stringify({ url: o.url, report, consoleErrors, pageErrors, selfRedirects: selfRedirects.length }, null, 2));
  if (o.out && o.out !== 'screenshot.png') await page.screenshot({ path: o.out, fullPage: o.full, timeout: 15000 });
  await browser.close();
  if (cleanupSession) await cleanupSession();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
