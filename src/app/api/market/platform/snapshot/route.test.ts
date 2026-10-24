import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

// Regression (2026-10-20, DISCOVERY-lane input-validation sweep): `?? 50` only guards an absent
// `flow_limit` param — a non-numeric one survives it as NaN (neither null nor undefined), and
// stays NaN through getPlatformSnapshot's own `opts?.flowLimit ?? 50` (same gap, one layer
// deeper) all the way to a raw SQL `LIMIT` bind in fetchRecentFlows, which throws and is caught
// by the per-service `.catch(() => { snapshot.flows = null })` — silently nulling the flow tape
// for a caller (including Largo's own cross-product tool-calling) with no way to tell "no data"
// from "malformed flow_limit". `|| 50` catches it here (NaN is falsy) before it ever leaves
// this route.
test("the flow_limit query param falls back to 50 on malformed (non-numeric) input, not NaN", () => {
  assert.match(
    src,
    /Number\(sp\.get\("flow_limit"\) \?\? 50\) \|\| 50/,
    "flow_limit must be guarded with `|| 50` so a non-numeric param can't survive as NaN"
  );
});
