#!/usr/bin/env node
/**
 * Vector ROW-RENDER probe — why does the CHART draw one bead row where the DATA has eight?
 *
 * WHY THIS EXISTS. `vector-rail-validate.mjs` reports rows off the raw wall-history payload and has
 * consistently said NVDA/TSLA/AAPL yield 6-8 rows per side, the same as SPX. The rendered chart says
 * otherwise: measured on prod 2026-08-19 at the `structure` zoom, SPX painted ~12 rows and NVDA
 * painted exactly ONE. Both cannot be right, and the difference is everything the member has been
 * asking about ("Why does nvda have only one level? While spx has 10-12 levels??").
 *
 * The gap between the two is the CLIENT pipeline, which the validator does not run:
 *
 *     bucketWallHistoryForInterval(history, tf, {minBucketSec, liveBeads, barSpacingPx})
 *       -> strikeTrailLifecycle(bucketed, side, lens)
 *         -> pickActiveStrikes(trailMap, wallCountForTimeframe(tf), {spot})
 *
 * Three stages that can each silently collapse a rail, and the validator skips all three: it reads
 * raw samples, uses a fixed row cap, and passes `spot: null`. So it measures what the SERVER has,
 * not what the CHART draws. This probe runs the REAL production functions, in the REAL order, with
 * a REAL spot and a REAL bar spacing, and prints the row count SURVIVING EACH STAGE — so the stage
 * that eats the rows names itself instead of being guessed at.
 *
 * Read-only. ONE temp Clerk user for the whole run, deleted in a `finally`. Never prints secrets.
 *
 * Run from the REPO ROOT:
 *   node --import tsx scripts/audit/vector-row-render-probe.mjs \
 *     [--tickers=SPX,NVDA] [--horizons=weekly,0dte] [--tf=3] [--spacing=9] [--session=YYYY-MM-DD] [--json]
 */
import {
  bucketWallHistoryForInterval,
  strikeTrailLifecycle,
  pickActiveStrikes,
  DOMINANT_WALLS_PER_BUCKET,
} from "../../src/features/vector/lib/vector-wall-history";
import { wallCountForTimeframe } from "../../src/features/vector/lib/vector-bar-timeframes";
import { VECTOR_WALL_TRAIL_SEC } from "../../src/features/vector/lib/vector-cadence";

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const TICKERS = arg("tickers", "SPX,NVDA,TSLA,AAPL").split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);
const HORIZONS = arg("horizons", "weekly,0dte").split(",").map((h) => h.trim()).filter(Boolean);
/** Candle timeframe in minutes — the chart's own default view. */
const TF = Number(arg("tf", "3"));
/** px per bar. The measured live value at 1440-1920 wide on the intraday presets is ~5-12. */
const SPACING = Number(arg("spacing", "9"));
const AS_JSON = argv.includes("--json");

function etSessionYmd() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
const SESSION = arg("session", etSessionYmd());

/** Walls carried per sample, per side — the ceiling every later stage inherits. */
function wallsPerSample(history, side) {
  const counts = history.map((s) => (Array.isArray(s?.walls?.[side]) ? s.walls[side].length : 0));
  if (!counts.length) return { min: 0, median: 0, max: 0 };
  const sorted = [...counts].sort((a, b) => a - b);
  return { min: sorted[0], median: sorted[Math.floor(sorted.length / 2)], max: sorted[sorted.length - 1] };
}

/** Distinct strikes present ANYWHERE in the samples — the upper bound on drawable rows. */
function distinctStrikes(history, side) {
  const set = new Set();
  for (const s of history) for (const w of s?.walls?.[side] ?? []) if (Number.isFinite(w?.strike)) set.add(w.strike);
  return set;
}

