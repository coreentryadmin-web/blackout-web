import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(new URL("./uw-lit-dark-ratio.ts", import.meta.url), "utf8");

test("computeLitDarkRatio uses isWsUpdatedAtFresh, not raw Date.now() - updatedAt", () => {
  assert.match(src, /import \{ isWsUpdatedAtFresh \} from "@\/lib\/ws\/timestamp-freshness"/);
  assert.match(src, /isWsUpdatedAtFresh\(litTradesStore\.updatedAt, LIT_DARK_MAX_AGE_MS, now\)/);
  assert.match(src, /isWsUpdatedAtFresh\(darkPoolStore\.updatedAt, LIT_DARK_MAX_AGE_MS, now\)/);
  assert.doesNotMatch(
    src,
    /now\s*-\s*litTradesStore\.updatedAt\s*<=/,
    "future timestamps must not read as live"
  );
});
