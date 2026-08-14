import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("/vector page uses VectorPageClient for soft ticker navigation", () => {
  const page = readFileSync(join(process.cwd(), "src/app/(site)/vector/page.tsx"), "utf8");
  assert.match(page, /VectorPageClient/);
  assert.doesNotMatch(page, /<VectorPageShell/);
});

test("VectorPageClient wires client seed fetch on ticker switch", () => {
  const src = readFileSync(
    join(process.cwd(), "src/features/vector/components/VectorPageClient.tsx"),
    "utf8"
  );
  assert.match(src, /fetchVectorClientSeed/);
  assert.match(src, /history\.replaceState/);
  assert.match(src, /onTickerSelect=\{onTickerSelect\}/);
});

test("vector-play-invariants refreshes Clerk session on 401", () => {
  const src = readFileSync(join(process.cwd(), "scripts/audit/vector-play-invariants.mjs"), "utf8");
  assert.match(src, /httpStats\.refreshed/);
  assert.match(src, /activeSession = null/);
});
