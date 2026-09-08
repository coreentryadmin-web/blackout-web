import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routeSrc = readFileSync("src/app/api/market/gex-heatmap/route.ts", "utf8");
const explainSrc = readFileSync("src/app/api/market/gex-heatmap/explain/route.ts", "utf8");

test("gex-heatmap route: NH context + overlay caches reject future at stamps", () => {
  assert.match(routeSrc, /import \{ isWsUpdatedAtFresh \} from "@\/lib\/ws\/timestamp-freshness"/);
  assert.match(routeSrc, /isWsUpdatedAtFresh\(mem\.at, NH_CONTEXT_TTL_MS, now\)/);
  assert.match(routeSrc, /isWsUpdatedAtFresh\(mem\.at, OVERLAY_TTL_MS, now\)/);
  assert.match(routeSrc, /isWsUpdatedAtFresh\(hit\.at, OVERLAY_TTL_MS, now\)/);
  assert.doesNotMatch(routeSrc, /now - mem\.at < NH_CONTEXT_TTL_MS/);
  assert.doesNotMatch(routeSrc, /now - mem\.at < OVERLAY_TTL_MS/);
  assert.doesNotMatch(routeSrc, /now - hit\.at < OVERLAY_TTL_MS/);
});

test("gex-heatmap explain route: mem + redis + overlay reuse reject future at stamps", () => {
  assert.match(explainSrc, /import \{ isWsUpdatedAtFresh \} from "@\/lib\/ws\/timestamp-freshness"/);
  assert.match(explainSrc, /isWsUpdatedAtFresh\(mem\.at, EXPLAIN_TTL_MS, now\)/);
  assert.match(explainSrc, /isWsUpdatedAtFresh\(hit\.at, EXPLAIN_TTL_MS, now\)/);
  assert.match(explainSrc, /isWsUpdatedAtFresh\(ov\.at, EXPLAIN_TTL_MS, now\)/);
  assert.doesNotMatch(explainSrc, /now - mem\.at < EXPLAIN_TTL_MS/);
  assert.doesNotMatch(explainSrc, /now - hit\.at < EXPLAIN_TTL_MS/);
  assert.doesNotMatch(explainSrc, /now - ov\.at < EXPLAIN_TTL_MS/);
});
