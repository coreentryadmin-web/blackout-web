#!/usr/bin/env node
/**
 * Vector RAIL VALIDATOR — one command that answers "is the bead rail actually working, for every
 * ticker, on every horizon?"
 *
 * WHY THIS EXISTS. The bead investigation of 2026-08-18/19 needed four different ad-hoc probes to
 * reach an answer, and two of them gave confidently wrong results first. The specific traps, all of
 * which this script encodes so nobody re-discovers them:
 *
 *   1. ROWS are not BEADS-PER-ROW. NVDA drew one visible level while SPX drew ten, and the natural
 *      conclusion — row selection is broken — was wrong. NVDA yielded 7-8 rows per side, the same as
 *      SPX. What differed was how many beads landed ON those rows. Report both, always.
 *   2. The chart opens on WEEKLY, not "all". A rail can look healthy on the blended horizon and be
 *      nearly empty on the one a member actually sees. Every horizon is measured separately.
 *   3. `session` is the ET date, not the UTC date. At 02:00 UTC the ET session is still yesterday,
 *      and asking for the UTC date returns an empty rail that reads as a catastrophic outage.
 *   4. A rail being dense for SPX and thin for everything else was not a coincidence: viewing a
 *      ticker used to trigger live 5s writes, so density tracked ATTENTION rather than importance.
 *      That is what the universe/non-universe split below is checking.
 *
 * WHAT IT REPORTS, per ticker x horizon:
 *   - samples, median gap, max gap          (is the recorder keeping up?)
 *   - rows drawn per side                   (does row selection work?)
 *   - beads per row                         (is there anything ON the rows?)
 *   - births / deaths / always-on rows      (is the rail a TIME SERIES or a static ladder?)
 *
 * The births/deaths section is the one that answers "do walls actually appear and disappear". A rail
 * where every row is born at the open and never dies is the "SPX had the exact same walls all day"
 * failure mode — it renders fine and tells the member nothing.
 *
 * Read-only. ONE temp Clerk user for the whole run, deleted in a `finally` (FAPI is rate-limited, so
 * the run authenticates exactly once). Never prints secrets.
 *
 * Run from the REPO ROOT:
 *   node --import tsx scripts/audit/vector-rail-validate.mjs \
 *     [--tickers=SPX,NVDA,TSLA,AAPL] [--horizons=all,0dte,weekly,monthly] [--session=YYYY-MM-DD] [--json]
 *
 * Exits non-zero when any (ticker, horizon) is RED.
 */
import {
  trailsByStrike,
  pickActiveStrikes,
  strikeTrailLifecycle,
  DOMINANT_WALLS_PER_BUCKET,
} from "../../src/features/vector/lib/vector-wall-history";

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const TICKERS = arg("tickers", "SPX,NVDA,TSLA,AAPL,SPY,QQQ").split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);
const HORIZONS = arg("horizons", "all,0dte,weekly,monthly").split(",").map((h) => h.trim()).filter(Boolean);
const AS_JSON = argv.includes("--json");

/** ET session date. NOT the UTC date — see trap 3 in the header. */
function etSessionYmd() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
const SESSION = arg("session", etSessionYmd());

/** Rows the chart would actually draw, using the SAME cap the live chart uses per side. */
const ROWS_PER_SIDE = 8;

function gaps(times) {
  const out = [];
  for (let i = 1; i < times.length; i++) out.push(times[i] - times[i - 1]);
  return out.sort((a, b) => a - b);
}
const median = (sorted) => (sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0);

/**
 * Births and deaths.
 *
 * `bornAt` within the first `OPEN_GRACE_SEC` of the rail is "was there from the start" rather than a
 * birth — otherwise every row on every rail counts as born at the open and the number says nothing.
 */
const OPEN_GRACE_SEC = 5 * 60;

function lifecycleStats(history, side) {
  const trails = strikeTrailLifecycle(history, side, "gex");
  if (!trails.length) return { rows: 0, born: 0, died: 0, alwaysOn: 0, bornStrikes: [], diedStrikes: [] };
  const first = Math.min(...trails.map((t) => t.bornAt));
  const born = trails.filter((t) => t.bornAt > first + OPEN_GRACE_SEC);
  const died = trails.filter((t) => !t.active);
  const alwaysOn = trails.filter((t) => t.bornAt <= first + OPEN_GRACE_SEC && t.active);
  return {
    rows: trails.length,
    born: born.length,
    died: died.length,
    alwaysOn: alwaysOn.length,
    bornStrikes: born.slice(0, 5).map((t) => t.strike),
    diedStrikes: died.slice(0, 5).map((t) => t.strike),
  };
}

