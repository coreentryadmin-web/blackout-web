import { test } from "node:test";
import assert from "node:assert/strict";

import {
  productionFetchBudget,
  productionScreenPool,
  splitBreakoutCohorts,
} from "./breakout-cohort-split.mjs";

const SRC = new URL("../../../src/", import.meta.url).pathname;
// The REAL production ranker — the whole point of this module is that the harnesses use it
// instead of the $-volume order `screenBreakoutMovers` happens to return.
const { rankMoversForChainFetch, BREAKOUT_SCREEN_POOL, BREAKOUT_MAX_CANDIDATES_CEILING } =
  await import(`${SRC}lib/zerodte/breakout-discovery.ts`);

const mover = (ticker, gain, close_strength, dollar) => ({ ticker, gain, close_strength, dollar });

test("productionFetchBudget mirrors min(max(cap*4, 60), screenPool)", () => {
  assert.equal(productionFetchBudget(40, 200), 160); // 40*4 = 160
  assert.equal(productionFetchBudget(100, 200), 200); // 400 clamped to the screen pool
  assert.equal(productionFetchBudget(5, 200), 60); // floor of 60
});

test("productionScreenPool mirrors max(ceiling*4, BREAKOUT_SCREEN_POOL)", () => {
  assert.equal(productionScreenPool(100, 200), 400);
  assert.equal(productionScreenPool(10, 200), 200);
  // Sanity: pinned against the live constants so a constant change surfaces here.
  assert.equal(productionScreenPool(BREAKOUT_MAX_CANDIDATES_CEILING, BREAKOUT_SCREEN_POOL), 400);
});

test("the split is by MOMENTUM rank, not by $-volume — the exact defect being corrected", () => {
  // MEGA is a sluggish mega-cap: huge $-volume, weak momentum quality. SHARP is a mid-cap
  // continuation: modest $-volume, best gain × close_strength. The old `.slice(0, KEEP)` over a
  // $-volume-sorted pool keeps MEGA and drops SHARP; production keeps SHARP.
  const pool = [
    mover("MEGA", 0.05, 0.5, 900e6), // quality 0.025 — $-volume rank 1
    mover("MID", 0.08, 0.6, 400e6), // quality 0.048
    mover("SHARP", 0.20, 0.95, 120e6), // quality 0.190 — momentum rank 1
  ];

  const dollarOrder = [...pool].sort((a, b) => b.dollar - a.dollar).map((m) => m.ticker);
  assert.deepEqual(dollarOrder, ["MEGA", "MID", "SHARP"], "pool arrives in $-volume order");

  const split = splitBreakoutCohorts({
    pool,
    cap: 1,
    screenPoolCap: BREAKOUT_SCREEN_POOL,
    rank: rankMoversForChainFetch,
    side: "long",
  });

  assert.deepEqual(split.ranked.map((m) => m.ticker), ["SHARP", "MID", "MEGA"]);
  assert.deepEqual(split.kept.map((m) => m.ticker), ["SHARP"], "production keeps the momentum leader");
  assert.deepEqual(split.dropped.map((m) => m.ticker), ["MID", "MEGA"]);
  assert.notDeepEqual(
    split.kept.map((m) => m.ticker),
    pool.slice(0, 1).map((m) => m.ticker),
    "the corrected split MUST differ from the old .slice(0, KEEP) over the screened pool"
  );
});

test("short side ranks on WEAK closes (gain × (1 − close_strength))", () => {
  const pool = [
    mover("BOUNCE", 0.10, 0.45, 500e6), // closed mid-range → weak conviction short
    mover("CRUSH", 0.09, 0.05, 200e6), // closed on the low → real breakdown
  ];
  const split = splitBreakoutCohorts({
    pool,
    cap: 1,
    screenPoolCap: BREAKOUT_SCREEN_POOL,
    rank: rankMoversForChainFetch,
    side: "short",
  });
  assert.deepEqual(split.kept.map((m) => m.ticker), ["CRUSH"]);
});

test("kept ∪ dropped is the whole pool, disjointly — no name is invented or lost", () => {
  const pool = Array.from({ length: 57 }, (_, i) =>
    mover(`T${i}`, 0.05 + (i % 11) / 100, 0.5 + (i % 5) / 12, (57 - i) * 1e6)
  );
  const split = splitBreakoutCohorts({
    pool,
    cap: 40,
    screenPoolCap: BREAKOUT_SCREEN_POOL,
    rank: rankMoversForChainFetch,
    side: "long",
  });
  assert.equal(split.kept.length, 40);
  assert.equal(split.dropped.length, 17);
  const seen = new Set([...split.kept, ...split.dropped].map((m) => m.ticker));
  assert.equal(seen.size, pool.length, "every pool name lands in exactly one cohort");
});

test("cap larger than the pool keeps everything and drops nothing", () => {
  const pool = [mover("A", 0.1, 0.9, 10e6), mover("B", 0.2, 0.8, 5e6)];
  const split = splitBreakoutCohorts({
    pool,
    cap: 40,
    screenPoolCap: BREAKOUT_SCREEN_POOL,
    rank: rankMoversForChainFetch,
    side: "long",
  });
  assert.equal(split.kept.length, 2);
  assert.deepEqual(split.dropped, []);
});

test("unfetched = names below the chain-fetch budget (unreachable even on total build failure)", () => {
  const pool = Array.from({ length: 250 }, (_, i) =>
    mover(`T${i}`, 0.05 + i / 1000, 0.6, (250 - i) * 1e6)
  );
  const split = splitBreakoutCohorts({
    pool,
    cap: 40,
    screenPoolCap: BREAKOUT_SCREEN_POOL,
    rank: rankMoversForChainFetch,
    side: "long",
  });
  assert.equal(split.fetch_budget, 160);
  assert.equal(split.unfetched.length, 250 - 160);
});
