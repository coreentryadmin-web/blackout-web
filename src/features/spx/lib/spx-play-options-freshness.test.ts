import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("src/features/spx/lib/spx-play-options.ts", "utf8");

test("spx-play-options: 0DTE quote cache rejects future at stamps", () => {
  assert.match(src, /import \{ isWsUpdatedAtFresh \} from "@\/lib\/ws\/timestamp-freshness"/);
  assert.match(src, /isWsUpdatedAtFresh\(cached\.at, QUOTE_TTL_MS, now\)/);
  assert.doesNotMatch(src, /now - cached\.at < QUOTE_TTL_MS/);
});

test("spx-play-options: ticket cache rejects future at stamps", () => {
  assert.match(src, /isWsUpdatedAtFresh\(ticketCache\.at, 45_000, now\)/);
  assert.doesNotMatch(src, /now - ticketCache\.at < 45_000/);
});
