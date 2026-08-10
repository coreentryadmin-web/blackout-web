import { test } from "node:test";
import assert from "node:assert/strict";
import { collectReadings, findSourceConflicts, applyConflictCaveat } from "./cross-source";

test("catches two sources disagreeing about the same instrument", () => {
  // The case that motivates this: one tool serving a cached snapshot while the others are live.
  // Both numbers are real, traceable and grounded; nothing else in the system compares them.
  const results = [
    { ticker: "SPX", spot: 7757.64 },
    { symbol: "SPX", last_price: 7757.7 },
    { ticker: "SPX", spot_price: 7712.1 },
  ];
  const c = findSourceConflicts(results);
  assert.equal(c.length, 1);
  assert.equal(c[0]!.ticker, "SPX");
  assert.equal(c[0]!.min, 7712.1);
  assert.equal(c[0]!.max, 7757.7);
  assert.ok(c[0]!.spreadPct > 0.5);
});

test("normal intra-turn drift is not a conflict", () => {
  // Sources are sampled at different instants. Exact equality is the wrong test — a checker that
  // fires on every turn gets ignored, then deleted.
  assert.deepEqual(
    findSourceConflicts([{ ticker: "SPX", spot: 7757.64 }, { ticker: "SPX", spot: 7758.9 }]),
    []
  );
});

test("one reading is never a disagreement", () => {
  assert.deepEqual(findSourceConflicts([{ ticker: "NVDA", spot: 223.8 }]), []);
  assert.deepEqual(findSourceConflicts([]), []);
});

test("different instruments are never compared", () => {
  // SPX at 7757 and NVDA at 223 are not a 97% disagreement.
  assert.deepEqual(
    findSourceConflicts([{ ticker: "SPX", spot: 7757.64 }, { ticker: "NVDA", spot: 223.8 }]),
    []
  );
});

test("SPXW and SPX are ONE instrument for this comparison", () => {
  // They share an underlying, so a weekly-chain read and an index read disagreeing IS a conflict.
  // Without canonicalisation they would sit in separate buckets and the conflict would be invisible.
  const c = findSourceConflicts([
    { ticker: "SPX", spot: 7757.64 },
    { ticker: "SPXW", spot: 7690.0 },
  ]);
  assert.equal(c.length, 1);
  assert.equal(c[0]!.ticker, "SPX");
});

test("a price is only claimed when the ticker is in the SAME object", () => {
  // Inheriting a ticker from an ancestor would attach a contract's strike or a peer's quote to the
  // wrong instrument and manufacture a conflict. Inventing one trains people to ignore the warning.
  const nested = [{ ticker: "SPX", spot: 7757.64, contracts: [{ strike: 7800, price: 12.4 }] }];
  const readings = collectReadings(nested);
  assert.equal(readings.length, 1, "only the SPX spot, not the contract price");
  assert.equal(readings[0]!.value, 7757.64);
  assert.deepEqual(findSourceConflicts(nested), []);
});

test("non-price numeric fields are ignored", () => {
  // An exact field match, not a substring rule: strike_price and entry_premium are not spots.
  const readings = collectReadings([
    { ticker: "SPX", spot: 7757.64, strike_price: 7800, entry_premium: 6.1, volume: 12345 },
  ]);
  assert.deepEqual(readings.map((r) => r.field), ["spot"]);
});

test("garbage values never become readings", () => {
  const readings = collectReadings([
    { ticker: "SPX", spot: 0 },
    { ticker: "SPX", spot: -5 },
    { ticker: "SPX", spot: "7757" },
    { ticker: "SPX", spot: null },
  ]);
  assert.deepEqual(readings, []);
});

test("the caveat states the RANGE and picks no winner", () => {
  // Which source is right depends on which is freshest — and freshness is exactly what is in doubt
  // when two sources disagree. Naming a winner would be the averaging mistake in a new costume.
  const c = findSourceConflicts([
    { ticker: "SPX", spot: 7757.64 },
    { ticker: "SPX", spot: 7712.1 },
  ]);
  const out = applyConflictCaveat("answer", c);
  assert.ok(out.startsWith("answer"));
  assert.match(out, /Sources disagree on SPX/);
  assert.match(out, /7712\.1 to 7757\.64/);
  assert.match(out, /stale snapshot/);
  assert.equal(applyConflictCaveat("answer", []), "answer");
});

test("traversal is total — cycles, depth and junk do not throw", () => {
  const cyclic: Record<string, unknown> = { ticker: "SPX", spot: 7757.64 };
  cyclic.self = cyclic;
  assert.doesNotThrow(() => findSourceConflicts([cyclic]));
  assert.doesNotThrow(() => findSourceConflicts([null, undefined, 42, "str", [[[[[[{ a: 1 }]]]]]]]));
});
