import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Drift guard: /vector client-loads seed via VectorPageLoader → /api/market/vector/seed.
 * The SPX dashboard uses SpxVectorEmbed (bars-only client fetch) so HTML is not blocked on cold
 * Polygon reconstruct — chart data still flows through the same /api/market/vector/* paths.
 */
test("Vector seed pipeline: /vector client-loads; dashboard client-embeds without inline internals", () => {
  const vectorPage = readFileSync(join(process.cwd(), "src/app/(site)/vector/page.tsx"), "utf8");
  const dashboardPage = readFileSync(join(process.cwd(), "src/app/(site)/dashboard/page.tsx"), "utf8");
  const seedRoute = readFileSync(
    join(process.cwd(), "src/app/api/market/vector/seed/route.ts"),
    "utf8"
  );

  assert.match(vectorPage, /VectorPageLoader/);
  assert.doesNotMatch(vectorPage, /await loadVectorSeedProps/);
  assert.match(dashboardPage, /SpxVectorEmbed/);
  assert.doesNotMatch(dashboardPage, /await loadVectorSeedProps/);
  assert.match(seedRoute, /loadVectorSeedProps/);
  assert.match(seedRoute, /trimVectorSeedForTransport/);

  const pipelineInternals = [
    "fetchVectorSeedBars",
    "primeVectorWallScope",
    "mergeWallHistory",
    "backfillRailPrefix",
    "reconstructSessionRail",
    "seedWallHistoryForDisplay",
    "loadSessionWallHistory",
  ];
  for (const token of pipelineInternals) {
    assert.equal(
      vectorPage.includes(token),
      false,
      `/vector page must not inline seed internals (${token}) — use VectorPageLoader`
    );
    assert.equal(
      dashboardPage.includes(token),
      false,
      `/dashboard page must not inline seed internals (${token}) — use SpxVectorEmbed`
    );
  }

  const helper = readFileSync(
    join(process.cwd(), "src/features/vector/lib/vector-seed-props.ts"),
    "utf8"
  );
  for (const token of pipelineInternals) {
    assert.match(helper, new RegExp(token), `loadVectorSeedProps must own ${token}`);
  }
});
