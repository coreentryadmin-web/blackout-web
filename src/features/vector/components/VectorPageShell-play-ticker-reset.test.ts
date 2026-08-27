import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(process.cwd(), "src/features/vector");

test("VectorPageShell: playEmit/expectedMove/confluence reset on ticker switch, mirroring the alert-rules reset", () => {
  // Regression guard for the 2026-08-27 fix: playEmit/expectedMove/confluence are populated by
  // VectorChart callbacks but live in THIS parent — reset on ticker switch.
  const src = readFileSync(join(root, "components/VectorPageShell.tsx"), "utf8");
  const resetEffect = src.match(
    /useEffect\(\(\) => \{\s*setPlayEmit\(null\);\s*setExpectedMove\(\[\]\);\s*setConfluence\(null\);\s*setPlayAnalyticsOpen\(false\);\s*\}, \[activeTicker\]\);/
  );
  assert.ok(resetEffect, "expected a useEffect resetting playEmit/expectedMove/confluence keyed on [activeTicker]");
});

test("VectorPageShell: action rail is play-engine only — no Technicals panel", () => {
  const src = readFileSync(join(root, "components/VectorPageShell.tsx"), "utf8");
  assert.doesNotMatch(src, /VectorTechnicalsPanel/);
  assert.match(src, /VectorPlayIntelStrip/);
  assert.match(src, /VectorPlayAnalyticsDrawer/);
});
