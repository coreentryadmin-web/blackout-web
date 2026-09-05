import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const routeSrc = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const explainSrc = readFileSync(new URL("./explain/route.ts", import.meta.url), "utf8");

test("gex-heatmap overlay + NH context caches reject future at stamps (cross-replica clock skew)", () => {
  assert.match(routeSrc, /import \{ isWsUpdatedAtFresh \} from "@\/lib\/ws\/timestamp-freshness"/);
  assert.match(routeSrc, /isWsUpdatedAtFresh\(mem\.at, NH_CONTEXT_TTL_MS/);
  assert.match(routeSrc, /isWsUpdatedAtFresh\(mem\.at, OVERLAY_TTL_MS/);
  assert.match(routeSrc, /isWsUpdatedAtFresh\(hit\.at, OVERLAY_TTL_MS/);
});

test("gex-heatmap explain cache rejects future at stamps on L1/L2 and overlay reuse", () => {
  assert.match(explainSrc, /import \{ isWsUpdatedAtFresh \} from "@\/lib\/ws\/timestamp-freshness"/);
  assert.match(explainSrc, /isWsUpdatedAtFresh\(mem\.at, EXPLAIN_TTL_MS/);
  assert.match(explainSrc, /isWsUpdatedAtFresh\(hit\.at, EXPLAIN_TTL_MS/);
  assert.match(explainSrc, /isWsUpdatedAtFresh\(ov\.at, EXPLAIN_TTL_MS/);
});
