/**
 * Vector play-narrative invariant audit — many tickers x DTE horizons x timeframes, one run.
 *
 * WHY THIS EXISTS. The live NVDA capture (2026-08-09) showed the right-hand play panel saying
 * "sell rips 225" while listing "magnet 226.08" as a target — sell here, target above here. Not a
 * rendering bug and not stale data: a play whose own parts disagreed. Every individual number was
 * correct, which is exactly why nothing caught it. This asserts the RELATIONSHIPS a play must
 * satisfy to be coherent, across every combination the desk serves.
 *
 * HOW IT GETS A PLAY. There is no /api/market/vector/play — buildVectorPlay runs CLIENT-SIDE in
 * VectorChart.tsx. So this fetches the real INPUTS from the real endpoints and calls the REAL
 * production buildVectorPlay on them. It never reimplements the engine; a reimplementation would
 * drift and start certifying itself.
 *
 * Run with:  node --import tsx scripts/audit/vector-play-invariants.mjs
 * READ-ONLY. One temp Clerk member for the whole run, deleted in a finally (FAPI is rate-limited).
 */
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";
import { buildVectorPlay } from "../../src/features/vector/lib/vector-play-engine.ts";
// The chart derives regime/magnet/proximity from walls+flip before calling the engine. The harness
// must do the same, with the SAME functions — see the "the audit was vacuous" note below.
import { deriveVectorRegime } from "../../src/features/vector/lib/vector-regime.ts";
import { deriveGammaMagnet } from "../../src/features/vector/lib/vector-gamma-magnet.ts";
import { deriveWallProximity } from "../../src/features/vector/lib/vector-wall-proximity.ts";

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const TICKERS = (process.env.AUDIT_TICKERS || "SPX,SPY,QQQ,NVDA,TSLA,AAPL,AMD,META").split(",");
const HORIZONS = (process.env.AUDIT_HORIZONS || "0dte,weekly,monthly").split(",");
const TIMEFRAMES = (process.env.AUDIT_TIMEFRAMES || "3,15,60").split(",").map(Number);

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Each invariant describes a way a play contradicts ITSELF. Deliberately no strategy opinions — a
 * rule encoding a view about what the play *should* say would fire constantly and get ignored,
 * which is worse than no rule at all.
 */
const INVARIANTS = [
  {
    name: "walls-ordered",
    check: (s) => {
      const c = num(s.gexWalls?.callWalls?.[0]?.strike);
      const p = num(s.gexWalls?.putWalls?.[0]?.strike);
      return c != null && p != null && c < p ? `call wall ${c} is BELOW put wall ${p}` : null;
    },
  },
  {
    name: "range-mean-inside-rails",
    check: (s, play) => {
      if (play?.bias !== "range") return null;
      const c = num(s.gexWalls?.callWalls?.[0]?.strike);
      const p = num(s.gexWalls?.putWalls?.[0]?.strike);
      // The headline names the mean-revert level; a range play must not aim outside its own rails.
      const m = /([\d,]+\.?\d*)\s+(magnet|max pain|range mid|call wall|put wall)/.exec(play.headline ?? "");
      const lvl = m ? Number(m[1].replace(/,/g, "")) : null;
      if (lvl == null) return null;
      if (c != null && lvl > c) return `range mean ${lvl} is ABOVE call wall ${c} (headline: ${play.headline})`;
      if (p != null && lvl < p) return `range mean ${lvl} is BELOW put wall ${p} (headline: ${play.headline})`;
      return null;
    },
  },
  {
    name: "target-is-not-an-entry",
    check: (s, play) => {
      // "Sell rips 225" over "TARGETS call wall 225" — the second form of the NVDA contradiction.
      // A level you were just told to enter at cannot also be where you take profit.
      //
      // Only numbers PLAUSIBLY a price count. These strings carry non-price digits — "1σ 778.07",
      // "long on 1H close > 775" — and a naive tokenizer matched the sigma prefix against the
      // timeframe label and reported three phantom failures. Anchoring to spot is the honest
      // filter: an entry or target is a level on this instrument, not a label.
      const spot = num(s?.spot);
      const isPrice = (n) => spot == null || (n > spot * 0.5 && n < spot * 2);
      const prices = (txt) =>
        new Set(
          (String(txt ?? "").match(/[\d,]+\.?\d*/g) ?? [])
            .map((n) => n.replace(/,/g, ""))
            .filter((n) => isPrice(Number(n)))
        );
      const entries = prices(play?.entryZone);
      if (!entries.size) return null;
      for (const t of play?.targets ?? []) {
        for (const p of prices(t)) if (entries.has(p)) return `target "${t}" repeats entry level ${p} (entry: ${play.entryZone})`;
      }
      return null;
    },
  },
  {
    name: "targets-carry-a-price",
    check: (_s, play) =>
      (play?.targets ?? []).some((t) => typeof t === "string" && !/\d/.test(t))
        ? `a target carries no price: ${JSON.stringify(play.targets)}`
        : null,
  },
  {
    name: "levels-plausible-vs-spot",
    check: (s) => {
      const spot = num(s.spot);
      if (spot == null) return null;
      const pairs = [
        ["gamma flip", num(s.gammaFlip)],
        ["call wall", num(s.gexWalls?.callWalls?.[0]?.strike)],
        ["put wall", num(s.gexWalls?.putWalls?.[0]?.strike)],
        ["magnet", num(s.magnet?.strike)],
        ["max pain", num(s.maxPain)],
      ];
      for (const [label, v] of pairs) {
        // An order-of-magnitude gap means another underlying's levels leaked into this snapshot.
        if (v != null && (v > spot * 3 || v < spot / 3)) return `${label} ${v} implausible vs spot ${spot}`;
      }
      return null;
    },
  },
  {
    name: "play-produced",
    check: (_s, play) => (play == null ? "buildVectorPlay returned nothing for a snapshot with spot" : null),
  },
];

