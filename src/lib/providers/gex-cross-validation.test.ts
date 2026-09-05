import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

test("gex-cross-validation: UW ladder cache hit uses gexHeatmapCacheEntryWithinTtl (source scan)", () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "gex-cross-validation.ts"),
    "utf8"
  );
  assert.match(
    src,
    /import \{ gexHeatmapCacheEntryWithinTtl \} from "@\/lib\/providers\/polygon-options-gex"/,
    "must import the shared TTL+future-skew helper"
  );
  assert.match(
    src,
    /gexHeatmapCacheEntryWithinTtl\(entry\.cachedAt, now, CACHE_TTL_MS\)/,
    "getUwStrikeLadder cache admission must route through gexHeatmapCacheEntryWithinTtl"
  );
  assert.doesNotMatch(
    src,
    /Date\.now\(\)\s*-\s*entry\.cachedAt\s*<\s*CACHE_TTL_MS/,
    "must not regress to raw now - cachedAt comparison (future skew reads as fresh)"
  );
});
