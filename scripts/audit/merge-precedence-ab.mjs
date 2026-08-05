/**
 * MERGE-PRECEDENCE A/B HARNESS (design item #1 — FLOW-first merge precedence).
 *
 * The three whole-market discovery rails (FLOW, BREAKOUT, PIN) merge BY TICKER, and when two rails
 * surface the same ticker in OPPOSITE directions the shipped merge keeps the highest-precedence
 * rail's direction by a fixed SEATING ORDER — FLOW > BREAKOUT > PIN — with NO evidence weighting
 * (breakout-source.ts `mergeDiscoveryOrigins`, pin-source.ts `mergePinOrigins`; the kept read is
 * always the incumbent, the opposing read is stamped as evidence but never allowed to win). That
 * precedence is now VERSIONED as `MERGE_POLICY_VERSION` (board.ts, currently "v1") and every rail's
 * (direction, score) is FROZEN on the committed row at `entry_context.origin_maps` (WS-06). This
 * harness uses those frozen maps to answer the standing question the fixed order deliberately left
 * open: on the rows where the rails DISAGREED, would an EVIDENCE-WEIGHTED precedence (keep the
 * HIGHEST-SCORE rail's direction) have graded better than FLOW-first?
 *
 * It is OFFLINE + READ-ONLY and changes NO production behavior — it only re-scores already-committed
 * rows against real minute bars. It does NOT re-run the merge; it reads what the shipped merge froze.
 *
 * METHOD. For each committed row it reads `entry_context.origin_maps`:
 *   FLOW-first choice     = direction_owner's direction (origin_direction_map[direction_owner]).
 *   Evidence-weighted     = direction of the rail with the max origin_score_map value (ties → skip).
 * Rows with a single origin, or where both precedences pick the SAME direction, carry NO A/B delta
 * (counted as "agree", excluded from the head-to-head). On the DISAGREEMENT rows, BOTH candidate
 * directions are graded identically on REAL Polygon minute bars with the same favorable-first proxy
 * the discovery-recall-probe uses (long: HIGH reaches entry·(1+fav) before LOW reaches entry·(1−fav/2);
 * short: mirror on LOW/ HIGH) — so the comparison is apples-to-apples. Reports per-precedence win-rate
 * + net, and names the rows where the choice diverged.
 *
 * GRADING is an UNDERLYING-continuation proxy applied identically to both arms — NOT exact option P&L
 * (that needs each row's committed contract path). It is evidence for a precedence decision, not a gate.
 *
 * DATA. Committed rows are a DB product (zerodte_setup_log.entry_context) and the raw TCP DB is blocked
 * from this sandbox, so this harness reads them from a JSON export you pass with `--ledger=<path>`
 * (an array of rows shaped like record.ts ZeroDteRecordPlay: {session_date, ticker, entry_context}).
 * With no reachable ledger it prints INSUFFICIENT DATA and exactly what it needs — it never fabricates
 * a disagreement. Minute bars are fetched from Polygon directly (self-defaulted base, same as the
 * other audit scripts). Run:
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY node --import tsx scripts/audit/merge-precedence-ab.mjs --ledger=export.json [--fav=0.015] [--entry=10:00] [--json]
 */
// POLYGON_API_BASE is often the unresolved `${{shared.*}}` placeholder in this sandbox — accept it
// ONLY when it is a real http(s) URL, else fall back to the code's own default host.
const rawBase = process.env.POLYGON_API_BASE;
const RESOLVED_BASE = rawBase && /^https?:\/\//.test(rawBase) ? rawBase : "https://api.massive.com";
process.env.POLYGON_API_BASE = RESOLVED_BASE;
const SRC = new URL("../../src/", import.meta.url).pathname;

// Import ONLY the pure production precedence constant so the harness measures against the SAME policy
// version the live merge froze — if the shipped precedence changes, this print changes with it.
const { MERGE_POLICY_VERSION } = await import(`${SRC}lib/zerodte/board.ts`);

