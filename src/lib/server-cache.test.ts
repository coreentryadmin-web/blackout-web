import { test } from "node:test";
import assert from "node:assert/strict";
import { serverCache, isDegraded, withServerCache, peekServerCache } from "./server-cache";

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

test("staleOnInflight returns stale instead of awaiting a slow pending refresh", async () => {
  const { withServerCache } = await import("./server-cache");
  const key = `test:stale-on-inflight:${Math.random()}`;
  const ttl = 5;

  await withServerCache(key, ttl, async () => ({ n: 1 }), { staleWhileRevalidate: false });
  await new Promise((r) => setTimeout(r, ttl + 5));

  let releaseSlow!: () => void;
  const slowGate = new Promise<void>((resolve) => {
    releaseSlow = resolve;
  });

  const slowRefresh = withServerCache(
    key,
    ttl,
    async () => {
      await slowGate;
      return { n: 2 };
    },
    { staleWhileRevalidate: false }
  );

  const concurrent = withServerCache(
    key,
    ttl,
    async () => ({ n: 3 }),
    { staleOnInflight: true, staleWhileRevalidate: false }
  );

  const value = await Promise.race([
    concurrent,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 50)),
  ]);

  assert.deepEqual(value, { n: 1 });
  releaseSlow();
  await slowRefresh;
});

test("maxBlockMs on expired fast lane serves stale instead of blocking refresh", async () => {
  const { withServerCache } = await import("./server-cache");
  const key = `test:max-block-expired:${Math.random()}`;
  const ttl = 5;

  await withServerCache(key, ttl, async () => ({ n: 1 }), { staleWhileRevalidate: false });
  await new Promise((r) => setTimeout(r, ttl + 5));

  let invoked = 0;
  const value = await Promise.race([
    withServerCache(
      key,
      ttl,
      async () => {
        invoked += 1;
        await new Promise((r) => setTimeout(r, 500));
        return { n: 2 };
      },
      { maxBlockMs: 30, staleWhileRevalidate: false, fallback: async () => ({ n: 99 }) }
    ),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 100)),
  ]);

  assert.deepEqual(value, { n: 1 });
  // Fast lane must not block on rebuild; background refresh may start after return.
  await new Promise((r) => setImmediate(r));
  assert.ok(invoked <= 1, `expected at most one background refresh, got ${invoked}`);
});

// Regression for the live 2026-09-11 spx/play staleness bug: peekServerCache's final fallback
// (`if (hit) return hit.value`) had NO staleness ceiling, unlike withServerCache's own
// MAX_STALE_AGE_MS guard — so a replica that stopped refreshing served an arbitrarily old cached
// entry forever via the "instant read" path every peek-first route (spx/play, nighthawk/edition,
// spx-desk-loader, flows-member-cache, flow-brief) relies on. `maxStaleMs` is test-only surface
// area so this doesn't need a real 10-minute wait to exercise the real MAX_STALE_AGE_MS ceiling.
test("peekServerCache refuses to serve a locally-cached entry past its staleness ceiling", async () => {
  const key = `test:peek-stale-ceiling:${Math.random()}`;
  const ttl = 5;

  // Populate the local store (short TTL, so it's already logically "expired" almost immediately).
  await withServerCache(key, ttl, async () => ({ n: 1 }));
  await new Promise((r) => setTimeout(r, ttl + 5));

  // Redis is a no-op in this test env (REDIS_URL unset), so the entry now lives ONLY in the local
  // store, past its TTL. Before the fix: peekServerCache still returned { n: 1 } here regardless of
  // age. After the fix: a tiny maxStaleMs (well under the real age of this entry) makes it refuse.
  const stale = await peekServerCache(key, { maxStaleMs: 1 });
  assert.equal(stale, null, "an entry older than the staleness ceiling must not be served via peek");

  // Sanity: the SAME entry, read with a generous ceiling, still comes back — this proves the miss
  // above is the new ceiling doing its job, not some unrelated store/key bug.
  const withinCeiling = await peekServerCache(key, { maxStaleMs: 60_000 });
  assert.deepEqual(withinCeiling, { n: 1 });

  // Default (no opts) uses the real MAX_STALE_AGE_MS (10 minutes) — this entry is only
  // milliseconds old, so the default path must still serve it (no behavior change for the
  // overwhelming majority of real callers, which never approach that ceiling).
  const defaultPeek = await peekServerCache(key);
  assert.deepEqual(defaultPeek, { n: 1 });
});

