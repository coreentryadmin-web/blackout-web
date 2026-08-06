/**
 * Screenshot the Night Hawk 0DTE page using Playwright + proxy interception.
 * Mints a temp Clerk admin user, authenticates, loads the page, screenshots.
 */
import { chromium } from 'playwright';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, existsSync, readFileSync } from 'fs';
import { connect as tlsConnect } from 'tls';
import { URL } from 'url';
import http from 'http';
import { generateDefaultAuditPhone } from './lib/audit-phone.mjs';
import { createOrAdoptAuditUserViaCurl } from './lib/clerk-audit-user.mjs';

const SECRET = process.env.CLERK_SECRET_KEY;
const PUB = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || '';
const APP = 'https://blackouttrades.com';
const API = 'https://api.clerk.com/v1';
const CJS = '5.57.0';
const EMAIL = 'claude-audit-temp@blackouttrades.com';
const PHONE = generateDefaultAuditPhone();
const CA_BUNDLE = '/root/.ccr/ca-bundle.crt';
const PROXY_URL = process.env.HTTPS_PROXY;
const OUT = process.env.SCREENSHOT_OUT || '/tmp/claude-0/-home-user/4e81061a-28b0-5b7a-b55b-1ebd214f8951/scratchpad';

function fapiHost() {
  try {
    const d = Buffer.from(PUB.replace(/^pk_(live|test)_/, ''), 'base64').toString('utf8').replace(/\$$/, '');
    if (d.includes('.')) return `https://${d}`;
  } catch {}
  return 'https://clerk.blackouttrades.com';
}
const FAPI = fapiHost();

// curl-based helpers (reuse data-validator pattern)
const TMP = join(tmpdir(), `bo-screenshot-${process.pid}`);
mkdirSync(TMP, { recursive: true });
const JAR = join(TMP, 'cookies.txt');
let seq = 0;
function curl({ method = 'GET', url, headers = {}, form, urlencodeForm, json, jar = false, saveJar = false }) {
  const bf = join(TMP, `b${++seq}`);
  const args = ['-sS', '--max-time', '45', '-o', bf, '-w', '%{http_code}', '-A', 'Mozilla/5.0'];
  if (method !== 'GET') args.push('-X', method);
  for (const [k, v] of Object.entries(headers)) args.push('-H', `${k}: ${v}`);
  if (json) args.push('-H', 'Content-Type: application/json', '--data', JSON.stringify(json));
  if (form) for (const [k, v] of Object.entries(form)) args.push('--data', `${k}=${v}`);
  if (urlencodeForm) for (const [k, v] of Object.entries(urlencodeForm)) args.push('--data-urlencode', `${k}=${v}`);
  if (jar) args.push('-b', JAR);
  if (saveJar) args.push('-c', JAR);
  args.push(url);
  try {
    const s = Number(execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }).trim());
    return { s, b: existsSync(bf) ? readFileSync(bf, 'utf8') : '' };
  } catch (e) { return { s: 0, b: '', err: String(e.message || e).split('\n')[0] }; }
}
const J = (r) => { try { return JSON.parse(r.b); } catch { return null; } };
const backend = (m, p, j) => curl({ method: m, url: `${API}${p}`, headers: { Authorization: `Bearer ${SECRET}` }, json: j });

let userId = null;

