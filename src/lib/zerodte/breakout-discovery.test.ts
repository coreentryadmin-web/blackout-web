import { test } from "node:test";
import assert from "node:assert/strict";

import {
  assessGroupedBarFreshness,
  discoverBreakoutSetups,
  rankMoversForChainFetch,
  BREAKOUT_MAX_BAR_AGE_MS,
  BREAKOUT_MAX_CANDIDATES,
  BREAKOUT_MAX_CANDIDATES_CEILING,
  type BreakoutDiscoveryDeps,
} from "./breakout-discovery";
import type { DailyMarketBar } from "@/lib/providers/polygon";
import type { EnrichedZeroDteSetup } from "./board";
import type { BreakoutMover } from "@/features/nighthawk/lib/candidates";

// WS-19 — BREAKOUT grouped-bar age validation (fail closed on stale data).
//
// The guard sits BEFORE screening/chain-fetch, so these tests drive the pure freshness function
// directly AND exercise discoverBreakoutSetups end-to-end through its injectable IO seam (no
// network, no real providers). The three mandated scenarios:
//   (1) a STALE non-empty grouped snapshot  → data_unavailable, zero candidates (fail closed).
//   (2) a FRESH but empty market            → normal empty (status "ok"), DISTINCT from stale.
//   (3) FRESH data with movers              → normal candidates.

const RTH_NOW_ET_MINUTES = 11 * 60; // 11:00 ET — inside the [9:30, 14:00) commit window.

/** A grouped-daily bar dated `t`, otherwise a plausible strong-close mover. */
function bar(ticker: string, t: number, over: Partial<DailyMarketBar> = {}): DailyMarketBar {
  return { T: ticker, o: 100, h: 130, l: 99, c: 129, vw: 120, v: 5_000_000, t, ...over };
}

/** Deps that record calls, so we can assert screening/chain-fetch never ran when we fail closed. */
function makeDeps(over: Partial<BreakoutDiscoveryDeps> = {}): {
  deps: Partial<BreakoutDiscoveryDeps>;
  calls: { screen: number; resolveChain: number };
} {
  const calls = { screen: 0, resolveChain: 0 };
  const deps: Partial<BreakoutDiscoveryDeps> = {
    screen: ((results: Parameters<BreakoutDiscoveryDeps["screen"]>[0]) => {
      calls.screen++;
      // Default screen: turn every bar into a mover (tests that want "no movers" override this).
      return (results as DailyMarketBar[]).map(
        (r): BreakoutMover => ({
          ticker: r.T,
          gain: 0.25,
          volume: r.v,
          close_strength: 0.95,
          dollar: r.c * r.v,
        })
      );
    }) as BreakoutDiscoveryDeps["screen"],
    resolveChain: (async (ticker: string) => {
      calls.resolveChain++;
      return {
        spot: 130,
        rows: [{ expiry: "2026-07-24", strike: 130, call_bid: 1, call_ask: 1.1, call_oi: 500 }],
      };
    }) as unknown as BreakoutDiscoveryDeps["resolveChain"],
    pickContract: (() => ({ strike: 130, expiry: "2026-07-24", dte: 0 })) as BreakoutDiscoveryDeps["pickContract"],
    buildSetup: ((input: { mover: { ticker: string } }) =>
      ({ ticker: input.mover.ticker, score: 42 } as unknown as EnrichedZeroDteSetup)) as BreakoutDiscoveryDeps["buildSetup"],
    ...over,
  };
  return { deps, calls };
}

// ── Pure freshness function ────────────────────────────────────────────────────────

test("assessGroupedBarFreshness: prior-day snapshot (age > 24h) is stale", () => {
  const now = Date.parse("2026-07-24T15:00:00Z");
  // Freshest bar dated ~26h earlier — a carried-over prior-day snapshot.
  const res = assessGroupedBarFreshness([{ t: now - 26 * 3_600_000 }, { t: now - 30 * 3_600_000 }], now);
  assert.equal(res.fresh, false);
  assert.equal(res.fresh === false && res.reason, "stale_snapshot");
});

