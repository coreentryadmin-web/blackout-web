import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  computeCandidateForwardReturns,
  nearestBarClose,
  rawForwardReturnPct,
  FORWARD_HORIZON_MINUTES,
  type MinuteBar,
} from "./candidate-forward-grade";

const MIN = 60_000;
const BASE_T = 1_700_000_000_000; // arbitrary fixed epoch ms, 1-minute-aligned for readability

function bar(minuteOffset: number, close: number, overrides: Partial<MinuteBar> = {}): MinuteBar {
  return { t: BASE_T + minuteOffset * MIN, o: close, h: close, l: close, c: close, ...overrides };
}

// ── nearestBarClose ──────────────────────────────────────────────────────────────

test("nearestBarClose: exact match returns that bar's close", () => {
  const bars = [bar(0, 100), bar(1, 101), bar(2, 102)];
  assert.equal(nearestBarClose(bars, BASE_T + 1 * MIN), 101);
});

test("nearestBarClose: picks the closest bar within tolerance when there's no exact match", () => {
  const bars = [bar(0, 100), bar(5, 105)];
  // target at minute 4 -- 1 min from bar(5), 4 min from bar(0) -- closer to bar(5)
  assert.equal(nearestBarClose(bars, BASE_T + 4 * MIN), 105);
});

test("nearestBarClose: beyond the tolerance window returns null, never the nearest-at-any-distance bar", () => {
  const bars = [bar(0, 100)];
  assert.equal(nearestBarClose(bars, BASE_T + 30 * MIN, 10), null);
});

test("nearestBarClose: empty bars array returns null", () => {
  assert.equal(nearestBarClose([], BASE_T), null);
});

test("nearestBarClose: a bar with a non-finite timestamp is skipped, not treated as a match", () => {
  const bars: MinuteBar[] = [{ t: undefined, o: 999, h: 999, l: 999, c: 999 }, bar(0, 100)];
  assert.equal(nearestBarClose(bars, BASE_T), 100);
});

test("nearestBarClose: a bar with a zero/negative close is not a usable price", () => {
  const bars = [bar(0, 0)];
  assert.equal(nearestBarClose(bars, BASE_T), null);
});

// ── rawForwardReturnPct ──────────────────────────────────────────────────────────

test("rawForwardReturnPct: a rise from entry is a positive raw return", () => {
  assert.equal(rawForwardReturnPct(100, 105), 5);
});

test("rawForwardReturnPct: a fall from entry is a negative raw return", () => {
  assert.equal(rawForwardReturnPct(100, 95), -5);
});

test("rawForwardReturnPct: unsigned -- a SHORT candidate benefiting from a fall still reads as a negative raw number (sign interpretation is the caller's job)", () => {
  assert.equal(rawForwardReturnPct(50, 45), -10);
});

// ── computeCandidateForwardReturns ───────────────────────────────────────────────

test("computeCandidateForwardReturns: empty bars -> every field honestly null, never fabricated", () => {
  const result = computeCandidateForwardReturns([], "2026-09-17T20:30:00.000Z");
  assert.deepEqual(result, {
    schema_version: 2,
    entry_price: null,
    entry_at: null,
    horizons: { m5: null, m15: null, m30: null, h1: null, eod: null },
    session_high_pct: null,
    session_high_at: null,
    session_low_pct: null,
    session_low_at: null,
    graded_at: "2026-09-17T20:30:00.000Z",
  });
});

test("computeCandidateForwardReturns: an entry bar with no usable open (0) grades every horizon null", () => {
  const bars = [bar(0, 100, { o: 0 }), bar(5, 110)];
  const result = computeCandidateForwardReturns(bars, "2026-09-17T20:30:00.000Z");
  assert.equal(result.entry_price, null);
  assert.equal(result.horizons.m5, null);
});

test("computeCandidateForwardReturns: a full session's worth of bars grades every horizon from the session-open anchor", () => {
  const bars: MinuteBar[] = [];
  // session open at minute 0, price 100; rises 1 point per minute through minute 60; EOD (last bar) at minute 389 (~6.5h RTH), price 250.
  for (let m = 0; m <= 60; m++) bars.push(bar(m, 100 + m));
  bars.push(bar(389, 250));

  const result = computeCandidateForwardReturns(bars, "2026-09-17T20:30:00.000Z");
  assert.equal(result.entry_price, 100);
  assert.equal(result.entry_at, new Date(BASE_T).toISOString());
  assert.equal(result.horizons.m5, rawForwardReturnPct(100, 105)); // 100+5
  assert.equal(result.horizons.m15, rawForwardReturnPct(100, 115));
  assert.equal(result.horizons.m30, rawForwardReturnPct(100, 130));
  assert.equal(result.horizons.h1, rawForwardReturnPct(100, 160)); // 100+60
  assert.equal(result.horizons.eod, rawForwardReturnPct(100, 250)); // the session's own LAST bar, not a fixed-minute offset
  assert.deepEqual(Object.keys(FORWARD_HORIZON_MINUTES).sort(), ["h1", "m15", "m30", "m5"]);
});

