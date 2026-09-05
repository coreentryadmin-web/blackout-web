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

test("_rowToSnapshot: does not fabricate flat 0% when change is unknowable (source scan)", () => {
  const src = readFileSync("src/lib/providers/polygon.ts", "utf8");
  assert.match(
    src,
    /function _rowToSnapshot[\s\S]*?change_pct: number \| null/,
    "StockQuoteSnapshot.change_pct must allow null"
  );
  assert.doesNotMatch(
    src,
    /function _rowToSnapshot[\s\S]*?:\s*0;\s*\n\s*return \{/,
    "_rowToSnapshot must not fall through to fabricated 0% for change_pct"
  );
});
