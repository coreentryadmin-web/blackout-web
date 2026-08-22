import test from "node:test";
import assert from "node:assert/strict";

import {
  fitVectorFullStateForModel,
  VECTOR_FIT_MAX_BEADS,
  VECTOR_FIT_MAX_LADDER_ROWS,
} from "@/lib/bie/vector-full-state-fit";
import { LARGO_RESULT_CHAR_BUDGET } from "@/lib/largo/fit-tool-result";
import { MAX_TOOL_RESULT_CHARS } from "@/lib/providers/anthropic";
import { VECTOR_FULL_STATE_FIXTURE } from "@/lib/bie/vector-full-state-fixture";

/**
 * One realistic ORACLE bead: 20 wall levels per side on BOTH lenses, each carrying `notional`.
 * That is what `VECTOR_WALL_NODES_PER_SIDE = 20` plus `computeGexWalls`'s `{strike, pct, notional}`
 * actually produces, and it is the reason a single bead is ~4k chars — a quarter of the budget.
 */
function oracleBead(time: number) {
  const side = (offset: number) =>
    Array.from({ length: 20 }, (_, i) => ({
      strike: 7600 + (i + offset) * 5,
      pct: Number((12.34 - i * 0.4).toFixed(2)),
      notional: 1_234_567_890 - i * 7_654_321,
    }));
  return {
    time,
    walls: { callWalls: side(0), putWalls: side(-20) },
    gammaFlip: 7655.25,
    vexWalls: { callWalls: side(0), putWalls: side(-20) },
    vexFlip: 7640.5,
  };
}

function stateWithRail(beadCount: number) {
  return {
    ...VECTOR_FULL_STATE_FIXTURE,
    // The read-time blocks `withReadContext` appends LAST — the ones a head-slice ate first.
    unavailable_sections: [] as string[],
    wall_history_empty_reason: null,
    observed_at: "2026-07-13T14:40:00.000Z",
    observed_session_date: "2026-07-13",
    as_of: "2026-07-13 10:41 ET",
    session_date: "2026-07-13",
    age_seconds: 60,
    freshness: "live",
    note: null,
    wallHistory: Array.from({ length: beadCount }, (_, i) => oracleBead(1_752_417_300 + i * 5)),
  };
}

const size = (o: unknown) => JSON.stringify(o).length;

test("the unfitted state really does blow the transport cap — the defect this module exists for", () => {
  // Guards the premise. If this ever stops being true the module's cost is no longer justified,
  // and a test that only checked the fitted output would never say so.
  assert.ok(
    size(stateWithRail(12)) > MAX_TOOL_RESULT_CHARS,
    "one minute of oracle rail should already exceed the 16k tool_result cap"
  );
  assert.ok(
    size(stateWithRail(360)) > 50 * MAX_TOOL_RESULT_CHARS,
    "30 minutes of oracle rail should be dozens of times the cap"
  );
});

test("fits inside the budget at every rail length, including a full session", () => {
  for (const beads of [0, 1, 12, 60, 360, 3_720, 5_760]) {
    const fitted = fitVectorFullStateForModel(stateWithRail(beads));
    assert.ok(
      size(fitted) <= LARGO_RESULT_CHAR_BUDGET,
      `rail=${beads} produced ${size(fitted)} chars, over the ${LARGO_RESULT_CHAR_BUDGET} budget`
    );
    assert.ok(size(fitted) < MAX_TOOL_RESULT_CHARS, `rail=${beads} must also clear the transport cap`);
  }
});

test("the disclosure blocks survive — they are what the head slice used to eat first", () => {
  const fitted = fitVectorFullStateForModel(stateWithRail(3_720)) as Record<string, unknown>;
  // Every one of these sits AFTER wallHistory in the raw key order, so every one of them was
  // being lost during RTH. This is the assertion the defect is actually about.
  for (const key of [
    "unavailable_sections",
    "wall_history_empty_reason",
    "observed_at",
    "observed_session_date",
    "as_of",
    "session_date",
    "age_seconds",
    "freshness",
    "vexWalls",
    "vexFlip",
    "darkPoolLevels",
  ]) {
    assert.ok(key in fitted, `${key} must survive the fit`);
  }
  assert.equal(fitted.freshness, "live");
  assert.deepEqual(fitted.vexWalls, VECTOR_FULL_STATE_FIXTURE.vexWalls);
  assert.deepEqual(fitted.darkPoolLevels, VECTOR_FULL_STATE_FIXTURE.darkPoolLevels);
});

