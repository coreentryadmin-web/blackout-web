import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { computeLitDarkRatio } from "./uw-lit-dark-ratio";
import { darkPoolStore, litTradesStore } from "@/lib/ws/uw-socket";

const src = readFileSync(join(process.cwd(), "src/lib/uw-lit-dark-ratio.ts"), "utf8");

test("computeLitDarkRatio uses isWsUpdatedAtFresh, not raw Date.now() - updatedAt", () => {
  assert.match(src, /import \{ isWsUpdatedAtFresh \} from "@\/lib\/ws\/timestamp-freshness"/);
  assert.match(src, /isWsUpdatedAtFresh\(litTradesStore\.updatedAt, LIT_DARK_MAX_AGE_MS, now\)/);
  assert.match(src, /isWsUpdatedAtFresh\(darkPoolStore\.updatedAt, LIT_DARK_MAX_AGE_MS, now\)/);
  assert.doesNotMatch(src, /now - litTradesStore\.updatedAt/);
  assert.doesNotMatch(src, /now - darkPoolStore\.updatedAt/);
});

test("computeLitDarkRatio returns null when both stores carry far-future updatedAt", () => {
  const now = Date.parse("2026-09-04T15:00:00.000Z");
  const future = now + 60_000;
  litTradesStore.updatedAt = future;
  litTradesStore.rows = [{ symbol: "SPY", premium: 1_000_000 } as never];
  darkPoolStore.updatedAt = future;
  darkPoolStore.data = { total_premium: 500_000, prints: [] } as never;
  assert.equal(computeLitDarkRatio(now), null);
});