async function authenticate() {
  console.log('Creating temp admin user...');
  // Shared create-or-adopt: e-mail collision → adopt the leftover user; PHONE collision →
  // redraw a fresh +1415555XXXX and retry.
  const auth = await createOrAdoptAuditUserViaCurl({ curl, api: API, secret: SECRET, email: EMAIL, phone: PHONE });
  if (auth.error) { console.error('FAIL: could not create/adopt temp user', auth.error.slice(0, 220)); process.exit(1); }
  userId = auth.userId;
  console.log(`User ${userId} ready`);

  // Sign-in token → FAPI ticket exchange
  const ticket = J(backend('POST', '/sign_in_tokens', { user_id: userId }))?.token;
  if (!ticket) { console.error('FAIL: no sign_in_token'); process.exit(1); }

  const si = curl({
    method: 'POST',
    url: `${FAPI}/v1/client/sign_ins?_clerk_js_version=${CJS}`,
    headers: { Origin: APP, Referer: `${APP}/`, 'Content-Type': 'application/x-www-form-urlencoded' },
    form: { strategy: 'ticket' }, urlencodeForm: { ticket },
    saveJar: true, jar: true
  });
  const sessionId = J(si)?.response?.created_session_id;
  if (!sessionId) { console.error('FAIL: no session from FAPI', si.b.slice(0, 200)); process.exit(1); }
  console.log(`Session ${sessionId}`);

  // Mint JWT
  const tokResp = curl({
    method: 'POST',
    url: `${FAPI}/v1/client/sessions/${sessionId}/tokens?_clerk_js_version=${CJS}`,
    headers: { Origin: APP, Referer: `${APP}/`, 'Content-Type': 'application/x-www-form-urlencoded' },
    jar: true, saveJar: true
  });
  const jwt = J(tokResp)?.jwt;
  if (!jwt) { console.error('FAIL: no JWT', tokResp.b.slice(0, 200)); process.exit(1); }
  console.log('JWT minted');

  const clientUat = Math.floor(Date.now() / 1000);
  return { jwt, clientUat, sessionId };
}

async function cleanup() {
  if (userId) {
    console.log(`Deleting temp user ${userId}...`);
    const r = curl({ method: 'DELETE', url: `${API}/users/${userId}`, headers: { Authorization: `Bearer ${SECRET}` } });
    console.log(`DELETE ${r.s}`);
  }
}