test("scalars and derived reads pass through untouched", () => {
  const fitted = fitVectorFullStateForModel(stateWithRail(600)) as Record<string, unknown>;
  assert.equal(fitted.ticker, "SPX");
  assert.equal(fitted.spot, 7560);
  assert.equal(fitted.gammaFlip, 7520);
  assert.equal(fitted.maxPain, 7550);
  assert.deepEqual(fitted.gexWalls, VECTOR_FULL_STATE_FIXTURE.gexWalls);
  assert.deepEqual(fitted.wallIntegrity, VECTOR_FULL_STATE_FIXTURE.wallIntegrity);
  assert.deepEqual(fitted.magnet, VECTOR_FULL_STATE_FIXTURE.magnet);
  assert.deepEqual(fitted.play, VECTOR_FULL_STATE_FIXTURE.play);
});

test("states the real total, so a sample can never be counted as the universe", () => {
  const fitted = fitVectorFullStateForModel(stateWithRail(3_720));
  const scope = fitted.fit.wall_history;
  assert.equal(scope.total, 3_720, "total must be the REAL rail length, not what fitted");
  assert.ok(scope.returned > 0, "a full session must still yield some beads");
  assert.ok(scope.returned <= VECTOR_FIT_MAX_BEADS);
  assert.equal(scope.truncated, true);
  assert.match(scope.note, /SAMPLE, not the whole set/);
  assert.match(scope.note, /computed server-side over the FULL set/);
});

test("an untruncated section says so plainly instead of implying a cut", () => {
  const fitted = fitVectorFullStateForModel(stateWithRail(2));
  assert.equal(fitted.fit.wall_history.truncated, false);
  assert.equal(fitted.fit.wall_history.returned, 2);
  assert.match(fitted.fit.wall_history.note, /All 2 bead samples/);
});

test("an empty rail reads as empty, not as a malformed 'All 0'", () => {
  const fitted = fitVectorFullStateForModel(stateWithRail(0));
  assert.equal(fitted.fit.wall_history.total, 0);
  assert.equal(fitted.fit.wall_history.truncated, false);
  assert.match(fitted.fit.wall_history.note, /No bead samples on this read/);
  // The distinction between "before the open" and "a real in-RTH gap" belongs to the absence
  // report, which must still be present to make it.
  assert.ok("wall_history_empty_reason" in (fitted as Record<string, unknown>));
});

test("keeps the MOST RECENT beads, in ascending time order", () => {
  const fitted = fitVectorFullStateForModel(stateWithRail(600));
  const rail = fitted.wallHistory as Array<{ time: number }>;
  assert.ok(rail.length > 0);
  const times = rail.map((b) => b.time);
  assert.deepEqual([...times].sort((a, b) => a - b), times, "rail must stay ascending by time");
  // The newest bead of the source rail is the last one recorded.
  assert.equal(times[times.length - 1], 1_752_417_300 + 599 * 5);
});

