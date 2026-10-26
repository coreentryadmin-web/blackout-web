import { test, mock } from "node:test";
import assert from "node:assert/strict";

// Regression for a live cross-replica staleness bug (found 2026-10-26, Ask Largo/5-engine standing
// mandate, live RTH repro): `peekSpxDesk()`/`peekMergedSpxDesk()`'s default usage had no per-key
// staleness override, so both fell back to server-cache.ts's generic 10-minute `MAX_STALE_AGE_MS`
// ceiling — far looser than this key's real ~10s refresh cadence (`deskCacheTtlMs()`) or the 90s
// "Desk data stale" play-gate (`playGexStaleMaxSec()`, spx-play-gates.ts) that reads whatever desk
// snapshot these peeks hand back. A replica whose local copy (and Redis's own short-TTL copy) had
// both gone cold was free to keep serving an up-to-10-minute-old snapshot while a fresher sibling
// replica served a current one — non-monotonic `as_of`/score and a flickering "Desk data stale"
// gate block across consecutive member polls, exactly as measured live. The fix (spx-desk-loader.ts)
// passes a desk-specific `deskPeekMaxAgeSec()` ceiling (`@/lib/providers/config`, default 40s,
// comfortably under the 90s gate threshold) to both peeks' `maxStaleMs`, mirroring the identical,
// already-shipped fix for the sibling `spx-play-read` key (`playMemberPeekMaxAgeSec()`).
//
// This exercises the REAL `peekSpxDesk()`/`peekMergedSpxDesk()`/`peekServerCache()` code paths —
// only `deskPeekMaxAgeSec()` is mocked, returning a tiny fractional-second ceiling so the real
// staleness math can be proven with milliseconds of real wait instead of the real 40s default.

let deskBuildCount = 0;
let pulseBuildCount = 0;
let flowBuildCount = 0;
let fakeDate = "2099-02-02";

mock.module("../../../lib/providers/spx-session", {
  namedExports: {
    todayEtYmd: () => fakeDate,
  },
});

mock.module("../../../lib/providers/config", {
  namedExports: {
    // spx-desk-loader evaluates maxBlockMs at module load — every export it imports must be stubbed.
    deskBootstrapMaxBlockMs: () => 3_000,
    deskCacheTtlMs: () => 5, // 5ms TTL — entries "expire" almost immediately, same as prod ratio
    deskFlowCacheTtlMs: () => 5,
    deskPeekMaxAgeSec: () => 0.02, // 20ms ceiling for this test only (real default is 40s)
    deskPulseCacheTtlMs: () => 5,
    deskPulseMaxBlockMs: () => 500,
  },
});

mock.module("./spx-desk", {
  namedExports: {
    buildSpxDesk: async () => ({ marker: ++deskBuildCount, price: 100 }),
    buildSpxDeskFlow: async () => ({ marker: ++flowBuildCount }),
    buildSpxDeskPulse: async () => ({ marker: ++pulseBuildCount }),
    buildSpxDeskPulseMinimal: async () => ({ marker: ++pulseBuildCount }),
    deskShellFromPulse: (pulse: { marker?: number }) => ({ marker: ++deskBuildCount, pulse }),
  },
});

mock.module("./spx-desk-merge", {
  namedExports: {
    mergeDeskLayers: (desk: unknown) => desk,
  },
});

test("peekSpxDesk() self-invalidates (returns null) once the local entry exceeds deskPeekMaxAgeSec(), instead of serving it for up to the generic 10-minute ceiling", async () => {
  fakeDate = "2099-02-02";
  const { loadSpxDesk, peekSpxDesk } = await import("./spx-desk-loader");

  await loadSpxDesk(); // populate the in-memory entry (Redis is a no-op here — REDIS_URL unset)

  const freshPeek = await peekSpxDesk();
  assert.ok(freshPeek, "a freshly-loaded entry must still be served immediately");

  // Age the entry past the tightened 20ms ceiling — nowhere near the generic 10-minute one, which
  // would have served this unconditionally before the fix.
  await new Promise((r) => setTimeout(r, 40));

  const stalePeek = await peekSpxDesk();
  assert.equal(
    stalePeek,
    null,
    "an entry older than deskPeekMaxAgeSec() must self-invalidate instead of being served as if fresh"
  );
});

test("peekMergedSpxDesk() default usage applies the same tightened ceiling (an explicit opts.maxStaleMs override still wins unchanged)", async () => {
  fakeDate = "2099-02-03"; // independent cache key from the desk-only test above
  const { loadMergedSpxDesk, peekMergedSpxDesk } = await import("./spx-desk-loader");

  await loadMergedSpxDesk();

  await new Promise((r) => setTimeout(r, 40));

  const defaultPeek = await peekMergedSpxDesk();
  assert.equal(
    defaultPeek,
    null,
    "peekMergedSpxDesk()'s default usage must apply deskPeekMaxAgeSec(), not the generic 10-minute ceiling"
  );

  // spx-service.ts's deliberate 24h off-hours closed-market read passes its own explicit
  // maxStaleMs — this fix must tighten only the DEFAULT, never override an explicit caller.
  const overriddenPeek = await peekMergedSpxDesk({ maxStaleMs: 24 * 60 * 60 * 1000 });
  assert.ok(overriddenPeek, "an explicit maxStaleMs override must still be honored unchanged");
});

test.after(() => mock.restoreAll());
