/**
 * Night Hawk PRODUCTION smoke check — logs into the LIVE site as a temp admin+premium member
 * (headless HTTP, no browser) and verifies the remodel didn't break anything member-facing:
 *   1. the evening PLAYBOOK still generates + serves the 1-5 ranked plays (edition API);
 *   2. the new unified horizon board API is live and returns the 0DTE lane;
 *   3. the /nighthawk page renders (served HTML shell).
 *
 * Reuses the proven auth block from data-validator.mjs (mint sign_in_token → FAPI ticket exchange →
 * __session cookie). ONE temp Clerk user per run, ALWAYS deleted in the finally block.
 *
 * Run with:  env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY node scripts/audit/nighthawk-prod-check.mjs
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateDefaultAuditPhone } from './lib/audit-phone.mjs';
import { isAuthFailureStatus } from './lib/auth-status.mjs';

const req = (n) => { const v = process.env[n]; if (!v || v.includes('${{')) { console.error(`FATAL: env ${n} missing`); process.exit(3); } return v; };
const SECRET = req('CLERK_SECRET_KEY');
const PUB = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || '';
const APP = process.env.AUDIT_APP_URL || 'https://blackouttrades.com';
const EMAIL = process.env.AUDIT_EMAIL || 'claude-nh-check@blackouttrades.com';
const PHONE = process.env.AUDIT_PHONE || generateDefaultAuditPhone();
const API = 'https://api.clerk.com/v1';
const CJS = '5.57.0';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
function fapiHost() { try { const d = Buffer.from(PUB.replace(/^pk_(live|test)_/, ''), 'base64').toString('utf8').replace(/\$$/, ''); if (d.includes('.')) return `https://${d}`; } catch {} return 'https://clerk.blackouttrades.com'; }
const FAPI = fapiHost();

const TMP = join(tmpdir(), `nh-check-${process.pid}`); mkdirSync(TMP, { recursive: true });
const JAR = join(TMP, 'cookies.txt'); let seq = 0;
function curl({ method = 'GET', url, headers = {}, form, urlencodeForm, json, jar = false, saveJar = false, raw = false }) {
  const bf = join(TMP, `b${++seq}`);
  const args = ['-sS', '--max-time', '45', '-o', bf, '-w', '%{http_code}', '-A', UA];
  if (method !== 'GET') args.push('-X', method);
  for (const [k, v] of Object.entries(headers)) args.push('-H', `${k}: ${v}`);
  if (json) args.push('-H', 'Content-Type: application/json', '--data', JSON.stringify(json));
  if (form) for (const [k, v] of Object.entries(form)) args.push('--data', `${k}=${v}`);
  if (urlencodeForm) for (const [k, v] of Object.entries(urlencodeForm)) args.push('--data-urlencode', `${k}=${v}`);
  if (jar) args.push('-b', JAR);
  if (saveJar) args.push('-c', JAR);
  args.push(url);
  try { const s = Number(execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 80 * 1024 * 1024 }).trim()); return { s, b: existsSync(bf) ? readFileSync(bf, 'utf8') : '' }; }
  catch (e) { return { s: 0, b: '', err: String(e.message || e).split('\n')[0] }; }
}
const J = (r) => { try { return JSON.parse(r.b); } catch { return null; } };
const backend = (m, p, j) => curl({ method: m, url: `${API}${p}`, headers: { Authorization: `Bearer ${SECRET}` }, json: j });

const out = [];
const rec = (name, status, detail) => { out.push({ name, status }); console.log(`  [${status}] ${name}${detail ? ' — ' + detail : ''}`); };

let userId = null;
async function main() {
  console.log(`\nNight Hawk prod check → ${APP}  (FAPI ${FAPI})\n`);
  // --- mint temp admin+premium user ---
  const create = backend('POST', '/users', { email_address: [EMAIL], phone_number: [PHONE], public_metadata: { role: 'admin', tier: 'premium' }, skip_password_requirement: true, skip_legal_checks: true });
  let cj = J(create);
  if (cj?.id) userId = cj.id;
  else if (/form_identifier_exists/.test(JSON.stringify(cj?.errors || ''))) {
    const u = (J(curl({ url: `${API}/users?email_address=${encodeURIComponent(EMAIL)}`, headers: { Authorization: `Bearer ${SECRET}` } })) || [])[0];
    if (u?.id) { userId = u.id; backend('PATCH', `/users/${userId}`, { public_metadata: { role: 'admin', tier: 'premium' } }); }
  }
  if (!userId) { rec('auth: create temp user', 'FAIL', create.b.slice(0, 160)); return; }
  rec('auth: temp admin+premium user', 'PASS', userId);

  // --- establish session (sign_in_token → ticket exchange → __session) ---
  let tok = null, sid = null, clientUat = 0;
  const mint = () => { tok = sid ? J(curl({ method: 'POST', url: `${FAPI}/v1/client/sessions/${sid}/tokens?_clerk_js_version=${CJS}`, headers: { Origin: APP, Referer: `${APP}/`, 'Content-Type': 'application/x-www-form-urlencoded' }, jar: true, saveJar: true }))?.jwt : null; return tok; };
  const establish = () => {
    const ticket = J(backend('POST', '/sign_in_tokens', { user_id: userId }))?.token;
    if (!ticket) return false;
    const si = curl({ method: 'POST', url: `${FAPI}/v1/client/sign_ins?_clerk_js_version=${CJS}`, headers: { Origin: APP, Referer: `${APP}/`, 'Content-Type': 'application/x-www-form-urlencoded' }, form: { strategy: 'ticket' }, urlencodeForm: { ticket }, saveJar: true, jar: true });
    const newSid = J(si)?.response?.created_session_id;
    if (!newSid) return false;
    sid = newSid; clientUat = Math.floor(Date.now() / 1000); return !!mint();
  };
  if (!establish()) { rec('auth: FAPI ticket exchange', 'FAIL', 'could not establish session'); return; }
  rec('auth: __session established', 'PASS');

  const get = (path, accept = 'application/json') => {
    for (let i = 0; i < 2; i++) {
      if (!tok && !establish()) return { s: 0, b: '' };
      const r = curl({ url: `${APP}${path}`, headers: { Cookie: `__session=${tok}; __client_uat=${clientUat}`, Accept: accept } });
      if (isAuthFailureStatus(r.s)) { tok = null; continue; }
      return r;
    }
    return { s: 0, b: '' };
  };

  // --- 1. the evening PLAYBOOK still generates + serves the 1-5 plays ---
  const edR = get('/api/market/nighthawk/edition');
  const ed = J(edR);
  if (edR.s === 200 && ed) {
    const plays = Array.isArray(ed.plays) ? ed.plays : [];
    const detail = `HTTP 200 · edition_for=${ed.edition_for ?? ed.served_for ?? '?'} · ${plays.length} plays${ed.stale ? ' (stale/prior)' : ''}${ed.degraded ? ' (degraded)' : ''}`;
    rec('playbook edition API (1-5 plays)', plays.length > 0 || ed.available != null ? 'PASS' : 'WARN', detail);
    if (plays.length) console.log('     plays: ' + plays.map((p, i) => `${p.rank ?? i + 1}.${p.ticker}(${p.direction ?? '?'})`).join('  '));
  } else {
    rec('playbook edition API (1-5 plays)', 'FAIL', `HTTP ${edR.s} ${edR.b.slice(0, 120)}`);
  }

  // --- 2. the new unified horizon board API (0DTE lane) is live ---
  for (const view of ['zerodte', 'swings', 'leaps']) {
    const r = get(`/api/market/nighthawk/horizons?view=${view}`);
    const j = J(r);
    if (r.s === 200 && j?.board?.lanes) {
      const L = j.board.lanes;
      const active = view === 'zerodte' ? L.ZERO_DTE : view === 'swings' ? L.SWING : L.LEAPS;
      rec(`horizons API ?view=${view}`, 'PASS', `HTTP 200 · ${active?.committedCount ?? 0} committed / ${active?.watchCount ?? 0} watch · floor ${active?.scoreFloor}${active?.scoreFloorGraduated ? '' : ' (provisional)'}`);
    } else if (r.s === 404) {
      rec(`horizons API ?view=${view}`, 'WARN', 'HTTP 404 — route not deployed to prod yet');
    } else {
      rec(`horizons API ?view=${view}`, r.s === 200 ? 'WARN' : 'FAIL', `HTTP ${r.s} ${r.b.slice(0, 120)}`);
    }
  }

  // --- 3. the /nighthawk page renders (served HTML shell) ---
  const pg = get('/nighthawk', 'text/html');
  if (pg.s === 200 && /Night ?Hawk/i.test(pg.b)) {
    const signedOut = /Sign in|__clerk_ssr_state.*signedOut/i.test(pg.b) && !/Open desk|nighthawk-content-canvas/i.test(pg.b);
    rec('/nighthawk page renders (authed)', signedOut ? 'WARN' : 'PASS', `HTTP 200 · ${pg.b.length} bytes${signedOut ? ' · looks signed-out' : ''}`);
  } else {
    rec('/nighthawk page renders (authed)', 'FAIL', `HTTP ${pg.s}`);
  }

  // --- 4. is the 0DTE/Swings/LEAPS/Legacy TOGGLE build deployed? ---
  // "Swings" + "LEAPS" are the new-build markers (0DTE/Legacy existed before). They render server-side in
  // the IosNativeSegment button labels, so the served HTML carries them once ECS rolls the new image.
  const hasSwings = /Swings/.test(pg.b), hasLeaps = /LEAPS/.test(pg.b);
  const toggleLive = hasSwings && hasLeaps;
  rec('toggle build deployed (0DTE/Swings/LEAPS/Legacy)', toggleLive ? 'PASS' : 'WARN',
    toggleLive ? 'served HTML carries the Swings+LEAPS toggle labels' : `NOT yet — Swings:${hasSwings} LEAPS:${hasLeaps} (ECS deploy still rolling)`);

  // --- 5. is the COMMAND DECK (matrix terminal) deployed? ---
  const hasDeck = /nh-deck/.test(pg.b);
  const hasTerminal = /Management|THESIS|Thesis|nh-deck-terminal|matrix/i.test(pg.b) && hasDeck;
  rec('command deck / terminal deployed', hasDeck ? 'PASS' : 'WARN',
    hasDeck ? `served HTML carries the nh-deck terminal markup${hasTerminal ? ' + tabs' : ''}` : 'NOT yet — command deck (#1016) not merged/deployed; the OLD board still serves');

  const fails = out.filter((o) => o.status === 'FAIL').length;
  console.log(`\n${fails === 0 ? '✅' : '❌'} ${out.filter((o) => o.status === 'PASS').length} pass · ${out.filter((o) => o.status === 'WARN').length} warn · ${fails} fail\n`);
  process.exitCode = fails === 0 ? 0 : 1;
}

main().catch((e) => rec('script error', 'FAIL', String(e.message || e))).finally(() => {
  if (userId) { const d = backend('DELETE', `/users/${userId}`); const v = backend('GET', `/users/${userId}`); rec('cleanup: temp user deleted', v.s === 404 ? 'PASS' : 'WARN', `DELETE ${d.s}, verify ${v.s}`); }
});
