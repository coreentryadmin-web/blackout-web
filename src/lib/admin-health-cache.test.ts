import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

test("admin health snapshot uses shared server cache lane", () => {
  const src = readFileSync(join(root, "src/lib/admin-health.ts"), "utf8");
  assert.match(src, /withServerCache\(\s*ADMIN_HEALTH_CACHE_KEY/);
  assert.match(src, /ADMIN_HEALTH_CACHE_TTL_MS/);
  assert.match(src, /buildAdminHealthSnapshotUncached/);
});

test("Nav and iOS chrome share useAdminFlag instead of duplicate /api/admin/me fetches", () => {
  const nav = readFileSync(join(root, "src/components/Nav.tsx"), "utf8");
  const ios = readFileSync(join(root, "src/components/ios/IosAppChrome.tsx"), "utf8");
  const hook = readFileSync(join(root, "src/hooks/use-admin-flag.ts"), "utf8");
  assert.match(nav, /useAdminFlag\(\)/);
  assert.match(ios, /useAdminFlag\(\)/);
  assert.doesNotMatch(nav, /fetch\("\/api\/admin\/me"\)/);
  assert.doesNotMatch(ios, /fetch\("\/api\/admin\/me"\)/);
  assert.match(hook, /revalidateOnFocus:\s*false/);
});

test("heavy desks disable per-hook SWR focus storms (Thermal + Vector universe)", () => {
  const heatmap = readFileSync(join(root, "src/features/thermal/components/GexHeatmap.tsx"), "utf8");
  const universe = readFileSync(join(root, "src/features/vector/lib/vector-universe-client.ts"), "utf8");
  assert.match(heatmap, /revalidateOnFocus:\s*false/);
  assert.doesNotMatch(heatmap, /revalidateOnFocus:\s*true/);
  assert.match(universe, /revalidateOnFocus:\s*false/);
});
