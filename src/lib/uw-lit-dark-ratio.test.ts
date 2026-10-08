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
