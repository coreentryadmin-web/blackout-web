import assert from "node:assert/strict";
import test from "node:test";
import {
  auditEnvVarKeys,
  mapDeploymentEdges,
  pickLiveDeploymentId,
  probeRailwayEnvVars,
  probeRailwayResourceUsage,
  probeRailwayRuntimeErrors,
  probeRailwayStatus,
  summarizeResourceMetrics,
} from "./railway-status";

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

test("summarizeResourceMetrics: computes avg/latest for CPU and memory independently", () => {
  const series = [
    { measurement: "CPU_USAGE", values: [{ ts: 1, value: 0.1 }, { ts: 2, value: 0.3 }] },
    { measurement: "MEMORY_USAGE_GB", values: [{ ts: 1, value: 0.8 }, { ts: 2, value: 1.2 }] },
  ];
  assert.deepEqual(summarizeResourceMetrics(series), {
    cpu_avg_vcpu: 0.2,
    cpu_latest_vcpu: 0.3,
    memory_avg_gb: 1,
    memory_latest_gb: 1.2,
  });
});

test("summarizeResourceMetrics: missing measurement maps to null, never a fabricated 0", () => {
  assert.deepEqual(summarizeResourceMetrics([{ measurement: "CPU_USAGE", values: [] }]), {
    cpu_avg_vcpu: null,
    cpu_latest_vcpu: null,
    memory_avg_gb: null,
    memory_latest_gb: null,
  });
  assert.deepEqual(summarizeResourceMetrics(undefined), {
    cpu_avg_vcpu: null,
    cpu_latest_vcpu: null,
    memory_avg_gb: null,
    memory_latest_gb: null,
  });
});

test("probeRailwayResourceUsage: reports not-configured when RAILWAY_TOKEN is unset", async () => {
  const prior = process.env.RAILWAY_TOKEN;
  delete process.env.RAILWAY_TOKEN;
  try {
    assert.deepEqual(await probeRailwayResourceUsage(), { configured: false });
  } finally {
    if (prior != null) process.env.RAILWAY_TOKEN = prior;
  }
});

test("auditEnvVarKeys: flags missing critical vars, counts total regardless of which are critical", () => {
  assert.deepEqual(auditEnvVarKeys(["DATABASE_URL", "SOME_OTHER_VAR"], ["DATABASE_URL", "REDIS_URL"]), {
    total_count: 2,
    missing_critical: ["REDIS_URL"],
  });
});

test("auditEnvVarKeys: nothing missing when every critical var is present", () => {
  assert.deepEqual(auditEnvVarKeys(["DATABASE_URL", "REDIS_URL"], ["DATABASE_URL", "REDIS_URL"]), {
    total_count: 2,
    missing_critical: [],
  });
});

test("probeRailwayEnvVars: reports not-configured when RAILWAY_TOKEN is unset", async () => {
  const prior = process.env.RAILWAY_TOKEN;
  delete process.env.RAILWAY_TOKEN;
  try {
    assert.deepEqual(await probeRailwayEnvVars(), { configured: false });
  } finally {
    if (prior != null) process.env.RAILWAY_TOKEN = prior;
  }
});

test("pickLiveDeploymentId: picks the first SUCCESS entry, not just the newest", () => {
  // Regression case straight from tonight's observed reality: the newest deployment
  // can be stuck BUILDING while an older one is still the one actually serving traffic.
  const edges = [
    { node: { id: "stuck-building", status: "BUILDING" } },
    { node: { id: "live-success", status: "SUCCESS" } },
    { node: { id: "old-removed", status: "REMOVED" } },
  ];
  assert.equal(pickLiveDeploymentId(edges), "live-success");
});

test("pickLiveDeploymentId: null when nothing in the window is SUCCESS", () => {
  assert.equal(pickLiveDeploymentId([{ node: { id: "a", status: "BUILDING" } }]), null);
  assert.equal(pickLiveDeploymentId(undefined), null);
});

test("probeRailwayRuntimeErrors: reports not-configured when RAILWAY_TOKEN is unset", async () => {
  const prior = process.env.RAILWAY_TOKEN;
  delete process.env.RAILWAY_TOKEN;
  try {
    assert.deepEqual(await probeRailwayRuntimeErrors(), { configured: false });
  } finally {
    if (prior != null) process.env.RAILWAY_TOKEN = prior;
  }
});