/**
 * AUTH EXPIRY MUST NOT LOOK LIKE "NO DATA".
 *
 * This used to be `return r.ok ? await r.json() : null`, and `snapshotFor` turns a null into a
 * "no snapshot" row, which the report explicitly does NOT count as a failure. So a run whose Clerk
 * token expired half way through printed a wall of harmless-looking skips and exited 0.
 *
 * That is not hypothetical. Measured 2026-08-09: the `__session` JWT this harness mints is dead
 * between t+61s and t+72s, and continuous requests do not extend it — a fixed lifetime, not an
 * idle timeout. Any sweep that runs longer than about a minute is losing its authentication
 * partway, and the previous shape could not tell that apart from a genuinely empty ticker.
 *
 * 401/403 are therefore recorded and escalated to a RUN failure by the caller. A real HTTP error
 * (500, timeout) is still tolerated per-combination — that is legitimately "this one had no data".
 */
const httpStats = { ok: 0, unauthorized: 0, refreshed: 0, otherError: 0, firstUnauthorizedAtMs: null };
const RUN_STARTED_AT = Date.now();

/** Active Clerk session — refreshed automatically when the ~72s JWT expires mid-sweep. */
let activeSession = null;

async function ensureSession() {
  if (activeSession) return activeSession;
  const minted = await mintClerkPremiumSession({ appUrl: BASE });
  if (minted.skip) return null;
  activeSession = minted;
  return activeSession;
}

async function json(path) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const session = await ensureSession();
    if (!session) return null;
    try {
      const r = await fetch(`${BASE}${path}`, { headers: { Cookie: session.cookieHeader } });
      if (r.status === 401 || r.status === 403) {
        httpStats.unauthorized++;
        if (httpStats.firstUnauthorizedAtMs == null) {
          httpStats.firstUnauthorizedAtMs = Date.now() - RUN_STARTED_AT;
        }
        await session.cleanup();
        activeSession = null;
        const refreshed = await ensureSession();
        if (!refreshed) return null;
        httpStats.refreshed++;
        continue;
      }
      if (!r.ok) {
        httpStats.otherError++;
        return null;
      }
      httpStats.ok++;
      return await r.json();
    } catch {
      httpStats.otherError++;
      return null;
    }
  }
  return null;
}

