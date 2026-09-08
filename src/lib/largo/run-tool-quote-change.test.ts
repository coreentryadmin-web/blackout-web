import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("src/lib/largo/run-tool.ts", "utf8");

test("toolQuote: index WS path must not fabricate change_pct as flat 0%", () => {
  assert.match(src, /return \{ ticker: sym, price: ws, change_pct: null, source: "polygon_ws" \}/);
  assert.doesNotMatch(
    src,
    /change_pct: 0, source: "polygon_ws"/,
    "WS price without authoritative change must be null, not 0"
  );
});