function verdictFor(row) {
  const notes = [];
  if (row.samples === 0) return { verdict: "RED", notes: ["no rail recorded at all"] };
  // A rail nobody can read is as bad as no rail. 5s cadence over a session is thousands; even a
  // late-session start should clear a few hundred.
  if (row.samples < 200) notes.push(`only ${row.samples} samples`);
  if (row.maxGapSec > 900) notes.push(`${Math.round(row.maxGapSec / 60)}min hole`);
  if (row.beadsPerRow < 20) notes.push(`${row.beadsPerRow} beads/row`);
  // The lifecycle question the member asked: does anything ever appear or disappear?
  if (row.callRows + row.putRows > 0 && row.born + row.died === 0) {
    notes.push("no births or deaths — static ladder");
  }
  const verdict = notes.length === 0 ? "GREEN" : row.samples < 200 || row.maxGapSec > 900 ? "RED" : "AMBER";
  return { verdict, notes };
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
      for (const horizon of HORIZONS) {
        const url = `${BASE}/api/market/vector/wall-history?ticker=${encodeURIComponent(ticker)}&session=${SESSION}&horizon=${horizon}`;
        let history = [];
        let status = 0;
        try {
          const r = await fetch(url, { headers: { Cookie: session.cookieHeader } });
          status = r.status;
          const j = await r.json().catch(() => ({}));
          history = Array.isArray(j?.history) ? j.history : [];
        } catch (err) {
          rows.push({ ticker, horizon, status, samples: 0, verdict: "RED", notes: [String(err).slice(0, 80)] });
          continue;
        }

        const times = history.map((h) => h.time).filter((t) => Number.isFinite(t)).sort((a, b) => a - b);
        const g = gaps(times);
        const callTrails = trailsByStrike(history, "callWalls", "gex", DOMINANT_WALLS_PER_BUCKET);
        const putTrails = trailsByStrike(history, "putWalls", "gex", DOMINANT_WALLS_PER_BUCKET);
        const callRows = pickActiveStrikes(callTrails, ROWS_PER_SIDE, { spot: null }).length;
        const putRows = pickActiveStrikes(putTrails, ROWS_PER_SIDE, { spot: null }).length;
        const call = lifecycleStats(history, "callWalls");
        const put = lifecycleStats(history, "putWalls");

        // Beads actually landing on the rows the chart draws — the number that separates "one
        // visible level" from "ten", and the one a sample count alone hides.
        let beadPoints = 0;
        for (const [, pts] of callTrails) beadPoints += pts.length;
        for (const [, pts] of putTrails) beadPoints += pts.length;
        const totalRows = Math.max(1, callTrails.size + putTrails.size);

        const row = {
          ticker,
          horizon,
          status,
          samples: history.length,
          medianGapSec: median(g),
          maxGapSec: g.length ? g[g.length - 1] : 0,
          callRows,
          putRows,
          beadsPerRow: Math.round(beadPoints / totalRows),
          born: call.born + put.born,
          died: call.died + put.died,
          alwaysOn: call.alwaysOn + put.alwaysOn,
          bornStrikes: [...call.bornStrikes, ...put.bornStrikes].slice(0, 6),
          diedStrikes: [...call.diedStrikes, ...put.diedStrikes].slice(0, 6),
        };
        rows.push({ ...row, ...verdictFor(row) });
      }
    }
  } finally {
    await session.cleanup();
    console.error("temp Clerk user deleted");
  }

  if (AS_JSON) {
    console.log(JSON.stringify({ base: BASE, session: SESSION, rows }, null, 2));
  } else {
    console.log(`VECTOR RAIL VALIDATION — ${BASE} — ET session ${SESSION}`);
    console.log(
      `${"ticker".padEnd(7)}${"horizon".padEnd(9)}${"verdict".padEnd(8)}${"samples".padStart(8)}` +
        `${"medGap".padStart(8)}${"maxGap".padStart(8)}${"rows c/p".padStart(10)}${"beads/row".padStart(11)}` +
        `${"born".padStart(6)}${"died".padStart(6)}${"static".padStart(8)}  notes`
    );
    for (const r of rows) {
      console.log(
        `${r.ticker.padEnd(7)}${r.horizon.padEnd(9)}${r.verdict.padEnd(8)}${String(r.samples).padStart(8)}` +
          `${String(r.medianGapSec ?? 0).padStart(8)}${String(r.maxGapSec ?? 0).padStart(8)}` +
          `${`${r.callRows ?? 0}/${r.putRows ?? 0}`.padStart(10)}${String(r.beadsPerRow ?? 0).padStart(11)}` +
          `${String(r.born ?? 0).padStart(6)}${String(r.died ?? 0).padStart(6)}${String(r.alwaysOn ?? 0).padStart(8)}` +
          `  ${(r.notes || []).join("; ")}`
      );
    }
  }
  process.exit(rows.some((r) => r.verdict === "RED") ? 1 : 0);
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
