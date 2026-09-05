import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("src/components/auth/auth-failure-detect.ts", "utf8");

test("auth-failure-detect: dedupe window rejects future at stamps", () => {
  assert.match(src, /import \{ isWsUpdatedAtFresh \} from "@\/lib\/ws\/timestamp-freshness"/);
  assert.match(src, /isWsUpdatedAtFresh\(lastReported\.at, DEDUPE_WINDOW_MS, now\)/);
  assert.doesNotMatch(src, /now - lastReported\.at < DEDUPE_WINDOW_MS/);
});
