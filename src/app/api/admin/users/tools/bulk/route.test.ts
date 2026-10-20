import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

// Regression (2026-10-20, DISCOVERY-lane input-validation sweep): `body.limit ?? 200` only
// guards an absent field — a malformed one (e.g. `{"limit":"all"}`) produces
// `Number("all")` = NaN, which survives `??` (NaN is neither null nor undefined) and makes
// both `Math.max`/`Math.min` wrapping it NaN too. `while (updated < limit)` is then
// `0 < NaN` = false on the very first check, so the whole bulk tool-access update silently
// no-ops — `200 {ok:true, updated:0, scanned:0, errors:[]}` — reading as "no matching users
// exist" rather than "the limit field was malformed." `|| 200` catches it (NaN is falsy).
test("the limit body field falls back to 200 on malformed (non-numeric) input, not NaN", () => {
  assert.match(
    src,
    /Number\(body\.limit \?\? 200\) \|\| 200/,
    "limit must be guarded with `|| 200` so a non-numeric body field can't survive as NaN and silently zero the bulk loop"
  );
});
