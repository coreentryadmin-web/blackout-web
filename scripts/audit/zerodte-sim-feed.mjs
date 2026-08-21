#!/usr/bin/env node
/*
 * ADMIN-ONLY 0DTE Night Hawk SIMULATION FEEDER (feat/zerodte-admin-sim-view).
 *
 * WHAT IT DOES
 *   Authenticates to production as a TEMPORARY admin Clerk user (mint sign_in_token →
 *   FAPI ticket exchange → __session cookie — the exact block used by
 *   scripts/audit/data-validator.mjs), then POSTs a stream of board frames to the
 *   admin-only ingest endpoint (POST /api/admin/zerodte/sim/board) on a clock. An admin
 *   watching <base>/nighthawk?sim=1 in a browser then sees a simulated 0DTE session
 *   play through the REAL Night Hawk panel — while every member keeps seeing the real,
 *   untouched board (three-layer isolation: admin gate + separate Redis key + ?sim=1
 *   opt-in; see src/lib/platform/zerodte-sim-board.ts).
 *
 *   The temp admin user is ALWAYS deleted in a finally block.
 *
 * SOURCES
 *   --synthetic          Generate a full valid RTH arc — the canonical 5-play demo:
 *                          NVDA long/FLOW      → trims to +80%
 *                          TSLA long/BREAKOUT  → +40%
 *                          META long           → +30% target
 *                          SPX  iron CONDOR/PIN→ +76% time_stop
 *                          AMD  long put/FLOW  → −50% STOPPED
 *   --replay=<file.json> Replay a captured session: an array of { etMinute, payload }
 *                        (payload = a ZeroDteBoardPayload). Frames are posted in etMinute
 *                        order on the same compressed clock.
 *
 * FLAGS
 *   --speed=N       ET-minutes advanced per real second (default 60 → a 5-min frame gap
 *                   posts every 5s; the whole RTH arc plays in ~6–7 min). Higher = faster.
 *   --base=URL      App base (default https://blackouttrades.com).
 *   --start-et=HH:MM / --end-et=HH:MM   Bound which frames are emitted (default full RTH).
 *   --dry-run       Print the frame schedule; authenticate is skipped; nothing is posted.
 *   --reset         Clear the sim key (DELETE) and exit — resets the sim view to empty.
 *
 * SECRETS — from env ONLY (never printed / committed):
 *   CLERK_SECRET_KEY                    production Clerk backend key
 *   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY   derives the Frontend API host
 *
 * EXAMPLE
 *   npm run sim:feed -- --synthetic --base=https://blackouttrades.com
 *   npm run sim:feed -- --reset
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateDefaultAuditPhone } from './lib/audit-phone.mjs';
import { createOrAdoptAuditUserViaCurl } from './lib/clerk-audit-user.mjs';

import { subprocessErrorMessage } from "./lib/redact.mjs";
// ── args ────────────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : dflt;
};
const SYNTHETIC = has('--synthetic');
const REPLAY = val('--replay', null);
const SPEED = Math.max(1, Number(val('--speed', '60')) || 60);
const BASE = (val('--base', 'https://blackouttrades.com')).replace(/\/$/, '');
const DRY = has('--dry-run');
const RESET = has('--reset');
const START_ET = parseEt(val('--start-et', '09:30'));
const END_ET = parseEt(val('--end-et', '15:55'));

function parseEt(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}
function fmtEt(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ── secrets / http ────────────────────────────────────────────────────────────────
function req(name) {
  const v = process.env[name];
  if (!v || v.includes('${{')) { console.error(`FATAL: env ${name} is missing or an unresolved \${{...}} placeholder.`); process.exit(3); }
  return v;
}
const API = 'https://api.clerk.com/v1';
const CJS = '5.57.0';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const EMAIL = process.env.SIM_FEED_EMAIL || 'claude-simfeed-temp@blackouttrades.com';
const PHONE = process.env.SIM_FEED_PHONE || generateDefaultAuditPhone();

const TMP = join(tmpdir(), `bo-simfeed-${process.pid}`);
mkdirSync(TMP, { recursive: true });
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
  try { const s = Number(execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim()); return { s, b: existsSync(bf) ? readFileSync(bf, 'utf8') : '' }; }
  catch (e) { return { s: 0, b: '', err: subprocessErrorMessage(e) }; }
}
const J = (r) => { try { return JSON.parse(r.b); } catch { return null; } };
const SECRET = RESET || !DRY ? req('CLERK_SECRET_KEY') : (process.env.CLERK_SECRET_KEY || '');
const PUB = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || '';
function fapiHost() {
  try { const d = Buffer.from(PUB.replace(/^pk_(live|test)_/, ''), 'base64').toString('utf8').replace(/\$$/, ''); if (d.includes('.')) return `https://${d}`; } catch {}
  return 'https://clerk.blackouttrades.com';
}
const FAPI = fapiHost();
const backend = (m, p, j) => curl({ method: m, url: `${API}${p}`, headers: { Authorization: `Bearer ${SECRET}` }, json: j });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── synthetic RTH arc ─────────────────────────────────────────────────────────────
// The canonical 5-play demo. Each play defines its lifecycle: when it commits, its
// entry premium, the mark trajectory (via keyframes on ET minutes), and the terminal
// status. Marks between keyframes are linearly interpolated so the board moves smoothly.
const SESSION_DATE = new Date().toISOString().slice(0, 10);

// ── RENDER-STATE COVERAGE MATRIX ────────────────────────────────────────────────────
// This synthetic roster is a VISUAL TEST HARNESS: every board state a member can see is
// exercised by at least one play, so `--synthetic` doubles as a render-state sweep.
//   WATCH (pre-commit, never commits) ......... QQQ setup   (SETUPS, no ledger row)
//   SKIP  (evaluated, gate-blocked) ........... IWM setup   (SETUPS, gate BLOCKED)
//   OPEN  (fresh, in the enterable band) ...... GOOGL       (mark stays within ±10%)
//   HOLD  (working, out of the entry band) .... TSLA / COIN / F / NFLX / SMCI / SNOW
//   TRIM  (post-target, sticky) ............... NVDA        (rides to +80%, stays TRIM)
//   CLOSED · target ........................... META        (closed_reason 'target')
//   CLOSED · ratchet .......................... AMZN        (closed_reason 'ratchet', +50%)
//   CLOSED · time_stop (directional) .......... MSFT        (closed_reason 'time_stop')
//   CLOSED · time_stop (condor winner) ........ SPX         (PIN condor, credit decays +76%)
//   CLOSED · stopped (directional) ............ AMD         (closed_reason 'stopped', −50%)
//   CLOSED · stopped (condor breach) .......... SPXW        (PIN condor breach → −50%)
//   breakeven (~0%) ........................... COIN        (mark hovers at entry)
//   tiny premium ($0.05-ish) .................. F           (entry 0.05)
//   huge premium .............................. NFLX        (entry 42.0)
//   STALE mark (staleness dim renders) ........ SMCI        (mark_as_of ~90s old)
//   NO mark ("—") ............................. SNOW        (last_mark null)
//   why-now: accumulation + scorecard CI ...... NVDA        (accumDays 3, WR CI)
//   why-now: breakout + scorecard "CI n/a" .... TSLA        (noCi scorecard)
//   why-now: gamma-wall pin ................... SPX / SPXW  (PIN condors)
//   why-now: sweep / flow-spike ............... GOOGL / MSFT
//   why-now ABSENT (ribbon omitted) ........... COIN        (noWhyNow)
// The five canonical names (NVDA/TSLA/META/SPX/AMD) are preserved from the original arc.
const PLAYS = [
  // ── canonical five (unchanged arc) ──
  {
    ticker: 'NVDA', direction: 'long', origin: 'FLOW', strike: 182, right: 'C', entry: 2.0,
    exit_mode: 'trim_scale', tier: 'A',
    // Wave 3 — multi-day accumulation trigger + a calibration scorecard WITH the Wilson CI.
    accumDays: 3, scorecard: { wins: 135, n: 214, avg: 12 },
    // Plausible long-call greeks so the sim previews the greeks strip + theta highlight.
    greeks: { delta: 0.52, gamma: 0.06, theta: -0.18, vega: 0.11, iv: 0.44 },
    marks: [[570, 2.0], [600, 2.6], [660, 3.2], [720, 3.6], [810, 3.6]], // 09:30..13:30 → TRIM +80%
    statusAt: (m, pnl) => (m >= 810 ? 'TRIM' : pnl >= 50 ? 'TRIM' : pnl >= 15 ? 'HOLD' : 'OPEN'),
    closed_reason: null,
  },
  {
    ticker: 'TSLA', direction: 'long', origin: 'BREAKOUT', strike: 250, right: 'C', entry: 1.5,
    exit_mode: 'trim_scale', tier: 'B',
    // Wave 3 — breakout trigger + a scorecard with NO CI attached → exercises the "CI n/a" render.
    scorecard: { wins: 40, n: 63, avg: 9, noCi: true },
    greeks: { delta: 0.47, gamma: 0.05, theta: -0.14, vega: 0.09, iv: 0.51 },
    marks: [[585, 1.5], [630, 1.8], [690, 2.05], [780, 2.1], [900, 2.1]], // HOLD +40%
    statusAt: (m, pnl) => (m >= 780 ? 'HOLD' : pnl >= 15 ? 'HOLD' : 'OPEN'),
    closed_reason: null,
  },
  {
    ticker: 'META', direction: 'long', origin: 'FLOW', strike: 720, right: 'C', entry: 1.0,
    exit_mode: 'trim_scale', tier: 'A',
    greeks: { delta: 0.55, gamma: 0.07, theta: -0.12, vega: 0.08, iv: 0.39 },
    marks: [[600, 1.0], [660, 1.15], [705, 1.3], [900, 1.3]], // CLOSED · target +30%
    statusAt: (m, pnl) => (m >= 705 ? 'CLOSED' : pnl >= 15 ? 'HOLD' : 'OPEN'),
    closed_reason: (m) => (m >= 705 ? 'target' : null),
  },
  {
    ticker: 'SPX', direction: 'short', origin: 'PIN', strike: 6300, right: 'P', entry: 4.2, condor: true,
    exit_mode: 'trim_scale', tier: 'A',
    greeks: { delta: -0.38, gamma: 0.03, theta: -0.22, vega: 0.14, iv: 0.29 },
    // Iron condor / PIN fade WINNER: credit decays as the pin holds → +76% by the time stop.
    marks: [[615, 4.2], [720, 2.4], [840, 1.2], [930, 1.0], [935, 1.0]],
    // Wave 2 condor geometry (tent gauge inputs) — a symmetric SPX condor around 6300, ±50 shorts,
    // 50-pt wings. Spot HOLDS centered inside the tent all session → the range never breaches.
    condorGeom: {
      spot: 6300, short_put: 6250, long_put: 6200, short_call: 6350, long_call: 6400, wing_pts: 50,
      net_credit: 420, max_loss: 4580, breach_lower: 6250, breach_upper: 6350,
      est_win_rate: 92, est_intraday_breach_pct: 18.7,
    },
    spotMarks: [[615, 6300], [720, 6305], [840, 6298], [930, 6301], [935, 6301]],
    statusAt: (m) => (m >= 930 ? 'CLOSED' : m >= 720 ? 'HOLD' : 'OPEN'),
    closed_reason: (m) => (m >= 930 ? 'time_stop' : null),
  },
  {
    // Ratchet mode → previews the LEGACY single stop→target track (the un-changed branch).
    ticker: 'AMD', direction: 'short', origin: 'FLOW', strike: 165, right: 'P', entry: 1.2,
    exit_mode: 'ratchet', tier: 'C',
    greeks: { delta: -0.44, gamma: 0.05, theta: -0.16, vega: 0.1, iv: 0.48 },
    marks: [[600, 1.2], [645, 0.95], [690, 0.6], [900, 0.6]], // CLOSED · stopped −50%
    statusAt: (m) => (m >= 690 ? 'CLOSED' : 'OPEN'),
    closed_reason: (m) => (m >= 690 ? 'stopped' : null),
  },
  // ── added render-states ──
  {
    // OPEN, fresh, in the ±10% enterable band all session — never commits past OPEN.
    ticker: 'GOOGL', direction: 'long', origin: 'FLOW', strike: 180, right: 'C', entry: 3.0,
    exit_mode: 'trim_scale', tier: 'B',
    // Wave 3 — aggressive-sweep trigger (sweep_pct over the material threshold).
    sweepPct: 0.7,
    greeks: { delta: 0.5, gamma: 0.04, theta: -0.11, vega: 0.09, iv: 0.33 },
    marks: [[600, 3.0], [660, 3.1], [720, 2.95], [840, 3.05], [900, 3.0]],
    statusAt: (m) => (m >= 900 ? 'HOLD' : 'OPEN'),
    closed_reason: null,
  },
  {
    // CLOSED · ratchet — runs to +70% then the ratchet floor takes it out at +50%. Ratchet
    // policy → the legacy single stop→target track (a 2nd preview of the unchanged branch).
    ticker: 'AMZN', direction: 'long', origin: 'BREAKOUT', strike: 220, right: 'C', entry: 2.0,
    exit_mode: 'ratchet', tier: 'B',
    greeks: { delta: 0.6, gamma: 0.05, theta: -0.19, vega: 0.1, iv: 0.42 },
    marks: [[600, 2.0], [660, 2.8], [720, 3.4], [780, 3.0], [900, 3.0]],
    statusAt: (m, pnl) => (m >= 780 ? 'CLOSED' : pnl >= 50 ? 'TRIM' : pnl >= 15 ? 'HOLD' : 'OPEN'),
    closed_reason: (m) => (m >= 780 ? 'ratchet' : null),
  },
  {
    // CLOSED · time_stop on a DIRECTIONAL long (distinct from the condor time-stop) — small green.
    ticker: 'MSFT', direction: 'long', origin: 'FLOW', strike: 470, right: 'C', entry: 1.5,
    exit_mode: 'trim_scale', tier: 'C',
    // Wave 3 — flow-spike trigger (30m surge) precedes the plain-FLOW fallback.
    spikeFlag: true,
    greeks: { delta: 0.49, gamma: 0.04, theta: -0.13, vega: 0.08, iv: 0.3 },
    marks: [[600, 1.5], [720, 1.7], [900, 1.6], [935, 1.6]],
    statusAt: (m) => (m >= 930 ? 'CLOSED' : 'HOLD'),
    closed_reason: (m) => (m >= 930 ? 'time_stop' : null),
  },
  {
    // BREAKEVEN — mark hovers on entry, P&L ~0% all day (the ~flat working row). No greeks →
    // exercises the null-greeks "—" strip path.
    ticker: 'COIN', direction: 'long', origin: 'FLOW', strike: 300, right: 'C', entry: 5.0,
    exit_mode: 'trim_scale', tier: 'C',
    // Wave 3 — NO trigger reason pinned → exercises the absent-omit (no why-now ribbon) render.
    noWhyNow: true,
    marks: [[600, 5.0], [660, 5.05], [720, 4.98], [840, 5.02], [900, 5.0]],
    statusAt: () => 'HOLD',
    closed_reason: null,
  },
  {
    // TINY PREMIUM — a $0.05 lotto that ticks to $0.08 (tests sub-dime formatting + ladder $ levels).
    ticker: 'F', direction: 'long', origin: 'BREAKOUT', strike: 14, right: 'C', entry: 0.05,
    exit_mode: 'trim_scale', tier: 'D',
    greeks: { delta: 0.3, gamma: 0.09, theta: -0.02, vega: 0.03, iv: 0.62 },
    marks: [[600, 0.05], [660, 0.07], [720, 0.09], [840, 0.08], [900, 0.08]],
    statusAt: (m, pnl) => (pnl >= 15 ? 'HOLD' : 'OPEN'),
    closed_reason: null,
  },
  {
    // HUGE PREMIUM — a deep $42 contract (tests wide number formatting / ladder-level column width).
    ticker: 'NFLX', direction: 'long', origin: 'FLOW', strike: 1200, right: 'C', entry: 42.0,
    exit_mode: 'trim_scale', tier: 'A',
    greeks: { delta: 0.72, gamma: 0.01, theta: -0.85, vega: 0.4, iv: 0.36 },
    marks: [[600, 42.0], [660, 48.0], [720, 52.0], [840, 50.0], [900, 50.0]],
    statusAt: (m, pnl) => (pnl >= 15 ? 'HOLD' : 'OPEN'),
    closed_reason: null,
  },
  {
    // STALE MARK — a working row whose last quote is ~90s old → the staleness dim must render.
    // Keeps greeks + a ladder so the v2 detail is visibly DIMMED (not blanked) when stale.
    ticker: 'SMCI', direction: 'long', origin: 'FLOW', strike: 55, right: 'C', entry: 2.0,
    exit_mode: 'trim_scale', tier: 'B',
    greeks: { delta: 0.51, gamma: 0.06, theta: -0.15, vega: 0.09, iv: 0.55 },
    marks: [[600, 2.0], [660, 2.3], [720, 2.3], [900, 2.3]],
    statusAt: () => 'HOLD',
    closed_reason: null,
    staleMark: true,
  },
  {
    // NO MARK — a working row with no live quote at all → mark "—", P&L null, no exec fill.
    // Greeks still carry (they come from the last snapshot, not the mark) so the strip renders.
    ticker: 'SNOW', direction: 'long', origin: 'BREAKOUT', strike: 200, right: 'C', entry: 1.8,
    exit_mode: 'trim_scale', tier: 'C',
    greeks: { delta: 0.48, gamma: 0.05, theta: -0.12, vega: 0.08, iv: 0.4 },
    marks: [[600, 1.8], [660, 1.9], [900, 1.9]],
    statusAt: () => 'HOLD',
    closed_reason: null,
    noMark: true,
  },
  {
    // CONDOR BREACH → stopped — the pin FAILS, the short side is breached, position stops at −50%.
    ticker: 'SPXW', direction: 'short', origin: 'PIN', strike: 6250, right: 'P', entry: 5.0, condor: true,
    exit_mode: 'trim_scale', tier: 'D',
    greeks: { delta: -0.55, gamma: 0.04, theta: -0.2, vega: 0.13, iv: 0.31 },
    marks: [[615, 5.0], [660, 6.5], [720, 7.5], [900, 7.5]],
    // Wave 2 condor geometry — same 6250/6350 tent; here spot SELLS OFF through the lower short (6250)
    // → the tent BREACHES (defended range fails), exercising the breached-marker render + −50% stop.
    condorGeom: {
      spot: 6300, short_put: 6250, long_put: 6200, short_call: 6350, long_call: 6400, wing_pts: 50,
      net_credit: 500, max_loss: 4500, breach_lower: 6250, breach_upper: 6350,
      est_win_rate: 90, est_intraday_breach_pct: 18.7,
    },
    spotMarks: [[615, 6300], [660, 6272], [720, 6246], [900, 6240]],
    statusAt: (m) => (m >= 720 ? 'CLOSED' : 'OPEN'),
    closed_reason: (m) => (m >= 720 ? 'stopped' : null),
  },
];

// ── WATCH / SKIP setups — pre-commit rows that live in `setups` (NOT the ledger). A WATCH
//    setup is a candidate the floor is still weighing (never commits); a BLOCKED gate makes
//    it a SKIP. Their tickers are deliberately absent from PLAYS so they never gain a ledger
//    row and therefore stay in the pre-commit band all session.
const SETUPS = [
  {
    ticker: 'QQQ', appearAt: 600, score: 58, direction: 'long', top_strike: 480, right: 'C', dte: 0,
    gamma_regime: 'positive', market_aligned: true, gate: { verdict: 'WATCH', blocks: [] },
    flow_quality: { components: { premiumDepth: 14, aggression: 11, sweepIntensity: 9 } },
  },
  {
    ticker: 'IWM', appearAt: 600, score: 44, direction: 'short', top_strike: 210, right: 'P', dte: 0,
    gamma_regime: 'negative', market_aligned: null, gate: { verdict: 'BLOCKED', blocks: [{ code: 'plan_illiquid' }] },
    flow_quality: { components: { premiumDepth: 6, aggression: 4 } },
  },
];

const STOP_PCT = -50; // pinned P&L for a stopped play (matches PLAN_RULES.stop_pct)

function interp(marks, m) {
  if (m <= marks[0][0]) return marks[0][1];
  for (let i = 1; i < marks.length; i++) {
    if (m <= marks[i][0]) {
      const [m0, v0] = marks[i - 1], [m1, v1] = marks[i];
      const t = m1 === m0 ? 0 : (m - m0) / (m1 - m0);
      return v0 + (v1 - v0) * t;
    }
  }
  return marks[marks.length - 1][1];
}
const r2 = (x) => Math.round(x * 100) / 100;

// Wilson 95% score interval (percent bounds) — mirrors src/lib/zerodte/calibration-stats.ts so the
// sim scorecard previews the SAME honest CI the live calibration lane computes (never fabricated).
function wilsonPct(k, n, z = 1.96) {
  if (!(n > 0)) return null;
  const p = k / n, z2 = z * z, d = 1 + z2 / n;
  const c = (p + z2 / (2 * n)) / d;
  const m = (z / d) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  const cl = (x) => Math.max(0, Math.min(1, x));
  return { lo: Math.round(cl(c - m) * 1000) / 10, hi: Math.round(cl(c + m) * 1000) / 10 };
}

// "Why now" trigger reason — mirrors src/lib/zerodte/why-now.ts deriveWhyNow so `?sim=1` previews
// the ribbon exactly as a live row (pinned into entry_context at commit server-side). Honest:
// omitted (null) when the play carries no supporting signal (noWhyNow) — no fabricated reason.
function whyNowFor(play) {
  if (play.noWhyNow) return null;
  const days = play.accumDays ?? null;
  if (days != null && days >= 2) return { reason: 'accumulation', label: `multi-day accumulation (${Math.round(days)}d build)` };
  if (play.origin === 'BREAKOUT') return { reason: 'breakout', label: 'breakout momentum' };
  if (play.origin === 'PIN') return { reason: 'pin', label: 'gamma-wall pin' };
  if ((play.sweepPct ?? 0) >= 0.5) return { reason: 'sweep', label: 'aggressive sweep' };
  if (play.spikeFlag) return { reason: 'flow_spike', label: 'flow spike (30m surge)' };
  if (play.origin === 'FLOW') return { reason: 'aggressor_flow', label: 'dominant aggressor flow' };
  return null;
}

// The calibration scorecard for the play, with the Wilson CI attached (or omitted for the "CI n/a"
// coverage row). Shape matches the deck's TerminalPlay.scorecard.
function scorecardFor(play) {
  const sc = play.scorecard;
  if (!sc) return null;
  const winRate = Math.round((sc.wins / sc.n) * 1000) / 10;
  const ci = sc.noCi ? null : wilsonPct(sc.wins, sc.n);
  return { winRate, avg: sc.avg, n: sc.n, ciLow: ci?.lo ?? null, ciHigh: ci?.hi ?? null };
}

/** Build the ledger row for one play at ET minute `m`. Returns null if the play hasn't
 *  committed yet (before its first keyframe). */
