import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

// Regression guard for the bug where the archive-reset effect's dependency included the same
// price-sensitive `contextKey` used to trigger pool re-fetches (embeds live spot, which changes
// on nearly every tick). Merged in #3023 with the price-sensitive key, which cleared
// `excludeOccs`/`archivedClosed` before the exclusion could survive even one fetch cycle — the
// invalidated pick could come right back into the pool and the Closed strip would flicker empty.
// Fixed in the same PR review cycle: the reset must key off a genuine new SETUP (ticker/bias/
// thesis), not a bare price move.
test("use-vector-actionable-picks: archive reset does not depend on live spot/walls/conviction", () => {
  const src = read("src/features/vector/lib/use-vector-actionable-picks.ts");

  // The reset effect's own key must not be built from emit.spot/callWall/putWall/conviction —
  // those are exactly the fields that change on a price tick, not a setup change.
  const setupKeyMatch = src.match(/const setupKey = `([^`]*)`/);
  assert.ok(setupKeyMatch, "expected a setupKey template literal driving the reset effect");
  const setupKeyExpr = setupKeyMatch![1]!;
  for (const priceSensitiveField of ["emit.spot", "emit.callWall", "emit.putWall", "conviction"]) {
    assert.ok(
      !setupKeyExpr.includes(priceSensitiveField),
      `setupKey must not include ${priceSensitiveField} — it changes on every price tick, which would wipe the archive before an exclusion can survive one fetch cycle`
    );
  }

  // The reset effect must depend on setupKey, not the raw contextKey used for fetching.
  assert.match(
    src,
    /useEffect\(\(\) => \{\s*setExcludeOccs\(\[\]\);\s*setArchivedClosed\(\[\]\);\s*archivedOccsRef\.current\.clear\(\);\s*\}, \[setupKey\]\)/,
    "the archive-reset effect must depend on [setupKey], not [ticker, contextKey]"
  );
});
