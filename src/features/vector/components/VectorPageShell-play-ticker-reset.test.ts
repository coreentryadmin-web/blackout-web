import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(process.cwd(), "src/features/vector");

test("VectorPageShell: playEmit/technicals/expectedMove/confluence reset on ticker switch, mirroring the alert-rules reset", () => {
  // Regression guard for the 2026-08-27 fix: playEmit/technicals/expectedMove/confluence are all
  // populated by VectorChart's onXChange callbacks but live in THIS parent component, so
  // VectorChart's key={activeTicker} remount does nothing to reset them. VectorPlayCard kept
  // rendering the PREVIOUS ticker's grade/bias/entry/stop/target/invalidation -- real, believable
  // risk levels -- until the newly-mounted chart for the new ticker completed its first fetch and
  // called onPlayChange. No rendering harness exists in this repo, so this asserts the fix is
  // wired into the source, matching the existing alert-rules reset effect it mirrors.
  const src = readFileSync(join(root, "components/VectorPageShell.tsx"), "utf8");
  const resetEffect = src.match(
    /useEffect\(\(\) => \{\s*setPlayEmit\(null\);\s*setTechnicals\(\[\]\);\s*setExpectedMove\(\[\]\);\s*setConfluence\(null\);\s*\}, \[activeTicker\]\);/
  );
  assert.ok(resetEffect, "expected a useEffect resetting playEmit/technicals/expectedMove/confluence keyed on [activeTicker]");
});
