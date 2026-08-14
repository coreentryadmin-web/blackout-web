import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Drift guard: /vector SSR-loads loadVectorSeedProps. The SPX dashboard uses SpxVectorEmbed
 * (client-hydrated) so HTML is not blocked on cold Polygon reconstruct — chart data still flows
 * through the same /api/market/vector/* paths VectorChart already polls.
 */
test("Vector seed pipeline: /vector SSR-loads; dashboard client-embeds without inline internals", () => {
  const vectorPage = readFileSync(join(process.cwd(), "src/app/(site)/vector/page.tsx"), "utf8");
  const dashboardPage = readFileSync(join(process.cwd(), "src/app/(site)/dashboard/page.tsx"), "utf8");

  assert.match(vectorPage, /loadVectorSeedProps/);
  assert.match(dashboardPage, /SpxVectorEmbed/);
  assert.doesNotMatch(dashboardPage, /await loadVectorSeedProps/);

  const pipelineInternals = [
    "fetchVectorSeedBars",
    "primeVectorWallScope",
    "enrichSessionWallHistory",
    "seedWallHistoryForDisplay",
    "loadSessionWallHistory",
  ];
  for (const token of pipelineInternals) {
    assert.equal(
      vectorPage.includes(token),
      false,
      `/vector page must not inline seed internals (${token}) — use loadVectorSeedProps`
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
