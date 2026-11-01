/**
 * Regression guard for a future-timestamp freshness bug in computeLitDarkRatio (2026-09-05).
 * Raw `now - updatedAt <= maxAge` reads clock-skewed future stamps as fresh.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { computeLitDarkRatio } from "./uw-lit-dark-ratio";
import { darkPoolStore, litTradesStore } from "./ws/uw-socket";
import type { DarkPoolSnapshot } from "./providers/unusual-whales";

test("computeLitDarkRatio: lit/dark freshness uses isWsUpdatedAtFresh (source scan)", () => {
  const src = readFileSync(new URL("./uw-lit-dark-ratio.ts", import.meta.url), "utf8");
  assert.match(
    src,
    /const litFresh = isWsUpdatedAtFresh\(litTradesStore\.updatedAt, LIT_DARK_MAX_AGE_MS, now\)/,
    "lit tape freshness must reject clock-skewed future updatedAt stamps"
  );
  assert.match(
    src,
    /const darkStoreFresh = isWsUpdatedAtFresh\(darkPoolStore\.updatedAt, LIT_DARK_MAX_AGE_MS, now\)/,
    "dark pool freshness must reject clock-skewed future updatedAt stamps"
  );
  assert.doesNotMatch(
    src,
    /now\s*-\s*litTradesStore\.updatedAt\s*<=/,
    "raw now-updatedAt must not gate lit freshness"
  );
  assert.doesNotMatch(
    src,
    /now\s*-\s*darkPoolStore\.updatedAt\s*<=/,
    "raw now-updatedAt must not gate dark freshness"
  );
});

test("computeLitDarkRatio: accepts a caller-resolved dark-pool snapshot when the raw WS store is dead", () => {
  // Live repro (2026-10-06, 5-engine/Ask Largo monitor): the SPX desk's own resolveDarkPool()
  // falls back to a Redis-bridge/REST snapshot when the raw darkPoolStore WS lane is dead, so the
  // desk's dark_pool field stays genuinely fresh (prints <150s old) while darkPoolStore.updatedAt
  // never advances. Before this fix, computeLitDarkRatio() only ever checked darkPoolStore and
  // litTradesStore directly, so it returned null forever in that state — even though the exact
  // data members already saw on the desk was live.
  const savedDark = { ...darkPoolStore };
  const savedLit = { ...litTradesStore };
  try {
    // Raw WS lane dead on both sides.
    darkPoolStore.data = null;
    darkPoolStore.updatedAt = 0;
    litTradesStore.rows = [];
    litTradesStore.updatedAt = 0;

    const resolved: DarkPoolSnapshot = {
      prints: [
        { strike: 255, premium: 639_665.27, side: "unknown", executed_at: new Date().toISOString() },
      ],
      total_premium: 639_665.27,
      call_premium: 0,
      put_premium: 0,
      bias: "neutral",
      pcr: null,
      detail: "1 print(s) | $0.64M",
    };

    assert.equal(computeLitDarkRatio(), null, "no resolved snapshot + dead WS lane -> still null");

    const ratio = computeLitDarkRatio(resolved);
    assert.notEqual(ratio, null, "a genuinely fresh resolved snapshot must not read as unavailable");
    assert.equal(ratio?.dark_premium, 639_665.27);
    assert.equal(ratio?.lit_premium, 0);
    assert.equal(ratio?.lit_share, 0);

    // A stale resolved snapshot (old print) must still correctly read as unavailable — the fix
    // must not weaken the freshness bar, only widen WHERE freshness can be proven from.
    const stale: DarkPoolSnapshot = {
      ...resolved,
      prints: [{ ...resolved.prints[0], executed_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString() }],
    };
    assert.equal(computeLitDarkRatio(stale), null, "a stale resolved snapshot must not count as fresh");
  } finally {
    Object.assign(darkPoolStore, savedDark);
    Object.assign(litTradesStore, savedLit);
  }
});

test("computeLitDarkRatio: updated_at reflects the resolved snapshot's own age, not the dead raw store (2026-10-21)", () => {
  // Live repro, GET /api/market/spx/desk production: dark_premium/lit_share were computed from a
  // genuinely fresh resolved snapshot (prints ~47s old) while updated_at still reported 0 (Unix
  // epoch — "never"), because updated_at was sourced unconditionally from the raw darkPoolStore/
  // litTradesStore timestamps, which stay dead at 0 whenever freshness comes from the caller's
  // resolved snapshot instead (the exact gap the 2026-10-06 fix above left for premium/share).
  const savedDark = { ...darkPoolStore };
  const savedLit = { ...litTradesStore };
  try {
    // Raw WS lane dead on both sides -- mirrors the live repro exactly.
    darkPoolStore.data = null;
    darkPoolStore.updatedAt = 0;
    litTradesStore.rows = [];
    litTradesStore.updatedAt = 0;

    const now = Date.now();
    const printAgeMs = 47_000;
    const resolved: DarkPoolSnapshot = {
      prints: [
        {
          strike: 255,
          premium: 2_862_377.88,
          side: "unknown",
          executed_at: new Date(now - printAgeMs).toISOString(),
        },
      ],
      total_premium: 2_862_377.88,
      call_premium: 0,
      put_premium: 0,
      bias: "neutral",
      pcr: null,
      detail: "1 print(s) | $2.86M",
    };

    const ratio = computeLitDarkRatio(resolved);
    assert.notEqual(ratio, null, "a genuinely fresh resolved snapshot must not read as unavailable");
    assert.notEqual(ratio?.updated_at, 0, "updated_at must not be the dead store's epoch-0 sentinel");
    // updated_at should land within a small tolerance of (now - printAgeMs), not at 0.
    const expected = Date.now() - printAgeMs;
    assert.ok(
      Math.abs((ratio?.updated_at ?? 0) - expected) < 5_000,
      `updated_at (${ratio?.updated_at}) should track the resolved snapshot's own print age (~${expected})`
    );
  } finally {
    Object.assign(darkPoolStore, savedDark);
    Object.assign(litTradesStore, savedLit);
  }
});

test("computeLitDarkRatio: a future-dated print (clock skew) must not push updated_at into the future", () => {
  // Root cause: latestPrintAgeMs() computed `now - latest` with no floor, so a print whose
  // executed_at is ahead of this process's clock (UW-side clock skew, or a container clock that
  // hasn't fully converged -- the exact failure mode coaching-alert-age.ts's module doc documents
  // for this same codebase) produces a NEGATIVE resolvedAgeMs. computeLitDarkRatio then derives
  // `updated_at` as `now - resolvedAgeMs`, which for a negative resolvedAgeMs lands AFTER `now` --
  // a future timestamp leaking into a field every downstream "time ago" renderer assumes is <= now
  // (same bug shape already fixed in FlowFeed.tsx, GexHeatmap.tsx, meridian-viz.tsx, and in this
  // exact file's own 2026-09-05 future-timestamp fix for the raw WS stores -- this is the same gap
  // reopened for the later caller-resolved-snapshot path).
  const savedDark = { ...darkPoolStore };
  const savedLit = { ...litTradesStore };
  try {
    darkPoolStore.data = null;
    darkPoolStore.updatedAt = 0;
    litTradesStore.rows = [];
    litTradesStore.updatedAt = 0;

    const now = Date.now();
    const futureSkewMs = 30_000; // print stamped 30s ahead of this process's clock
    const resolved: DarkPoolSnapshot = {
      prints: [
        {
          strike: 255,
          premium: 1_000_000,
          side: "unknown",
          executed_at: new Date(now + futureSkewMs).toISOString(),
        },
      ],
      total_premium: 1_000_000,
      call_premium: 0,
      put_premium: 0,
      bias: "neutral",
      pcr: null,
      detail: "1 print(s) | $1.00M",
    };

    const ratio = computeLitDarkRatio(resolved);
    assert.notEqual(ratio, null, "a future-dated-but-recent print must still read as fresh, not unavailable");
    assert.ok(
      (ratio?.updated_at ?? 0) <= Date.now(),
      `updated_at (${ratio?.updated_at}) must never be in the future (now=${Date.now()})`
    );
  } finally {
    Object.assign(darkPoolStore, savedDark);
    Object.assign(litTradesStore, savedLit);
  }
});
