#!/usr/bin/env node
/*
 * VETO-FLICKER-RATE data capture (INTENTIONAL-DESIGN #2 — stateless Cortex veto).
 *
 * `scripts/audit/veto-flicker-rate.mjs` measures how often a Cortex veto CLEARS within N
 * scan passes, but it has never been run — nothing persists an exact per-pass roster
 * (`--passes`), and nothing exposed the coarser `--rejections` shape (zerodte_scan_rejections
 * rows) over HTTP either: the two existing admin reads of that table
 * (/api/admin/zerodte/funnel, /api/admin/zerodte/health) only ever returned AGGREGATES
 * (by_gate/by_kind counts, or rejection_rate) — never the raw per-ticker rows — and raw
 * Postgres TCP is blocked in this sandbox (CLAUDE.md), so the only path to the real rows is
 * through the app's own HTTP surface.
 *
 * This script:
 *   1. Authenticates as ONE temp admin Clerk user (same mint-sign-in-token -> FAPI ticket
 *      exchange -> session cookie flow as data-validator.mjs), deleted in a `finally`.
 *   2. Calls GET /api/admin/zerodte/funnel?date=<session date> (PR #1679 added `raw_events`/
 *      `raw_rejections` to that response specifically for this capture — see the PR body).
 *   3. Merges both real tables into ONE chronological rows list in the exact shape
 *      veto-flicker-rate.mjs's `--rejections` (APPROXIMATE) mode expects — [{ ts, ticker, code }]
 *      — using:
 *        - every zerodte_scan_rejections row verbatim (code = gate_failed; this is the
 *          table veto-flicker-rate.mjs's own doc names as the fallback source), PLUS
 *        - every zerodte_discovery_events row (kind=detected/commit -> a non-veto code,
 *          the "cleared" signal the rejections table alone can never carry since it only
 *          ever logs REJECTED states; kind=gate_blocked -> its gate_code, a second
 *          independent sighting of the same veto/block).
 *      This is still the tool's documented APPROXIMATE mode (never claims to be the exact
 *      --passes format) but is the most complete real-data version of it obtainable without
 *      re-instrumenting the live scanner (out of scope / too invasive for a measurement).
 *   4. Writes the merged rows to --out (default scratchpad) for `veto-flicker-rate.mjs
 *      --rejections=<out>` to consume, and does NOT invoke that tool itself (kept as two
 *      separate, independently-runnable steps).
 *
 * Never prints secrets. Read-only against the app (one GET) + one temp-user create/delete.
 *
 * Run:
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY node --import tsx \
 *     scripts/audit/veto-flicker-capture.mjs --date=2026-08-04 --out=/tmp/veto-rows.json
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateDefaultAuditPhone } from './lib/audit-phone.mjs';
import { createOrAdoptAuditUserViaCurl } from './lib/clerk-audit-user.mjs';

function req(name) {
  const v = process.env[name];
  if (!v || v.includes('${{')) {
    console.error(`FATAL: env ${name} is missing or an unresolved \${{...}} placeholder. Set it to a literal value.`);
    process.exit(3);
  }
  return v;
}

const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);

const SECRET = req('CLERK_SECRET_KEY');
const PUB = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || '';
const APP = process.env.AUDIT_APP_URL || 'https://blackouttrades.com';
const EMAIL = process.env.AUDIT_EMAIL || 'claude-audit-temp@blackouttrades.com';
const PHONE = process.env.AUDIT_PHONE || generateDefaultAuditPhone();
const API = 'https://api.clerk.com/v1';
const CJS = '5.57.0';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const OUT = typeof argv.out === 'string' ? argv.out : join(process.cwd(), 'audit-output', 'veto-flicker-rows.json');
// --date=YYYY-MM-DD — required; this is a specific-session capture, not a "today" default,
// since the whole point is pulling a PAST session's data after the ET day has rolled over.
const SESSION_DATE = typeof argv.date === 'string' ? argv.date : null;
if (!SESSION_DATE || !/^\d{4}-\d{2}-\d{2}$/.test(SESSION_DATE)) {
  console.error('FATAL: --date=YYYY-MM-DD is required (the session date to capture).');
  process.exit(2);
}

function fapiHost() {
  try {
    const d = Buffer.from(PUB.replace(/^pk_(live|test)_/, ''), 'base64').toString('utf8').replace(/\$$/, '');
    if (d.includes('.')) return `https://${d}`;
  } catch {}
  return 'https://clerk.blackouttrades.com';
}
const FAPI = fapiHost();

const TMP = join(tmpdir(), `bo-veto-capture-${process.pid}`);
mkdirSync(TMP, { recursive: true });
mkdirSync(join(process.cwd(), 'audit-output'), { recursive: true });
const JAR = join(TMP, 'cookies.txt');
let seq = 0;

function curl({ method = 'GET', url, headers = {}, form, urlencodeForm, json, jar = false, saveJar = false }) {
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
  try {
    const s = Number(execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 80 * 1024 * 1024 }).trim());
    return { s, b: existsSync(bf) ? readFileSync(bf, 'utf8') : '' };
  } catch (e) {
    return { s: 0, b: '', err: String(e.message || e).split('\n')[0] };
  }
}
const J = (r) => { try { return JSON.parse(r.b); } catch { return null; } };
const backend = (m, p, j) => curl({ method: m, url: `${API}${p}`, headers: { Authorization: `Bearer ${SECRET}` }, json: j });

let userId = null;

async function main() {
  // Shared create-or-adopt: e-mail collision → adopt the leftover user; PHONE collision →
  // redraw a fresh +1415555XXXX and retry rather than aborting the capture.
  const auth = await createOrAdoptAuditUserViaCurl({ curl, api: API, secret: SECRET, email: EMAIL, phone: PHONE });
  if (auth.error) { console.error(`FAIL auth: create/adopt temp user — ${auth.error.slice(0, 220)}`); process.exitCode = 1; return; }
  userId = auth.userId;

  const ticket = J(backend('POST', '/sign_in_tokens', { user_id: userId }))?.token;
  if (!ticket) { console.error('FAIL auth: could not mint sign_in_token'); process.exitCode = 1; return; }
  const si = curl({
    method: 'POST',
    url: `${FAPI}/v1/client/sign_ins?_clerk_js_version=${CJS}`,
    headers: { Origin: APP, Referer: `${APP}/`, 'Content-Type': 'application/x-www-form-urlencoded' },
    form: { strategy: 'ticket' },
    urlencodeForm: { ticket },
    saveJar: true,
    jar: true,
  });
  const sid = J(si)?.response?.created_session_id;
  if (!sid) { console.error(`FAIL auth: FAPI ticket exchange — ${si.b.slice(0, 200)}`); process.exitCode = 1; return; }
  const clientUat = Math.floor(Date.now() / 1000);
  const tok = J(curl({
    method: 'POST',
    url: `${FAPI}/v1/client/sessions/${sid}/tokens?_clerk_js_version=${CJS}`,
    headers: { Origin: APP, Referer: `${APP}/`, 'Content-Type': 'application/x-www-form-urlencoded' },
    jar: true,
    saveJar: true,
  }))?.jwt;
  if (!tok) { console.error('FAIL auth: could not mint session token'); process.exitCode = 1; return; }

  const r = curl({
    url: `${APP}/api/admin/zerodte/funnel?date=${encodeURIComponent(SESSION_DATE)}`,
    headers: { Cookie: `__session=${tok}; __client_uat=${clientUat}`, Accept: 'application/json' },
  });
  const snapshot = J(r);
  if (r.s !== 200 || !snapshot) {
    console.error(`FAIL: GET /api/admin/zerodte/funnel?date=${SESSION_DATE} -> HTTP ${r.s} ${r.b.slice(0, 200)}`);
    process.exitCode = 1;
    return;
  }

  const rawEvents = Array.isArray(snapshot.raw_events) ? snapshot.raw_events : [];
  const rawRejections = Array.isArray(snapshot.raw_rejections) ? snapshot.raw_rejections : [];

  console.log(`session_date=${snapshot.session_date} db_configured=${snapshot.db_configured}`);
  console.log(`raw_events=${rawEvents.length} (capped=${snapshot.events_sample_capped}) raw_rejections=${rawRejections.length} (capped=${snapshot.rejections_sample_capped})`);
  if (snapshot.errors?.length) console.log(`snapshot errors: ${snapshot.errors.join('; ')}`);

  // Merge into veto-flicker-rate.mjs's --rejections shape: [{ ts, ticker, code }].
  // - scan_rejections rows verbatim (the table the tool names as its fallback source).
  // - discovery_events detected/commit rows -> the "cleared" signal rejections alone can't
  //   carry (a ticker that stops being rejected because it started PASSING never gets a new
  //   rejections row — only a detected/commit event proves it).
  // - discovery_events gate_blocked rows -> a second independent sighting of the same
  //   veto/block (harmless duplication; the tool tallies EPISODES per ticker, a repeated
  //   "still vetoed" sighting at the same/adjacent timestamp does not manufacture a new one).
  const rows = [];
  for (const r of rawRejections) {
    if (!r.ticker) continue;
    rows.push({ ts: r.observed_at, ticker: r.ticker, code: r.gate_failed });
  }
  for (const e of rawEvents) {
    if (!e.ticker) continue;
    if (e.kind === 'detected' || e.kind === 'commit') {
      rows.push({ ts: e.observed_at, ticker: e.ticker, code: e.kind === 'commit' ? 'committed' : 'detected_clear' });
    } else if (e.kind === 'gate_blocked' && e.gate_code) {
      rows.push({ ts: e.observed_at, ticker: e.ticker, code: e.gate_code });
    }
  }
  rows.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));

  const vetoRows = rows.filter((r) => String(r.code).startsWith('cortex_veto'));
  const distinctTickers = new Set(rows.map((r) => r.ticker.toUpperCase()));
  const distinctVetoTickers = new Set(vetoRows.map((r) => r.ticker.toUpperCase()));
  console.log(`merged rows=${rows.length} · distinct tickers=${distinctTickers.size} · cortex_veto* rows=${vetoRows.length} (${distinctVetoTickers.size} tickers)`);

  writeFileSync(OUT, JSON.stringify({ rejections: rows }, null, 2));
  console.log(`wrote ${rows.length} merged rows to ${OUT}`);
  console.log(`NOTE: this is the APPROXIMATE input shape (veto-flicker-rate.mjs --rejections) — built from`);
  console.log(`real zerodte_scan_rejections + zerodte_discovery_events rows (state-transition-throttled, NOT`);
  console.log(`one row per scan pass — see rejections.ts/discovery-events-persist.ts module docs), never fabricated.`);
  if (vetoRows.length === 0) {
    console.log(`\nZERO cortex_veto* rows found for ${SESSION_DATE} — nothing for veto-flicker-rate.mjs to measure`);
    console.log(`(a clean result, not a broken one; it will print INSUFFICIENT DATA / zero episodes).`);
  }
}

main()
  .catch((e) => { console.error(`script error: ${e?.message || e}`); process.exitCode = 1; })
  .finally(() => {
    if (userId) {
      const d = backend('DELETE', `/users/${userId}`);
      const v = backend('GET', `/users/${userId}`);
      console.log(`cleanup: temp user deleted — DELETE ${d.s}, verify ${v.s} (404=gone)`);
    }
  });
