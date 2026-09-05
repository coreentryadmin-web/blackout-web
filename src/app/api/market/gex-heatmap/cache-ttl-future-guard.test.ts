import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));

/** #3834/#3839 fixed polygon-options-gex caches; overlay/explain routes had the same raw shape. */
test("gex-heatmap route overlay + NH context caches gate through gexHeatmapCacheEntryWithinTtl", () => {
  const src = readFileSync(join(here, "route.ts"), "utf8");
  assert.match(src, /import \{[^}]*gexHeatmapCacheEntryWithinTtl[^}]*\} from "@\/lib\/providers\/polygon-options-gex"/);
  assert.match(src, /gexHeatmapCacheEntryWithinTtl\(mem\.at, now, NH_CONTEXT_TTL_MS\)/);
  assert.match(src, /gexHeatmapCacheEntryWithinTtl\(mem\.at, now, OVERLAY_TTL_MS\)/);
  assert.match(src, /gexHeatmapCacheEntryWithinTtl\(hit\.at, now, OVERLAY_TTL_MS\)/);
  assert.doesNotMatch(src, /now - mem\.at < NH_CONTEXT_TTL_MS/);
  assert.doesNotMatch(src, /now - mem\.at < OVERLAY_TTL_MS/);
  assert.doesNotMatch(src, /now - hit\.at < OVERLAY_TTL_MS/);
});

test("gex-heatmap explain route caches gate through gexHeatmapCacheEntryWithinTtl", () => {
  const src = readFileSync(join(here, "explain", "route.ts"), "utf8");
  assert.match(src, /gexHeatmapCacheEntryWithinTtl\(mem\.at, now, EXPLAIN_TTL_MS\)/);
  assert.match(src, /gexHeatmapCacheEntryWithinTtl\(hit\.at, now, EXPLAIN_TTL_MS\)/);
  assert.match(src, /gexHeatmapCacheEntryWithinTtl\(ov\.at, now, EXPLAIN_TTL_MS\)/);
  assert.doesNotMatch(src, /now - mem\.at < EXPLAIN_TTL_MS/);
  assert.doesNotMatch(src, /now - hit\.at < EXPLAIN_TTL_MS/);
  assert.doesNotMatch(src, /now - ov\.at < EXPLAIN_TTL_MS/);
});