function ledgerRowFor(play, m) {
  const first = play.marks[0][0];
  if (m < first) return null;
  const closedReason = typeof play.closed_reason === 'function' ? play.closed_reason(m) : play.closed_reason;
  // NO-mark row: a working position with no live quote → mark null, P&L null, "—" in the deck.
  const mark = play.noMark ? null : r2(interp(play.marks, m));
  // Peak/trough across the elapsed window so the deck's peak/trough chips move.
  const elapsed = play.marks.map(([km]) => km).filter((km) => km <= m).concat([m]);
  const sampled = elapsed.map((km) => interp(play.marks, km));
  const peak = play.noMark ? null : r2(Math.max(...sampled));
  const trough = play.noMark ? null : r2(Math.min(...sampled));
  // P&L is STRUCTURE-aware, matching the corrected server (reconcileLedgerLivePnlPct, FINDINGS
  // 2026-07-26): a CONDOR is a CREDIT structure whose return is SELLER-framed (entry − mark)/entry —
  // a DECAYING mark (mark ↓) is a POSITIVE return — so a winning condor is fed POSITIVE (never the
  // long-framed −76% that relied on the now-removed render flip). A directional row is long-framed
  // (mark − entry)/entry with the stopped-P&L pin. (For the SPXW breach condor the seller formula
  // yields −50% on its own — entry 5.0, mark 7.5 — so no stop-pin is needed for condors.)
  const rawPnl =
    mark == null
      ? null
      : play.condor === true
        ? (1 - mark / play.entry) * 100
        : (mark / play.entry - 1) * 100;
  const pnl =
    mark == null
      ? null
      : play.condor !== true && closedReason === 'stopped'
        ? STOP_PCT
        : Math.round(rawPnl * 10) / 10;
  const status = play.statusAt(m, rawPnl ?? 0);
  // Mark freshness: fresh (real wall clock) for normal rows; ~90s old for the STALE demo so the
  // deck's staleness dim renders; null (no timestamp) for the no-mark / legacy-sync case.
  const markAsOf = play.noMark ? null : play.staleMark ? new Date(Date.now() - 90_000).toISOString() : new Date().toISOString();
  // Terminal v2 — a live two-sided book around the mark (a ~4%-of-mid spread) so the sim previews
  // the executable fill + exec P&L. Null-safe: a no-mark row has no book → bid/ask/exec-P&L null.
  // A directional LONG-premium play sells into the BID: exec P&L = (bid − entry)/entry. A CONDOR is
  // a CREDIT (short-premium) structure — closed by BUYING back at the ASK — so its realized return
  // is (entry − ask)/entry (profit comes from the position DECAYING, not the premium rising).
  const bid = mark == null ? null : r2(mark * 0.98);
  const ask = mark == null ? null : r2(mark * 1.02);
  const execPnl =
    mark == null
      ? null
      : play.condor === true
        ? Math.round(((play.entry - ask) / play.entry) * 1000) / 10
        : Math.round(((bid - play.entry) / play.entry) * 1000) / 10;
  return {
    ticker: play.ticker,
    direction: play.direction,
    origin: play.origin,
    is_condor: play.condor === true,
    status,
    top_strike: play.strike,
    right: play.right,
    entry_premium: play.entry,
    last_mark: mark,
    peak_premium: peak,
    trough_premium: trough,
    live_pnl_pct: pnl,
    closed_reason: closedReason,
    graded: status === 'CLOSED',
    first_flagged_at: `${SESSION_DATE}T${fmtEt(first)}:00-04:00`,
    mark_source: mark == null ? null : 'mid',
    mark_as_of: markAsOf,
    mark_is_sync: false,
    move_pct: null,
    direction_hit: null,
    plan_outcome: closedReason,
    plan_pnl_pct: status === 'CLOSED' ? pnl : null,
    nighthawk_echo: null,
    cortex: null,
    tier: play.tier ? { tier: play.tier } : null,
    // Terminal v2 additive block — the real resolved exit ladder (priced + fired vs peak),
    // live greeks, executable book, and discovery origin, so the sim renders the v2 terminal.
    exit_policy: exitLadder(play.exit_mode, play.entry, peak),
    bid,
    ask,
    live_pnl_pct_exec: execPnl,
    greeks: play.greeks ?? null,
    discovery_origin: play.origin ? [play.origin] : null,
    // Wave 2 — the condor tent geometry + the LIVE underlying arc, so the sim renders the real condor
    // "price-inside-the-tent" gauge (winner holds centered; breach row sells through the lower short).
    // Null on a directional row → the deck draws the directional views exactly as before.
    condor: play.condorGeom ?? null,
    underlying_price: play.spotMarks ? r2(interp(play.spotMarks, m)) : null,
    // Wave 3 — the "why now" trigger reason (ribbon) + the calibration scorecard with its Wilson CI.
    // Null-safe: a play with no signal / no scorecard emits null and the deck omits the widget.
    why_now: whyNowFor(play),
    scorecard: scorecardFor(play),
  };
}

