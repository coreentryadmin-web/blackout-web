/**
 * Authenticated Night Hawk screenshot via proxy-tunneled Playwright.
 *
 * All HTTP (Clerk Backend API, FAPI ticket exchange, every Chromium
 * sub-request) goes through the agent proxy CONNECT tunnel. Chromium
 * never touches the network directly; context.route intercepts all requests.
 *
 * Usage: node screenshot-nighthawk.mjs [page-path] [output.png]
 *   --viewport WIDTHxHEIGHT   Default 430x932 (iPhone Pro Max)
 *   --wait ms                 Wait after DOM load (default 5000)
 *   --full                    Full-page screenshot
 */
import { chromium } from 'playwright';
import http from 'http';
import tls from 'tls';
import fs from 'fs';
import crypto from 'crypto';

const APP = 'https://blackouttrades.com';
const FAPI = 'https://clerk.blackouttrades.com';
const CLERK_API = 'https://api.clerk.com';
const CJS = '5.57.0';
const SECRET = process.env.CLERK_SECRET_KEY;

const PROXY_URL = process.env.HTTPS_PROXY || 'http://127.0.0.1:42795';
const CA_PATH = '/root/.ccr/ca-bundle.crt';
const ca = fs.existsSync(CA_PATH) ? fs.readFileSync(CA_PATH) : undefined;

function parseArgs() {
  const a = process.argv.slice(2);
  const opts = { vp: '430x932', wait: 5000, full: false };
  const pos = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--viewport') opts.vp = a[++i];
    else if (a[i] === '--wait') opts.wait = +a[++i];
    else if (a[i] === '--full') opts.full = true;
    else pos.push(a[i]);
  }
  opts.path = pos[0] || '/nighthawk';
  opts.out = pos[1] || 'screenshot.png';
  return opts;
}

/** Raw HTTPS fetch through CONNECT tunnel. HTTP/1.0 + Connection:close.
 *  Returns { status, headers (object, all keys lowercased), rawHeaders (array of lines), body (Buffer) }. */
