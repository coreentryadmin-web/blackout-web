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

test("_rowToSnapshot must delegate change_pct to snapshotChangePctFromRow — never fabricate 0%", () => {
  const src = readFileSync("src/lib/providers/polygon.ts", "utf8");
  const fn = src.slice(src.indexOf("function _rowToSnapshot"), src.indexOf("export async function fetchStockSnapshot"));
  assert.match(fn, /snapshotChangePctFromRow\(row\)/);
  assert.doesNotMatch(fn, /:\s*0;/, "must not fall back to fabricated flat 0%");
});
