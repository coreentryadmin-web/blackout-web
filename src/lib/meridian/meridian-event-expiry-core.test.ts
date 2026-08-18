import { test } from "node:test";
import assert from "node:assert/strict";
import {
  daysBetweenYmd,
  pickEventExpiry,
  scopeStructureToExpiry,
  describeEventExpiry,
} from "./meridian-event-expiry-core";

test("daysBetweenYmd: plain differences, including across a month boundary", () => {
  assert.equal(daysBetweenYmd("2026-08-18", "2026-08-21"), 3);
  assert.equal(daysBetweenYmd("2026-08-18", "2026-08-18"), 0);
  assert.equal(daysBetweenYmd("2026-08-28", "2026-09-04"), 7);
  assert.equal(daysBetweenYmd("2026-02-27", "2026-03-02"), 3);
});

test("daysBetweenYmd: rejects malformed dates instead of returning NaN", () => {
  assert.equal(daysBetweenYmd("nope", "2026-08-21"), null);
  assert.equal(daysBetweenYmd("2026-08-21", ""), null);
});

test("pickEventExpiry: the first expiry ON OR AFTER the print", () => {
  const ex = ["2026-08-14", "2026-08-21", "2026-08-28", "2026-09-18"];
  assert.equal(pickEventExpiry(ex, "2026-08-18"), "2026-08-21");
});

test("pickEventExpiry: a same-day expiry qualifies — it settles after an AMC release", () => {
  assert.equal(pickEventExpiry(["2026-08-14", "2026-08-18", "2026-08-21"], "2026-08-18"), "2026-08-18");
});

test("pickEventExpiry: does NOT trust axis order — far-dated columns are merged in after near ones", () => {
  // The real matrix appends far-dated monthlies AFTER the near-term block, so the axis is not
  // reliably ascending. Taking the first match in array order would pick the monthly.
  const outOfOrder = ["2026-09-18", "2026-12-18", "2026-08-21", "2026-08-28"];
  assert.equal(pickEventExpiry(outOfOrder, "2026-08-18"), "2026-08-21");
});

test("pickEventExpiry: no event date, no pick", () => {
  assert.equal(pickEventExpiry(["2026-08-21"], null), null);
  assert.equal(pickEventExpiry(["2026-08-21"], "garbage"), null);
});

const cells = {
  // strike -> expiry -> net dealer dollar gamma
  "90": { "2026-08-14": -5_000_000, "2026-08-21": -1_000_000 },
  "100": { "2026-08-14": 9_000_000, "2026-08-21": 500_000 },
  "110": { "2026-08-14": 1_000_000, "2026-08-21": 4_000_000 },
};
const expiries = ["2026-08-14", "2026-08-21", "2026-09-18"];

test("scope: the walls come from the EVENT expiry, not the loudest near-term one", () => {
  // On 08-14 the biggest positive gamma is at 100; on the event expiry it is at 110. An
  // unscoped read would point a member at the wrong wall entirely.
  const s = scopeStructureToExpiry({ cells, expiries, eventYmd: "2026-08-18" });
  assert.equal(s.expiryUsed, "2026-08-21");
  assert.equal(s.callWall, 110, "call wall must be the event expiry's largest POSITIVE gamma");
  assert.equal(s.putWall, 90);
  assert.equal(s.daysFromEvent, 3);
});

test("scope: net gex sums only the scoped expiry", () => {
  const s = scopeStructureToExpiry({ cells, expiries, eventYmd: "2026-08-18" });
  assert.equal(s.netGex, -1_000_000 + 500_000 + 4_000_000);
});

test("scope: max pain is taken for the SCOPED expiry, not the front one", () => {
  const s = scopeStructureToExpiry({
    cells,
    expiries,
    eventYmd: "2026-08-18",
    maxPainByExpiry: { "2026-08-14": 95, "2026-08-21": 105 },
  });
  assert.equal(s.maxPain, 105, "the front expiry's max pain describes a chain that dies pre-print");
});

test("scope: an empty column reports null net gex, never a confident zero", () => {
  // A 0 here would render as "perfectly balanced dealer gamma" on a chain we have no data for.
  const s = scopeStructureToExpiry({ cells: {}, expiries, eventYmd: "2026-08-18" });
  assert.equal(s.netGex, null);
  assert.equal(s.callWall, null);
  assert.equal(s.putWall, null);
  assert.deepEqual(s.strikeTotals, {});
});

test("scope: a chain that does not reach the print says so", () => {
  const s = scopeStructureToExpiry({ cells, expiries: ["2026-08-14"], eventYmd: "2026-08-18" });
  assert.equal(s.noCoveringExpiry, true);
  assert.equal(s.expiryUsed, null);
  assert.equal(describeEventExpiry(s), "no listed expiry covers this print");
});

test("scope: no event date is NOT the same as no covering expiry", () => {
  const s = scopeStructureToExpiry({ cells, expiries, eventYmd: null });
  assert.equal(s.noCoveringExpiry, false, "we simply were not asked about an event");
  assert.equal(s.expiryUsed, null);
});

test("scope: reports how many expiries the unscoped aggregate would have mixed", () => {
  const s = scopeStructureToExpiry({ cells, expiries, eventYmd: "2026-08-18" });
  assert.equal(s.aggregateExpiryCount, 3);
});

test("scope: a strike present on other expiries but absent on this one is excluded", () => {
  const sparse = { "90": { "2026-08-14": -5_000_000 }, "110": { "2026-08-21": 4_000_000 } };
  const s = scopeStructureToExpiry({ cells: sparse, expiries, eventYmd: "2026-08-18" });
  assert.deepEqual(Object.keys(s.strikeTotals), ["110"]);
  assert.equal(s.putWall, null, "no negative gamma on the event expiry means no put wall");
});

test("describeEventExpiry: says whether the chain settles on the print or after it", () => {
  const same = scopeStructureToExpiry({ cells, expiries: ["2026-08-18"], eventYmd: "2026-08-18" });
  assert.match(describeEventExpiry(same)!, /day of the print/);
  const after = scopeStructureToExpiry({ cells, expiries, eventYmd: "2026-08-18" });
  assert.match(describeEventExpiry(after)!, /3d after the print/);
});
