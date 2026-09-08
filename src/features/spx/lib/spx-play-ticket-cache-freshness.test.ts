import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("src/features/spx/lib/spx-play-options.ts", "utf8");

test("spx-play-options: graded ticket cache rejects future at stamps", () => {
  assert.match(src, /import \{ isWsUpdatedAtFresh \} from "@\/lib\/ws\/timestamp-freshness"/);
  assert.match(src, /isWsUpdatedAtFresh\(ticketCache\.at, 45_000, now\)/);
  assert.doesNotMatch(src, /now - ticketCache\.at < 45_000/);
});
