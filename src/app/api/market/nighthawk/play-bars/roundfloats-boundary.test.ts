import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("play-bars route wraps JSON with roundFloats at the boundary", () => {
  const src = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
  assert.match(src, /import \{ roundFloats \} from "@\/lib\/round-floats"/);
  assert.match(src, /roundFloats\(\{ occ, since: sinceIso, points \}\)/);
});