test("computeCandidateForwardReturns: a gap in the tape around one horizon's target leaves only THAT horizon null, the rest still grade", () => {
  const bars: MinuteBar[] = [bar(0, 100)];
  // m15's target (minute 15) has no bar within its 10-min tolerance window [5,25]: the nearest
  // candidates are bar(4) at 11 min away and bar(30) at 15 min away, both excluded.
  for (const m of [4, 30, 60, 200]) bars.push(bar(m, 100 + m));

  const result = computeCandidateForwardReturns(bars, "2026-09-17T20:30:00.000Z");
  assert.equal(result.horizons.m5, rawForwardReturnPct(100, 104)); // nearest to the m5 target (minute 5) is bar(4), 1 min away
  assert.equal(result.horizons.m15, null, "no bar within tolerance of the m15 target -- honestly null, not interpolated");
  assert.equal(result.horizons.m30, rawForwardReturnPct(100, 130));
  assert.equal(result.horizons.h1, rawForwardReturnPct(100, 160));
  assert.equal(result.horizons.eod, rawForwardReturnPct(100, 300)); // last bar, minute 200 -> 100+200
});

test("computeCandidateForwardReturns: direction-agnostic -- the same bars produce the same raw horizons regardless of what direction a caller later reads off a snapshot row", () => {
  const bars: MinuteBar[] = [bar(0, 100), bar(5, 90)]; // price FELL
  const result = computeCandidateForwardReturns(bars, "2026-09-17T20:30:00.000Z");
  // a raw negative number -- favorable for a SHORT, adverse for a LONG; this module never decides which
  assert.equal(result.horizons.m5, -10);
});

// ── session_high_pct / session_low_pct (Phase 2A: shadow-play MFE/MAE primitive) ────────────

test("computeCandidateForwardReturns: session high/low use each bar's h/l, not just closes, and the timestamp of the actual extreme bar", () => {
  const bars: MinuteBar[] = [
    bar(0, 100), // entry: open 100, h/l/c all 100
    { t: BASE_T + 3 * MIN, o: 100, h: 112, l: 99, c: 105 }, // spikes to 112 intrabar, closes 105
    { t: BASE_T + 7 * MIN, o: 105, h: 106, l: 90, c: 95 }, // dips to 90 intrabar, closes 95
    bar(10, 100),
  ];
  const result = computeCandidateForwardReturns(bars, "2026-09-17T20:30:00.000Z");
  assert.equal(result.entry_price, 100);
  assert.equal(result.session_high_pct, rawForwardReturnPct(100, 112));
  assert.equal(result.session_high_at, new Date(BASE_T + 3 * MIN).toISOString());
  assert.equal(result.session_low_pct, rawForwardReturnPct(100, 90));
  assert.equal(result.session_low_at, new Date(BASE_T + 7 * MIN).toISOString());
});

test("computeCandidateForwardReturns: a flat one-bar session has a defined (zero) high/low, not null", () => {
  const bars: MinuteBar[] = [bar(0, 100)];
  const result = computeCandidateForwardReturns(bars, "2026-09-17T20:30:00.000Z");
  assert.equal(result.session_high_pct, 0);
  assert.equal(result.session_low_pct, 0);
  assert.equal(result.session_high_at, new Date(BASE_T).toISOString());
  assert.equal(result.session_low_at, new Date(BASE_T).toISOString());
});

test("computeCandidateForwardReturns: a bar with a non-finite timestamp never becomes the recorded high/low extreme", () => {
  const bars: MinuteBar[] = [
    bar(0, 100),
    { t: undefined, o: 100, h: 999, l: 1, c: 100 }, // would dominate high/low if not skipped
    bar(5, 103),
  ];
  const result = computeCandidateForwardReturns(bars, "2026-09-17T20:30:00.000Z");
  assert.equal(result.session_high_pct, rawForwardReturnPct(100, 103));
  assert.equal(result.session_low_pct, 0); // entry bar's own low (100) is the lowest usable value
});

