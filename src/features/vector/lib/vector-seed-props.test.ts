import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Drift guard: /vector and /dashboard both client-bootstrap Vector — no SSR seed blocking HTML.
 * loadVectorSeedProps remains the server pipeline for API/cron paths; pages must not await it.
 */
test("Vector seed pipeline: pages client-bootstrap; loadVectorSeedProps stays server-only", () => {
  const vectorPage = readFileSync(join(process.cwd(), "src/app/(site)/vector/page.tsx"), "utf8");
  const dashboardPage = readFileSync(join(process.cwd(), "src/app/(site)/dashboard/page.tsx"), "utf8");
  const vectorClient = readFileSync(
    join(process.cwd(), "src/features/vector/components/VectorPageClient.tsx"),
    "utf8"
  );

  assert.doesNotMatch(vectorPage, /await loadVectorSeedProps/);
  assert.match(vectorPage, /VectorPageClient/);
  assert.match(vectorClient, /fetchVectorEmbedFastSeed/);
  assert.match(vectorClient, /fetchVectorClientSeed/);

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
      `/vector page must not inline seed internals (${token})`
    );
    assert.equal(
      dashboardPage.includes(token),
      false,
      `/dashboard page must not inline seed internals (${token})`
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
