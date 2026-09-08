import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("src/features/spx/lib/spx-lotto-options.ts", "utf8");

test("spx-lotto-options: lotto ticket cache rejects future at stamps", () => {
  assert.match(src, /import \{ isWsUpdatedAtFresh \} from "@\/lib\/ws\/timestamp-freshness"/);
  assert.match(src, /isWsUpdatedAtFresh\(lottoTicketCache\.at, 60_000, now\)/);
  assert.doesNotMatch(src, /now - lottoTicketCache\.at < 60_000/);
});