/** Build the terminal exit ladder for the sim (mirrors src/lib/zerodte/terminal-ladder.ts
 *  buildTerminalExitLadder). trim_scale = ⅓@+25% / ⅓@+50% ladder + a ⅓ runner; ratchet = a
 *  single +100% half-trim (previews the legacy single-track render). Premiums are entry ×
 *  (1+trigger/100); a tranche is FIRED once the latched peak reaches that level. */
function exitLadder(mode, entry, peak) {
  const lvl = (pct) => r2(entry * (1 + pct / 100));
  const fired = (level) => peak != null && peak >= level;
  const trim = (pct, frac) => { const premium = lvl(pct); return { trigger_pct: pct, fraction: frac, premium, fired: fired(premium) }; };
  const trim_levels = mode === 'ratchet' ? [trim(100, 0.5)] : [trim(25, 1 / 3), trim(50, 1 / 3)];
  return {
    policy: mode === 'ratchet' ? 'ratchet' : 'trim_scale',
    hard_stop_pct: -50,
    target_pct: 100,
    trim_levels,
    runner_fraction: mode === 'ratchet' ? 0.5 : 1 / 3,
    stop_premium: lvl(-50),
    target_premium: lvl(100),
    time_stop_et: '15:30',
  };
}

/** Build the pre-commit `setups` entry for a WATCH/SKIP candidate at ET minute `m` (null
 *  before it appears). Shape mirrors what the deck's zeroDteSources reader consumes. */