async function main() {
  const { mintClerkPremiumSession } = await import("./lib/prod-clerk-session.mjs");
  const session = await mintClerkPremiumSession({ appUrl: BASE });
  if (session.skip) {
    console.error(`SKIP: ${session.reason}`);
    process.exit(2);
  }

  const rows = [];
  try {
    for (const ticker of TICKERS) {
      // Spot matters: pickActiveStrikes PROMOTES rows within NEAR_SPOT_ROW_BAND_PCT of it, and the
      // band is a fraction of price — so the same 2% admits ~25 SPX strikes and ~1 NVDA strike.
      // Passing null (as the rail validator does) hides that entirely.
      let spot = null;
      try {
        const r = await fetch(`${BASE}/api/market/vector/quote?ticker=${encodeURIComponent(ticker)}`, {
          headers: { Cookie: session.cookieHeader },
        });
        const j = await r.json().catch(() => ({}));
        const raw = j?.price ?? j?.spot ?? j?.last ?? j?.quote?.price;
        if (Number.isFinite(Number(raw)) && Number(raw) > 0) spot = Number(raw);
      } catch {
        /* spot is diagnostic, not required — the run reports `spot=null` rather than failing */
      }

      for (const horizon of HORIZONS) {
        const url = `${BASE}/api/market/vector/wall-history?ticker=${encodeURIComponent(ticker)}&session=${SESSION}&horizon=${horizon}`;
        const r = await fetch(url, { headers: { Cookie: session.cookieHeader } });
        const j = await r.json().catch(() => ({}));
        const history = Array.isArray(j?.history) ? j.history : [];

        for (const side of ["callWalls", "putWalls"]) {
          const bucketed = bucketWallHistoryForInterval(history, TF, {
            minBucketSec: VECTOR_WALL_TRAIL_SEC,
            liveBeads: true,
            barSpacingPx: SPACING,
          });
          const lifecycle = strikeTrailLifecycle(bucketed, side, "gex");
          const trailMap = new Map(lifecycle.map((t) => [t.strike, t.points]));
          const cap = wallCountForTimeframe(TF);
          const drawn = pickActiveStrikes(trailMap, cap, { spot });
          rows.push({
            ticker,
            horizon,
            side: side === "callWalls" ? "call" : "put",
            spot,
            samples: history.length,
            bucketed: bucketed.length,
            wallsPerSample: wallsPerSample(history, side),
            distinctStrikes: distinctStrikes(history, side).size,
            trails: lifecycle.length,
            cap,
            drawn: drawn.length,
            strikes: drawn.slice(0, 12),
          });
        }
      }
    }
  } finally {
    await session.cleanup();
    console.error("temp Clerk user deleted");
  }

  if (AS_JSON) {
    console.log(JSON.stringify({ base: BASE, session: SESSION, tf: TF, spacingPx: SPACING, rows }, null, 2));
  } else {
    console.log(
      `ROW-RENDER PROBE — ${BASE} — ET ${SESSION} — tf=${TF}m spacing=${SPACING}px ` +
        `dominant/bucket=${DOMINANT_WALLS_PER_BUCKET}`
    );
    console.log(
      `${"ticker".padEnd(7)}${"horizon".padEnd(9)}${"side".padEnd(6)}${"spot".padStart(9)}` +
        `${"samples".padStart(9)}${"bucketed".padStart(10)}${"walls/smpl".padStart(12)}` +
        `${"strikes".padStart(9)}${"trails".padStart(8)}${"cap".padStart(5)}${"DRAWN".padStart(7)}  strikes`
    );
    for (const r of rows) {
      console.log(
        `${r.ticker.padEnd(7)}${r.horizon.padEnd(9)}${r.side.padEnd(6)}` +
          `${String(r.spot ?? "—").padStart(9)}${String(r.samples).padStart(9)}${String(r.bucketed).padStart(10)}` +
          `${`${r.wallsPerSample.min}/${r.wallsPerSample.median}/${r.wallsPerSample.max}`.padStart(12)}` +
          `${String(r.distinctStrikes).padStart(9)}${String(r.trails).padStart(8)}${String(r.cap).padStart(5)}` +
          `${String(r.drawn).padStart(7)}  ${r.strikes.join(",")}`
      );
    }
  }
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
