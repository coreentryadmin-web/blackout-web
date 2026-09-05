/**
 * Regression guard for a future-timestamp freshness bug in computeLitDarkRatio (2026-09-05).
 * Raw `now - updatedAt <= maxAge` reads clock-skewed future stamps as fresh.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("computeLitDarkRatio: lit/dark freshness uses isWsUpdatedAtFresh (source scan)", () => {
  const src = readFileSync(new URL("./uw-lit-dark-ratio.ts", import.meta.url), "utf8");
  assert.match(
    src,
    /const litFresh = isWsUpdatedAtFresh\(litTradesStore\.updatedAt, LIT_DARK_MAX_AGE_MS, now\)/,
    "lit tape freshness must reject clock-skewed future updatedAt stamps"
  );
  assert.match(
    src,
    /const darkFresh = isWsUpdatedAtFresh\(darkPoolStore\.updatedAt, LIT_DARK_MAX_AGE_MS, now\)/,
    "dark pool freshness must reject clock-skewed future updatedAt stamps"
  );
  assert.doesNotMatch(
    src,
    /now\s*-\s*litTradesStore\.updatedAt\s*<=/,
    "raw now-updatedAt must not gate lit freshness"
  );
  assert.doesNotMatch(
    src,
    /now\s*-\s*darkPoolStore\.updatedAt\s*<=/,
    "raw now-updatedAt must not gate dark freshness"
  );
});
