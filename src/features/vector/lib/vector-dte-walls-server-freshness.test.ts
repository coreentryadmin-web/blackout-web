import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("src/features/vector/lib/vector-dte-walls-server.ts", "utf8");

test("vector-dte-walls-server: per-expiry memo rejects future at stamps", () => {
  assert.match(src, /import \{ isWsUpdatedAtFresh \} from "@\/lib\/ws\/timestamp-freshness"/);
  assert.match(src, /isWsUpdatedAtFresh\(cached\.at, MEMO_TTL_MS, now\)/);
  assert.doesNotMatch(src, /now - cached\.at < MEMO_TTL_MS/);
});
