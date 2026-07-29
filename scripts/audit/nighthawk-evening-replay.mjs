/**
 * NIGHT HAWK LEGACY — evening edition date replay + score-floor counterfactual.
 *
 * Answers:
 *   "If we'd set MIN_PUBLISH_SCORE to N on this session, would the book empty?"
 *   "What would buildEveningEdition produce for --as-of=YYYY-MM-DD?" (dry-run, no DB write)
 *
 * Modes:
 *   --mode=floor (default, offline) — read a scored-plays fixture (or stdin JSON) and report
 *     clearing counts at floors 35/42/50/55/65. No network.
 *   --mode=live — call buildEveningEdition({ asOfEt, dryRun:true }). Needs UW/Polygon keys.
 *     Historical asOfEt always dry-runs unless --persist=1 (dangerous; not for probes).
 *
 * Flags:
 *   --as-of=YYYY-MM-DD   session date (ET); edition_for = next trading day
 *   --fixture=<path.json>  { plays:[{score,...}] } or [{score}] for floor mode
 *   --floors=35,42,50,55,65
 *   --mode=floor|live
 *   --json --quiet
 *   --persist=1   (live only) allow DB write when asOfEt set — admin recovery, not probes
 *
 * Run:
 *   node --import tsx scripts/audit/nighthawk-evening-replay.mjs --mode=floor --fixture=...
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *     node --import tsx scripts/audit/nighthawk-evening-replay.mjs --mode=live --as-of=2026-07-28
 *
 * Exit: 0 ok, 2 bad args / missing fixture, 1 live build not-ok.
 */
import { readFileSync } from "node:fs";

const SRC = new URL("../../src/", import.meta.url).pathname;

const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? "true"] : [a, "true"];
  })
);

const MODE = String(argv.mode ?? "floor");
const JSON_OUT = argv.json === true || argv.json === "true";
const QUIET = argv.quiet === true || argv.quiet === "true";
const FLOORS = String(argv.floors ?? "35,42,50,55,65")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n) && n > 0);

function log(...args) {
  if (!QUIET && !JSON_OUT) console.log(...args);
}

function loadScored(path) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const plays = Array.isArray(raw) ? raw : raw.plays ?? raw.scored ?? [];
  if (!Array.isArray(plays)) throw new Error("fixture must be an array or {plays|scored:[]}");
  return plays.map((p) => ({
    ticker: p.ticker ?? null,
    score: Number(p.score ?? 0),
    direction: p.direction ?? null,
  }));
}

async function runFloor() {
  const { countClearingScoreFloor } = await import(
    `${SRC}features/nighthawk/lib/flow-polarity.ts`
  );
  const { MIN_PUBLISH_SCORE } = await import(`${SRC}features/nighthawk/lib/constants.ts`);

  const fixture = argv.fixture;
  if (!fixture || fixture === true) {
    console.error("--fixture=<path.json> required for --mode=floor");
    process.exit(2);
  }
  const scored = loadScored(String(fixture));
  const byFloor = FLOORS.map((floor) => ({
    floor,
    ...countClearingScoreFloor(scored, floor),
    empty_book: countClearingScoreFloor(scored, floor).clearing === 0,
  }));
  const out = {
    mode: "floor",
    shipped_floor: MIN_PUBLISH_SCORE,
    n: scored.length,
    by_floor: byFloor,
    tickers: scored.map((s) => ({ ticker: s.ticker, score: s.score, direction: s.direction })),
  };
  if (JSON_OUT) console.log(JSON.stringify(out, null, 2));
  else {
    log(`Night Hawk Legacy score-floor counterfactual — n=${scored.length} (shipped floor=${MIN_PUBLISH_SCORE})`);
    for (const row of byFloor) {
      log(
        `  floor ${String(row.floor).padStart(3)} → ${row.clearing}/${row.total} clear` +
          (row.empty_book ? "  EMPTY BOOK" : "")
      );
    }
  }
  return 0;
}

async function runLive() {
  const asOf = argv["as-of"] ?? argv.asOf ?? argv.grade ?? argv.date;
  if (!asOf || asOf === true) {
    console.error("--as-of=YYYY-MM-DD required for --mode=live");
    process.exit(2);
  }
  const persist = argv.persist === true || argv.persist === "1" || argv.persist === "true";
  const { buildEveningEdition } = await import(
    `${SRC}features/nighthawk/lib/edition-builder.ts`
  );
  const { nextTradingDayEt } = await import(`${SRC}features/nighthawk/lib/session.ts`);
  const { countClearingScoreFloor } = await import(
    `${SRC}features/nighthawk/lib/flow-polarity.ts`
  );
  const { MIN_PUBLISH_SCORE } = await import(`${SRC}features/nighthawk/lib/constants.ts`);

  const sessionEt = String(asOf);
  const editionFor = nextTradingDayEt(sessionEt);
  log(`Live dry-run buildEveningEdition session=${sessionEt} edition_for=${editionFor} persist=${persist}`);

  const result = await buildEveningEdition({
    force: true,
    asOfEt: sessionEt,
    dryRun: !persist,
    persist,
  });

  const plays = result.plays ?? [];
  const byFloor = FLOORS.map((floor) => ({
    floor,
    ...countClearingScoreFloor(plays, floor),
    empty_book: countClearingScoreFloor(plays, floor).clearing === 0,
  }));

  const out = {
    mode: "live",
    session_et: sessionEt,
    edition_for: editionFor,
    dry_run: !persist,
    result: {
      ok: result.ok,
      plays_count: result.plays_count,
      candidates: result.candidates,
      recap_only: result.recap_only ?? false,
      job_status: result.job_status,
      duration_ms: result.duration_ms,
      error: result.error,
    },
    shipped_floor: MIN_PUBLISH_SCORE,
    plays: plays.map((p) => ({
      ticker: p.ticker,
      direction: p.direction,
      score: p.score,
      conviction: p.conviction,
    })),
    by_floor: byFloor,
  };
  if (JSON_OUT) console.log(JSON.stringify(out, null, 2));
  else {
    log(
      `  ok=${result.ok} plays=${result.plays_count} candidates=${result.candidates}` +
        (result.recap_only ? " RECAP_ONLY" : "") +
        (result.error ? ` error=${result.error}` : "")
    );
    for (const row of byFloor) {
      log(
        `  floor ${String(row.floor).padStart(3)} → ${row.clearing}/${row.total} clear` +
          (row.empty_book ? "  EMPTY BOOK" : "")
      );
    }
  }
  return result.ok ? 0 : 1;
}

const code = MODE === "live" ? await runLive() : await runFloor();
process.exit(code);