async function main() {
  let auth;
  try {
    auth = await authenticate();
  } catch (e) {
    console.error('Auth failed:', e);
    await cleanup();
    process.exit(1);
  }

  const { jwt, clientUat } = auth;
  const caBundle = readFileSync(CA_BUNDLE);

  console.log('Launching Chromium...');
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-certificate-errors'],
    headless: true,
  });

  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
      ignoreHTTPSErrors: true,
    });

    const page = await context.newPage();

    // Route ALL requests through the proxy via CONNECT tunnel
    await page.route('**/*', async (route) => {
      const request = route.request();
      const url = request.url();

      // Skip data: and blob: URLs
      if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('about:')) {
        return route.continue();
      }

      try {
        const target = new URL(url);
        const proxy = new URL(PROXY_URL);

        // CONNECT tunnel through proxy
        const tlsSocket = await new Promise((resolve, reject) => {
          const connectReq = http.request({
            host: proxy.hostname,
            port: proxy.port,
            method: 'CONNECT',
            path: `${target.hostname}:443`,
          });
          connectReq.setTimeout(30000);
          connectReq.on('connect', (res, socket) => {
            if (res.statusCode !== 200) {
              reject(new Error(`CONNECT ${res.statusCode} for ${target.hostname}`));
              return;
            }
            const tls = tlsConnect({
              socket,
              servername: target.hostname,
              ca: caBundle,
              rejectUnauthorized: true,
            });
            tls.on('secureConnect', () => resolve(tls));
            tls.on('error', reject);
          });
          connectReq.on('error', reject);
          connectReq.end();
        });

        // Build raw HTTP request
        const method = request.method();
        const headers = request.headers();
        const postData = request.postData();

        // Inject auth cookies for blackouttrades.com
        if (target.hostname === 'blackouttrades.com' || target.hostname.endsWith('.blackouttrades.com')) {
          headers['cookie'] = `__session=${jwt}; __client_uat=${clientUat}`;
        }

        delete headers['host'];
        headers['host'] = target.host;

        let reqStr = `${method} ${target.pathname}${target.search} HTTP/1.1\r\n`;
        for (const [k, v] of Object.entries(headers)) {
          if (k.toLowerCase() === 'connection') continue;
          reqStr += `${k}: ${v}\r\n`;
        }
        if (postData) {
          reqStr += `content-length: ${Buffer.byteLength(postData)}\r\n`;
        }
        reqStr += `connection: close\r\n\r\n`;

        tlsSocket.write(reqStr);
        if (postData) tlsSocket.write(postData);

        // Read response
        const chunks = [];
        await new Promise((resolve, reject) => {
          tlsSocket.on('data', (chunk) => chunks.push(chunk));
          tlsSocket.on('end', resolve);
          tlsSocket.on('error', reject);
          setTimeout(() => { tlsSocket.destroy(); resolve(); }, 30000);
        });

        const raw = Buffer.concat(chunks);
        const rawStr = raw.toString('latin1');

        // Parse HTTP response
        const headerEnd = rawStr.indexOf('\r\n\r\n');
        if (headerEnd === -1) {
          return route.fulfill({ status: 502, body: 'No response headers' });
        }

        const headerStr = rawStr.substring(0, headerEnd);
        const statusLine = headerStr.split('\r\n')[0];
        const statusMatch = statusLine.match(/HTTP\/\d\.\d (\d+)/);
        const status = statusMatch ? parseInt(statusMatch[1]) : 200;

        const respHeaders = {};
        const headerLines = headerStr.split('\r\n').slice(1);
        for (const line of headerLines) {
          const idx = line.indexOf(':');
          if (idx > 0) {
            const key = line.substring(0, idx).trim().toLowerCase();
            const val = line.substring(idx + 1).trim();
            if (key !== 'transfer-encoding' && key !== 'content-encoding' && key !== 'content-length') {
              respHeaders[key] = val;
            }
          }
        }

        // Handle chunked transfer encoding
        let body;
        const bodyRaw = raw.slice(headerEnd + 4);
        if (headerStr.toLowerCase().includes('transfer-encoding: chunked')) {
          body = dechunk(bodyRaw);
        } else {
          body = bodyRaw;
        }

        // Handle gzip/deflate
        if (headerStr.toLowerCase().includes('content-encoding: gzip')) {
          const { gunzipSync } = await import('zlib');
          try { body = gunzipSync(body); } catch {}
        } else if (headerStr.toLowerCase().includes('content-encoding: br')) {
          const { brotliDecompressSync } = await import('zlib');
          try { body = brotliDecompressSync(body); } catch {}
        } else if (headerStr.toLowerCase().includes('content-encoding: deflate')) {
          const { inflateSync } = await import('zlib');
          try { body = inflateSync(body); } catch {}
        }

        await route.fulfill({ status, headers: respHeaders, body });
      } catch (e) {
        console.error(`Route error for ${url.substring(0, 80)}: ${e.message}`);
        try { await route.fulfill({ status: 502, body: `Proxy error: ${e.message}` }); } catch {}
      }
    });

    console.log('Navigating to Night Hawk 0DTE page...');
    await page.goto(`${APP}/nighthawk`, { timeout: 60000, waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);

    // Click on the PNL tab to see it
    try {
      const pnlTab = await page.$('text=[3] PNL');
      if (pnlTab) { await pnlTab.click(); await page.waitForTimeout(2000); }
    } catch {}


    // Take full page screenshot
    const ssPath = join(OUT, 'nighthawk-0dte-live.png');
    await page.screenshot({ path: ssPath, fullPage: true });
    console.log(`Screenshot saved: ${ssPath}`);

    // Also take a viewport-only screenshot
    const ssPath2 = join(OUT, 'nighthawk-0dte-viewport.png');
    await page.screenshot({ path: ssPath2, fullPage: false });
    console.log(`Viewport screenshot saved: ${ssPath2}`);

    // Get page title and check for key elements
    const title = await page.title();
    console.log(`Page title: ${title}`);

    // Check what's visible on the page
    const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 3000));
    console.log('\n--- Page text (first 3000 chars) ---');
    console.log(bodyText);

  } catch (e) {
    console.error('Browser error:', e);
  } finally {
    await browser.close();
    await cleanup();
  }
}

function dechunk(buf) {
  const parts = [];
  let pos = 0;
  const str = buf.toString('latin1');
  while (pos < str.length) {
    const lineEnd = str.indexOf('\r\n', pos);
    if (lineEnd === -1) break;
    const sizeStr = str.substring(pos, lineEnd).trim();
    const size = parseInt(sizeStr, 16);
    if (isNaN(size) || size === 0) break;
    const start = lineEnd + 2;
    parts.push(buf.slice(start, start + size));
    pos = start + size + 2;
  }
  return Buffer.concat(parts);
}

main().catch(e => { console.error(e); cleanup().then(() => process.exit(1)); });
