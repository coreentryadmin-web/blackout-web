import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routeSrc = readFileSync("src/app/api/market/heatmap/route.ts", "utf8");

test("heatmap route rounds floats at the data layer", () => {
  assert.match(routeSrc, /roundFloats\(/);
  assert.match(routeSrc, /import \{ roundFloats \} from "@\/lib\/round-floats"/);
});