test("maxBlockMs serves fallback instead of blocking on a slow cold loader", async () => {
  const { withServerCache } = await import("./server-cache");
  const key = `test:max-block:${Math.random()}`;
  const ttl = 60_000;

  const value = await withServerCache(
    key,
    ttl,
    () => new Promise<{ ok: boolean }>((resolve) => setTimeout(() => resolve({ ok: true }), 500)),
    {
      maxBlockMs: 30,
      fallback: async () => ({ ok: false }),
      staleWhileRevalidate: false,
    }
  );

  assert.deepEqual(value, { ok: false });
});

test("maxBlockMs bounds a slow fallback when a build is already inflight (live 2026-09-16: /api/market/spx/desk 42.8s vs a 3s cap)", async () => {
  const { withServerCache } = await import("./server-cache");
  const key = `test:max-block-inflight-fallback:${Math.random()}`;
  const ttl = 60_000;

  // First caller: no maxBlockMs/fallback of its own, so it takes the plain cold-start path
  // (`refreshCache`) and registers the key as inflight for the duration of its slow loader.
  // Never awaited directly — its only job is to occupy `inflight.get(key)` for caller two.
  const firstCallerLoader = () =>
    new Promise<{ ok: boolean }>((resolve) => setTimeout(() => resolve({ ok: true }), 2_000));
  const firstCaller = withServerCache(key, ttl, firstCallerLoader, {});
  firstCaller.catch(() => {}); // swallow unhandled-rejection noise if the test exits first

  // Give the first caller's refreshCache a tick to register the inflight promise.
  await new Promise((r) => setTimeout(r, 5));

  // Second caller lands in the "pending" branch (server-cache.ts ~line 218): no hit, no Redis
  // copy, a build already inflight, and its own maxBlockMs+fallback configured — exactly the
  // shape spx-desk-loader.ts's deskCacheOpts uses. Before the fix, opts.fallback() here was
  // awaited with no timeout at all; a slow fallback (here: 500ms) blocked the caller for its
  // full duration regardless of the 30ms cap. After the fix, it must be bounded near maxBlockMs.
  const slowFallback = () =>
    new Promise<{ ok: boolean }>((resolve) => setTimeout(() => resolve({ ok: false }), 500));

  const start = Date.now();
  await assert.rejects(
    withServerCache(key, ttl, firstCallerLoader, {
      staleOnInflight: true,
      maxBlockMs: 30,
      fallback: slowFallback,
    }),
    /exceeded maxBlockMs/
  );
  const elapsed = Date.now() - start;
  assert.ok(
    elapsed < 200,
    `second caller must be bounded near maxBlockMs (30ms), not the fallback's own 500ms duration — took ${elapsed}ms`
  );
});

test("maxBlockMs bounds a slow fallback on the COLD-START path too, when the primary refresh itself times out (found live post-deploy: PR #5061's inflight-branch fix alone did NOT stop the 42s /api/market/spx/desk block)", async () => {
  const { withServerCache } = await import("./server-cache");
  const key = `test:max-block-cold-start-fallback:${Math.random()}`;
  const ttl = 60_000;

  // No prior caller, no hit, no Redis, nothing inflight — a genuinely cold key. This lands in
  // the "no pending" branch (server-cache.ts ~line 263), which correctly races its own
  // `refreshCache()` against maxBlockMs. Before this fix, once THAT race timed out, falling
  // through to `opts.fallback()` was awaited with no timeout of its own — the exact same
  // unguarded shape as the "already inflight" branch fixed by PR #5061, just one branch over.
  // This is the branch a genuinely cold key actually takes in production (no concurrent
  // request racing the same build), which is why the live bug survived that first fix.
  const slowLoader = () =>
    new Promise<{ ok: boolean }>((resolve) => setTimeout(() => resolve({ ok: true }), 2_000));
  const slowFallback = () =>
    new Promise<{ ok: boolean }>((resolve) => setTimeout(() => resolve({ ok: false }), 500));

  const start = Date.now();
  await assert.rejects(
    withServerCache(key, ttl, slowLoader, {
      staleWhileRevalidate: true,
      maxBlockMs: 30,
      fallback: slowFallback,
    }),
    /exceeded maxBlockMs/
  );
  const elapsed = Date.now() - start;
  assert.ok(
    elapsed < 300,
    `cold-start caller must be bounded near a small multiple of maxBlockMs (30ms), not the fallback's own 500ms duration — took ${elapsed}ms`
  );
});
