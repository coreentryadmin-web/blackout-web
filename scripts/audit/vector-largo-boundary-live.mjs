/**
 * VECTOR-FOR-LARGO boundary probe — live, read-only, against PRODUCTION.
 *
 * Confirms on the real deployment the three things the offline measurements asserted:
 *
 *  1. `/api/market/vector/expected-move` serves `movePct` as a real FRACTION (it passes
 *     VECTOR_FRACTION_DP), and shows what the same number becomes under the BIE boundary's
 *     bare `roundFloats(dp=2)` — the two disagree, and that disagreement IS the defect.
 *  2. The wall-history rail off-hours: an empty rail before the open is the recorder working
 *     as designed, not missing data (the premise behind `wall_history_empty_reason`).
 *  3. The walls/flip surface is live, so an empty rail cannot be blamed on a dead ticker.
 *
 * READ-ONLY: only GETs. One temp Clerk user, released in a `finally`.
 * Run from the repo root:
 *   node --import tsx scripts/audit/vector-largo-boundary-live.mjs [--tickers=SPX,NVDA] [--json]
 */
import { fetchAuditJson, releaseAuditClerkSession } from "./lib/audit-auth-fetch.mjs";
import { roundFloats } from "../../src/lib/round-floats.ts";
import { VECTOR_FRACTION_DP } from "../../src/features/vector/lib/vector-response-rounding.ts";
import { todayEtYmd } from "../../src/lib/providers/spx-session.ts";

const BASE = process.env.VALIDATE_BASE || "https://blackouttrades.com";
const args = process.argv.slice(2);
const flag = (n, d) => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.split("=").slice(1).join("=") : d;
};
const TICKERS = flag("tickers", "SPX,NVDA,SPY").split(",").map((t) => t.trim()).filter(Boolean);
const JSON_OUT = args.includes("--json");
/** The rail is per-session; the route cannot resolve one for you. Default to today ET. */
const SESSION = flag("session", todayEtYmd());

const log = (...a) => { if (!JSON_OUT) console.log(...a); };

async function main() {
  const out = { base: BASE, at: new Date().toISOString(), tickers: {} };

  log(`\nVECTOR-for-Largo boundary probe — ${BASE}`);
  log(`run at ${out.at}\n`);

  for (const ticker of TICKERS) {
    const row = {};

    // 1. Expected move — the route path (correct) vs the BIE path (bare dp=2).
    const em = await fetchAuditJson(BASE, `/api/market/vector/expected-move?ticker=${ticker}`);
    if (em.ok && em.json && typeof em.json === "object") {
      const served = em.json.movePct ?? em.json?.expectedMove?.movePct ?? null;
      row.expected_move = {
        http: em.status,
        route_movePct: served,
        // What the SAME number becomes through the BIE boundary's default rounding.
        bie_boundary_movePct: served == null ? null : roundFloats({ movePct: served }).movePct,
        route_with_keydp: served == null ? null : roundFloats({ movePct: served }, 2, VECTOR_FRACTION_DP).movePct,
        atm_iv: em.json.atmIv ?? null,
      };
    } else {
      row.expected_move = { http: em.status, error: "no expected-move payload" };
    }

    // 2. Wall-history rail — the bead trail.
    //
    // `session` IS REQUIRED and its absence is NOT an error: the route returns `history: []`
    // with HTTP 200 when it is missing ("A missing session can't be resolved to a rail here —
    // the chart owns the displayed session date"). Omitting it therefore yields a clean,
    // confident, meaningless zero that looks exactly like an empty rail. The first version of
    // this probe did precisely that and reported "0 samples" against a desk whose chart was
    // visibly full of beads — the same green-probe false negative the 2026-08-19 bead-cadence
    // investigation warns about, in its other direction.
    const wh = await fetchAuditJson(
      BASE,
      `/api/market/vector/wall-history?ticker=${ticker}&session=${SESSION}`
    );
    const history = Array.isArray(wh.json?.history) ? wh.json.history : null;
    row.wall_history = {
      http: wh.status,
      session: wh.json?.sessionYmd ?? SESSION,
      samples: history ? history.length : null,
      // Guard against the failure above ever returning silently: a probe that did not ask for a
      // session must never be read as a measurement of the rail.
      measured: Boolean(SESSION) && history != null,
    };

    // 3. Walls — proves the ticker's dealer surface is live, so an empty rail is about the
    //    RECORDER's session gate and not about a dead symbol.
    const w = await fetchAuditJson(BASE, `/api/market/vector/walls?ticker=${ticker}`);
    row.walls = {
      http: w.status,
      call_walls: w.json?.walls?.callWalls?.length ?? w.json?.callWalls?.length ?? null,
      put_walls: w.json?.walls?.putWalls?.length ?? w.json?.putWalls?.length ?? null,
      gamma_flip: w.json?.gammaFlip ?? w.json?.flip ?? null,
    };

    out.tickers[ticker] = row;

    log(`── ${ticker} ──────────────────────────────`);
    const e = row.expected_move;
    if (e.route_movePct != null) {
      log(`  expected-move  route serves movePct = ${e.route_movePct}  (${(e.route_movePct * 100).toFixed(3)}%)`);
      log(`                 BIE boundary dp=2    = ${e.bie_boundary_movePct}   <-- what Largo received`);
      if (e.bie_boundary_movePct === 0) log(`                 *** SERVED AS ZERO ***`);
    } else {
      log(`  expected-move  HTTP ${e.http} — ${e.error ?? "no movePct"}`);
    }
    log(`  wall-history   HTTP ${row.wall_history.http}  session=${row.wall_history.session}  samples = ${row.wall_history.samples}${row.wall_history.measured ? "" : "  (NOT MEASURED — no session)"}`);
    log(`  walls          HTTP ${row.walls.http}  call=${row.walls.call_walls} put=${row.walls.put_walls} flip=${row.walls.gamma_flip}`);
    log("");
  }

  if (JSON_OUT) console.log(JSON.stringify(out, null, 2));
  return out;
}

main()
  .catch((e) => { console.error("probe failed:", e?.message ?? e); process.exitCode = 1; })
  .finally(() => releaseAuditClerkSession().catch(() => {}));
