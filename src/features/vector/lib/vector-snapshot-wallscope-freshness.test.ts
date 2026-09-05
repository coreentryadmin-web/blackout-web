import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("src/features/vector/lib/vector-snapshot.ts", "utf8");

test("vector-snapshot: wallScope refresh gates reject future fetchedAt stamps", () => {
  assert.match(src, /import \{ isWsUpdatedAtFresh \} from "@\/lib\/ws\/timestamp-freshness"/);
  assert.match(
    src,
    /isWsUpdatedAtFresh\(s\.wallScope\.fetchedAt, refreshMs, now\) \|\| s\.wallScopeInFlight/
  );
  assert.match(
    src,
    /isWsUpdatedAtFresh\(s\.wallScope\.fetchedAt, refreshMs, now\) &&[\s\S]*fallbackStrikeTotals \|\| s\.fallbackVexStrikeTotals/
  );
  assert.doesNotMatch(src, /now - s\.wallScope\.fetchedAt < refreshMs/);
});