test("assessGroupedBarFreshness: same-day live bar (age < 24h) is fresh", () => {
  const now = Date.parse("2026-07-24T15:00:00Z");
  // t ≈ midnight ET of the same session → ~19h old at 15:00Z, well under the 24h cap.
  const res = assessGroupedBarFreshness([{ t: now - 19 * 3_600_000 }], now);
  assert.equal(res.fresh, true);
});

test("assessGroupedBarFreshness: no usable timestamp fails closed (never fabricates one)", () => {
  const now = Date.now();
  const r = assessGroupedBarFreshness([{ t: undefined }, {}], now);
  assert.equal(r.fresh, false);
  assert.equal(r.fresh === false && r.reason, "missing_bar_timestamp");
});

test("BREAKOUT_MAX_BAR_AGE_MS is 24h", () => {
  assert.equal(BREAKOUT_MAX_BAR_AGE_MS, 24 * 60 * 60 * 1000);
});

// ── Scenario 1: STALE non-empty snapshot → data_unavailable, zero candidates ─────────

test("discoverBreakoutSetups: stale grouped snapshot fails closed (data_unavailable, no candidates)", async () => {
  const now = Date.parse("2026-07-24T15:00:00Z");
  const staleT = now - 26 * 3_600_000; // prior session
  const { deps, calls } = makeDeps();
  const out = await discoverBreakoutSetups({
    today: "2026-07-24",
    nowEtMinutes: RTH_NOW_ET_MINUTES,
    excludeTickers: new Set(),
    nowMs: now,
    deps: {
      ...deps,
      fetchSummary: (async () => ({ results: [bar("AAAA", staleT), bar("BBBB", staleT)] })) as never,
    },
  });
  assert.equal(out.status, "data_unavailable");
  assert.equal(out.reason, "stale_snapshot");
  assert.equal(out.setups.length, 0);
  // Fail-closed means we never even screened the stale bars into candidates.
  assert.equal(calls.screen, 0);
  assert.equal(calls.resolveChain, 0);
});

// ── Scenario 2: FRESH but empty market → normal empty (distinct from stale) ──────────

test("discoverBreakoutSetups: fresh snapshot with zero qualifying movers → ok + empty (not data_unavailable)", async () => {
  const now = Date.parse("2026-07-24T15:00:00Z");
  const freshT = now - 19 * 3_600_000; // same-session bar
  const { deps } = makeDeps({
    screen: (() => [] as BreakoutMover[]) as BreakoutDiscoveryDeps["screen"], // fresh data, but nothing qualifies
  });
  const out = await discoverBreakoutSetups({
    today: "2026-07-24",
    nowEtMinutes: RTH_NOW_ET_MINUTES,
    excludeTickers: new Set(),
    nowMs: now,
    deps: {
      ...deps,
      fetchSummary: (async () => ({ results: [bar("AAAA", freshT), bar("BBBB", freshT)] })) as never,
    },
  });
  assert.equal(out.status, "ok"); // NOT data_unavailable — the data was fresh, the market was just quiet
  assert.equal(out.reason, undefined);
  assert.equal(out.setups.length, 0);
});

// ── Scenario 3: FRESH data with movers → normal candidates ───────────────────────────

test("discoverBreakoutSetups: fresh snapshot with movers → ok + built candidates", async () => {
  const now = Date.parse("2026-07-24T15:00:00Z");
  const freshT = now - 19 * 3_600_000;
  const { deps, calls } = makeDeps();
  const out = await discoverBreakoutSetups({
    today: "2026-07-24",
    nowEtMinutes: RTH_NOW_ET_MINUTES,
    excludeTickers: new Set(),
    nowMs: now,
    maxCandidates: 6,
    deps: {
      ...deps,
      fetchSummary: (async () => ({ results: [bar("AAAA", freshT), bar("BBBB", freshT)] })) as never,
    },
  });
  assert.equal(out.status, "ok");
  assert.equal(out.setups.length, 2);
  assert.ok(calls.screen > 0, "fresh data must reach the screen");
  assert.ok(calls.resolveChain > 0, "fresh movers must reach the chain fetch");
});

