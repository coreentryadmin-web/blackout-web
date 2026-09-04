import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routeSrc = readFileSync("src/app/api/market/quote/route.ts", "utf8");

test("WS index freshness rejects future timestamps (clock skew)", () => {
  assert.match(routeSrc, /ageMs >= -WS_STALE_MS/);
  assert.match(routeSrc, /Math\.max\(0, ageMs\) < WS_STALE_MS/);
});

test("WS stock path rebases change_pct from the shared REST cache when available", () => {
  assert.match(routeSrc, /withFreshPrice\(/);
  assert.match(routeSrc, /mem\.payload\.change_pct/);
});
