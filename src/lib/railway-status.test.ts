import assert from "node:assert/strict";
import test from "node:test";
import { mapDeploymentEdges, probeRailwayStatus } from "./railway-status";

test("mapDeploymentEdges: extracts status/createdAt/commit fields from GraphQL edges", () => {
  const edges = [
    {
      node: {
        status: "SUCCESS",
        createdAt: "2026-07-03T12:38:34.452Z",
        meta: { commitHash: "abc123", commitMessage: "fix: something" },
      },
    },
  ];
  assert.deepEqual(mapDeploymentEdges(edges), [
    { status: "SUCCESS", createdAt: "2026-07-03T12:38:34.452Z", commitHash: "abc123", commitMessage: "fix: something" },
  ]);
});

test("mapDeploymentEdges: missing meta/commit fields become null, never fabricated", () => {
  const edges = [{ node: { status: "SKIPPED", createdAt: "2026-07-03T12:18:27.772Z" } }];
  assert.deepEqual(mapDeploymentEdges(edges), [
    { status: "SKIPPED", createdAt: "2026-07-03T12:18:27.772Z", commitHash: null, commitMessage: null },
  ]);
});

test("mapDeploymentEdges: undefined edges yields an empty array, never throws", () => {
  assert.deepEqual(mapDeploymentEdges(undefined), []);
});

test("probeRailwayStatus: reports not-configured when RAILWAY_TOKEN is unset, never attempts a call", async () => {
  const prior = process.env.RAILWAY_TOKEN;
  delete process.env.RAILWAY_TOKEN;
  try {
    const status = await probeRailwayStatus();
    assert.deepEqual(status, { configured: false });
  } finally {
    if (prior != null) process.env.RAILWAY_TOKEN = prior;
  }
});
