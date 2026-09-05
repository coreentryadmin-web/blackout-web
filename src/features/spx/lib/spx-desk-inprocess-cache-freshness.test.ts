import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("src/features/spx/lib/spx-desk.ts", "utf8");

const guards = [
  {
    label: "dark pool REST cache",
    fresh: /isWsUpdatedAtFresh\(cachedDarkPool\.fetchedAt, DARK_POOL_CACHE_MS, now\)/,
    stale: /now - cachedDarkPool\.fetchedAt < DARK_POOL_CACHE_MS/,
  },
  {
    label: "prior-day pulse lane cache",
    fresh: /isWsUpdatedAtFresh\(cachedPriorDay\.fetchedAt, 60_000, now\)/,
    stale: /now - cachedPriorDay\.fetchedAt < 60_000/,
  },
  {
    label: "pulse structure kick refresh",
    fresh:
      /isWsUpdatedAtFresh\(cachedPulseStructure\.fetchedAt, ttl, now\)[\s\S]*pulseStructureInflight = refreshPulseStructureCore/,
    stale: /now - cachedPulseStructure\.fetchedAt < ttl/,
  },
] as const;

test("spx-desk: imports shared future-at freshness helper", () => {
  assert.match(src, /import \{ isWsUpdatedAtFresh \} from "@\/lib\/ws\/timestamp-freshness"/);
});

for (const { label, fresh, stale } of guards) {
  test(`${label}: in-process cache rejects future fetchedAt stamps`, () => {
    assert.match(src, fresh);
    assert.doesNotMatch(src, stale);
  });
}
