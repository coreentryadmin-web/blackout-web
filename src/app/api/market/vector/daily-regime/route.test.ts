import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routeSrc = readFileSync("src/app/api/market/vector/daily-regime/route.ts", "utf8");
const siblingSrc = readFileSync("src/app/api/market/vector/walls/route.ts", "utf8");

test("daily-regime carries the same premium + vector + ticker gates as walls", () => {
  for (const gate of ["authorizePremiumDeskApi", 'requireToolApi("vector")', "isVectorTickerAllowed"]) {
    assert.ok(siblingSrc.includes(gate), `precondition: walls route gates on ${gate}`);
    assert.ok(routeSrc.includes(gate), `daily-regime must gate on ${gate}`);
  }
});

test("daily-regime does not use community-tier authorizeMarketDeskApi", () => {
  assert.doesNotMatch(routeSrc, /authorizeMarketDeskApi/);
});

test("daily-regime is uncached and force-dynamic", () => {
  assert.match(routeSrc, /NO_STORE_HEADERS/);
  assert.match(routeSrc, /dynamic = "force-dynamic"/);
});
