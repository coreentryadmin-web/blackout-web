import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { snapshotChangePctFromRow } from "./polygon";

test("snapshotChangePctFromRow: returns null when change is absent — never fabricates 0%", () => {
  assert.equal(snapshotChangePctFromRow(undefined), null);
  assert.equal(snapshotChangePctFromRow({ ticker: "ZZZZ" }), null);
  assert.equal(snapshotChangePctFromRow({ ticker: "ZZZZ", todaysChangePerc: undefined }), null);
});

test("snapshotChangePctFromRow: uses provider todaysChangePerc when present", () => {
  assert.equal(snapshotChangePctFromRow({ todaysChangePerc: 1.2345 }), 1.23);
});

test("snapshotChangePctFromRow: derives from day close vs prior close when % absent", () => {
  assert.equal(
    snapshotChangePctFromRow({ day: { c: 110 }, prevDay: { c: 100 } }),
    10
  );
});

test("fetchStockSnapshotPerformance + fetchMarketMovers must not default missing change to 0", () => {
  const src = readFileSync("src/lib/providers/polygon.ts", "utf8");
  assert.doesNotMatch(src, /todaysChangePerc \?\? 0/);
  assert.match(src, /snapshotChangePctFromRow/);
});

test("_rowToSnapshot uses snapshotChangePctFromRow — never fabricates flat 0%", () => {
  const src = readFileSync("src/lib/providers/polygon.ts", "utf8");
  const block = src.match(/function _rowToSnapshot[\s\S]*?^}/m)?.[0] ?? "";
  assert.match(block, /change_pct: snapshotChangePctFromRow\(row, isEtCashRth\(\)\)/);
  assert.doesNotMatch(block, /change_pct:[\s\S]*?: 0/);
});

test("snapshotChangePctFromRow: cash session open ignores the after-hours anchor (unchanged default)", () => {
  // Same row shape as the AH-anchor test below, but with cashSessionOpen omitted (the default)
  // and explicitly true: must fall through to the standard day.c-vs-prevDay.c reading, not the
  // new day.c-vs-lastTrade after-hours anchor.
  const row = { day: { c: 708.69 }, prevDay: { c: 716.31 }, lastTrade: { p: 706.9 } };
  assert.equal(snapshotChangePctFromRow(row), -1.06);
  assert.equal(snapshotChangePctFromRow(row, true), -1.06);
});

test("snapshotChangePctFromRow: cash session closed anchors an after-hours print to day.c, not prevDay.c", () => {
  // Live 2026-09-11 QQQ case: day.c (Sept-10's real close, $708.69) is the correct anchor for the
  // after-hours print ($706.90) once cash RTH is closed — NOT prevDay.c ($716.31, Sept-9's close),
  // which reads a stale, wrong-magnitude -1.31% instead of the real -0.25% move since the close.
  const pct = snapshotChangePctFromRow(
    { day: { c: 708.69 }, prevDay: { c: 716.31 }, lastTrade: { p: 706.9 }, todaysChangePerc: -1.31 },
    false,
  );
  assert.equal(pct, -0.25);
});

test("snapshotChangePctFromRow: cash session closed, no after-hours print yet — day.c vs itself, not a crash", () => {
  // No lastTrade at all (e.g. right at close, before any AH print): falls back to day.c as both
  // price and anchor, i.e. 0% — a real (if temporary) reading, never a thrown error or NaN.
  assert.equal(snapshotChangePctFromRow({ day: { c: 708.69 }, prevDay: { c: 716.31 } }, false), 0);
});

test("snapshotChangePctFromRow: cash session closed but day.c missing — falls back to the standard reading", () => {
  assert.equal(
    snapshotChangePctFromRow({ todaysChangePerc: 1.2345 }, false),
    1.23,
  );
});