test("rankMoversForChainFetch: momentum quality beats $-volume for the chain-fetch budget", () => {
  const mega = { ticker: "MEGA", gain: 0.04, close_strength: 0.55, dollar: 5e9 };
  const sharp = { ticker: "SHARP", gain: 0.18, close_strength: 0.95, dollar: 2e8 };
  const mid = { ticker: "MID", gain: 0.1, close_strength: 0.8, dollar: 8e8 };
  const ranked = rankMoversForChainFetch([mega, sharp, mid], 2, "long");
  assert.deepEqual(
    ranked.map((m) => m.ticker),
    ["SHARP", "MID"],
    "sharp mid-cap continuation outranks sluggish mega-cap $-volume"
  );

  const weakClose = { ticker: "DUMP", gain: 0.15, close_strength: 0.1, dollar: 3e8 };
  const softDump = { ticker: "SOFT", gain: 0.12, close_strength: 0.4, dollar: 9e8 };
  const shortRanked = rankMoversForChainFetch([softDump, weakClose], 1, "short");
  assert.equal(shortRanked[0]!.ticker, "DUMP", "weak-close breakdown wins the short chain-fetch slot");
});

test("discoverBreakoutSetups: walks past weekly-only misses to fill same-day setups", async () => {
  // Repro 2026-07-29: momentum-top names only listed Aug weeklies → old hard top-N
  // Promise.all returned built=0 even when a later-ranked name (MU-class) had 0DTE.
  const now = Date.parse("2026-07-29T15:00:00Z");
  const freshT = now - 19 * 3_600_000;
  const weeklyOnly = new Set(["JUNK1", "JUNK2", "JUNK3", "JUNK4"]);
  const { deps, calls } = makeDeps({
    screen: ((results) =>
      (results as DailyMarketBar[]).map(
        (r, i): BreakoutMover => ({
          ticker: r.T,
          // Descending momentum so JUNK* rank above MU.
          gain: 0.3 - i * 0.02,
          volume: r.v,
          close_strength: 0.95,
          dollar: r.c * r.v,
        })
      )) as BreakoutDiscoveryDeps["screen"],
    screenBreakdowns: (() => [] as BreakoutMover[]) as BreakoutDiscoveryDeps["screenBreakdowns"],
    resolveChain: (async (ticker: string) => {
      calls.resolveChain++;
      if (weeklyOnly.has(ticker.toUpperCase())) {
        // Chain exists but only a weekly (≥2 DTE) — pickAtmZeroDteContract returns null.
        return {
          spot: 50,
          rows: [
            {
              expiry: "2026-08-21",
              strike: 50,
              call_bid: 1,
              call_ask: 1.1,
              call_oi: 100,
              put_bid: 1,
              put_ask: 1.1,
              put_oi: 100,
            },
          ],
        };
      }
      // MU: same-day contract available.
      return {
        spot: 780,
        rows: [
          {
            expiry: "2026-07-29",
            strike: 780,
            call_bid: 8,
            call_ask: 8.5,
            call_oi: 500,
            put_bid: 8,
            put_ask: 8.5,
            put_oi: 500,
          },
        ],
      };
    }) as unknown as BreakoutDiscoveryDeps["resolveChain"],
    // Use the REAL picker so weekly rows are rejected and the 0DTE row is kept.
    pickContract: undefined,
  });
  // Re-bind pickContract to the real one from breakout-source (makeDeps default stubs a hit).
  const { pickBreakoutContractWithFallback } = await import("./breakout-source");
  const out = await discoverBreakoutSetups({
    today: "2026-07-29",
    nowEtMinutes: RTH_NOW_ET_MINUTES,
    excludeTickers: new Set(),
    nowMs: now,
    maxCandidates: 2,
    deps: {
      ...deps,
      pickContract: pickBreakoutContractWithFallback,
      fetchSummary: (async () => ({
        results: [
          bar("JUNK1", freshT, { c: 40, o: 30, v: 2_000_000 }),
          bar("JUNK2", freshT, { c: 40, o: 30, v: 2_000_000 }),
          bar("JUNK3", freshT, { c: 40, o: 30, v: 2_000_000 }),
          bar("JUNK4", freshT, { c: 40, o: 30, v: 2_000_000 }),
          bar("MU", freshT, { c: 780, o: 700, v: 18_000_000 }),
        ],
      })) as never,
    },
  });
  assert.equal(out.status, "ok");
  assert.ok(
    out.setups.some((s) => String(s.ticker).toUpperCase() === "MU"),
    `expected MU to be walked-to after weekly-only misses; got ${out.setups.map((s) => s.ticker).join(",")}`
  );
  assert.ok(calls.resolveChain > 1, "must attempt more than the first weekly-only name");
});