const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);
const FAV = Number(argv.fav ?? 0.015);
const ADV = FAV / 2;
const [entH, entM] = String(argv.entry ?? "10:00").split(":").map(Number);
const JSON_OUT = argv.json === true || argv.json === "true";
const ET_OFFSET = -4; // EDT (summer sessions); the RTH window derives from this.
const ENTRY_UTC_MIN = (entH - ET_OFFSET) * 60 + (entM || 0);
const CLOSE_UTC_MIN = (16 - ET_OFFSET) * 60;

const KEY = process.env.POLYGON_API_KEY;
const BASE = process.env.POLYGON_API_BASE;

// Pure precedence-arm helpers, factored into lib/merge-precedence-eval.mjs (unit-tested by
// lib/merge-precedence-eval.test.mjs — see that file's header for the real bug it regression-tests).
const { flowFirstDirection, evidenceWeightedDirection } = await import("./lib/merge-precedence-eval.mjs");

function fail(msg, code = 2) {
  console.error(msg);
  process.exit(code);
}

/** INSUFFICIENT-DATA exit — honest, never fabricated. */
function insufficient(reason) {
  if (JSON_OUT) {
    console.log(JSON.stringify({ ok: false, insufficient_data: true, reason }, null, 2));
  } else {
    console.log(`\n=== merge-precedence A/B — INSUFFICIENT DATA ===`);
    console.log(reason);
    console.log(
      "\nProvide a committed-row export with --ledger=<path.json>: an array of rows shaped like\n" +
        "record.ts ZeroDteRecordPlay — each needs { session_date, ticker, entry_context: { origin_maps:\n" +
        "{ origin_direction_map, origin_score_map, direction_owner, disagreeing_origins,\n" +
        "merge_policy_version } } }. Produce it where the zerodte_setup_log DB / an admin ledger export is\n" +
        "reachable (raw Postgres is blocked from this sandbox), then re-run here to grade offline."
    );
  }
  process.exit(0);
}

if (!KEY) fail("POLYGON_API_KEY required");

const ledgerPath = typeof argv.ledger === "string" ? argv.ledger : null;
if (!ledgerPath) {
  insufficient("No --ledger export was provided, so there are no committed origin_maps to re-grade.");
}

let rows;
try {
  const fs = await import("node:fs/promises");
  const txt = await fs.readFile(ledgerPath, "utf8");
  const parsed = JSON.parse(txt);
  // Accept either a bare array or { plays: [...] } / { rows: [...] } envelopes.
  rows = Array.isArray(parsed) ? parsed : (parsed.plays ?? parsed.rows ?? []);
} catch (e) {
  fail(`Could not read/parse --ledger=${ledgerPath}: ${e?.message ?? e}`);
}
if (!Array.isArray(rows) || rows.length === 0) {
  insufficient(`--ledger=${ledgerPath} contained no rows.`);
}

const utcMinOf = (tMs) => {
  const d = new Date(tMs);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};
const ymd = (s) => String(s).slice(0, 10);
const pct = (x) => (x == null ? "n/a" : `${(x * 100).toFixed(1)}%`);
const rate = (arr) => (arr.length ? arr.filter((x) => x.win).length / arr.length : null);

