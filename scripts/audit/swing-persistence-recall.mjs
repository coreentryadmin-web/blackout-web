#!/usr/bin/env node
// swing-persistence-recall.mjs — does the swing cross-session persistence gate
// (accumulation-store.ts's MIN_PERSISTENCE_SESSIONS=2, "provisional — never a graduated edge")
// actually protect edge, or does it just cost real winners a same-day entry?
//
// WHY THIS EXISTS: live-observed 2026-09-08, several TRIGGERED+AT_TRIGGER swing setups scoring
// 67-85 sat in RESEARCH all day, routed there ONLY because sectionForSwingPlay's persistence
// check fires before setup-state routing (serving.ts: "Persistence-observed ... -> RESEARCH").
// One of them (EWY) was already up +1.4% in the underlying hours after being blocked — a real,
// concrete instance of the gate costing a winner, not just protecting against noise. A single
// day's anecdote proves the MECHANISM exists but says nothing about whether it nets positive or
// negative across real sessions. This script measures that, mirroring the exact discipline
// discovery-recall-probe.mjs already established for the analogous 0DTE BREAKOUT_MAX_CANDIDATES
// question: split a real population into CLEARED vs BLOCKED cohorts by the gate's own predicate,
// grade both on REAL Polygon daily bars, and report which one actually performed better forward.
//
// DATA SOURCE: GET /api/admin/swing/accumulation-export (admin-gated) — every
// swing_candidate_accumulation row (ticker/direction/archetype/distinct_session_days/
// first_seen_at/promoted_position_id), both promoted AND still-pending. The persistence
// predicate below (meetsPersistence) is a COPY of accumulation-store.ts's own logic, not an
// import — same reasoning as print-window-eval.mjs's sibling copy: this is a plain .mjs script,
// no TS path aliases, so it mirrors the source and must be kept in lockstep with it.
//
// GRADING: for each row, pull the underlying's REAL Polygon daily bar on first_seen_at's own
// session day (the day it was scored/gated) and N trading days later, compute the direction-
// adjusted % move (favorable = long+up or short+down). This is a coarse proxy — no strike/decay/
// exit rule, same scope discipline helix-score-signal.mjs states for its own underlying-only
// grading — but it directly answers the one question at hand: does the SIGNAL underneath a
// gate-blocked name actually continue, on average, better or worse than a gate-cleared one?
//
// Flags: --days=N (accumulation lookback, default 30) --horizons=1,3,5 (trading days forward)
//        --base=<url> --min-n=<int, default 8> --json
import { fetchAuditJson, releaseAuditClerkSession } from "./lib/audit-auth-fetch.mjs";

