import { chromium } from 'playwright';
import { readFileSync } from 'fs';
import { connect as tlsConnect } from 'tls';
import { URL } from 'url';
import http from 'http';

const APP = 'https://blackouttrades.com';
const CA_BUNDLE = '/root/.ccr/ca-bundle.crt';
const PROXY_URL = process.env.HTTPS_PROXY;
const OUT = '/tmp/claude-0/-home-user-blackout-web/181ac0b6-3fb4-56b6-8fff-bcf437ccd5d0/scratchpad';

function dechunk(buf) {
  const parts = [];
  let pos = 0;
  const str = buf.toString('latin1');
  while (pos < str.length) {
    const lineEnd = str.indexOf('\r\n', pos);
    if (lineEnd === -1) break;
    const size = parseInt(str.substring(pos, lineEnd).trim(), 16);
    if (isNaN(size) || size === 0) break;
    const start = lineEnd + 2;
    parts.push(buf.slice(start, start + size));
    pos = start + size + 2;
  }
  return Buffer.concat(parts);
}

async function main() {
  const caBundle = readFileSync(CA_BUNDLE);

  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-certificate-errors'],
    headless: true,
  });

  // Desktop viewport
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    ignoreHTTPSErrors: true,
  });

  const page = await context.newPage();

  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = request.url();
    if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('about:')) return route.continue();

    try {
      const target = new URL(url);
      const proxy = new URL(PROXY_URL);

      const tlsSocket = await new Promise((resolve, reject) => {
        const connectReq = http.request({ host: proxy.hostname, port: proxy.port, method: 'CONNECT', path: `${target.hostname}:443` });
        connectReq.setTimeout(30000);
        connectReq.on('connect', (res, socket) => {
          if (res.statusCode !== 200) { reject(new Error(`CONNECT ${res.statusCode}`)); return; }
          const tls = tlsConnect({ socket, servername: target.hostname, ca: caBundle, rejectUnauthorized: true });
          tls.on('secureConnect', () => resolve(tls));
          tls.on('error', reject);
        });
        connectReq.on('error', reject);
        connectReq.end();
      });

      const method = request.method();
      const headers = { ...request.headers() };
      const postData = request.postData();
      delete headers['host'];
      headers['host'] = target.host;

      let reqStr = `${method} ${target.pathname}${target.search} HTTP/1.1\r\n`;
      for (const [k, v] of Object.entries(headers)) {
        if (k.toLowerCase() === 'connection') continue;
        reqStr += `${k}: ${v}\r\n`;
      }
      if (postData) reqStr += `content-length: ${Buffer.byteLength(postData)}\r\n`;
      reqStr += `connection: close\r\n\r\n`;
      tlsSocket.write(reqStr);
      if (postData) tlsSocket.write(postData);

      const chunks = [];
      await new Promise((resolve, reject) => {
        tlsSocket.on('data', (chunk) => chunks.push(chunk));
        tlsSocket.on('end', resolve);
        tlsSocket.on('error', reject);
        setTimeout(() => { tlsSocket.destroy(); resolve(); }, 30000);
      });

      const raw = Buffer.concat(chunks);
      const rawStr = raw.toString('latin1');
      const headerEnd = rawStr.indexOf('\r\n\r\n');
      if (headerEnd === -1) return route.fulfill({ status: 502, body: 'No headers' });

      const headerStr = rawStr.substring(0, headerEnd);
      const statusMatch = headerStr.split('\r\n')[0].match(/HTTP\/\d\.\d (\d+)/);
      const status = statusMatch ? parseInt(statusMatch[1]) : 200;

      const respHeaders = {};
      for (const line of headerStr.split('\r\n').slice(1)) {
        const idx = line.indexOf(':');
        if (idx > 0) {
          const key = line.substring(0, idx).trim().toLowerCase();
          const val = line.substring(idx + 1).trim();
          if (!['transfer-encoding', 'content-encoding', 'content-length'].includes(key)) respHeaders[key] = val;
        }
      }

      let body = raw.slice(headerEnd + 4);
      if (headerStr.toLowerCase().includes('transfer-encoding: chunked')) body = dechunk(body);
      if (headerStr.toLowerCase().includes('content-encoding: gzip')) {
        const { gunzipSync } = await import('zlib');
        try { body = gunzipSync(body); } catch {}
      } else if (headerStr.toLowerCase().includes('content-encoding: br')) {
        const { brotliDecompressSync } = await import('zlib');
        try { body = brotliDecompressSync(body); } catch {}
      }

      await route.fulfill({ status, headers: respHeaders, body });
    } catch (e) {
      console.error(`Route error: ${url.substring(0, 60)}: ${e.message}`);
      try { await route.fulfill({ status: 502, body: `Proxy error` }); } catch {}
    }
  });

  // Desktop full-page
  console.log('Loading homepage (desktop)...');
  await page.goto(APP, { timeout: 60000, waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${OUT}/homepage-desktop-full.png`, fullPage: true });
  console.log('Desktop full-page done');

  // Scroll to each section for viewport shots
  for (const [id, name] of [['edge', 'comparison'], ['pricing', 'pricing'], ['faq', 'faq']]) {
    try {
      await page.evaluate((s) => document.getElementById(s)?.scrollIntoView({ behavior: 'instant' }), id);
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${OUT}/homepage-${name}.png` });
      console.log(`${name} section done`);
    } catch (e) { console.error(`${name}: ${e.message}`); }
  }

  // Scroll to footer
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/homepage-footer.png` });
  console.log('Footer done');

  // Mobile viewport
  const mCtx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
    ignoreHTTPSErrors: true,
    isMobile: true,
  });
  const mPage = await mCtx.newPage();
  await mPage.route('**/*', async (route) => {
    const request = route.request();
    const url = request.url();
    if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('about:')) return route.continue();
    try {
      const target = new URL(url);
      const proxy = new URL(PROXY_URL);
      const tlsSocket = await new Promise((resolve, reject) => {
        const connectReq = http.request({ host: proxy.hostname, port: proxy.port, method: 'CONNECT', path: `${target.hostname}:443` });
        connectReq.setTimeout(30000);
        connectReq.on('connect', (res, socket) => {
          if (res.statusCode !== 200) { reject(new Error(`CONNECT ${res.statusCode}`)); return; }
          const tls = tlsConnect({ socket, servername: target.hostname, ca: caBundle, rejectUnauthorized: true });
          tls.on('secureConnect', () => resolve(tls));
          tls.on('error', reject);
        });
        connectReq.on('error', reject);
        connectReq.end();
      });
      const method = request.method();
      const headers = { ...request.headers() };
      const postData = request.postData();
      delete headers['host'];
      headers['host'] = target.host;
      let reqStr = `${method} ${target.pathname}${target.search} HTTP/1.1\r\n`;
      for (const [k, v] of Object.entries(headers)) { if (k.toLowerCase() !== 'connection') reqStr += `${k}: ${v}\r\n`; }
      if (postData) reqStr += `content-length: ${Buffer.byteLength(postData)}\r\n`;
      reqStr += `connection: close\r\n\r\n`;
      tlsSocket.write(reqStr);
      if (postData) tlsSocket.write(postData);
      const chunks = [];
      await new Promise((resolve, reject) => { tlsSocket.on('data', (c) => chunks.push(c)); tlsSocket.on('end', resolve); tlsSocket.on('error', reject); setTimeout(() => { tlsSocket.destroy(); resolve(); }, 30000); });
      const raw = Buffer.concat(chunks);
      const rawStr = raw.toString('latin1');
      const headerEnd = rawStr.indexOf('\r\n\r\n');
      if (headerEnd === -1) return route.fulfill({ status: 502, body: 'No headers' });
      const headerStr = rawStr.substring(0, headerEnd);
      const statusMatch = headerStr.split('\r\n')[0].match(/HTTP\/\d\.\d (\d+)/);
      const status = statusMatch ? parseInt(statusMatch[1]) : 200;
      const respHeaders = {};
      for (const line of headerStr.split('\r\n').slice(1)) { const idx = line.indexOf(':'); if (idx > 0) { const k = line.substring(0, idx).trim().toLowerCase(); if (!['transfer-encoding','content-encoding','content-length'].includes(k)) respHeaders[k] = line.substring(idx+1).trim(); } }
      let body = raw.slice(headerEnd + 4);
      if (headerStr.toLowerCase().includes('transfer-encoding: chunked')) body = dechunk(body);
      if (headerStr.toLowerCase().includes('content-encoding: gzip')) { const { gunzipSync } = await import('zlib'); try { body = gunzipSync(body); } catch {} }
      else if (headerStr.toLowerCase().includes('content-encoding: br')) { const { brotliDecompressSync } = await import('zlib'); try { body = brotliDecompressSync(body); } catch {} }
      await route.fulfill({ status, headers: respHeaders, body });
    } catch (e) { try { await route.fulfill({ status: 502, body: 'err' }); } catch {} }
  });

  console.log('Loading homepage (mobile)...');
  await mPage.goto(APP, { timeout: 60000, waitUntil: 'domcontentloaded' });
  await mPage.waitForTimeout(4000);
  await mPage.screenshot({ path: `${OUT}/homepage-mobile-full.png`, fullPage: true });
  console.log('Mobile full-page done');

  await browser.close();
  console.log('All screenshots saved');
}

main().catch(e => { console.error(e); process.exit(1); });
