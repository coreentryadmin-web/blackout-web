import { test } from "node:test";
import assert from "node:assert/strict";

import { buildGammaLevelsResearch, type ResearchSessionInput } from "./gamma-levels-core";
import {
  coverageSentence,
  flipSentence,
  formatLevel,
  formatRate,
  formatSessionLabel,
  pageCopy,
  recurringSentence,
  wallSentence,
} from "./gamma-levels-copy";

const BAR = { open: 7650, high: 7699, low: 7601, close: 7680 };

function sample(call: number | null, put: number | null, flip?: number | null) {
  return {
    walls: {
      callWalls: call === null ? [] : [{ strike: call, pct: 0.2 }],
      putWalls: put === null ? [] : [{ strike: put, pct: 0.2 }],
    },
    gammaFlip: flip,
  };
}

function build(inputs: ResearchSessionInput[]) {
  return buildGammaLevelsResearch("SPX", inputs);
}

test("levels are formatted for reading, never as raw floats", () => {
  assert.equal(formatLevel(7699.360000000001), "7,699");
  assert.equal(formatLevel(45.219999999), "45.22");
  assert.equal(formatLevel(0.9160819881475173), "0.9161");
  assert.equal(formatLevel(NaN), "—");
});

test("a rate reads as a whole percent", () => {
  assert.equal(formatRate(0.8), "80%");
  assert.equal(formatRate(0.666), "67%");
});

test("a session date reads as a date, in the session's own terms", () => {
  // Parsed at UTC noon and formatted in UTC, so no offset can roll it to the previous day.
  assert.equal(formatSessionLabel("2026-08-19"), "August 19, 2026");
  assert.equal(formatSessionLabel("2026-01-01"), "January 1, 2026");
  assert.equal(formatSessionLabel("garbage"), "garbage");
});

test("an untested wall states its absence and quotes no rate", () => {
  const r = build([
    { session: "2026-08-19", samples: [sample(9000, 5000)], bar: { open: 7650, high: 7660, low: 7640, close: 7655 } },
  ]);
  const s = wallSentence(r.callWall, "call wall", "SPX");
  assert.match(s, /never came close enough/);
  assert.doesNotMatch(s, /\d+%/, "an untested wall must not produce a percentage");
  assert.doesNotMatch(s, /\b0%/, "and certainly not a zero rate");
});

test("a tested wall always states its denominator alongside its rate", () => {
  const r = build([
    { session: "2026-08-19", samples: [sample(7700, 7600)], bar: BAR },
    { session: "2026-08-18", samples: [sample(7700, 7600)], bar: { open: 7650, high: 7780, low: 7601, close: 7760 } },
  ]);
  const s = wallSentence(r.callWall, "call wall", "SPX");
  assert.match(s, /2 sessions/, "the denominator must appear");
  assert.match(s, /50%/);
});

test("singular and plural read correctly on a one-session denominator", () => {
  const r = build([{ session: "2026-08-19", samples: [sample(7700, 7600)], bar: BAR }]);
  const s = wallSentence(r.callWall, "call wall", "SPX");
  assert.match(s, /1 session\b/);
  assert.doesNotMatch(s, /1 sessions/);
  assert.match(s, /1 time\b/);
});

test("the flip sentence splits into three honest regimes", () => {
  const above = build(
    Array.from({ length: 10 }, (_, i) => ({
      session: `2026-08-0${i}`.slice(0, 10),
      samples: [sample(7700, 7600, 7000)],
      bar: BAR,
    }))
  );
  assert.match(flipSentence(above), /long-gamma side/);

  const below = build(
    Array.from({ length: 10 }, (_, i) => ({
      session: `2026-08-0${i}`.slice(0, 10),
      samples: [sample(7700, 7600, 9000)],
      bar: BAR,
    }))
  );
  assert.match(flipSentence(below), /short-gamma side/);

  const mixed = build([
    { session: "2026-08-19", samples: [sample(7700, 7600, 7000)], bar: BAR },
    { session: "2026-08-18", samples: [sample(7700, 7600, 9000)], bar: BAR },
  ]);
  assert.match(flipSentence(mixed), /no settled regime/);
});

test("no recorded flip produces an absence, not a fabricated regime", () => {
  const r = build([{ session: "2026-08-19", samples: [sample(7700, 7600)], bar: BAR }]);
  const s = flipSentence(r);
  assert.match(s, /No gamma flip level was recorded/);
  assert.doesNotMatch(s, /%/);
});

test("recurring levels are only claimed when a level actually recurred", () => {
  const none = build([
    { session: "2026-08-19", samples: [sample(7700, 7600)], bar: BAR },
    { session: "2026-08-18", samples: [sample(7800, 7500)], bar: BAR },
  ]);
  assert.match(recurringSentence(none), /No single strike repeated/);

  const some = build([
    { session: "2026-08-19", samples: [sample(7700, 7600)], bar: BAR },
    { session: "2026-08-18", samples: [sample(7700, 7600)], bar: BAR },
  ]);
  const s = recurringSentence(some);
  assert.match(s, /7,700/);
  assert.match(s, /2 separate sessions/);
});

test("coverage names how many sessions were dropped and why", () => {
  const r = build([
    { session: "2026-08-19", samples: [sample(7700, 7600)], bar: BAR },
    { session: "2026-08-18", samples: [], bar: BAR },
    { session: "2026-08-17", samples: [sample(7700, 7600)], bar: null },
  ]);
  const s = coverageSentence(r);
  assert.match(s, /1 of the last 3/);
  assert.match(s, /no recorded positioning/);
  assert.match(s, /no price bar/);
});

test("full coverage says so plainly", () => {
  const r = build([{ session: "2026-08-19", samples: [sample(7700, 7600)], bar: BAR }]);
  assert.match(coverageSentence(r), /full coverage/);
});

test("page copy never claims to predict, and carries the ticker and window", () => {
  const r = build([
    { session: "2026-08-19", samples: [sample(7700, 7600, 7650)], bar: BAR },
    { session: "2026-08-18", samples: [sample(7700, 7600, 7650)], bar: BAR },
  ]);
  const copy = pageCopy(r);
  assert.match(copy.metaTitle, /^SPX Gamma Levels/);
  assert.ok(copy.metaTitle.length <= 70, `title is ${copy.metaTitle.length} chars — too long for a SERP`);
  assert.match(copy.h1, /SPX Dealer Gamma Levels — 2-Session History/);
  assert.match(copy.standfirst, /not a forecast, a record/);
  assert.match(copy.metaDescription, /August 18, 2026 to August 19, 2026/);
  // A forward-looking WORD is not a forward-looking CLAIM: "not a forecast, a record" is the page
  // disclaiming prediction, which is the behaviour we want, not a violation of it. Strip explicit
  // negations first so the guard stays sharp on the thing it is actually policing.
  const DISCLAIMERS = /\bnot a (forecast|prediction|guarantee)\b/gi;
  for (const text of [copy.metaTitle, copy.metaDescription, copy.h1, copy.standfirst]) {
    const claims = text.replace(DISCLAIMERS, "");
    assert.doesNotMatch(claims, /\b(will|predict|forecast|guarantee|expect)\b/i, `forward-looking claim in: ${text}`);
  }
});

test("an empty payload still produces renderable copy rather than throwing", () => {
  const r = build([]);
  const copy = pageCopy(r);
  assert.match(copy.metaDescription, /the recorded window/);
  assert.match(coverageSentence(r), /No sessions/);
  assert.match(wallSentence(r.callWall, "call wall", "SPX"), /never came close enough/);
});
