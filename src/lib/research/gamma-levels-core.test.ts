import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildGammaLevelsResearch,
  classifyWallOutcome,
  isPublishable,
  MIN_SESSIONS_TO_PUBLISH,
  type ResearchSessionInput,
} from "./gamma-levels-core";

function sample(call: number | null, put: number | null, flip?: number | null, pct = 0.2) {
  return {
    walls: {
      callWalls: call === null ? [] : [{ strike: call, pct }],
      putWalls: put === null ? [] : [{ strike: put, pct }],
    },
    gammaFlip: flip,
  };
}

function session(
  s: string,
  samples: ReturnType<typeof sample>[],
  bar: { open: number; high: number; low: number; close: number } | null
): ResearchSessionInput {
  return { session: s, samples, bar };
}

test("a wall that capped the high held; one price ran through broke", () => {
  assert.equal(classifyWallOutcome(7700, 7699, "call"), "held", "reached it and stopped");
  assert.equal(classifyWallOutcome(7700, 7750, "call"), "broke", "ran clean through");
  assert.equal(classifyWallOutcome(7700, 7500, "call"), "untested", "never got near it");

  assert.equal(classifyWallOutcome(7600, 7601, "put"), "held");
  assert.equal(classifyWallOutcome(7600, 7500, "put"), "broke");
  assert.equal(classifyWallOutcome(7600, 7700, "put"), "untested");
});

test("an exact touch is a hold, not a break — the tolerance band exists for this", () => {
  assert.equal(classifyWallOutcome(7700, 7700, "call"), "held");
  assert.equal(classifyWallOutcome(7700, 7700, "put"), "held");
  // Just inside the 0.15% band on the far side is still a hold.
  assert.equal(classifyWallOutcome(7700, 7700 * 1.001, "call"), "held");
  // Comfortably past it is not.
  assert.equal(classifyWallOutcome(7700, 7700 * 1.005, "call"), "broke");
});

test("a missing or nonsensical wall is untested, never a free hold", () => {
  assert.equal(classifyWallOutcome(null, 7700, "call"), "untested");
  assert.equal(classifyWallOutcome(0, 7700, "call"), "untested");
  assert.equal(classifyWallOutcome(-100, 7700, "call"), "untested");
  assert.equal(classifyWallOutcome(NaN, 7700, "call"), "untested");
  assert.equal(classifyWallOutcome(7700, NaN, "call"), "untested");
});

test("a session's wall is its MODAL strike, not its last sample", () => {
  // 7700 appears three times, 7750 only in the final sample. Taking the last sample would
  // report 7750 — the single least stable instant of the day.
  const r = buildGammaLevelsResearch("SPX", [
    session(
      "2026-08-19",
      [sample(7700, 7600), sample(7700, 7600), sample(7700, 7600), sample(7750, 7650)],
      { open: 7650, high: 7699, low: 7601, close: 7680 }
    ),
  ]);
  assert.equal(r.sessions[0].callWall, 7700);
  assert.equal(r.sessions[0].putWall, 7600);
});

test("a modal tie breaks by concentration, then by the lower strike — deterministically", () => {
  const byWeight = buildGammaLevelsResearch("SPX", [
    session("2026-08-19", [sample(7700, 7600, null, 0.1), sample(7750, 7600, null, 0.4)], {
      open: 7650, high: 7660, low: 7640, close: 7655,
    }),
  ]);
  assert.equal(byWeight.sessions[0].callWall, 7750, "equal frequency → larger concentration wins");

  const byStrike = buildGammaLevelsResearch("SPX", [
    session("2026-08-19", [sample(7750, 7600, null, 0.2), sample(7700, 7600, null, 0.2)], {
      open: 7650, high: 7660, low: 7640, close: 7655,
    }),
  ]);
  assert.equal(byStrike.sessions[0].callWall, 7700, "fully tied → lower strike, always the same one");
});

test("the gamma flip is the median, so one spike cannot move it", () => {
  const r = buildGammaLevelsResearch("SPX", [
    session(
      "2026-08-19",
      [sample(7700, 7600, 7650), sample(7700, 7600, 7655), sample(7700, 7600, 99999)],
      { open: 7640, high: 7699, low: 7601, close: 7680 }
    ),
  ]);
  assert.equal(r.sessions[0].gammaFlip, 7655);
  assert.equal(r.sessions[0].closedAboveFlip, true);
});

