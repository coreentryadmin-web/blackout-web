import { test } from "node:test";
import assert from "node:assert/strict";
// Only the FAIL-OPEN no-Redis path is unit-testable without booting Redis/Clerk.
// With REDIS_URL unset, getRedis() returns null before importing ioredis, so
// acquireMembershipSyncSlot resolves { ok:true } with nothing booted.
import { acquireMembershipSyncSlot } from "./membership-sync-limit";

test("fail-open: no REDIS_URL -> slot always granted", async () => {
  const prev = process.env.REDIS_URL;
  delete process.env.REDIS_URL;
  try {
    const slot = await acquireMembershipSyncSlot("user_test");
    assert.deepEqual(slot, { ok: true });
  } finally {
    if (prev !== undefined) process.env.REDIS_URL = prev;
  }
});
