import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("uw-lit-dark-ratio: freshness uses isWsUpdatedAtFresh (source scan)", () => {
  const src = readFileSync(new URL("./uw-lit-dark-ratio.ts", import.meta.url), "utf8");
  assert.match(
    src,
    /import \{ isWsUpdatedAtFresh \} from "@\/lib\/ws\/timestamp-freshness"/,
    "lit/dark ratio must import shared freshness helper"
  );
  assert.match(
    src,
    /isWsUpdatedAtFresh\(litTradesStore\.updatedAt, LIT_DARK_MAX_AGE_MS\)/,
    "lit tape freshness must reject clock-skewed future updatedAt"
  );
  assert.match(
    src,
    /isWsUpdatedAtFresh\(darkPoolStore\.updatedAt, LIT_DARK_MAX_AGE_MS\)/,
    "dark pool freshness must reject clock-skewed future updatedAt"
  );
  assert.doesNotMatch(
    src,
    /Date\.now\(\)\s*-\s*litTradesStore\.updatedAt/,
    "must not use raw subtraction for lit freshness"
  );
});