test("both king strikes are retained even when the ladder is trimmed", () => {
  const rows = [
    ...Array.from({ length: 200 }, (_, i) => ({
      strike: 7000 + i * 5,
      gex: (i % 2 ? -1 : 1) * (1_000_000 + i),
      side: i % 2 ? "put" : "call",
      magnitude: 0.1,
      isKing: false,
      migration: null,
    })),
    { strike: 9000, gex: 9_000_000_000, side: "call", magnitude: 1, isKing: true, migration: null },
    { strike: 5000, gex: -8_000_000_000, side: "put", magnitude: 0.9, isKing: true, migration: null },
  ];
  const fitted = fitVectorFullStateForModel({
    ...stateWithRail(120),
    ladder: { spot: 7560, maxAbs: 9_000_000_000, rows },
  });
  const kept = (fitted.ladder as { rows: Array<{ strike: number; isKing: boolean }> }).rows;
  assert.ok(kept.length <= VECTOR_FIT_MAX_LADDER_ROWS);
  // Far from spot on both sides, so a nearest-spot-only rule would have dropped them.
  assert.ok(kept.some((r) => r.strike === 9000 && r.isKing), "call king must survive");
  assert.ok(kept.some((r) => r.strike === 5000 && r.isKing), "put king must survive");
  const strikes = kept.map((r) => r.strike);
  assert.deepEqual([...strikes].sort((a, b) => b - a), strikes, "ladder must stay descending by strike");
  assert.equal(fitted.fit.ladder_rows.total, 202);
});

test("a null ladder or absent flow markers stay null rather than becoming empty objects", () => {
  const fitted = fitVectorFullStateForModel({
    ...stateWithRail(4),
    ladder: null,
    flowMarkers: null,
  });
  assert.equal(fitted.ladder, null);
  assert.equal(fitted.flowMarkers, null);
  assert.equal(fitted.fit.ladder_rows.total, 0);
  assert.equal(fitted.fit.flow_prints.total, 0);
});

test("flowMarkers.meta survives while its prints are sampled", () => {
  const fitted = fitVectorFullStateForModel({
    ...stateWithRail(200),
    flowMarkers: {
      available: true,
      expiry: "2026-07-13",
      spot: 7560,
      prints: Array.from({ length: 40 }, (_, i) => ({
        strike: 7500 + i * 5,
        side: i % 2 ? "put" : "call",
        premium: 1_000_000 + i,
        size: 100 + i,
        tsMs: 1_752_417_600_000 + i,
        aggressor: "buy",
      })),
      meta: { minPremium: 5_000, largeFound: 40, truncated: 0, partial: false, deadlineHit: false },
    },
  });
  const flow = fitted.flowMarkers as { meta: unknown; prints: unknown[] };
  // `meta` counts the whole fetch; losing it while keeping a sample of prints would leave the
  // model with a denominator it cannot see.
  assert.deepEqual(flow.meta, {
    minPremium: 5_000,
    largeFound: 40,
    truncated: 0,
    partial: false,
    deadlineHit: false,
  });
  assert.equal(fitted.fit.flow_prints.total, 40);
  assert.ok(flow.prints.length <= 40);
});

test("degrades to scalars rather than throwing when even the base is over budget", () => {
  // A pathological base (a huge technicals blob) leaves no room for any section. The right
  // behaviour is zero rows with honest scopes, not an exception and not a silent overflow.
  const fitted = fitVectorFullStateForModel({
    ...stateWithRail(50),
    technicals: { blob: "x".repeat(LARGO_RESULT_CHAR_BUDGET) },
  });
  assert.equal(fitted.fit.wall_history.returned, 0);
  assert.equal(fitted.fit.wall_history.total, 50);
  assert.equal(fitted.fit.wall_history.truncated, true);
  assert.equal((fitted.wallHistory as unknown[]).length, 0);
  assert.equal(fitted.freshness, "live", "the disclosure still survives a degraded fit");
});

test("wall events are kept newest-first but returned ascending", () => {
  const events = Array.from({ length: 60 }, (_, i) => ({
    time: 1_752_417_300 + i * 5,
    lens: "gex",
    kind: "call_wall_building",
    message: `Call wall 7,600 building — step ${i}`,
    severity: "info",
  }));
  const fitted = fitVectorFullStateForModel({ ...stateWithRail(300), wallEvents: events });
  const kept = fitted.wallEvents as Array<{ time: number }>;
  assert.ok(kept.length > 0);
  const times = kept.map((e) => e.time);
  assert.deepEqual([...times].sort((a, b) => a - b), times, "events must be ascending by time");
  assert.equal(times[times.length - 1], 1_752_417_300 + 59 * 5, "the newest event must be kept");
  assert.equal(fitted.fit.wall_events.total, 60);
});