test("sessions without data are excluded AND counted, with the reason", () => {
  const r = buildGammaLevelsResearch("SPX", [
    session("2026-08-19", [sample(7700, 7600)], { open: 7650, high: 7699, low: 7601, close: 7680 }),
    session("2026-08-18", [], { open: 1, high: 1, low: 1, close: 1 }),
    session("2026-08-17", [sample(7700, 7600)], null),
    session("2026-08-14", [sample(null, null)], { open: 1, high: 1, low: 1, close: 1 }),
  ]);
  assert.equal(r.coverage.requested, 4);
  assert.equal(r.coverage.covered, 1);
  assert.deepEqual(r.coverage.missing, [
    { session: "2026-08-18", reason: "no_samples" },
    { session: "2026-08-17", reason: "no_bar" },
    { session: "2026-08-14", reason: "no_walls" },
  ]);
});

test("a rate over zero tested sessions is null, never 0 or NaN", () => {
  // Both walls miles away — nothing was tested, so there is no hold rate to state.
  const r = buildGammaLevelsResearch("SPX", [
    session("2026-08-19", [sample(9000, 5000)], { open: 7650, high: 7660, low: 7640, close: 7655 }),
  ]);
  assert.equal(r.callWall.tested, 0);
  assert.equal(r.callWall.holdRate, null);
  assert.equal(r.putWall.holdRate, null);
  assert.equal(r.flip.aboveRate, null, "no flip recorded → no rate");
});

test("hold rates count only tested sessions", () => {
  const r = buildGammaLevelsResearch("SPX", [
    // held
    session("2026-08-19", [sample(7700, 7600)], { open: 7650, high: 7699, low: 7601, close: 7680 }),
    // broke
    session("2026-08-18", [sample(7700, 7600)], { open: 7650, high: 7780, low: 7601, close: 7760 }),
    // untested — never approached either wall
    session("2026-08-17", [sample(7700, 7600)], { open: 7650, high: 7660, low: 7640, close: 7655 }),
  ]);
  assert.equal(r.callWall.tested, 2);
  assert.equal(r.callWall.held, 1);
  assert.equal(r.callWall.holdRate, 0.5);
});

test("output is newest-first with a window matching the covered rows", () => {
  const bar = { open: 7650, high: 7699, low: 7601, close: 7680 };
  const r = buildGammaLevelsResearch("SPX", [
    session("2026-08-17", [sample(7700, 7600)], bar),
    session("2026-08-19", [sample(7700, 7600)], bar),
    session("2026-08-18", [sample(7700, 7600)], bar),
  ]);
  assert.deepEqual(r.sessions.map((s) => s.session), ["2026-08-19", "2026-08-18", "2026-08-17"]);
  assert.deepEqual(r.window, { from: "2026-08-17", to: "2026-08-19" });
});

test("a level seen once is not reported as recurring", () => {
  const bar = { open: 7650, high: 7699, low: 7601, close: 7680 };
  const r = buildGammaLevelsResearch("SPX", [
    session("2026-08-19", [sample(7700, 7600)], bar),
    session("2026-08-18", [sample(7700, 7600)], bar),
    session("2026-08-17", [sample(7800, 7500)], bar),
  ]);
  assert.deepEqual(r.recurringCallWalls, [{ strike: 7700, sessions: 2 }]);
  assert.deepEqual(r.recurringPutWalls, [{ strike: 7600, sessions: 2 }]);
});

test("an empty input yields an empty, honest payload rather than throwing", () => {
  const r = buildGammaLevelsResearch("SPX", []);
  assert.equal(r.window, null);
  assert.deepEqual(r.sessions, []);
  assert.equal(r.coverage.covered, 0);
  assert.equal(r.callWall.holdRate, null);
  assert.equal(isPublishable(r), false);
});

test("thin pages are refused at the publish floor", () => {
  const bar = { open: 7650, high: 7699, low: 7601, close: 7680 };
  const make = (n: number) =>
    buildGammaLevelsResearch(
      "SPX",
      Array.from({ length: n }, (_, i) =>
        session(`2026-06-${String(i + 1).padStart(2, "0")}`, [sample(7700, 7600)], bar)
      )
    );
  assert.equal(isPublishable(make(MIN_SESSIONS_TO_PUBLISH - 1)), false);
  assert.equal(isPublishable(make(MIN_SESSIONS_TO_PUBLISH)), true);
});
