import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("route wraps JSON with roundFloats at the boundary", () => {
  const src = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
  assert.match(src, /roundFloats\(/);
});