test("computeCandidateForwardReturns: entry-anchor failure (no usable open) leaves session high/low honestly null too", () => {
  const bars = [bar(0, 100, { o: 0 }), bar(5, 110)];
  const result = computeCandidateForwardReturns(bars, "2026-09-17T20:30:00.000Z");
  assert.equal(result.session_high_pct, null);
  assert.equal(result.session_low_pct, null);
});

// ── orchestration (source-inspection: fetchAggBars/@/lib/db go through mock.module elsewhere in
// this repo, which breaks "@/" alias resolution repo-wide once active -- see dossier.test.ts's
// Task #10 precedent for why a source-inspection proof is this codebase's established substitute
// for full-integration-mocking a thin DB/Polygon orchestration wrapper) ──────────────────────

test("gradeNighthawkCandidateForwardReturns: groups by (edition_for, ticker), fetches bars once per group, and is fail-soft per group", () => {
  const source = readFileSync(fileURLToPath(new URL("./candidate-forward-grade.ts", import.meta.url)), "utf8");
  assert.match(source, /export async function gradeNighthawkCandidateForwardReturns/);
  assert.match(source, /const key = `\$\{row\.edition_for\}:\$\{row\.ticker\}`;/, "must group by edition_for+ticker");
  assert.match(source, /await fetchAggBars\(group\.ticker, 1, "minute", group\.edition_for, group\.edition_for/, "one bar fetch per group, not per row");
  assert.match(source, /for \(const id of group\.ids\)/, "the SAME computed grade must be pinned onto every row in the group");
  assert.match(source, /} catch \(err\) \{\s*\n\s*errors\.push/, "a per-group failure must land in errors, never throw and abort the whole pass");
});

// ── Workstream C / #20's D4 (2026-09-21): does every rejection reason really get forward-graded,
// not just published rank_final rows? Confirmed by direct source read against db.ts's query, not
// assumed -- a query-shape regression here would silently stop rejected candidates from ever
// being gradeable, which is exactly the "did a gate throw away a real winner" question the
// rank-bucket diagnostic depends on being answerable. ──────────────────────────────────────────

test("fetchNighthawkCandidateSnapshotsMissingForwardGrade: the query has NO stage or rejection_reason filter -- every stage/reason is eligible for grading", () => {
  const source = readFileSync(fileURLToPath(new URL("../../../lib/db.ts", import.meta.url)), "utf8");
  const start = source.indexOf("export async function fetchNighthawkCandidateSnapshotsMissingForwardGrade");
  assert.ok(start >= 0, "fetchNighthawkCandidateSnapshotsMissingForwardGrade not found in db.ts");
  const fnSource = source.slice(start, start + 800);

  assert.match(fnSource, /FROM nighthawk_candidate_snapshot/);
  assert.match(fnSource, /WHERE forward_returns IS NULL/);
  // The WHERE clause's only other condition must be the lookback-window date filter -- no
  // `stage =`/`stage IN`/`rejection_reason` restriction anywhere in this function's SQL.
  const whereClauseEnd = fnSource.indexOf("ORDER BY");
  const whereClause = fnSource.slice(fnSource.indexOf("WHERE"), whereClauseEnd);
  assert.doesNotMatch(whereClause, /\bstage\b/i, "grading must not be restricted to specific stages");
  assert.doesNotMatch(whereClause, /rejection_reason/, "grading must not be restricted by rejection reason");
});

test("gradeNighthawkCandidateForwardReturns: calls the fetch with only lookbackDays -- no stage-restricting option exists to pass", () => {
  const source = readFileSync(fileURLToPath(new URL("./candidate-forward-grade.ts", import.meta.url)), "utf8");
  assert.match(
    source,
    /fetchNighthawkCandidateSnapshotsMissingForwardGrade\(lookbackDays\)/,
    "the call site must not (and structurally cannot, per its single-param signature) filter by stage"
  );
});

test("cron/nighthawk-outcomes route wires the forward-grade pass in fail-soft alongside the other post-grading passes", () => {
  const routeSrc = readFileSync(
    fileURLToPath(new URL("../../../app/api/cron/nighthawk-outcomes/route.ts", import.meta.url)),
    "utf8"
  );
  assert.match(routeSrc, /import \{ gradeNighthawkCandidateForwardReturns \} from "@\/features\/nighthawk\/lib\/candidate-forward-grade"/);
  assert.match(routeSrc, /gradeNighthawkCandidateForwardReturns\(\{ lookbackDays \}\)\.catch\(/, "must be wrapped in .catch() so it can never fail the headline grading run");
});
