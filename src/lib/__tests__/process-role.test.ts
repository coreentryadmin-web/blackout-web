import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

describe("process-role", () => {
  const keys = ["PROCESS_ROLE", "DATA_SOCKETS_ENABLED"] as const;
  const saved: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  function setEnv(overrides: Partial<Record<(typeof keys)[number], string | undefined>>) {
    for (const k of keys) saved[k] = process.env[k];
    for (const [k, v] of Object.entries(overrides)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }

  test("defaults to all when unset", async () => {
    setEnv({ PROCESS_ROLE: undefined, DATA_SOCKETS_ENABLED: undefined });
    const mod = await import("../process-role");
    assert.equal(mod.processRole(), "all");
    assert.equal(mod.shouldBootDataSockets(), true);
    assert.equal(mod.shouldRunRthWarmLeader(), true);
  });

  test("web role disables sockets", async () => {
    setEnv({ PROCESS_ROLE: "web" });
    const mod = await import("../process-role");
    assert.equal(mod.processRole(), "web");
    assert.equal(mod.shouldBootDataSockets(), false);
    assert.equal(mod.shouldRunRthWarmLeader(), false);
  });

  test("ingest role enables sockets and warm leader", async () => {
    setEnv({ PROCESS_ROLE: "ingest" });
    const mod = await import("../process-role");
    assert.equal(mod.processRole(), "ingest");
    assert.equal(mod.shouldBootDataSockets(), true);
    assert.equal(mod.shouldRunRthWarmLeader(), true);
  });

  test("DATA_SOCKETS_ENABLED=0 maps to web", async () => {
    setEnv({ PROCESS_ROLE: undefined, DATA_SOCKETS_ENABLED: "0" });
    const mod = await import("../process-role");
    assert.equal(mod.processRole(), "web");
  });
});