function setupRowFor(setup, m) {
  if (m < setup.appearAt) return null;
  return {
    ticker: setup.ticker,
    score: setup.score,
    direction: setup.direction,
    top_strike: setup.top_strike,
    right: setup.right,
    dte: setup.dte,
    gamma_regime: setup.gamma_regime,
    market_aligned: setup.market_aligned,
    gate: setup.gate,
    flow_quality: setup.flow_quality,
  };
}

function sessionHeatFor(m) {
  // Mirror the coarse buckets the real sessionHeat produces so the deck's clock chips render.
  const state = m < 570 ? 'PRE' : m >= 960 ? 'CLOSED' : m < 600 ? 'OPEN_DRIVE' : m >= 900 ? 'POWER_HOUR' : 'MIDDAY';
  return { state, label: state, et_minutes: m };
}

/** One full ZeroDteBoardPayload frame at ET minute `m`. */
function frameAt(m) {
  const ledger = PLAYS.map((p) => ledgerRowFor(p, m)).filter(Boolean);
  const setups = SETUPS.map((s) => setupRowFor(s, m)).filter(Boolean);
  return {
    available: true,
    as_of: new Date().toISOString(),
    upstream_ok: true,
    session: { date: SESSION_DATE, trading_day: true, heat: sessionHeatFor(m) },
    setups,
    ledger,
    covered_elsewhere: [],
    governor: null,
    allocation: [],
  };
}