function tunnelFetch(url, method = 'GET', headers = {}, body = null) {
  const u = new URL(url);
  const p = new URL(PROXY_URL);
  return new Promise((resolve, reject) => {
    const kill = setTimeout(() => reject(new Error('tunnel timeout 30s')), 30000);
    const cReq = http.request({
      host: p.hostname, port: +p.port || 8080,
      method: 'CONNECT', path: `${u.hostname}:${u.port || 443}`,
    });
    cReq.on('error', e => { clearTimeout(kill); reject(e); });
    cReq.on('connect', (res, sock) => {
      if (res.statusCode !== 200) {
        clearTimeout(kill); sock.destroy();
        return reject(new Error(`CONNECT ${res.statusCode}`));
      }
      const ts = tls.connect({ socket: sock, host: u.hostname, servername: u.hostname, ca }, () => {
        const rh = { Host: u.host, 'Accept-Encoding': 'identity', Connection: 'close', ...headers };
        if (body) rh['Content-Length'] = String(Buffer.byteLength(body));
        delete rh['accept-encoding'];
        let raw = `${method} ${u.pathname}${u.search} HTTP/1.0\r\n`;
        for (const [k, v] of Object.entries(rh)) if (v != null) raw += `${k}: ${v}\r\n`;
        raw += '\r\n';
        ts.write(raw);
        if (body) ts.write(body);
      });
      const bufs = [];
      ts.on('data', c => bufs.push(c));
      ts.on('end', () => {
        clearTimeout(kill);
        const all = Buffer.concat(bufs);
        const s = all.toString('latin1');
        const sep = s.indexOf('\r\n\r\n');
        if (sep < 0) return resolve({ status: 200, headers: {}, rawHeaders: [], body: Buffer.alloc(0) });
        const hdr = s.slice(0, sep);
        const bdy = all.slice(sep + 4);
        const st = +(hdr.match(/^HTTP\/[\d.]+ (\d+)/)?.[1] || 200);
        const rh2 = {};
        const rawHdrs = hdr.split('\r\n').slice(1);
        rawHdrs.forEach(l => {
          const i = l.indexOf(':');
          if (i > 0) rh2[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim();
        });
        resolve({ status: st, headers: rh2, rawHeaders: rawHdrs, body: bdy });
      });
      ts.on('error', e => { clearTimeout(kill); reject(e); });
    });
    cReq.end();
  });
}

/** Follow redirects (up to 5). */
async function tunnelFetchFollow(url, method = 'GET', headers = {}, body = null) {
  let r = await tunnelFetch(url, method, headers, body);
  for (let i = 0; i < 5 && r.status >= 301 && r.status <= 308 && r.headers.location; i++) {
    const loc = new URL(r.headers.location, url).href;
    r = await tunnelFetch(loc, 'GET', headers, null);
  }
  return r;
}

/** JSON helper for Clerk Backend API. */
async function clerkApi(method, path, body) {
  const headers = {
    Authorization: `Bearer ${SECRET}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  const r = await tunnelFetch(
    `${CLERK_API}/v1${path}`, method, headers,
    body ? JSON.stringify(body) : null,
  );
  return JSON.parse(r.body.toString('utf8'));
}

/** Simple cookie jar: extracts Set-Cookie names/values, sends them back as Cookie header. */
const cookieJar = {};
function extractCookies(rawHeaders) {
  for (const line of rawHeaders) {
    const m = line.match(/^set-cookie:\s*([^=]+)=([^;]*)/i);
    if (m) cookieJar[m[1].trim()] = m[2].trim();
  }
}
function cookieHeader() {
  const pairs = Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`);
  return pairs.length ? pairs.join('; ') : undefined;
}

/** FAPI call (form-encoded) with cookie jar. */
async function fapiPost(path, formData) {
  const encoded = Object.entries(formData)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  const hdrs = {
    Origin: APP,
    Referer: `${APP}/`,
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  };
  const ck = cookieHeader();
  if (ck) hdrs.Cookie = ck;

  const r = await tunnelFetch(
    `${FAPI}${path}?_clerk_js_version=${CJS}`, 'POST',
    hdrs,
    encoded || undefined,
  );
  extractCookies(r.rawHeaders);
  return { parsed: JSON.parse(r.body.toString('utf8')), status: r.status };
}

async function main() {
  const opts = parseArgs();
  if (!SECRET) { console.error('CLERK_SECRET_KEY not set'); process.exit(1); }

  const email = `audit-screenshot-${Date.now()}@example.com`;
  const suffix = String(crypto.randomInt(0, 10000)).padStart(4, '0');
  const phone = `+1415555${suffix}`;
  let userId = null;

  try {
    // 1. Create temp admin user
    console.log('Creating temp Clerk user...');
    const user = await clerkApi('POST', '/users', {
      email_address: [email],
      phone_number: [phone],
      public_metadata: { role: 'admin', tier: 'premium' },
      skip_password_requirement: true,
      skip_legal_checks: true,
    });
    userId = user.id;
    if (!userId) { console.error('Failed to create user:', JSON.stringify(user).slice(0, 200)); process.exit(1); }
    console.log(`  user ${userId}`);

    // 2. Create sign-in token
    const sit = await clerkApi('POST', '/sign_in_tokens', { user_id: userId });
    const ticket = sit.token;
    if (!ticket) { console.error('No sign-in token:', JSON.stringify(sit).slice(0, 200)); process.exit(1); }
    console.log('  sign-in token obtained');

    // 3. FAPI ticket exchange (sets cookies in jar)
    const { parsed: si } = await fapiPost('/v1/client/sign_ins', { strategy: 'ticket', ticket });
    const sid = si?.response?.created_session_id;
    if (!sid) { console.error('FAPI exchange failed:', JSON.stringify(si).slice(0, 300)); process.exit(1); }
    console.log(`  session ${sid}`);
    console.log(`  cookies in jar: ${Object.keys(cookieJar).join(', ')}`);

    // 4. Mint JWT (uses cookies from jar)
    const clientUat = Math.floor(Date.now() / 1000);
    const { parsed: tokResp } = await fapiPost(`/v1/client/sessions/${sid}/tokens`, {});
    const jwt = tokResp?.jwt;
    if (!jwt) { console.error('JWT mint failed:', JSON.stringify(tokResp).slice(0, 200)); process.exit(1); }
    console.log('  JWT minted (fresh)');

    // 5. Launch Playwright with route interception
    const [vw, vh] = opts.vp.split('x').map(Number);
    const browser = await chromium.launch({
      executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
      headless: true,
      args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--disable-background-networking'],
    });

    const ctx = await browser.newContext({
      viewport: { width: vw, height: vh },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1 BlackOutiOSApp/1.0',
      deviceScaleFactor: 3,
      isMobile: true,
    });

    // Set auth cookies on the browser context
    const domain = 'blackouttrades.com';
    await ctx.addCookies([
      { name: '__session', value: jwt, domain, path: '/', httpOnly: true, secure: true, sameSite: 'Lax' },
      { name: '__client_uat', value: String(clientUat), domain, path: '/', httpOnly: false, secure: true, sameSite: 'Lax' },
    ]);

    let ok = 0, fail = 0;

    // Intercept ALL requests at context level — before any page exists
    await ctx.route(/.*/, async (route, req) => {
      const url = req.url();
      if (/^(data|blob|about|chrome|chrome-extension):/.test(url)) return route.continue();
      try {
        const r = await tunnelFetchFollow(url, req.method(), req.headers(), req.postDataBuffer());
        ok++;
        await route.fulfill({ status: r.status, headers: r.headers, body: r.body });
      } catch (e) {
        fail++;
        if (fail <= 5) console.error(`  FAIL [${req.method()}] ${url.slice(0, 80)}: ${e.message}`);
        await route.abort('connectionfailed');
      }
    });

    const page = await ctx.newPage();
    const targetUrl = `${APP}${opts.path}`;
    console.log(`Navigating to ${targetUrl}...`);

    try {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      console.log('DOM loaded');
    } catch (e) {
      console.warn(`nav warning: ${e.message.split('\n')[0]}`);
    }

    console.log(`Waiting ${opts.wait}ms for rendering...`);
    await page.waitForTimeout(opts.wait);
    console.log(`Routed: ${ok} ok, ${fail} fail`);

    await page.screenshot({ path: opts.out, fullPage: opts.full, timeout: 15000 });
    console.log(`Screenshot saved: ${opts.out}`);
    await browser.close();

  } finally {
    if (userId) {
      try {
        await clerkApi('DELETE', `/users/${userId}`);
        console.log(`Cleaned up user ${userId}`);
      } catch (e) {
        console.error(`Cleanup failed: ${e.message}`);
      }
    }
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
