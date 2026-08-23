import { test } from "node:test";
import assert from "node:assert/strict";
import { fieldInventory, directionalCoverage, newestPrintAgeHours, DARK_POOL_FIELDS } from "./helix-darkpool-eval.mjs";

const print = (over = {}) => ({
  ticker: "SGOV", premium: 805040, side: "neutral",
  executed_at: "2026-08-21T23:59:08Z", share_size: 8000, ...over,
});

test("a 100%-filled field that never varies is reported as NOT informative", () => {
  // The measured case: all 40 live prints carry side="neutral". A fill-rate inventory would report
  // "side: 100% ALWAYS" and a reader would design a directional panel on it.
  const inv = fieldInventory(Array.from({ length: 40 }, () => print()));
  assert.equal(inv.side.fillPct, 100, "it really is fully populated");
  assert.equal(inv.side.distinctValues, 1);
  assert.equal(inv.side.informative, false, "one distinct value cannot discriminate between rows");
  // …while a genuinely varying field is informative at the same fill rate.
  assert.equal(inv.ticker.fillPct, 100);
  const varied = fieldInventory([print({ ticker: "A" }), print({ ticker: "B" })]);
  assert.equal(varied.ticker.informative, true);
});

test("fieldInventory covers every field the row contract declares", () => {
  const inv = fieldInventory([print()]);
  for (const f of DARK_POOL_FIELDS) assert.ok(inv[f], `${f} must be inventoried`);
  assert.equal(fieldInventory([]), null, "an empty sample yields no inventory, not a zeroed one");
  assert.equal(fieldInventory(null), null);
});

test("a missing field is not counted as present, and empty string is not a value", () => {
  const inv = fieldInventory([print({ share_size: null }), print({ share_size: undefined }), print({ share_size: "" }), print()]);
  assert.equal(inv.share_size.present, 1);
  assert.equal(inv.share_size.fillPct, 25);
});

test("no direction reported is its own status — the panel's guard is CORRECT there", () => {
  const c = directionalCoverage(Array.from({ length: 40 }, () => print()));
  assert.equal(c.status, "NO_DIRECTION_REPORTED");
  assert.equal(c.sidedPrints, 0);
  assert.equal(c.sidedPremiumPct, 0);
  assert.match(c.note, /correctly renders/);
});

test("the case the panel's guard does NOT cover: a verdict from a minority of the premium", () => {
  // 1 sided print worth $1M among 9 unsided worth $9M. `biasFromSide`'s guard only fires when
  // NEITHER side is present, so here it would compute a ratio over 10% of the premium and drop 90%.
  const prints = [print({ side: "buy", premium: 1_000_000 }), ...Array.from({ length: 9 }, () => print({ premium: 1_000_000 }))];
  const c = directionalCoverage(prints);
  assert.equal(c.status, "MINORITY_VERDICT_RISK");
  assert.ok(c.sidedPremiumPct < 50);
  assert.match(c.note, /silently dropped/);
});

test("a majority-sided population is a legitimate directional read", () => {
  const prints = [
    ...Array.from({ length: 8 }, () => print({ side: "buy", premium: 1_000_000 })),
    ...Array.from({ length: 2 }, () => print({ premium: 1_000_000 })),
  ];
  const c = directionalCoverage(prints);
  assert.equal(c.status, "DIRECTIONAL");
  assert.equal(c.sidedPremiumPct, 80);
});

test("an empty feed is NO_DATA, never a confident zero", () => {
  const c = directionalCoverage([]);
  assert.equal(c.status, "NO_DATA");
  assert.equal(c.sidedPremiumPct, null, "null, not 0 — nothing was measured");
});

test("newestPrintAgeHours returns null rather than 0 when nothing is readable", () => {
  const now = Date.parse("2026-08-23T08:00:00Z");
  // The fixture's print is the real one measured live — Friday 2026-08-21 23:59Z — so from Sunday
  // morning it is ~32h old. That staleness is the normal weekend state of this feed, not a fault,
  // which is exactly why the age must be REPORTED rather than assumed fresh.
  assert.equal(Math.round(newestPrintAgeHours([print()], now)), 32);
  // Newest wins, not first or last in the array.
  const mixed = [print({ executed_at: "2026-08-20T00:00:00Z" }), print({ executed_at: "2026-08-23T07:00:00Z" })];
  assert.equal(Math.round(newestPrintAgeHours(mixed, now)), 1);
  // 0 would read as "live" — the one answer an unreadable feed must never give.
  assert.equal(newestPrintAgeHours([print({ executed_at: "nope" })], now), null);
  assert.equal(newestPrintAgeHours([], now), null);
  assert.equal(newestPrintAgeHours(null, now), null);
});
