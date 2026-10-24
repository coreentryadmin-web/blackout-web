import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveExpectedMoveInputs, deriveExpectedMoveInputsForEarningsDate } from "./vector-expected-move-atm";
import type { ReconstructContract } from "./vector-gex-reconstruct";

const TODAY = "2026-07-13"; // a Monday
// Fixed "now" mid-session on TODAY (16:00Z = noon ET) so every expiry in the fixtures below
// (all >= 2026-07-17) is genuinely still live, regardless of the real wall-clock date this suite
// happens to run on — the whole point of threading `nowMs` instead of reading Date.now() in tests.
const NOW_MS = Date.parse("2026-07-13T16:00:00Z");
// A couple of hours after TODAY's own 20:00 UTC close — simulates "market closed for the day."
const AFTER_CLOSE_MS = Date.parse("2026-07-13T22:00:00Z");

function c(over: Partial<ReconstructContract>): ReconstructContract {
  return { strike: 7500, expiry: "2026-07-17", openInterest: 100, iv: 0.15, type: "call", ...over };
}

test("deriveExpectedMoveInputs: ATM IV = avg of call+put IV at the strike nearest spot", () => {
  const chain: ReconstructContract[] = [
    c({ strike: 7490, type: "call", iv: 0.2 }),
    c({ strike: 7500, type: "call", iv: 0.16 }),
    c({ strike: 7500, type: "put", iv: 0.18 }), // ATM (spot 7501) — avg(0.16,0.18)=0.17
    c({ strike: 7520, type: "put", iv: 0.25 }),
  ];
  const res = deriveExpectedMoveInputs(chain, 7501, "weekly", TODAY, NOW_MS);
  assert.ok(res);
  assert.equal(res!.expiry, "2026-07-17");
  assert.ok(Math.abs(res!.atmIv - 0.17) < 1e-9, "ATM IV is the call/put average at the nearest strike");
  assert.equal(res!.spot, 7501);
  assert.ok(res!.dteDays > 0, "positive time to expiry");
});

test("deriveExpectedMoveInputs: quotes the FRONT expiry of the horizon, not a later one", () => {
  const chain: ReconstructContract[] = [
    c({ strike: 7500, expiry: "2026-07-17", type: "call", iv: 0.16 }),
    c({ strike: 7500, expiry: "2026-08-21", type: "call", iv: 0.30 }), // later expiry, higher IV
  ];
  const res = deriveExpectedMoveInputs(chain, 7500, "all", TODAY, NOW_MS);
  assert.ok(res);
  assert.equal(res!.expiry, "2026-07-17", "front expiry wins");
  assert.ok(Math.abs(res!.atmIv - 0.16) < 1e-9, "uses the front expiry's IV");
});

test("deriveExpectedMoveInputs: skips strikes with no usable IV; null when none usable", () => {
  const chain: ReconstructContract[] = [
    c({ strike: 7500, type: "call", iv: 0 }), // ATM but no IV
    c({ strike: 7500, type: "put", iv: 0 }),
    c({ strike: 7550, type: "call", iv: 0.19 }), // only usable IV → becomes the ATM pick
  ];
  const res = deriveExpectedMoveInputs(chain, 7500, "weekly", TODAY, NOW_MS);
  assert.ok(res, "falls back to the nearest strike that HAS a real IV");
  assert.ok(Math.abs(res!.atmIv - 0.19) < 1e-9);

  const allZero = [c({ strike: 7500, iv: 0 }), c({ strike: 7510, iv: 0 })];
  assert.equal(deriveExpectedMoveInputs(allZero, 7500, "weekly", TODAY, NOW_MS), null, "no real IV → null");
});

test("deriveExpectedMoveInputs: guards — no spot / empty chain → null", () => {
  assert.equal(deriveExpectedMoveInputs([], 7500, "weekly", TODAY, NOW_MS), null, "empty chain");
  assert.equal(deriveExpectedMoveInputs([c({})], 0, "weekly", TODAY, NOW_MS), null, "no spot");
});

