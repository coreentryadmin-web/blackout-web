import { test } from "node:test";
import assert from "node:assert/strict";

import {
  printedBy,
  visibleShare,
  compareRuns,
  saturationVerdict,
} from "./helix-signal-population-ab-eval.mjs";

const at = (iso) => ({ event_at: iso });
const ms = (f) => (f.event_at == null ? null : new Date(f.event_at).getTime());
const T = (h, m) => `2026-08-21T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000Z`;

test("printedBy excludes prints that had not happened yet — the 7x replay error", () => {
  // Feeding the whole session at a past nowMs gives later prints a NEGATIVE age, and a negative age
  // is `<=` every window bound, so they count as maximally recent. That is what turned 14 spikes
  // into 91 the first time this lane replayed velocity.
  const rows = [at(T(15, 0)), at(T(15, 30)), at(T(16, 0))];
  const now = new Date(T(15, 30)).getTime();
  assert.deepEqual(printedBy(rows, now, ms).map((r) => r.event_at), [T(15, 0), T(15, 30)]);
});

test("printedBy drops undatable prints rather than treating them as time zero", () => {
  const rows = [at(T(15, 0)), at(null), { event_at: "not-a-date" }];
  const now = new Date(T(16, 0)).getTime();
  assert.deepEqual(printedBy(rows, now, ms).length, 1);
});

test("visibleShare reports counts beside the rate, and null on an empty population", () => {
  assert.deepEqual(visibleShare(new Array(3118).fill(0), new Array(39).fill(0)), {
    total: 3118, visible: 39, pct: 1.3,
  });
  // No prints is not 0% coverage — it is nothing to cover.
  assert.deepEqual(visibleShare([], []), { total: 0, visible: 0, pct: null });
});

test("compareRuns states the direction outright, including a FALL", () => {
  // The result §5k did not expect: more eligible prints, FEWER velocity firings.
  const c = compareRuns(
    { tickerFirings: 239, firedSteps: 59, steps: 67 },
    { tickerFirings: 220, firedSteps: 57, steps: 67 }
  );
  assert.equal(c.direction, "fell");
  assert.equal(c.delta, -19);
  assert.equal(c.beforeStepPct, 88.1);
  assert.equal(c.afterStepPct, 85.1);
});

test("compareRuns distinguishes unchanged from a small move", () => {
  assert.equal(compareRuns({ tickerFirings: 5, firedSteps: 1, steps: 10 }, { tickerFirings: 5, firedSteps: 1, steps: 10 }).direction, "unchanged");
  assert.equal(compareRuns({ tickerFirings: 5, firedSteps: 1, steps: 10 }, { tickerFirings: 6, firedSteps: 2, steps: 10 }).direction, "rose");
});

test("saturationVerdict flags an always-on signal, which a raw count hides", () => {
  // "SPX split flow: 67" reads like a strong result. 67 of 67 scans means it says nothing.
  assert.deepEqual(saturationVerdict(67, 67), { rate: 100, saturated: true });
  assert.deepEqual(saturationVerdict(65, 67), { rate: 97, saturated: true });
  assert.equal(saturationVerdict(24, 67).saturated, false);
});

test("saturationVerdict refuses a verdict from too few scans", () => {
  assert.equal(saturationVerdict(3, 3), null);
  assert.equal(saturationVerdict(9, 9), null);
  assert.notEqual(saturationVerdict(10, 10), null);
});
