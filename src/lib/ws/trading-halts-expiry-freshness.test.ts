import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "trading-halts-expiry.ts"),
  "utf8"
);

test("trading-halts-expiry: isHaltStillActive rejects future receivedAt via isWsUpdatedAtFresh", () => {
  assert.match(src, /isWsUpdatedAtFresh\(halt\.receivedAt, maxAgeMs \+ 1, now\)/);
  assert.doesNotMatch(src, /now - halt\.receivedAt <= maxAgeMs/);
});
