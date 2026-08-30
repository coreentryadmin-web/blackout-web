import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(process.cwd(), "src/features/vector");

test("VectorPageShell: playEmit bootstraps from seed on ticker switch (not blank until chart mounts)", () => {
  const src = readFileSync(join(root, "components/VectorPageShell.tsx"), "utf8");
  assert.match(src, /bootstrapVectorPlayEmit/);
  assert.match(src, /setPlayEmit\(\s*bootstrapVectorPlayEmit/);
  assert.doesNotMatch(src, /setPlayEmit\(null\)/);
});

test("VectorPageShell: action rail is play-engine only — no Technicals panel", () => {
  const src = readFileSync(join(root, "components/VectorPageShell.tsx"), "utf8");
  assert.doesNotMatch(src, /VectorTechnicalsPanel/);
  assert.match(src, /VectorPlayIntelStrip/);
  assert.match(src, /VectorPlayAnalyticsDrawer/);
});