async function jget(url) {
  const r = await fetch(url).catch(() => null);
  if (!r || !r.ok) return null;
  return r.json().catch(() => null);
}
async function fetchMinuteBars(ticker, date) {
  // CodeQL / SSRF hardening: ticker+date come from the operator's --ledger export (file data).
  // Validate both against strict allowlists BEFORE they reach the outbound URL — a regex guard
  // against a constant pattern breaks the taint flow and rejects any malformed/hostile row.
  const t = String(ticker).toUpperCase();
  const d = String(date);
  if (!/^[A-Z][A-Z0-9.]{0,9}$/.test(t) || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return [];
  const url = `${BASE}/v2/aggs/ticker/${t}/range/1/minute/${d}/${d}?adjusted=true&sort=asc&limit=50000&apiKey=${KEY}`;
  const j = await jget(url);
  return (j?.results ?? []).map((b) => ({ t: b.t, h: b.h, l: b.l, c: b.c }));
}

/** Favorable-first proxy generalized to direction. long → up move wins; short → down move wins.
 *  Returns { win, maxRet } or null when there aren't enough RTH bars from the entry. */
function gradeDirection(bars, direction) {
  const rth = bars
    .filter((b) => Number.isFinite(b.t) && Number.isFinite(b.h) && Number.isFinite(b.l) && Number.isFinite(b.c))
    .sort((a, b) => a.t - b.t)
    .filter((b) => utcMinOf(b.t) >= ENTRY_UTC_MIN && utcMinOf(b.t) <= CLOSE_UTC_MIN);
  if (rth.length < 2) return null;
  const entry = rth[0].c;
  if (!(entry > 0)) return null;
  const long = direction === "long";
  const favLevel = long ? entry * (1 + FAV) : entry * (1 - FAV);
  const advLevel = long ? entry * (1 - ADV) : entry * (1 + ADV);
  let maxRet = 0;
  for (let i = 1; i < rth.length; i++) {
    const b = rth[i];
    const fav = long ? (b.h - entry) / entry : (entry - b.l) / entry;
    maxRet = Math.max(maxRet, fav);
    const hitFav = long ? b.h >= favLevel : b.l <= favLevel;
    const hitAdv = long ? b.l <= advLevel : b.h >= advLevel;
    if (hitFav && !hitAdv) return { win: true, maxRet };
    if (hitAdv && !hitFav) return { win: false, maxRet };
    if (hitFav && hitAdv) return { win: false, maxRet }; // same-bar ambiguity → pessimistic
  }
  return { win: false, maxRet };
}

// flowFirstDirection / evidenceWeightedDirection are imported above from
// lib/merge-precedence-eval.mjs — see that file for the bug this harness shipped with (an
// earlier inline version read the policy-versioned `direction_owner` field as if it were always
// the v1 seating-order pick, which made the two arms silently collapse to the same value on
// every real v2 ledger row) and lib/merge-precedence-eval.test.mjs for the regression test.

// ── Walk the rows ─────────────────────────────────────────────────────────────────────
const considered = [];
let singleOrigin = 0;
let agree = 0;
let missingMaps = 0;
let staleVersion = 0;

for (const row of rows) {
  const maps = row?.entry_context?.origin_maps;
  if (!maps || !maps.origin_direction_map || !maps.origin_score_map) {
    missingMaps++;
    continue;
  }
  if (maps.merge_policy_version && maps.merge_policy_version !== MERGE_POLICY_VERSION) staleVersion++;
  const origins = Object.keys(maps.origin_direction_map);
  if (origins.length < 2) {
    singleOrigin++;
    continue;
  }
  const ff = flowFirstDirection(maps);
  const ew = evidenceWeightedDirection(maps);
  if (!ff || !ew) continue;
  if (ff.dir === ew.dir) {
    agree++;
    continue;
  }
  considered.push({ row, maps, ff, ew });
}

if (considered.length === 0) {
  insufficient(
    `Read ${rows.length} row(s): ${singleOrigin} single-origin, ${agree} multi-origin where FLOW-first and\n` +
      `evidence-weighted AGREE, ${missingMaps} without origin_maps. ZERO rows where the two precedences\n` +
      `chose DIFFERENT directions — so there is no A/B delta to grade on this export. This is a real (and\n` +
      `reassuring) result: it means the fixed FLOW-first order rarely overrides a stronger-scoring rail on\n` +
      `this sample. Feed a larger/multi-session export to find disagreement rows.`
  );
}

// Grade both arms on each disagreement row.
const graded = [];
for (const c of considered) {
  const date = ymd(c.row.session_date ?? c.row.session ?? c.row.edition_for);
  const ticker = String(c.row.ticker ?? "").toUpperCase();
  if (!date || date.length !== 10 || !ticker) continue;
  const bars = await fetchMinuteBars(ticker, date);
  const gFlow = gradeDirection(bars, c.ff.dir);
  const gEvid = gradeDirection(bars, c.ew.dir);
  if (!gFlow || !gEvid) continue; // no bars → can't grade this row either way
  graded.push({ date, ticker, ...c, gFlow, gEvid });
}

if (graded.length === 0) {
  insufficient(
    `${considered.length} disagreement row(s) found, but NONE could be graded — Polygon returned no usable\n` +
      `minute bars for their (ticker, session_date). Check the export's dates are real RTH sessions.`
  );
}

const flowArm = graded.map((g) => ({ win: g.gFlow.win }));
const evidArm = graded.map((g) => ({ win: g.gEvid.win }));
const flowWR = rate(flowArm);
const evidWR = rate(evidArm);
const flips = graded.filter((g) => g.gFlow.win !== g.gEvid.win);
const evidWon = flips.filter((g) => g.gEvid.win && !g.gFlow.win).length;
const flowWon = flips.filter((g) => g.gFlow.win && !g.gEvid.win).length;

if (JSON_OUT) {
  console.log(
    JSON.stringify(
      {
        ok: true,
        merge_policy_version: MERGE_POLICY_VERSION,
        rows_read: rows.length,
        single_origin: singleOrigin,
        multi_origin_agree: agree,
        missing_maps: missingMaps,
        stale_version_rows: staleVersion,
        disagreement_rows: considered.length,
        graded_rows: graded.length,
        flow_first_win_rate: flowWR,
        evidence_weighted_win_rate: evidWR,
        rows_where_arms_diverged: flips.length,
        evidence_weighted_uniquely_won: evidWon,
        flow_first_uniquely_won: flowWon,
        detail: graded.map((g) => ({
          date: g.date,
          ticker: g.ticker,
          flow_first: { owner: g.ff.owner, dir: g.ff.dir, win: g.gFlow.win },
          evidence_weighted: { owner: g.ew.owner, dir: g.ew.dir, score: g.ew.score, win: g.gEvid.win },
        })),
      },
      null,
      2
    )
  );
  process.exit(0);
}

console.log(`\n=== MERGE-PRECEDENCE A/B — FLOW-first vs evidence-weighted (policy ${MERGE_POLICY_VERSION}) ===`);
console.log(
  `rows read ${rows.length} · single-origin ${singleOrigin} · multi-origin agree ${agree} · missing maps ${missingMaps}` +
    (staleVersion ? ` · ${staleVersion} row(s) frozen under a DIFFERENT policy version (still graded, flagged)` : "")
);
console.log(
  `DISAGREEMENT rows (the two precedences chose different directions): ${considered.length}; graded on bars: ${graded.length}\n`
);
console.log(`grade: favorable-first proxy — ±${pct(FAV)}/∓${pct(ADV)}, entry ${String(argv.entry ?? "10:00")} ET, real minute bars\n`);
console.log(`FLOW-first        win-rate = ${pct(flowWR)}  (n=${graded.length})`);
console.log(`evidence-weighted win-rate = ${pct(evidWR)}  (n=${graded.length})`);
console.log(`\nrows where the arms' OUTCOMES diverged: ${flips.length}  (evidence-weighted uniquely won ${evidWon}, FLOW-first uniquely won ${flowWon})`);
for (const g of flips.slice(0, 20)) {
  console.log(
    `  · ${g.date} ${g.ticker.padEnd(6)} FLOW-first ${g.ff.owner}/${g.ff.dir}=${g.gFlow.win ? "WIN " : "loss"}  ` +
      `evidence ${g.ew.owner}/${g.ew.dir}(score ${g.ew.score})=${g.gEvid.win ? "WIN" : "loss"}`
  );
}
if (flowWR != null && evidWR != null) {
  const verdict =
    evidWR > flowWR
      ? "⚠ evidence-weighted precedence graded BETTER on the disagreement rows — worth a calibrated revisit of the FLOW-first order."
      : evidWR < flowWR
        ? "FLOW-first held up — the incumbent-wins order graded at least as well as evidence-weighting here."
        : "dead heat — no measured edge either way on this sample.";
  console.log(`\nVerdict: ${verdict}`);
}
console.log(`\n(A/B PROBE — underlying-continuation proxy on already-committed rows, not exact option P&L. Evidence for a precedence decision, not a gate. No production behavior touched.)`);
