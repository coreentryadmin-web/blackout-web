import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

// Regression (2026-10-20, DISCOVERY-lane input-validation sweep): `?? 10` only guards an absent
// `limit` param — a non-numeric one (e.g. `limit=foo`) produces `Number("foo")` = NaN, which
// survives `??` (NaN is neither null nor undefined). That NaN then poisons
// `fetchPolygonTickerSearch`'s own `upstreamLimit` derivation (sent to Polygon as the literal
// string "NaN") and its final `.slice(0, limit)`, which silently returns [] for a perfectly
// valid ticker query. `|| 10` catches it (NaN is falsy), matching the safe idiom
// src/app/api/market/flows/route.ts already uses.
test("the limit query param falls back to 10 on malformed (non-numeric) input, not NaN", () => {
  assert.match(
    src,
    /Number\(req\.nextUrl\.searchParams\.get\("limit"\) \?\? 10\) \|\| 10/,
    "limit must be guarded with `|| 10` so a non-numeric param can't survive as NaN"
  );
});
