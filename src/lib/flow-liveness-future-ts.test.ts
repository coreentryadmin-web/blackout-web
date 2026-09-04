import { before, test, mock } from "node:test";
import assert from "node:assert/strict";

const NOW = 1_700_000_000_000;
const MAX_AGE_MS = 120_000;

let mockHeartbeat: { at: number; instance: string } | null = null;

mock.module("./shared-cache", {
  namedExports: {
    sharedCacheGet: async () => mockHeartbeat,
    sharedCacheSet: async () => {},
  },
});

let isFlowFrameFreshAnywhere: (maxAgeMs?: number) => Promise<boolean>;
let peekFlowLivenessHeartbeat: (maxAgeMs?: number) => Promise<{
  heartbeat_present: boolean;
  last_frame_at: string | null;
  age_sec: number | null;
  fresh: boolean;
}>;

before(async () => {
  const mod = await import("./flow-liveness");
  isFlowFrameFreshAnywhere = mod.isFlowFrameFreshAnywhere;
  peekFlowLivenessHeartbeat = mod.peekFlowLivenessHeartbeat;
});

test("isFlowFrameFreshAnywhere rejects future timestamps beyond tolerance", async () => {
  mock.timers.enable({ apis: ["Date"], now: NOW });
  mockHeartbeat = { at: NOW + 10_000, instance: "other-replica" };
  assert.equal(await isFlowFrameFreshAnywhere(MAX_AGE_MS), false);
  mock.timers.reset();
});

test("isFlowFrameFreshAnywhere accepts timestamps within future tolerance", async () => {
  mock.timers.enable({ apis: ["Date"], now: NOW });
  mockHeartbeat = { at: NOW + 4_000, instance: "other-replica" };
  assert.equal(await isFlowFrameFreshAnywhere(MAX_AGE_MS), true);
  mock.timers.reset();
});

test("peekFlowLivenessHeartbeat marks future timestamps as not fresh", async () => {
  mock.timers.enable({ apis: ["Date"], now: NOW });
  mockHeartbeat = { at: NOW + 10_000, instance: "other-replica" };
  const peek = await peekFlowLivenessHeartbeat(MAX_AGE_MS);
  assert.equal(peek.heartbeat_present, true);
  assert.equal(peek.fresh, false);
  assert.equal(peek.age_sec, 0);
  mock.timers.reset();
});
