import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("src/features/spx/lib/spx-signal-log.ts", "utf8");

test("spx-signal-log: macro predictions cache rejects future fetchedAt stamps", () => {
  assert.match(src, /import \{ isWsUpdatedAtFresh \} from "@\/lib\/ws\/timestamp-freshness"/);
  assert.match(
    src,
    /isWsUpdatedAtFresh\(cachedMacroPredictions\.fetchedAt, MACRO_PREDICTIONS_CACHE_TTL_MS, now\)/
  );
  assert.doesNotMatch(src, /now - cachedMacroPredictions\.fetchedAt < MACRO_PREDICTIONS_CACHE_TTL_MS/);
});
