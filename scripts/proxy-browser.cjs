#!/usr/bin/env node
// Playwright browser rendering through the agent proxy.
// Chromium can't CONNECT-tunnel through the proxy natively, so we intercept
// every request via page.route() and fulfill it with a manual CONNECT+TLS
// tunnel using Node's tls module. Works for full JS-rendered screenshots.
//
// Usage: node scripts/proxy-browser.cjs [URL] [--viewport WxH] [--ua STRING] [--out FILE]
//        node scripts/proxy-browser.cjs https://blackouttrades.com/desk/vector --viewport 393x852

const { chromium } = require('playwright');
const http = require('http');
const tls = require('tls');
const fs = require('fs');

const CA = fs.readFileSync('/root/.ccr/ca-bundle.crt');
// Read the agent proxy from HTTPS_PROXY — the port drifts across sessions
// (seen 39619 → 33181). Hardcoding it silently breaks every render, and the
// symptoms are subtle (blank pages, no HTTP error) so it wastes debug time.
const PROXY_URL = new URL(process.env.HTTPS_PROXY || process.env.https_proxy || 'http://127.0.0.1:39619');
const PROXY_HOST = PROXY_URL.hostname;
const PROXY_PORT = Number(PROXY_URL.port) || 39619;

function fetchViaProxy(url, hdrs = {}) {
  const parsed = new URL(url);
  const hostname = parsed.hostname;
  const reqPath = parsed.pathname + parsed.search;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), 20000);

    const proxyReq = http.request({
      host: PROXY_HOST, port: PROXY_PORT,
      method: 'CONNECT', path: `${hostname}:443`,
    });

    proxyReq.on('connect', (res, socket) => {
      if (res.statusCode !== 200) { clearTimeout(timer); reject(new Error(`CONNECT ${res.statusCode}`)); return; }

      const tlsSocket = tls.connect({ socket, servername: hostname, ca: CA }, () => {
        const rh = {
          Host: hostname,
          Accept: hdrs.accept || '*/*',
          'User-Agent': hdrs['user-agent'] || 'BlackOutiOSApp',
          'Accept-Encoding': 'identity',
          Connection: 'close',
          Cookie: hdrs.cookie || '',
        };
        let r = `GET ${reqPath} HTTP/1.1\r\n`;
        for (const [k, v] of Object.entries(rh)) { if (v) r += `${k}: ${v}\r\n`; }
        r += '\r\n';
        tlsSocket.write(r);

        let data = Buffer.alloc(0);
        tlsSocket.on('data', (c) => { data = Buffer.concat([data, c]); });
        tlsSocket.on('end', () => {
          clearTimeout(timer);
          const str = data.toString('latin1');
          const he = str.indexOf('\r\n\r\n');
          if (he < 0) { resolve({ status: 502, headers: {}, body: Buffer.from('') }); return; }
          const headerBlock = str.substring(0, he);
          const status = parseInt(headerBlock.split('\r\n')[0].split(' ')[1]) || 200;
          const respHeaders = {};
          headerBlock.split('\r\n').slice(1).forEach(l => {
            const idx = l.indexOf(': ');
            if (idx > 0) respHeaders[l.substring(0, idx).toLowerCase()] = l.substring(idx + 2);
          });
          let body = data.slice(he + 4);
          if (respHeaders['transfer-encoding']?.includes('chunked')) {
            const dec = []; let raw = body.toString('latin1');
            while (raw.length > 0) {
              const nl = raw.indexOf('\r\n');
              if (nl < 0) break;
              const sz = parseInt(raw.substring(0, nl), 16);
              if (sz === 0 || isNaN(sz)) break;
              dec.push(Buffer.from(raw.substring(nl + 2, nl + 2 + sz), 'latin1'));
              raw = raw.substring(nl + 2 + sz + 2);
            }
            body = Buffer.concat(dec);
          }
          resolve({ status, headers: respHeaders, body });
        });
        tlsSocket.on('error', (e) => { clearTimeout(timer); reject(e); });
      });
      tlsSocket.on('error', (e) => { clearTimeout(timer); reject(e); });
    });
    proxyReq.on('error', (e) => { clearTimeout(timer); reject(e); });
    proxyReq.end();
  });
}

async function renderPage(opts = {}) {
  const url = opts.url || 'https://blackouttrades.com';
  const vp = opts.viewport || { width: 393, height: 852 };
  const ua = opts.userAgent || 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) BlackOutiOSApp';
  const outFile = opts.out || '/tmp/blackout-screenshot.png';
  const waitUntil = opts.waitUntil || 'networkidle';
  const timeout = opts.timeout || 60000;

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: vp, userAgent: ua });

  let fetched = 0;
  await page.route('**/*', async (route) => {
    const reqUrl = route.request().url();
    if (reqUrl.startsWith('data:') || reqUrl.startsWith('blob:')) { await route.continue(); return; }
    if (!reqUrl.startsWith('https://')) { await route.abort(); return; }
    try {
      const r = await fetchViaProxy(reqUrl, route.request().headers());
      fetched++;
      await route.fulfill({
        status: r.status,
        headers: { 'content-type': r.headers['content-type'] || 'application/octet-stream', 'access-control-allow-origin': '*' },
        body: r.body,
      });
    } catch {
      await route.abort();
    }
  });

  try {
    await page.goto(url, { timeout, waitUntil });
    console.log(`Loaded: ${await page.title()} (${fetched} resources)`);
  } catch (e) {
    console.log(`Partial load (${fetched} resources): ${e.message.split('\n')[0]}`);
  }

  await page.screenshot({ path: outFile, fullPage: false });
  console.log(`Screenshot: ${outFile}`);

  await browser.close();
  return { fetched, outFile };
}

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--viewport' && args[i + 1]) {
      const [w, h] = args[++i].split('x').map(Number);
      opts.viewport = { width: w, height: h };
    } else if (args[i] === '--ua' && args[i + 1]) {
      opts.userAgent = args[++i];
    } else if (args[i] === '--out' && args[i + 1]) {
      opts.out = args[++i];
    } else if (!args[i].startsWith('--')) {
      opts.url = args[i];
    }
  }
  renderPage(opts).catch(e => { console.error(e); process.exit(1); });
}

module.exports = { renderPage, fetchViaProxy };
