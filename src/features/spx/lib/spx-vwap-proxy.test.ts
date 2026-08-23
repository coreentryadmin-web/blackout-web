import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveSessionVwap,
  __resetSpyVolumeCache,
  SPY_VOLUME_CACHE_MS,
  SPY_VOLUME_EMPTY_CACHE_MS,
} from "./spx-vwap-proxy";
import { spxVwapSpyProxyEnabled } from "@/lib/providers/config";
import { evaluatePlaybookDataSatisfaction } from "./playbook-data-requirements";
import type { PlaybookDataQualityFlags } from "./playbook-data-requirements";

// 10:00 and 10:01 ET — inside RTH, so filterRthBars keeps them.
const T1 = Date.parse("2026-07-13T14:00:00Z");
const T2 = T1 + 60_000;
const BARS = [
  { t: T1, o: 100, h: 102, l: 98, c: 100, v: 0 }, // typical 100
  { t: T2, o: 100, h: 112, l: 108, c: 110, v: 0 }, // typical 110
];
const HEAVY_ON_SECOND = new Map<number, number>([
  [Math.floor(T1 / 1000), 100],
  [Math.floor(T2 / 1000), 900],
]);

const deps = (over: Partial<Parameters<typeof resolveSessionVwap>[2]> = {}) => ({
  fetchSpyVolume: async () => new Map(HEAVY_ON_SECOND),
  enabled: true,
  ...over,
});

test.beforeEach(() => __resetSpyVolumeCache());

// ── the env flag ────────────────────────────────────────────────────────────────────────────────
test("spxVwapSpyProxyEnabled: defaults ON so the capability ships without a secret change", () => {
  const saved = process.env.SPX_VWAP_SPY_PROXY;
  try {
    delete process.env.SPX_VWAP_SPY_PROXY;
    assert.equal(spxVwapSpyProxyEnabled(), true, "unset must mean ON");
    // Reversible without a deploy — the whole point of not hardcoding this.
    for (const off of ["0", "false", "FALSE"]) {
      process.env.SPX_VWAP_SPY_PROXY = off;
      assert.equal(spxVwapSpyProxyEnabled(), false, `${off} must disable`);
    }
    for (const on of ["1", "true"]) {
      process.env.SPX_VWAP_SPY_PROXY = on;
      assert.equal(spxVwapSpyProxyEnabled(), true, `${on} must enable`);
    }
  } finally {
    if (saved === undefined) delete process.env.SPX_VWAP_SPY_PROXY;
    else process.env.SPX_VWAP_SPY_PROXY = saved;
  }
});

// ── resolution + provenance ─────────────────────────────────────────────────────────────────────
test("proxy ON: volume-weights the VWAP and labels the source spy_proxy", async () => {
  const r = await resolveSessionVwap(BARS, "2026-07-13", deps());
  assert.equal(r.vwap_volume_weighted, true);
  assert.equal(r.vwap_volume_source, "spy_proxy");
  // Equal-weight would be 105; SPY volume 9:1 on the 110 bar pulls it up.
  assert.ok(r.vwap! > 108, `expected pull toward the heavy bar, got ${r.vwap}`);
});

test("proxy OFF: falls back to the typical-price mean and claims NO source", async () => {
  const r = await resolveSessionVwap(BARS, "2026-07-13", deps({ enabled: false }));
  assert.equal(r.vwap_volume_weighted, false);
  assert.equal(r.vwap, 105, "equal-weight typical price");
  assert.equal(r.vwap_volume_source, null, "must not name a source it did not use");
});

test("bars carrying their own volume are labelled native, and SPY is never fetched", async () => {
  let fetched = 0;
  const withVol = BARS.map((b) => ({ ...b, v: 500 }));
  const r = await resolveSessionVwap(withVol, "2026-07-13", deps({
    fetchSpyVolume: async () => { fetched++; return new Map(HEAVY_ON_SECOND); },
  }));
  assert.equal(r.vwap_volume_weighted, true);
  assert.equal(r.vwap_volume_source, "native");
  assert.equal(fetched, 0, "real SPX volume must short-circuit the proxy entirely");
});

test("empty SPY map degrades to the fallback rather than a fabricated weighting", async () => {
  const r = await resolveSessionVwap(BARS, "2026-07-13", deps({
    fetchSpyVolume: async () => new Map(),
  }));
  assert.equal(r.vwap_volume_weighted, false);
  assert.equal(r.vwap_volume_source, null);
});

test("a throwing SPY fetch degrades quietly — never propagates out of the desk build", async () => {
  const r = await resolveSessionVwap(BARS, "2026-07-13", deps({
    fetchSpyVolume: async () => { throw new Error("polygon 502"); },
  }));
  assert.equal(r.vwap_volume_weighted, false);
  assert.equal(r.vwap_volume_source, null);
});

test("volume that lands on NO bar leaves the label null, not spy_proxy", async () => {
  // Timestamps that match nothing — merge is a no-op, so the stats come back unweighted and must
  // not be dressed as a proxy read.
  const r = await resolveSessionVwap(BARS, "2026-07-13", deps({
    fetchSpyVolume: async () => new Map([[1, 1000], [2, 2000]]),
  }));
  assert.equal(r.vwap_volume_weighted, false);
  assert.equal(r.vwap_volume_source, null);
});