/** Structural validity check mirroring src/lib/platform/zerodte-sim-board.ts
 *  isZeroDteBoardPayload — the SAME contract the admin ingest endpoint enforces before
 *  writing a frame. Used by `--dry-run` to prove every generated frame would be accepted
 *  (0 invalid frames), so the synthetic roster can't silently drift out of the contract. */
function isValidFramePayload(v) {
  if (!v || typeof v !== 'object') return false;
  if (v.available !== true) return false;
  if (typeof v.as_of !== 'string' || !Number.isFinite(Date.parse(v.as_of))) return false;
  if (!v.session || typeof v.session !== 'object') return false;
  if (typeof v.session.date !== 'string') return false;
  if (typeof v.session.trading_day !== 'boolean') return false;
  if (!v.session.heat || typeof v.session.heat !== 'object') return false;
  if (!Array.isArray(v.setups)) return false;
  if (!Array.isArray(v.ledger)) return false;
  if (!Array.isArray(v.covered_elsewhere)) return false;
  if (!Array.isArray(v.allocation)) return false;
  return true;
}

/** The synthetic schedule: one frame every 5 ET minutes across [START_ET, END_ET]. */
function syntheticFrames() {
  const frames = [];
  const from = START_ET ?? 570, to = END_ET ?? 955;
  for (let m = from; m <= to; m += 5) frames.push({ etMinute: m, payload: frameAt(m) });
  return frames;
}