async function snapshotFor(ticker, horizon, timeframeMin) {
  const t = encodeURIComponent(ticker);
  const [walls, ladder, maxPain, em] = await Promise.all([
    json(`/api/market/vector/walls?ticker=${t}&dte=${horizon}`),
    json(`/api/market/vector/gex-ladder?ticker=${t}&dte=${horizon}`),
    json(`/api/market/vector/max-pain?ticker=${t}&dte=${horizon}`),
    json(`/api/market/vector/expected-move?ticker=${t}&dte=${horizon}`),
  ]);
  const spot = num(ladder?.spot ?? walls?.spot);
  if (spot == null) return null;

  // THE HARNESS WAS VACUOUS UNTIL 2026-08-09. It read `walls.gammaFlip` / `walls.regime` /
  // `walls.magnet` / `walls.proximity`, none of which the /walls route returns — its payload is
  // `{ticker, horizon, walls, flip}`. Every field came back undefined, so the engine saw no flip
  // and no regime and returned bias="neutral" for all 24 combinations. The run was green because
  // it never reached the range/fade branches, which is exactly where the contradictions live.
  //
  // A green audit that cannot fail is worse than no audit. VectorChart derives these three from
  // walls+flip before calling the engine, so the harness now calls the SAME production functions —
  // same rule as buildVectorPlay: import the real thing, never reimplement it.
  const gexWalls = walls?.walls ?? walls?.gexWalls ?? null;
  const gammaFlip = num(walls?.flip ?? walls?.gammaFlip);
  const regime = deriveVectorRegime({
    spot,
    gammaFlip,
    topCallWall: num(gexWalls?.callWalls?.[0]?.strike),
    topPutWall: num(gexWalls?.putWalls?.[0]?.strike),
  });
  return {
    ticker,
    horizon,
    timeframeMin,
    spot,
    regime,
    gexWalls,
    gammaFlip,
    magnet: deriveGammaMagnet({ spot, walls: gexWalls, posture: regime?.posture }),
    proximity: deriveWallProximity({ spot, walls: gexWalls, gammaFlip }),
    // The route's envelope is `{ticker, horizon, expectedMove}` — the ExpectedMove (with `bands`)
    // is NESTED, not the response body. Reading `em.bands` off the envelope meant this was `null`
    // on every single row, so the audit never exercised any expectedMove-dependent path. That is
    // the same field whose unguarded access crashed the panel (#1958) — found by accident, not by
    // this harness. Unwrap, then still require the array: a mismatched object would test the
    // harness rather than production.
    expectedMove: Array.isArray(em?.expectedMove?.bands) ? em.expectedMove : null,
    maxPain: num(maxPain?.maxPain ?? maxPain?.strike),
    confluenceZones: null,
    wallIntegrity: null,
    technicals: null,
  };
}

const boot = await ensureSession();
if (!boot) {
  console.error(`SKIP: Clerk session unavailable`);
  process.exit(2);
}

const results = [];
try {
  for (const ticker of TICKERS) {
    for (const horizon of HORIZONS) {
      for (const tf of TIMEFRAMES) {
        const snap = await snapshotFor(ticker, horizon, tf);
        if (!snap) {
          results.push({ ticker, horizon, tf, noData: true });
          continue;
        }
        let play = null;
        let engineError = null;
        try {
          play = buildVectorPlay(snap);
        } catch (e) {
          engineError = String(e.message).slice(0, 160);
        }
        results.push({ ticker, horizon, tf, snap, play, engineError });
      }
    }
  }
} finally {
  if (activeSession) await activeSession.cleanup();
  activeSession = null;
  console.error("temp Clerk user deleted");
}

let failures = 0;
let noData = 0;
console.log(`\n=== VECTOR PLAY INVARIANTS — ${TICKERS.length} tickers x ${HORIZONS.length} horizons x ${TIMEFRAMES.length} timeframes\n`);
for (const r of results) {
  const tag = `${r.ticker.padEnd(6)} ${r.horizon.padEnd(8)} ${String(r.tf).padStart(3)}m`;
  if (r.noData) {
    noData++;
    console.log(`  --   ${tag} no snapshot (no spot)`);
    continue;
  }
  if (r.engineError) {
    failures++;
    console.log(`  FAIL ${tag} engine threw: ${r.engineError}`);
    continue;
  }
  const broken = [];
  for (const inv of INVARIANTS) {
    const msg = inv.check(r.snap, r.play);
    if (msg) broken.push(`${inv.name}: ${msg}`);
  }
  if (broken.length) {
    failures += broken.length;
    console.log(`  FAIL ${tag} bias=${r.play?.bias}`);
    for (const b of broken) console.log(`         ${b}`);
  } else {
    console.log(`  ok   ${tag} bias=${String(r.play?.bias ?? "-").padEnd(16)} spot=${r.snap.spot}`);
  }
}
console.log(`\ninvariant failures: ${failures}`);
console.log(`combinations with no snapshot: ${noData}${noData ? " (off-hours or unsupported horizon — NOT counted as a failure)" : ""}`);
console.log(`http: ${httpStats.ok} ok · ${httpStats.unauthorized} unauthorized · ${httpStats.refreshed} refreshed · ${httpStats.otherError} other-error`);

if (httpStats.unauthorized > 0 && httpStats.refreshed === 0) {
  const at = (httpStats.firstUnauthorizedAtMs / 1000).toFixed(0);
  console.log(
    `\nRUN INVALID: ${httpStats.unauthorized} request(s) came back 401/403, first at t+${at}s, and session refresh did not recover.\n` +
      `Check Clerk secrets and retry with a narrower AUDIT_TICKERS set if needed.`
  );
  process.exit(2);
}
process.exit(failures > 0 ? 1 : 0);
