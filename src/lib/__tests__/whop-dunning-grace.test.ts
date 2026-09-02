import { test, mock } from "node:test";
import assert from "node:assert/strict";

// Postgres-backed dunning grace (Redis as hot cache). The load-bearing case is the
// REGRESSION test: a Redis miss/outage must fall through to Postgres — the old
// Redis-only storage failed open toward REVOKING access on any Redis miss, and the
// hourly reconcile cron could persist tier:free to Clerk. Run: npm test.
//
// ESM caches the module under test after its first import, so the mocks are
// registered ONCE with implementations that delegate to this mutable `state`
// holder — each test swaps the state instead of re-mocking.

const state = {
  cache: new Map<string, number>(),
  cacheSetFails: false,
  cacheDelKeys: [] as string[],
  dbRows: new Map<string, string>(), // membership_id -> expires_at ISO
  dbConfigured: true,
  dbThrows: false,
  dbCalls: [] as Array<{ text: string; values: unknown[] }>,
};

function resetState() {
  state.cache = new Map();
  state.cacheSetFails = false;
  state.cacheDelKeys = [];
  state.dbRows = new Map();
  state.dbConfigured = true;
  state.dbThrows = false;
  state.dbCalls = [];
}

mock.module("../shared-cache", {
  namedExports: {
    sharedCacheGet: async (key: string) => (state.cache.has(key) ? state.cache.get(key) : null),
    sharedCacheSet: async (key: string, value: number) => {
      if (!state.cacheSetFails) state.cache.set(key, value);
    },
    sharedCacheDel: async (key: string) => {
      state.cacheDelKeys.push(key);
      state.cache.delete(key);
    },
  },
});
mock.module("../db", {
  namedExports: {
    dbConfigured: () => state.dbConfigured,
    dbQuery: async (text: string, values: unknown[]) => {
      state.dbCalls.push({ text, values });
      if (state.dbThrows) throw new Error("pg down");
      if (/SELECT/i.test(text)) {
        const id = String(values[0]);
        const expiresAt = state.dbRows.get(id);
        if (!expiresAt) return { rows: [] };
        if (new Date(expiresAt).getTime() <= Date.now()) return { rows: [] };
        return { rows: [{ expires_at: new Date(expiresAt) }] };
      }
      if (/INSERT/i.test(text)) {
        state.dbRows.set(String(values[0]), String(values[1]));
      }
      if (/DELETE/i.test(text)) {
        state.dbRows.delete(String(values[0]));
      }
      return { rows: [] };
    },
  },
});

const mod = () => import("../whop-dunning");

test("Redis hit (1) short-circuits to in-grace without touching Postgres", async () => {
  const { isMembershipInDunningGrace } = await mod();
  resetState();
  state.cache.set("whop:dunning:mem_1", 1);
  assert.equal(await isMembershipInDunningGrace("mem_1"), true);
  assert.equal(state.dbCalls.length, 0);
});

test("REGRESSION: Redis miss falls through to Postgres and still reports in-grace", async () => {
  const { isMembershipInDunningGrace } = await mod();
  resetState();
  const future = new Date(Date.now() + 86_400_000).toISOString();
  state.dbRows.set("mem_2", future);
  assert.equal(await isMembershipInDunningGrace("mem_2"), true);
  assert.equal(state.cache.get("whop:dunning:mem_2"), 1);
});

test("Redis miss + expired Postgres row is not in grace, with a negative backfill", async () => {
  const { isMembershipInDunningGrace } = await mod();
  resetState();
  const past = new Date(Date.now() - 1000).toISOString();
  state.dbRows.set("mem_3", past);
  assert.equal(await isMembershipInDunningGrace("mem_3"), false);
  assert.equal(state.cache.get("whop:dunning:mem_3"), 0);
});

test("Redis miss + no Postgres row is not in grace, with a negative backfill", async () => {
  const { isMembershipInDunningGrace } = await mod();
  resetState();
  assert.equal(await isMembershipInDunningGrace("mem_4"), false);
  assert.equal(state.cache.get("whop:dunning:mem_4"), 0);
});

test("fresh negative cache (0) short-circuits without touching Postgres", async () => {
  const { isMembershipInDunningGrace } = await mod();
  resetState();
  state.cache.set("whop:dunning:mem_5", 0);
  assert.equal(await isMembershipInDunningGrace("mem_5"), false);
  assert.equal(state.dbCalls.length, 0);
});

test("mark: Postgres write succeeding is enough even when Redis verification fails", async () => {
  const { markMembershipDunningGrace } = await mod();
  resetState();
  state.cacheSetFails = true;
  await assert.doesNotReject(markMembershipDunningGrace("mem_6"));
  assert.equal(state.dbRows.has("mem_6"), true);
});

test("mark: throws only when BOTH stores fail (webhook retry path)", async () => {
  const { markMembershipDunningGrace } = await mod();
  resetState();
  state.cacheSetFails = true;
  state.dbThrows = true;
  await assert.rejects(
    markMembershipDunningGrace("mem_7"),
    /Postgres and Redis both unavailable/
  );
});

test("clear removes from both Postgres and Redis", async () => {
  const { markMembershipDunningGrace, clearMembershipDunningGrace, isMembershipInDunningGrace } =
    await mod();
  resetState();
  await markMembershipDunningGrace("mem_8");
  assert.equal(await isMembershipInDunningGrace("mem_8"), true);
  await clearMembershipDunningGrace("mem_8");
  assert.equal(state.dbRows.has("mem_8"), false);
  assert.ok(state.cacheDelKeys.includes("whop:dunning:mem_8"));
  state.cache.delete("whop:dunning:mem_8");
  assert.equal(await isMembershipInDunningGrace("mem_8"), false);
});

test("db not configured degrades to Redis-only (no Postgres calls on read)", async () => {
  const { isMembershipInDunningGrace, markMembershipDunningGrace } = await mod();
  resetState();
  state.dbConfigured = false;
  assert.equal(await isMembershipInDunningGrace("mem_9"), false);
  await assert.doesNotReject(markMembershipDunningGrace("mem_9"));
  assert.equal(state.dbCalls.length, 0);
  assert.equal(state.cache.get("whop:dunning:mem_9"), 1);
});