function replayFrames(file) {
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(raw)) throw new Error('replay file must be an array of { etMinute, payload }');
  return raw
    .filter((f) => f && Number.isFinite(f.etMinute) && f.payload && typeof f.payload === 'object')
    .filter((f) => (START_ET == null || f.etMinute >= START_ET) && (END_ET == null || f.etMinute <= END_ET))
    .sort((a, b) => a.etMinute - b.etMinute);
}

// ── main ────────────────────────────────────────────────────────────────────────────
const WATCH_URL = `${BASE}/nighthawk?sim=1`;
const INGEST = `${BASE}/api/admin/zerodte/sim/board`;

let userId = null;
async function main() {
  if (!SYNTHETIC && !REPLAY && !RESET) {
    console.error('Nothing to do. Pass --synthetic, --replay=<file.json>, or --reset.');
    process.exit(2);
  }

  const frames = RESET ? [] : SYNTHETIC ? syntheticFrames() : replayFrames(REPLAY);
  if (!RESET) {
    console.log(`\n▲ 0DTE SIM FEEDER — ${SYNTHETIC ? 'synthetic RTH arc' : `replay ${REPLAY}`}`);
    console.log(`  frames: ${frames.length}  speed: ${SPEED} ET-min/s  window: ${fmtEt(frames[0]?.etMinute ?? 0)}–${fmtEt(frames[frames.length - 1]?.etMinute ?? 0)} ET`);
    console.log(`\n  WATCH URL:  ${WATCH_URL}   (open as an ADMIN)\n`);
  }

  if (DRY && !RESET) {
    let invalid = 0;
    for (const f of frames) {
      const ok = isValidFramePayload(f.payload);
      if (!ok) invalid++;
      console.log(`  ${fmtEt(f.etMinute)} ET  ${ok ? '✓' : '✗ INVALID'}  ${f.payload.ledger.length} plays · ${f.payload.setups.length} setups`);
    }
    // Report the render-state coverage the last (fullest) frame exercises.
    const last = frames[frames.length - 1]?.payload;
    if (last) {
      const statuses = [...new Set(last.ledger.map((r) => r.status))].sort();
      const closed = [...new Set(last.ledger.filter((r) => r.status === 'CLOSED').map((r) => r.closed_reason))].sort();
      const condors = last.ledger
        .filter((r) => r.is_condor)
        .map((r) => {
          // Confirm the tent GEOMETRY is actually emitted (not just the is_condor flag) so `?sim=1`
          // renders the real condor tent/breach view instead of "geometry unavailable".
          const g = r.condor;
          const geom = g && typeof g === 'object' && Number.isFinite(g.breach_lower) && Number.isFinite(g.breach_upper)
            ? `tent ${g.breach_lower}/${g.breach_upper}`
            : 'NO-GEOMETRY';
          return `${r.ticker}:${r.closed_reason ?? 'live'} (${geom})`;
        });
      const stale = last.ledger.filter((r) => r.mark_as_of && Date.now() - Date.parse(r.mark_as_of) > 5_000).map((r) => r.ticker);
      const noMark = last.ledger.filter((r) => r.last_mark == null).map((r) => r.ticker);
      // Wave 3 coverage: which trigger reasons + which scorecards carry a CI vs "CI n/a".
      const whyNow = last.ledger.filter((r) => r.why_now).map((r) => `${r.ticker}:${r.why_now.reason}`);
      const noWhy = last.ledger.filter((r) => !r.why_now).map((r) => r.ticker);
      const scWithCi = last.ledger.filter((r) => r.scorecard && r.scorecard.ciLow != null).map((r) => r.ticker);
      const scNoCi = last.ledger.filter((r) => r.scorecard && r.scorecard.ciLow == null).map((r) => r.ticker);
      console.log(`\n  ledger statuses:    ${statuses.join(', ')}`);
      console.log(`  CLOSED reasons:     ${closed.join(', ')}`);
      console.log(`  condors:            ${condors.join(', ')}`);
      console.log(`  stale-mark rows:    ${stale.join(', ') || '(none)'}`);
      console.log(`  no-mark rows:       ${noMark.join(', ') || '(none)'}`);
      console.log(`  pre-commit setups:  ${last.setups.map((s) => `${s.ticker}:${s.gate?.verdict}`).join(', ')}`);
      console.log(`  why-now triggers:   ${whyNow.join(', ')}`);
      console.log(`  no why-now (omit):  ${noWhy.join(', ') || '(none)'}`);
      console.log(`  scorecard +CI:      ${scWithCi.join(', ') || '(none)'}`);
      console.log(`  scorecard CI n/a:   ${scNoCi.join(', ') || '(none)'}`);
    }
    console.log(`\n[dry-run] no auth, nothing posted.  invalid frames: ${invalid}`);
    if (invalid > 0) process.exitCode = 1;
    return;
  }

  // --- auth (once) — mint temp admin user → FAPI ticket → __session cookie ---
  // Shared create-or-adopt: e-mail collision → adopt the leftover user; PHONE collision →
  // redraw a fresh +1415555XXXX and retry.
  const auth = await createOrAdoptAuditUserViaCurl({ curl, api: API, secret: SECRET, email: EMAIL, phone: PHONE });
  if (auth.error) { console.error('auth: could not create/adopt temp admin user:', auth.error.slice(0, 220)); process.exit(1); }
  userId = auth.userId;

  let tok = null, sid = null, clientUat = 0;
  const mint = () => { tok = sid ? J(curl({ method: 'POST', url: `${FAPI}/v1/client/sessions/${sid}/tokens?_clerk_js_version=${CJS}`, headers: { Origin: BASE, Referer: `${BASE}/`, 'Content-Type': 'application/x-www-form-urlencoded' }, jar: true, saveJar: true }))?.jwt : null; return tok; };
  const establishSession = () => {
    const ticket = J(backend('POST', '/sign_in_tokens', { user_id: userId }))?.token;
    if (!ticket) return false;
    const si = curl({ method: 'POST', url: `${FAPI}/v1/client/sign_ins?_clerk_js_version=${CJS}`, headers: { Origin: BASE, Referer: `${BASE}/`, 'Content-Type': 'application/x-www-form-urlencoded' }, form: { strategy: 'ticket' }, urlencodeForm: { ticket }, saveJar: true, jar: true });
    const newSid = J(si)?.response?.created_session_id;
    if (!newSid) return false;
    sid = newSid;
    clientUat = Math.floor(Date.now() / 1000);
    return !!mint();
  };
  if (!establishSession()) { console.error('auth: FAPI ticket exchange failed — could not establish session'); process.exit(1); }

  const postFrame = (payload) => {
    if (!tok) mint() || establishSession();
    return curl({ method: 'POST', url: INGEST, headers: { Cookie: `__session=${tok}; __client_uat=${clientUat}`, 'Content-Type': 'application/json' }, json: payload });
  };
  const del = () => curl({ method: 'DELETE', url: INGEST, headers: { Cookie: `__session=${tok}; __client_uat=${clientUat}` } });

  if (RESET) {
    const r = del();
    console.log(`\n▲ 0DTE SIM RESET — DELETE ${INGEST} → HTTP ${r.s}`);
    console.log(`  ${(J(r) && JSON.stringify(J(r))) || r.b.slice(0, 160)}`);
    return;
  }

  // Clear any prior sim state so the arc starts clean.
  del();

  const FRAME_GAP_ET = 5; // synthetic frames are 5 ET-min apart; replay gaps come from etMinute deltas.
  let prevEt = frames[0]?.etMinute ?? 0;
  let ok = 0, fail = 0;
  for (const f of frames) {
    const gapEt = SYNTHETIC ? FRAME_GAP_ET : Math.max(0, f.etMinute - prevEt);
    prevEt = f.etMinute;
    const waitMs = Math.round((gapEt * 60 * 1000) / SPEED);
    if (waitMs > 0) await sleep(waitMs);

    // Re-mint the session token periodically so a long arc doesn't post with a stale token.
    if (!tok) mint() || establishSession();
    const r = postFrame(f.payload);
    if (r.s === 200) { ok++; const body = J(r) || {}; console.log(`  ${fmtEt(f.etMinute)} ET  ✓  ${f.payload.ledger.length} plays  (ttl ${body.ttlSec ?? '?'}s)`); }
    else { fail++; console.log(`  ${fmtEt(f.etMinute)} ET  ✗  HTTP ${r.s}  ${r.b.slice(0, 120)}`); if (r.s === 401 || r.s === 403) { tok = null; establishSession(); } }
  }
  console.log(`\n▲ done — ${ok} frames posted, ${fail} failed.  Watch: ${WATCH_URL}`);
}

main()
  .catch((e) => { console.error('FATAL:', e?.message || e); process.exitCode = 1; })
  .finally(() => {
    // ALWAYS delete the temp admin user (cleanup), then wipe the temp cookie jar.
    try { if (userId) backend('DELETE', `/users/${userId}`); } catch {}
    try { rmSync(TMP, { recursive: true, force: true }); } catch {}
  });
