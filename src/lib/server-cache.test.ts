import { test } from "node:test";
import assert from "node:assert/strict";
import { serverCache, isDegraded } from "./server-cache";

// Covers the load-bearing guarantee behind null-commentary-cache: when the loader
// THROWS, serverCache stores nothing and clears the in-flight entry, so the next
// request rebuilds immediately (no negative caching). server-cache.ts is alias-free
// (its only import is a dynamic import("./shared-cache") gated on process.env.REDIS_URL),
// so leaving REDIS_URL unset keeps readRedisCache/writeRedisCache as no-ops and this
// runs under `npx tsx --test` without Next or Redis. Each test uses a unique key
// because store/failureCount/inflight are module-level Maps.

const TTL = 60_000;

test("loader that throws stores nothing and the next call rebuilds", async () => {
  const key = `test:throw-then-resolve:${Math.random()}`;
  await assert.rejects(
    serverCache(key, TTL, async () => {
      throw new Error("spx-commentary: generation returned null");
    })
  );
  // Nothing was cached and inflight was cleared, so this loader MUST run.
  let invoked = 0;
  const value = await serverCache(key, TTL, async () => {
    invoked += 1;
    return { ok: true };
  });
  assert.equal(invoked, 1);
  assert.deepEqual(value, { ok: true });
});

test("resolved value is cached: second call within ttl does not re-invoke loader", async () => {
  const key = `test:resolve-dedup:${Math.random()}`;
  let invoked = 0;
  const first = await serverCache(key, TTL, async () => {
    invoked += 1;
    return { n: 1 };
  });
  const second = await serverCache(key, TTL, async () => {
    invoked += 1;
    return { n: 2 };
  });
  assert.equal(invoked, 1);
  assert.deepEqual(first, { n: 1 });
  assert.deepEqual(second, { n: 1 });
});

test("repeated throws mark the key degraded after the failure threshold", async () => {
  const key = `test:degrade:${Math.random()}`;
  const thrower = async () => {
    throw new Error("spx-commentary: generation returned null");
  };
  for (let i = 0; i < 3; i += 1) {
    await assert.rejects(serverCache(key, TTL, thrower));
  }
  assert.equal(isDegraded(key), true);
});

// Regression guard for the ticker-news 60ms bug: `serverCache(key, 60, …)` read as
// "60 seconds" but the parameter is MILLISECONDS, so per-ticker news was effectively
// uncached and every member poll hit Benzinga upstream. Two tripwires: the shared TTL
// table must never carry a sub-second entry, and no route file may pass a raw
// sub-second numeric TTL to serverCache/withServerCache again.
test("TTL table carries no sub-second (misread-as-seconds) entries", async () => {
  const { TTL: table } = await import("./server-cache");
  for (const [name, ms] of Object.entries(table)) {
    assert.ok(ms >= 1_000, `TTL.${name} = ${ms}ms — sub-second TTL is almost certainly a seconds/ms mixup`);
  }
});

test("no route passes a raw sub-second TTL literal to serverCache", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const roots: string[] = [join(process.cwd(), "src", "app", "api")];
  const offenders: string[] = [];
  while (roots.length) {
    const dir = roots.pop()!;
    // withFileTypes: type comes from the directory listing itself — no separate
    // stat-then-read (CodeQL js/file-system-race).
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        roots.push(p);
        continue;
      }
      if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) continue;
      const src = readFileSync(p, "utf8");
      // serverCache("key", <raw number < 1000>, …) — TTL constants and *_MS names pass.
      const m = src.match(/(?:serverCache|withServerCache)\s*\(\s*[^,]+,\s*(\d{1,3})\s*,/);
      if (m) offenders.push(`${p} (ttl=${m[1]}ms)`);
    }
  }
  assert.deepEqual(offenders, [], `raw sub-second serverCache TTLs found:\n${offenders.join("\n")}`);
});

test("stale-while-revalidate background refresh swallows loader errors (no unhandledRejection)", async () => {
  const { withServerCache } = await import("./server-cache");
  const key = `test:swr-bg-swallow:${Math.random()}`;
  const ttl = 5;
  let rejections = 0;
  const onRejection = () => {
    rejections += 1;
  };
  process.on("unhandledRejection", onRejection);

  const first = await withServerCache(key, ttl, async () => ({ ok: true }));
  assert.deepEqual(first, { ok: true });

  // Force expiry so the next call returns stale and kicks off a background refresh.
  await new Promise((r) => setTimeout(r, ttl + 5));

  const second = await withServerCache(key, ttl, async () => {
    throw new Error("upstream timeout");
  });
  assert.deepEqual(second, { ok: true });

  await new Promise((r) => setTimeout(r, 25));
  process.off("unhandledRejection", onRejection);
  assert.equal(rejections, 0, "background SWR refresh must not emit unhandledRejection");
});