// ── Dynamic-N (2026-08-04) ────────────────────────────────────────────────────────────
// resolveBreakoutCandidateCap sizes the live cap to the day's qualifying breadth instead of the
// fixed BREAKOUT_MAX_CANDIDATES=40. These exercise the production path end-to-end (opts.maxCandidates
// intentionally omitted, matching how the real board calls discoverBreakoutSetups).

test("discoverBreakoutSetups: huge-breadth day fills PAST the static floor, bounded by the ceiling", async () => {
  const now = Date.parse("2026-07-24T15:00:00Z");
  const freshT = now - 19 * 3_600_000;
  const QUALIFYING = 300; // real 2026-07-30-class breadth (390 qualifying observed live)
  const bars = Array.from({ length: QUALIFYING }, (_, i) => bar(`AAA${i}`, freshT, { c: 100 + i, v: 5_000_000 + i }));
  const { deps } = makeDeps({
    screenBreakdowns: (() => [] as BreakoutMover[]) as BreakoutDiscoveryDeps["screenBreakdowns"],
  });
  const out = await discoverBreakoutSetups({
    today: "2026-07-24",
    nowEtMinutes: RTH_NOW_ET_MINUTES,
    excludeTickers: new Set(),
    nowMs: now,
    // NOTE: no maxCandidates override — production never passes one, so this exercises the real
    // dynamic-cap formula (resolveBreakoutCandidateCap) rather than a test-injected hard cap.
    deps: {
      ...deps,
      fetchSummary: (async () => ({ results: bars })) as never,
    },
  });
  assert.equal(out.status, "ok");
  // ceil(300 * 0.30) = 90, clamped to [BREAKOUT_MAX_CANDIDATES, BREAKOUT_MAX_CANDIDATES_CEILING].
  const expected = Math.max(BREAKOUT_MAX_CANDIDATES, Math.min(BREAKOUT_MAX_CANDIDATES_CEILING, Math.ceil(QUALIFYING * 0.3)));
  assert.equal(expected, 90, "sanity: this test's own math should land at 90");
  assert.equal(out.setups.length, expected);
  assert.ok(
    out.setups.length > BREAKOUT_MAX_CANDIDATES,
    "a huge-breadth day must fill past the old static cap — this is the whole point of dynamic-N"
  );
  assert.ok(
    out.setups.length <= BREAKOUT_MAX_CANDIDATES_CEILING,
    "dynamic-N must never exceed the ceiling regardless of how large the qualifying pool is"
  );
});

test("discoverBreakoutSetups: thin day still fills up to the static floor (no regression vs pre-dynamic behavior)", async () => {
  const now = Date.parse("2026-07-24T15:00:00Z");
  const freshT = now - 19 * 3_600_000;
  // 50 qualifying movers → ceil(50*0.30)=15 < floor(40) → clamped up to 40, same as the old static cap.
  const bars = Array.from({ length: 50 }, (_, i) => bar(`BBB${i}`, freshT, { c: 100 + i, v: 5_000_000 + i }));
  const { deps } = makeDeps({
    screenBreakdowns: (() => [] as BreakoutMover[]) as BreakoutDiscoveryDeps["screenBreakdowns"],
  });
  const out = await discoverBreakoutSetups({
    today: "2026-07-24",
    nowEtMinutes: RTH_NOW_ET_MINUTES,
    excludeTickers: new Set(),
    nowMs: now,
    deps: {
      ...deps,
      fetchSummary: (async () => ({ results: bars })) as never,
    },
  });
  assert.equal(out.status, "ok");
  assert.equal(out.setups.length, BREAKOUT_MAX_CANDIDATES, "thin day must still hit the floor, unchanged from pre-dynamic behavior");
});