// ── the cache, which is why this is affordable on a 5s lane ─────────────────────────────────────
test("SPY volume is fetched once across many rebuilds within the TTL", async () => {
  let fetched = 0;
  let clock = 1_000_000;
  const d = deps({
    fetchSpyVolume: async () => { fetched++; return new Map(HEAVY_ON_SECOND); },
    now: () => clock,
  });
  for (let i = 0; i < 12; i++) {
    clock += 5_000; // the pulse-structure lane's cadence
    await resolveSessionVwap(BARS, "2026-07-13", d);
  }
  assert.equal(fetched, 1, "12 rebuilds inside the TTL must not mean 12 provider calls");

  clock += SPY_VOLUME_CACHE_MS + 1;
  await resolveSessionVwap(BARS, "2026-07-13", d);
  assert.equal(fetched, 2, "refetches once the TTL lapses");
});

test("an EMPTY result is cached briefly, so an outage does not retry every rebuild", async () => {
  let fetched = 0;
  let clock = 1_000_000;
  const d = deps({
    fetchSpyVolume: async () => { fetched++; return new Map(); },
    now: () => clock,
  });
  await resolveSessionVwap(BARS, "2026-07-13", d);
  clock += SPY_VOLUME_EMPTY_CACHE_MS - 1;
  await resolveSessionVwap(BARS, "2026-07-13", d);
  assert.equal(fetched, 1, "empty result held for its shorter TTL");
  // Shorter than the success TTL, so recovery is quick rather than waiting out a full minute.
  clock += 2;
  await resolveSessionVwap(BARS, "2026-07-13", d);
  assert.equal(fetched, 2);
  assert.ok(SPY_VOLUME_EMPTY_CACHE_MS < SPY_VOLUME_CACHE_MS);
});

test("a new session date invalidates the cache", async () => {
  let fetched = 0;
  const d = deps({
    fetchSpyVolume: async () => { fetched++; return new Map(HEAVY_ON_SECOND); },
  });
  await resolveSessionVwap(BARS, "2026-07-13", d);
  await resolveSessionVwap(BARS, "2026-07-14", d);
  assert.equal(fetched, 2, "yesterday's volume map must never weight today's VWAP");
});

// ── THE REGRESSION THAT MATTERS: PB-01/PB-02 can fire again ─────────────────────────────────────
//
// This is the member-facing assertion. `PLAYBOOK_LIVE_GATE=1` in production means a BUY requires a
// matched primary playbook, so a PB-01/PB-02 that can never satisfy its data requirement is not a
// degraded setup — it is an entry that silently never happens. Before this change
// `vwap_volume_weighted` was permanently false in production and both were unreachable.
const CLEAN_FLAGS: PlaybookDataQualityFlags = {
  desk_stale: false,
  gex_missing: false,
  vix_missing: false,
  halt_feed_stale: false,
};

for (const pb of ["PB-01", "PB-02"] as const) {
  test(`${pb} is data-BLOCKED when the VWAP is not volume-weighted (the pre-fix production state)`, () => {
    const r = evaluatePlaybookDataSatisfaction(
      pb,
      CLEAN_FLAGS,
      { vix: 15, vwap_volume_weighted: false },
      { option_quotes_available: true }
    );
    assert.equal(r.satisfied, false);
    assert.ok(
      r.violations.some((v) => v.capability === "volumeWeightedVwap"),
      "the volumeWeightedVwap requirement is what stops it"
    );
  });

  test(`${pb} is data-SATISFIED once the SPY proxy weights the VWAP (the fix)`, () => {
    const r = evaluatePlaybookDataSatisfaction(
      pb,
      CLEAN_FLAGS,
      { vix: 15, vwap_volume_weighted: true },
      { option_quotes_available: true }
    );
    assert.ok(
      !r.violations.some((v) => v.capability === "volumeWeightedVwap"),
      `${pb} must no longer be blocked on volumeWeightedVwap`
    );
    assert.equal(r.satisfied, true, `${pb} clears its data requirements`);
  });
}

test("end to end: the resolver output is what unblocks the playbooks", async () => {
  const resolved = await resolveSessionVwap(BARS, "2026-07-13", deps());
  const r = evaluatePlaybookDataSatisfaction(
    "PB-01",
    CLEAN_FLAGS,
    { vix: 15, vwap_volume_weighted: resolved.vwap_volume_weighted },
    { option_quotes_available: true }
  );
  assert.equal(resolved.vwap_volume_source, "spy_proxy");
  assert.equal(r.satisfied, true);
});

test("and disabling the proxy re-blocks them — the revert path is real, not theoretical", async () => {
  const resolved = await resolveSessionVwap(BARS, "2026-07-13", deps({ enabled: false }));
  const r = evaluatePlaybookDataSatisfaction(
    "PB-01",
    CLEAN_FLAGS,
    { vix: 15, vwap_volume_weighted: resolved.vwap_volume_weighted },
    { option_quotes_available: true }
  );
  assert.equal(r.satisfied, false);
  assert.ok(r.violations.some((v) => v.capability === "volumeWeightedVwap"));
});
