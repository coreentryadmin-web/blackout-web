import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("src/lib/largo/technicals.ts", "utf8");

test("buildLargoTechnicals: live WS price must rebase change_pct against REST snapshot", () => {
  assert.match(src, /import \{ rebaseChangePct \} from "@\/lib\/providers\/change-pct"/);
  assert.match(
    src,
    /if \(ws != null\)[\s\S]*?rebaseChangePct\(ws, row\)/,
    "index WS path must rebase against the index snapshot already fetched"
  );
  assert.match(
    src,
    /wsCandle\.changePct[\s\S]*?rebaseChangePct\(ws, equitySnap\)/,
    "equity WS path must prefer authoritative WS change_pct, then rebase against REST snapshot"
  );
  assert.doesNotMatch(
    src,
    /if \(ws != null\) \{\s*price = ws;\s*\} else if \(isIndex\)/,
    "WS path must not leave change_pct unset when a REST baseline exists"
  );
});
