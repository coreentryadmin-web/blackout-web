#!/usr/bin/env node
/*
 * Comprehensive RTH browser test sweep (API-level proxy)
 *
 * Browser env is blocked in cloud sandbox (ERR_CONNECTION_CLOSED).
 * This script tests the same endpoints the premium pages hit, measures
 * timing, validates live data updates, checks console-level issues
 * (reflected in response headers/errors), and scans for missing fields.
 *
 * Pages tested (API-level equivalent):
 *   /dashboard (SPX Slayer) → /api/market/gex-heatmap?ticker=SPX + /api/market/spx/merged
 *   /flows (HELIX) → /api/market/flows + /api/market/flow-brief
 *   /heatmap (Matrix + Profile) → /api/market/gex-heatmap + cross_validation
 *   /grid (12 panels) → /api/market/platform/snapshot
 *   /nighthawk → /api/market/nighthawk/edition
 *   /terminal (Largo) → /api/terminal/query (AI chat)
 *   /track-record → /api/public/track-record
 *
 * Secrets from env: CLERK_SECRET_KEY, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, POLYGON_API_KEY, UW_API_KEY
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SECRET = req('CLERK_SECRET_KEY');
const PUB = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || '';
const APP = 'https://blackouttrades.com';
const EMAIL = 'rth-test-' + Date.now() + '@blackouttrades.com';
const PHONE = '+14155550' + String(Math.floor(Math.random() * 900) + 100);
const OUT = process.env.AUDIT_OUT || join(process.cwd(), 'audit-output');
const API = 'https://api.clerk.com/v1';
const CJS = '5.57.0';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

function req(name) {
  const v = process.env[name];
  if (!v || v.includes('${{')) {
    console.error(`FATAL: env ${name} is missing`);
    process.exit(3);
  }
  return v;
}

function fapiHost() {
  try {
    const d = Buffer.from(PUB.replace(/^pk_(live|test)_/, ''), 'base64')
      .toString('utf8')
      .replace(/\$$/, '');
    if (d.includes('.')) return `https://${d}`;
  } catch {}
  return 'https://clerk.blackouttrades.com';
}
const FAPI = fapiHost();

const TMP = join(tmpdir(), `bo-rth-test-${process.pid}`);
mkdirSync(TMP, { recursive: true });
mkdirSync(OUT, { recursive: true });
const JAR = join(TMP, 'cookies.txt');

let seq = 0;
function curl({ method = 'GET', url, headers = {}, form, urlencodeForm, json, jar = false, saveJar = false, timeout = 45 }) {
  const bf = join(TMP, `b${++seq}`);
  const args = [
    '-sS',
    '--max-time',
    String(timeout),
    '-o',
    bf,
    '-w',
    '%{http_code}\\n%{time_total}',
    '-A',
    UA,
  ];
  if (method !== 'GET') args.push('-X', method);
  for (const [k, v] of Object.entries(headers)) args.push('-H', `${k}: ${v}`);
  if (json)
    args.push('-H', 'Content-Type: application/json', '--data', JSON.stringify(json));
  if (form) for (const [k, v] of Object.entries(form)) args.push('--data', `${k}=${v}`);
  if (urlencodeForm)
    for (const [k, v] of Object.entries(urlencodeForm))
      args.push('--data-urlencode', `${k}=${v}`);
  if (jar) args.push('-b', JAR);
  if (saveJar) args.push('-c', JAR);
  args.push(url);
  try {
    const out = execFileSync('curl', args, {
      encoding: 'utf8',
      maxBuffer: 80 * 1024 * 1024,
    }).trim();
    const [code, time] = out.split('\n');
    return {
      s: Number(code),
      t: Number(time) * 1000,
      b: existsSync(bf) ? readFileSync(bf, 'utf8') : '',
    };
  } catch (e) {
    return { s: 0, t: 0, b: '', err: String(e.message || e).split('\n')[0] };
  }
}

const J = (r) => {
  try {
    return JSON.parse(r.b);
  } catch {
    return null;
  }
};
const backend = (m, p, j) =>
  curl({
    method: m,
    url: `${API}${p}`,
    headers: { Authorization: `Bearer ${SECRET}` },
    json: j,
  });

const checks = [];
const rec = (name, status, detail, extra = {}) => {
  checks.push({ name, status, detail, ...extra });
  console.log(`  [${status}] ${name}${detail ? ' — ' + detail : ''}`);
};

function scanMissing(obj, path = '', out = []) {
  if (obj == null) return out;
  if (typeof obj === 'string' && ['—', 'N/A', '', 'null', 'undefined'].includes(obj))
    out.push(path);
  if (typeof obj === 'number' && !Number.isFinite(obj)) out.push(path);
  if (Array.isArray(obj)) {
    if (obj.length === 0 && path) out.push(`${path}[empty]`);
    obj.slice(0, 20).forEach((v, i) => scanMissing(v, `${path}[${i}]`, out));
    return out;
  }
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      const np = path ? `${path}.${k}` : k;
      if (v === null || v === undefined) out.push(np);
      else scanMissing(v, np, out);
    }
  }
  return out;
}

let userId = null;
let tok = null;
let clientUat = null;
let sid = null;

function isAuthFailureStatus(status) {
  return status === 401 || status === 403;
}

function authApp() {
  // Create temp user
  const create = backend('POST', '/users', {
    email_address: [EMAIL],
    phone_number: [PHONE],
    public_metadata: { role: 'admin', tier: 'premium' },
    skip_password_requirement: true,
    skip_legal_checks: true,
  });
  const cj = J(create);
  if (cj?.id) userId = cj.id;
  else if (/form_identifier_exists/.test(JSON.stringify(cj?.errors || ''))) {
    const u = (
      J(
        curl({
          url: `${API}/users?email_address=${encodeURIComponent(EMAIL)}`,
          headers: { Authorization: `Bearer ${SECRET}` },
        })
      ) || []
    )[0];
    if (u?.id) {
      userId = u.id;
      backend('PATCH', `/users/${userId}`, {
        public_metadata: { role: 'admin', tier: 'premium' },
      });
    }
  }
  if (!userId) {
    rec('auth: create temp user', 'FAIL', create.b.slice(0, 160));
    throw new Error('auth failed');
  }

  // Mint sign_in_token
  const ticket = J(backend('POST', '/sign_in_tokens', { user_id: userId }))?.token;
  const si = curl({
    method: 'POST',
    url: `${FAPI}/v1/client/sign_ins?_clerk_js_version=${CJS}`,
    headers: {
      Origin: APP,
      Referer: `${APP}/`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    form: { strategy: 'ticket' },
    urlencodeForm: { ticket },
    saveJar: true,
    jar: true,
  });
  sid = J(si)?.response?.created_session_id;
  if (!sid) {
    rec('auth: FAPI ticket exchange', 'FAIL', si.b.slice(0, 160));
    throw new Error('auth failed');
  }

  clientUat = Math.floor(Date.now() / 1000);
  mintToken();
  rec('auth: premium session established', 'PASS', `user_id=${userId} session=${sid}`);
}

function mintToken() {
  tok = J(
    curl({
      method: 'POST',
      url: `${FAPI}/v1/client/sessions/${sid}/tokens?_clerk_js_version=${CJS}`,
      headers: {
        Origin: APP,
        Referer: `${APP}/`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      jar: true,
      saveJar: true,
    })
  )?.jwt;
  return tok;
}

function app(path) {
  for (let i = 0; i < 2; i++) {
    if (!tok) mintToken();
    const r = curl({
      url: `${APP}${path}`,
      headers: {
        Cookie: `__session=${tok}; __client_uat=${clientUat}`,
        Accept: 'application/json',
      },
    });
    if (isAuthFailureStatus(r.s)) {
      tok = null;
      continue;
    }
    return { ...r, j: J(r) };
  }
  return { s: 401, t: 0, b: '{"error":"auth retry exhausted"}', j: null };
}

function testPage(name, path, validator) {
  console.log(`\n=== Testing ${name} (${path}) ===`);
  const r = app(path);
  rec(`${name}: HTTP status`, r.s === 200 ? 'PASS' : 'FAIL', `${r.s} (${r.t.toFixed(0)}ms)`, {
    time_ms: r.t,
  });
  if (r.s !== 200) {
    rec(`${name}: response body`, 'FAIL', r.b.slice(0, 200));
    return null;
  }
  if (!r.j) {
    rec(`${name}: JSON parse`, 'FAIL', 'not JSON');
    return null;
  }

  const missing = scanMissing(r.j).slice(0, 10);
  if (missing.length > 0) {
    rec(`${name}: missing fields`, 'WARN', missing.slice(0, 3).join(', '), { missing });
  } else {
    rec(`${name}: missing fields`, 'PASS', 'none');
  }

  if (validator) validator(r.j, name);
  return r.j;
}

function testLiveUpdate(name, path, interval_ms = 15000) {
  console.log(`\n=== Testing ${name} live update (${interval_ms}ms poll) ===`);
  const r1 = app(path);
  if (r1.s !== 200) {
    rec(`${name}: live update skipped`, 'SKIP', `initial fetch failed (${r1.s})`);
    return;
  }
  const snap1 = JSON.stringify(r1.j);
  rec(`${name}: snapshot 1`, 'INFO', `${snap1.length} bytes`);

  const sleep = (ms) => execFileSync('sleep', [String(ms / 1000)]);
  sleep(interval_ms);

  const r2 = app(path);
  if (r2.s !== 200) {
    rec(`${name}: live update skipped`, 'SKIP', `poll failed (${r2.s})`);
    return;
  }
  const snap2 = JSON.stringify(r2.j);
  const changed = snap1 !== snap2;
  rec(
    `${name}: live auto-update`,
    changed ? 'PASS' : 'WARN',
    `${interval_ms}ms poll: ${changed ? 'data changed' : 'no change (may be stale cache)'}`,
    { changed }
  );
}

function testLargo() {
  console.log(`\n=== Testing /terminal (Largo AI) ===`);
  const query = 'dark pool + options flow on NVDA';
  
  // Largo POST endpoint, may take 20-60s for AI response
  if (!tok) mintToken();
  const r = curl({
    method: 'POST',
    url: `${APP}/api/market/largo/query`,
    headers: {
      Cookie: `__session=${tok}; __client_uat=${clientUat}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    json: { question: query },
    timeout: 90,
  });
  
  rec('Largo: HTTP status', r.s === 200 ? 'PASS' : 'FAIL', `${r.s} (${r.t.toFixed(0)}ms)`, {
    time_ms: r.t,
  });
  if (r.s !== 200) {
    rec('Largo: response body', 'FAIL', r.b.slice(0, 200));
    return;
  }
  
  let rj = null;
  try {
    rj = JSON.parse(r.b);
  } catch {
    rec('Largo: JSON parse', 'FAIL', 'not JSON');
    rec('Largo: raw response', 'INFO', r.b.slice(0, 300));
    return;
  }

  if (rj?.error) {
    rec('Largo: error', 'FAIL', rj.error, { full_response: rj });
    return;
  }

  const answer = rj?.answer ?? rj?.response ?? '';
  const respLen = answer.length;
  const hasContent = respLen > 50;
  const tools = Array.isArray(rj?.tools_used) ? rj.tools_used.join(', ') : '';
  rec(
    'Largo: response quality',
    hasContent ? 'PASS' : 'FAIL',
    `${respLen} chars, tools=[${tools}], query="${query}"`,
    { response_preview: answer.slice(0, 200), full_keys: Object.keys(rj || {}) }
  );
}

async function main() {
  console.log('RTH Browser Test Sweep (API-level)\n');
  rec('environment', 'INFO', `app=${APP} fapi=${FAPI}`);

  authApp();

  // /dashboard → SPX Slayer (0DTE matrix + live spot)
  testPage('/dashboard (SPX Slayer)', '/api/market/gex-heatmap?ticker=SPX', (j, n) => {
    if (j.strikes?.length > 0) rec(`${n}: strikes loaded`, 'PASS', `${j.strikes.length} strikes`);
    else rec(`${n}: strikes loaded`, 'FAIL', 'no strikes');
    if (j.spot) rec(`${n}: live spot`, 'PASS', `spot=${j.spot}`);
    else rec(`${n}: live spot`, 'FAIL', 'no spot');
  });
  testPage('/dashboard (SPX merged)', '/api/market/spx/merged', (j, n) => {
    if (j.spot) rec(`${n}: spot`, 'PASS', `${j.spot}`);
  });

  // /flows → HELIX
  testPage('/flows (HELIX)', '/api/market/flows', (j, n) => {
    const cnt = Array.isArray(j.flows) ? j.flows.length : 0;
    rec(`${n}: flow count`, cnt > 0 ? 'PASS' : 'WARN', `${cnt} flows`);
  });
  testPage('/flows (brief)', '/api/market/flow-brief');

  // /heatmap → Matrix + Profile
  testPage('/heatmap (SPY matrix)', '/api/market/gex-heatmap?ticker=SPY', (j, n) => {
    if (j.strikes?.length > 0) rec(`${n}: strikes`, 'PASS', `${j.strikes.length}`);
    if (j.cross_validation)
      rec(`${n}: cross_validation`, 'INFO', JSON.stringify(j.cross_validation).slice(0, 100));
  });

  // /grid → 12 panels (bootstrap bundles Redis panel snapshots + Pulse/GEX market seeds)
  testPage('/grid (bootstrap)', '/api/grid/bootstrap', (j, n) => {
    const panelKeys = Object.keys(j?.panels ?? j ?? {});
    const marketKeys = j?.market ? Object.keys(j.market) : [];
    rec(`${n}: panel snapshots`, panelKeys.length >= 8 ? 'PASS' : 'WARN', `${panelKeys.length} panel keys`);
    rec(`${n}: market seeds`, marketKeys.length >= 1 ? 'PASS' : 'WARN', `${marketKeys.length} market keys`);
  });
  const gridPanels = [
    '/api/grid/analysts',
    '/api/grid/dark-pool',
    '/api/grid/earnings',
    '/api/grid/congress',
    '/api/grid/economy',
    '/api/grid/sectors',
    '/api/grid/movers',
    '/api/grid/catalysts',
  ];
  for (const ep of gridPanels) {
    testPage(`/grid ${ep.split('/').pop()}`, ep);
  }

  // /nighthawk → latest edition (NightHawkEdition: plays + recap, not a `content` blob)
  testPage('/nighthawk', '/api/market/nighthawk/edition', (j, n) => {
    if (j.error) rec(`${n}: error`, 'WARN', j.error);
    else if (j.available && (j.plays?.length > 0 || j.recap_summary)) {
      rec(
        `${n}: edition loaded`,
        'PASS',
        `${j.plays?.length ?? 0} plays, recap=${Boolean(j.recap_summary)}`
      );
    } else if (!j.available) rec(`${n}: edition loaded`, 'WARN', 'available=false (awaiting close)');
    else rec(`${n}: edition loaded`, 'FAIL', 'available but no plays or recap');
  });

  // /track-record
  testPage('/track-record', '/api/public/track-record', (j, n) => {
    if (j.total_closed != null) rec(`${n}: total_closed`, 'PASS', `${j.total_closed}`);
  });

  // /terminal → Largo AI
  testLargo();

  // Live update tests (15s poll)
  testLiveUpdate('SPX Slayer (live update)', '/api/market/gex-heatmap?ticker=SPX', 15000);
  testLiveUpdate('HELIX (live update)', '/api/market/flows', 15000);

  console.log('\n=== Console-level issues (API errors) ===');
  const consoleIssues = checks.filter((c) => c.status === 'FAIL' || c.status === 'WARN');
  if (consoleIssues.length === 0) {
    rec('console errors/warnings', 'PASS', 'none observed at API level');
  } else {
    rec(
      'console errors/warnings',
      'INFO',
      `${consoleIssues.length} issues (see report)`,
      { issues: consoleIssues.map((c) => `${c.name}: ${c.detail}`) }
    );
  }
}

let exitCode = 0;
main()
  .catch((e) => {
    rec('script error', 'FAIL', String(e.message || e));
  })
  .finally(() => {
    if (userId) {
      const d = backend('DELETE', `/users/${userId}`);
      const v = backend('GET', `/users/${userId}`);
      rec('cleanup: temp user deleted', v.s === 404 ? 'PASS' : 'WARN', `DELETE ${d.s}, verify ${v.s}`);
    }
    try {
      rmSync(TMP, { recursive: true, force: true });
    } catch {}

    const totals = checks.reduce((m, c) => ((m[c.status] = (m[c.status] || 0) + 1), m), {});
    const stamp = new Date().toISOString();
    const summary = { generated_at: stamp, app: APP, totals, checks };
    const base = join(OUT, `rth-browser-test-${stamp.replace(/[:.]/g, '-')}`);
    writeFileSync(`${base}.json`, JSON.stringify(summary, null, 2));

    // Structured report
    const report = [
      `# RTH Browser Test Sweep — ${stamp}`,
      ``,
      `**App:** ${APP}`,
      `**Totals:** ${JSON.stringify(totals)}`,
      ``,
      `## Page Timings`,
      ``,
      ...checks
        .filter((c) => c.time_ms != null)
        .map((c) => `- **${c.name}**: ${c.time_ms.toFixed(0)}ms (${c.status})`),
      ``,
      `## Live Auto-Update`,
      ``,
      ...checks
        .filter((c) => c.name.includes('live update'))
        .map((c) => `- **${c.name}**: ${c.detail} (${c.status})`),
      ``,
      `## Console Issues (API-level)`,
      ``,
      ...checks
        .filter((c) => c.status === 'FAIL' || c.status === 'WARN')
        .map((c) => `- **${c.name}**: ${c.detail}`),
      ``,
      `## Missing Fields`,
      ``,
      ...checks
        .filter((c) => c.missing?.length > 0)
        .map((c) => `- **${c.name}**: ${c.missing.join(', ')}`),
      ``,
      `## Largo Response`,
      ``,
      ...checks
        .filter((c) => c.name.includes('Largo'))
        .map((c) => `- **${c.name}**: ${c.detail}`),
      ``,
      `## Full Check Log`,
      ``,
      `| status | check | detail |`,
      `|---|---|---|`,
      ...checks.map(
        (c) =>
          `| ${c.status} | ${c.name} | ${(c.detail || '')
            .slice(0, 180)
            .replace(/\\/g, '\\\\')
            .replace(/\|/g, '\\|')
            .replace(/\r?\n/g, ' ')} |`
      ),
    ].join('\n');

    writeFileSync(`${base}.md`, report);
    console.log('\n=== SUMMARY ===');
    console.log(JSON.stringify(totals, null, 2));
    console.log(`\nReport: ${base}.md`);
    console.log(`JSON: ${base}.json`);

    exitCode = (totals.FAIL || 0) > 0 ? 1 : 0;
    process.exit(exitCode);
  });