// This sandbox sometimes ships POLYGON_API_BASE as the literal unresolved string
// "POLYGON_API_BASE" rather than leaving it unset — a plain `??` default doesn't catch that,
// so this must be a real-URL guard (same pattern as every other audit script's self-default).
const rawPolygonBase = process.env.POLYGON_API_BASE ?? "";
const POLYGON_API_BASE = (/^https?:\/\//.test(rawPolygonBase) ? rawPolygonBase : "https://api.polygon.io").replace(/\/$/, "");
const POLYGON_API_KEY = process.env.POLYGON_API_KEY ?? "";

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const BASE = arg("base", "https://blackouttrades.com");
const DAYS = Math.max(1, Number(arg("days", "30")) || 30);
const HORIZONS = (arg("horizons", "1,3,5") ?? "1,3,5")
  .split(",")
  .map((s) => Math.max(1, Number(s.trim()) || 0))
  .filter((n) => n > 0);
const MIN_N = Math.max(1, Number(arg("min-n", "8")) || 8);
const JSON_OUT = process.argv.includes("--json");

// ── mirrors taxonomy.ts's ARCHETYPE_PERSISTENCE + accumulation-store.ts's meetsPersistence ──
const ARCHETYPE_PERSISTENCE = {
  BREAKOUT: { minDistinctSessions: 2, requiresCorroboration: false },
  PULLBACK_CONTINUATION: { minDistinctSessions: 2, requiresCorroboration: false },
  MEAN_REVERSION: { minDistinctSessions: 2, requiresCorroboration: false },
  FLOW_ACCUMULATION: { minDistinctSessions: 2, requiresCorroboration: false },
  SECTOR_ROTATION: { minDistinctSessions: 2, requiresCorroboration: false },
  EVENT_DRIVEN: { minDistinctSessions: 1, requiresCorroboration: true },
  POST_EARNINGS_DRIFT: { minDistinctSessions: 1, requiresCorroboration: true },
  FAILED_BREAKDOWN: { minDistinctSessions: 1, requiresCorroboration: false },
};
const DEFAULT_RULE = { minDistinctSessions: 2, requiresCorroboration: false };

function persistenceRuleFor(archetype) {
  return ARCHETYPE_PERSISTENCE[archetype] ?? DEFAULT_RULE;
}

function hasCorroboration(row) {
  if (Number.isFinite(row.distinct_session_days) && row.distinct_session_days >= 2) return true;
  const kinds = new Set(row.last_session_signal_kinds ?? []);
  return kinds.size >= 2;
}

/** Pure copy of accumulation-store.ts's meetsPersistence — keep in lockstep with the source. */
export function meetsPersistence(row) {
  if (!Number.isFinite(row.distinct_session_days)) return false;
  const rule = persistenceRuleFor(row.archetype);
  if (!rule.requiresCorroboration) return row.distinct_session_days >= rule.minDistinctSessions;
  return row.distinct_session_days >= rule.minDistinctSessions && hasCorroboration(row);
}

/** CLEARED = actually promoted to a real position, OR the gate's own predicate says it could be. */
export function cohortFor(row) {
  if (row.promoted_position_id != null) return "CLEARED";
  return meetsPersistence(row) ? "CLEARED" : "BLOCKED";
}

async function polygonDailyClose(ticker, dateYmd) {
  const url = `${POLYGON_API_BASE}/v1/open-close/${encodeURIComponent(ticker)}/${dateYmd}?adjusted=true&apiKey=${POLYGON_API_KEY}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const d = await res.json();
    return typeof d.close === "number" ? d.close : null;
  } catch {
    return null;
  }
}

function addTradingDays(ymd, n) {
  const d = new Date(`${ymd}T00:00:00Z`);
  let added = 0;
  while (added < n) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d.toISOString().slice(0, 10);
}

async function gradeRow(row, horizon) {
  const day0 = row.first_seen_at.slice(0, 10);
  const dayN = addTradingDays(day0, horizon);
  if (new Date(dayN) > new Date()) return null; // horizon hasn't happened yet
  const [px0, pxN] = await Promise.all([
    polygonDailyClose(row.ticker, day0),
    polygonDailyClose(row.ticker, dayN),
  ]);
  if (px0 == null || pxN == null || px0 <= 0) return null;
  const movePct = ((pxN - px0) / px0) * 100;
  const favorable = row.direction === "long" ? movePct > 0 : movePct < 0;
  return { movePct: row.direction === "long" ? movePct : -movePct, favorable };
}

function summarize(graded) {
  const n = graded.length;
  if (n === 0) return { n: 0, winRate: null, avgMovePct: null };
  const wins = graded.filter((g) => g.favorable).length;
  const avg = graded.reduce((s, g) => s + g.movePct, 0) / n;
  return { n, winRate: Math.round((wins / n) * 1000) / 10, avgMovePct: Math.round(avg * 100) / 100 };
}

async function main() {
  if (!POLYGON_API_KEY) {
    console.error("POLYGON_API_KEY not set — cannot grade against real bars.");
    process.exit(1);
  }
  const { ok, status, json } = await fetchAuditJson(BASE, `/api/admin/swing/accumulation-export?days=${DAYS}`);
  if (!ok) {
    console.error(`accumulation-export fetch failed: HTTP ${status}`);
    process.exit(1);
  }
  const rows = Array.isArray(json.rows) ? json.rows : [];
  console.log(`Fetched ${rows.length} accumulation rows since ${json.since}`);

  const byCohort = { CLEARED: [], BLOCKED: [] };
  for (const row of rows) byCohort[cohortFor(row)].push(row);
  console.log(`CLEARED (cohort n=${byCohort.CLEARED.length}) vs BLOCKED (cohort n=${byCohort.BLOCKED.length})`);

  const report = { since: json.since, through: json.through, days: DAYS, horizons: {}, sample: [] };

  for (const horizon of HORIZONS) {
    const results = { CLEARED: [], BLOCKED: [] };
    for (const cohort of ["CLEARED", "BLOCKED"]) {
      for (const row of byCohort[cohort]) {
        const g = await gradeRow(row, horizon);
        if (g) {
          results[cohort].push(g);
          if (report.sample.length < 40) {
            report.sample.push({ cohort, horizon, ticker: row.ticker, direction: row.direction, ...g });
          }
        }
      }
    }
    report.horizons[`+${horizon}d`] = {
      CLEARED: summarize(results.CLEARED),
      BLOCKED: summarize(results.BLOCKED),
    };
  }

  console.log(JSON.stringify(report.horizons, null, 2));
  for (const [h, r] of Object.entries(report.horizons)) {
    const under = r.CLEARED.n < MIN_N || r.BLOCKED.n < MIN_N;
    const note = under ? "  [INSUFFICIENT SAMPLE — n below --min-n, do not trust this horizon]" : "";
    console.log(
      `${h}: CLEARED wr=${r.CLEARED.winRate}% avg=${r.CLEARED.avgMovePct}% (n=${r.CLEARED.n}) | ` +
        `BLOCKED wr=${r.BLOCKED.winRate}% avg=${r.BLOCKED.avgMovePct}% (n=${r.BLOCKED.n})${note}`
    );
  }

  if (JSON_OUT) console.log(JSON.stringify(report));
}

// Guard against running main() on import — swing-persistence-eval.test.mjs imports the pure
// meetsPersistence/cohortFor helpers above and must never trigger a live network fetch as a
// side effect of that import.
const isEntryPoint = import.meta.url === `file://${process.argv[1]}`;
if (isEntryPoint) {
  main()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => releaseAuditClerkSession());
}
