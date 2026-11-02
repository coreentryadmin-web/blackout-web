import { test } from "node:test";
import assert from "node:assert/strict";
import { selectEarliestBombCandidates } from "./date-bomb-select.mjs";

test("reports the EARLIEST offset that trips a bomb, regardless of the order runs are scanned in", () => {
  const baselineFailureNames = new Set();
  // Out-of-order offsets, exactly as `--offsets=120,10,45` would produce: the +120d run is
  // scanned BEFORE the +10d run, even though +10d is the earlier failure.
  const runs = [
    { offsetDays: 120, ran: true, failures: new Map([["bombTest", "src/lib/swing/live-plays.test.ts"]]) },
    { offsetDays: 10, ran: true, failures: new Map([["bombTest", "src/lib/swing/live-plays.test.ts"]]) },
    { offsetDays: 45, ran: true, failures: new Map([["bombTest", "src/lib/swing/live-plays.test.ts"]]) },
  ];

  const candidates = selectEarliestBombCandidates(baselineFailureNames, runs);

  assert.equal(candidates.get("bombTest").days, 10, "must report the earliest offset (10), not the first-scanned one (120)");
});

test("skips offset-0 (baseline) and runs that never produced a summary", () => {
  const baselineFailureNames = new Set();
  const runs = [
    { offsetDays: 0, ran: true, failures: new Map([["alreadyBrokenToday", "x.ts"]]) },
    { offsetDays: 400, ran: false, failures: new Map([["didNotRunTest", "y.ts"]]) },
    { offsetDays: 10, ran: true, failures: new Map([["realBomb", "z.ts"]]) },
  ];

  const candidates = selectEarliestBombCandidates(baselineFailureNames, runs);

  assert.equal(candidates.has("alreadyBrokenToday"), false, "offsetDays===0 must never be treated as a candidate run");
  assert.equal(candidates.has("didNotRunTest"), false, "a run that did not produce a summary must not contribute candidates");
  assert.equal(candidates.get("realBomb").days, 10);
});

test("excludes a name that is already failing at baseline (today), even if it also fails later", () => {
  const baselineFailureNames = new Set(["alreadyBroken"]);
  const runs = [{ offsetDays: 10, ran: true, failures: new Map([["alreadyBroken", "x.ts"], ["newBomb", "y.ts"]]) }];

  const candidates = selectEarliestBombCandidates(baselineFailureNames, runs);

  assert.equal(candidates.has("alreadyBroken"), false);
  assert.equal(candidates.get("newBomb").days, 10);
});
