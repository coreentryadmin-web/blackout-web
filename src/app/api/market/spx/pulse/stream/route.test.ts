import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("spx pulse stream: local index freshness uses isWsUpdatedAtFresh (source scan)", () => {
  const src = readFileSync("src/app/api/market/spx/pulse/stream/route.ts", "utf8");
  assert.match(src, /import \{ isWsUpdatedAtFresh \} from "@\/lib\/ws\/timestamp-freshness"/);
  assert.match(
    src,
    /isWsUpdatedAtFresh\(fresh, 10_000\)/,
    "local indexStore freshness must reject clock-skewed future updatedAt stamps"
  );
  assert.doesNotMatch(
    src,
    /Date\.now\(\)\s*-\s*fresh\s*<\s*10_000/,
    "raw Date.now()-fresh must not gate SPX pulse local freshness"
  );
});