// RED→GREEN regression for the live INTC repro (2026-10-07): a horizon whose nearest listed
// expiry is TODAY rolls forward to the next live expiry once today's has settled, instead of
// quoting a near-zero band off a dead contract. Pre-fix this returned expiry "2026-07-13"
// (today, settled) with dteDays floored to ~1 minute; post-fix it rolls to "2026-07-17".
test("deriveExpectedMoveInputs: rolls PAST today's own expiry once it has settled (post-close)", () => {
  const chain: ReconstructContract[] = [
    c({ strike: 7500, expiry: "2026-07-13", type: "call", iv: 0.2 }), // today, listed, but settled
    c({ strike: 7500, expiry: "2026-07-17", type: "call", iv: 0.21 }), // next live expiry
  ];
  const res = deriveExpectedMoveInputs(chain, 7500, "all", TODAY, AFTER_CLOSE_MS);
  assert.ok(res);
  assert.equal(res!.expiry, "2026-07-17", "rolls past the settled same-day expiry");
  assert.ok(
    res!.dteDays > 1,
    `dteDays should reflect real days to the next live expiry, not the ~1-minute floor (got ${res!.dteDays})`
  );
});

test("deriveExpectedMoveInputs: still live pre-close — today's own expiry wins as usual", () => {
  const chain: ReconstructContract[] = [
    c({ strike: 7500, expiry: "2026-07-13", type: "call", iv: 0.2 }),
    c({ strike: 7500, expiry: "2026-07-17", type: "call", iv: 0.21 }),
  ];
  const res = deriveExpectedMoveInputs(chain, 7500, "all", TODAY, NOW_MS);
  assert.ok(res);
  assert.equal(res!.expiry, "2026-07-13", "today's own expiry is still the front expiry before close");
});

test("deriveExpectedMoveInputs: every scoped expiry settled — falls back to the latest rather than failing", () => {
  const chain: ReconstructContract[] = [
    c({ strike: 7500, expiry: "2026-07-13", type: "call", iv: 0.2 }),
  ];
  const res = deriveExpectedMoveInputs(chain, 7500, "all", TODAY, AFTER_CLOSE_MS);
  assert.ok(res, "no live expiry left, but still answers rather than silently vanishing");
  assert.equal(res!.expiry, "2026-07-13");
});

test("deriveExpectedMoveInputsForEarningsDate: picks expiry on or after the print date", () => {
  const chain: ReconstructContract[] = [
    c({ strike: 7500, expiry: "2026-07-17", type: "call", iv: 0.16 }),
    c({ strike: 7500, expiry: "2026-07-24", type: "call", iv: 0.22 }),
    c({ strike: 7500, expiry: "2026-08-21", type: "call", iv: 0.30 }),
  ];
  const res = deriveExpectedMoveInputsForEarningsDate(chain, 7500, "2026-07-20", TODAY, NOW_MS);
  assert.ok(res);
  assert.equal(res!.expiry, "2026-07-24", "first expiry on/after earnings date");
  assert.ok(Math.abs(res!.atmIv - 0.22) < 1e-9);
});

// RED→GREEN regression, earnings-scoped sibling: a print dated TODAY whose own expiry is the
// first "on or after" candidate rolls to the next live one once TODAY has settled.
test("deriveExpectedMoveInputsForEarningsDate: rolls past a same-day print's settled expiry", () => {
  const chain: ReconstructContract[] = [
    c({ strike: 7500, expiry: "2026-07-13", type: "call", iv: 0.2 }), // print-day expiry, settled
    c({ strike: 7500, expiry: "2026-07-17", type: "call", iv: 0.23 }),
  ];
  const res = deriveExpectedMoveInputsForEarningsDate(chain, 7500, "2026-07-13", TODAY, AFTER_CLOSE_MS);
  assert.ok(res);
  assert.equal(res!.expiry, "2026-07-17", "rolls past the settled print-day expiry");
});
