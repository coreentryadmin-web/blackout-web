import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("src/lib/zerodte/live-marks.ts", "utf8");

test("live-marks: active-set cache rejects future fetchedAt stamps", () => {
  assert.match(src, /import \{ isWsUpdatedAtFresh \} from "@\/lib\/ws\/timestamp-freshness"/);
  assert.match(src, /isWsUpdatedAtFresh\(activeCache\.fetchedAt, ACTIVE_SET_TTL_MS, now\)/);
  assert.doesNotMatch(src, /now - activeCache\.fetchedAt <= ACTIVE_SET_TTL_MS/);
});

test("live-marks: SSE payload memo rejects future builtAt stamps", () => {
  assert.match(src, /isWsUpdatedAtFresh\(payloadMemo\.builtAt, PAYLOAD_MEMO_MS \+ 1, now\)/);
  assert.doesNotMatch(src, /now - payloadMemo\.builtAt <= PAYLOAD_MEMO_MS/);
});
