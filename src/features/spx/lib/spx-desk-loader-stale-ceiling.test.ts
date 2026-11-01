import { test, mock } from "node:test";
import assert from "node:assert/strict";

// Regression for the SPX desk loader-path stale-cache ceiling gap (found live 2026-10-26, Ask
// Largo/5-engine standing mandate — second half of the same cross-replica divergence investigation
// that produced spx-desk-peek-staleness.test.ts / PR #6882). That earlier fix tightened only the
// non-blocking PEEK paths (peekSpxDesk()/peekMergedSpxDesk()) to deskPeekMaxAgeSec() (~40s). Their
// FALLBACK — loadSpxDesk()/loadMergedSpxDesk()/loadBootstrapBundle(), all backed by
// withServerCache — had NO maxStaleAgeMs override at all, so they stayed on server-cache.ts's
// generic 10-minute MAX_STALE_AGE_MS: a replica whose peek self-invalidated could still fall
// through to a loader that itself kept serving an up-to-10-minute-old local snapshot.
//
// This could only be fixed safely in this order: FIRST, server-cache.ts's SWR branch (the
// `staleAge > maxStaleAgeMs`, not-yet-degraded branch) had to gain a race against opts.maxBlockMs
// (see server-cache.test.ts's own regression test) — otherwise tightening this ceiling would make
// that previously-unbounded blocking-refresh branch fire far more often, reintroducing the exact
// unbounded-block regression PR #5061/#5065 already had to fix once. THEN this loader-path ceiling
// (deskLoaderMaxStaleAgeMs(), src/lib/providers/config.ts — deliberately derived from the SAME
// value as deskPeekMaxAgeSec() so the two paths can't drift apart again) was wired into all three
// loader call sites.
//
// This mocks withServerCache itself (instead of exercising real staleness timing) and asserts the
// actual `opts` object each loader passes — a direct wiring proof, not a timing-dependent one. A
// timing-based version of this test was tried first and was a FALSE POSITIVE: without
// maxStaleAgeMs wired in at all, a freshly-aged (tens of ms old) entry never gets anywhere near the
// un-tightened 10-minute default, so it silently takes the ordinary (non-ceiling) SWR fast path in
// BOTH the pre-fix and post-fix code — passing either way and proving nothing. Capturing the actual
// opts is the only way to RED on the real pre-fix gap (opts.maxStaleAgeMs simply absent/undefined).
// server-cache.test.ts's own regression test already proves the general maxBlockMs-race mechanism
// once maxStaleAgeMs/maxBlockMs are set; this test proves these three specific call sites actually
// set it.

type CapturedCall = { key: string; opts: Record<string, unknown> };
let captured: CapturedCall[] = [];

mock.module("../../../lib/providers/spx-session", {
  namedExports: {
    todayEtYmd: () => "2099-05-01",
  },
});

mock.module("../../../lib/providers/config", {
  namedExports: {
    // spx-desk-loader evaluates these at module load — every export it imports must be stubbed.
    deskBootstrapMaxBlockMs: () => 3_000,
    deskCacheTtlMs: () => 10_000,
    deskFlowCacheTtlMs: () => 10_000,
    deskPeekMaxAgeSec: () => 40,
    deskPulseCacheTtlMs: () => 1_000,
    deskPulseMaxBlockMs: () => 500,
    // The fix under test — a distinctive, recognizable value (not a round number any OTHER
    // default in this test could coincidentally match) so the assertions below can only pass if
    // this exact function's return value made it into withServerCache's opts.
    deskLoaderMaxStaleAgeMs: () => 40_321,
  },
});

mock.module("../../../lib/server-cache", {
  namedExports: {
    // A bare passthrough that just records what each caller asked for, instead of doing any real
    // caching/staleness logic — the real mechanism (the maxBlockMs race once staleAge exceeds
    // maxStaleAgeMs) is already covered by server-cache.test.ts's own regression test.
    withServerCache: async (key: string, _ttlMs: number, loader: () => Promise<unknown>, opts: Record<string, unknown> = {}) => {
      captured.push({ key, opts });
      return loader();
    },
    peekServerCache: async () => null,
  },
});

mock.module("./spx-desk", {
  namedExports: {
    buildSpxDesk: async () => ({ marker: "desk" }),
    buildSpxDeskFlow: async () => ({ marker: "flow" }),
    buildSpxDeskPulse: async () => ({ marker: "pulse" }),
    buildSpxDeskPulseMinimal: async () => ({ marker: "pulse-minimal" }),
    deskShellFromPulse: (pulse: unknown) => ({ marker: "shell", pulse }),
  },
});

mock.module("./spx-desk-merge", {
  namedExports: {
    mergeDeskLayers: (desk: unknown) => desk,
  },
});

test("loadSpxDesk()/loadMergedSpxDesk()/loadBootstrapBundle() pass maxStaleAgeMs: deskLoaderMaxStaleAgeMs() to withServerCache, instead of leaving it unset (which falls back to the generic 10-minute MAX_STALE_AGE_MS)", async () => {
  captured = [];
  const { loadSpxDesk, loadMergedSpxDesk, loadBootstrapBundle } = await import("./spx-desk-loader");

  await loadSpxDesk();
  await loadMergedSpxDesk();
  await loadBootstrapBundle();

  const firstCallFor = (prefix: string) => captured.find((c) => c.key.startsWith(prefix));

  const desk = firstCallFor("spx-desk:");
  assert.ok(desk, "loadSpxDesk() must call withServerCache under the spx-desk:<date> key");
  assert.equal(
    desk!.opts.maxStaleAgeMs,
    40_321,
    "loadSpxDesk()'s withServerCache call must pass maxStaleAgeMs: deskLoaderMaxStaleAgeMs() — before the fix this key was simply absent from opts"
  );

  const merged = firstCallFor("spx-merged:");
  assert.ok(merged, "loadMergedSpxDesk() must call withServerCache under the spx-merged:<date> key");
  assert.equal(merged!.opts.maxStaleAgeMs, 40_321, "loadMergedSpxDesk() must also pass the tightened ceiling");

  const bootstrap = firstCallFor("spx-bootstrap:");
  assert.ok(bootstrap, "loadBootstrapBundle() must call withServerCache under the spx-bootstrap:<date> key");
  assert.equal(bootstrap!.opts.maxStaleAgeMs, 40_321, "loadBootstrapBundle() must also pass the tightened ceiling");

  // Sanity: every captured call still carries its own real maxBlockMs too (unchanged by this fix —
  // the ceiling and the block budget are two different, independently-configured numbers).
  for (const call of [desk!, merged!, bootstrap!]) {
    assert.equal(call.opts.maxBlockMs, 3_000, `${call.key}: maxBlockMs must be untouched by this fix`);
  }
});

test.after(() => mock.restoreAll());
