import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// /flows/stream is the live SSE lane for the same flow numbers as /flows REST.
// It must round at the boundary so members never see IEEE float tails on the wire.
const src = readFileSync("src/app/api/market/flows/stream/route.ts", "utf8");
const sibling = readFileSync("src/app/api/market/flows/route.ts", "utf8");

test("/flows/stream rounds floats before JSON.stringify, like /flows REST", () => {
  assert.match(sibling, /roundFloats\(/, "precondition: REST flows route rounds");
  assert.match(src, /import \{ roundFloats \} from "@\/lib\/round-floats"/);
  assert.match(src, /JSON\.stringify\(roundFloats\(payload\)\)/);
});
