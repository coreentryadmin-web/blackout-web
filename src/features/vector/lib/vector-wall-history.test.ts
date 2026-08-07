import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DOMINANT_WALLS_PER_BUCKET,
  trailsByStrike,
  backfillRailPrefix,
  compactHistoryToCap,
  backfillRailGaps,
  railCoverageGaps,
  railUncoveredSec,
  decimateSeedHistory,
  bucketWallHistoryForInterval,
  composeHorizonTrail,
  liveTrailAnchorSec,
  pickReplayTrailSource,
  mergeModeledUnderlay,
  mergeWallHistory,
  narrowedHorizonTrail,
  pickActiveStrikes,
  recordWallSample,
  seedWallHistoryForDisplay,
  strikeTrailLifecycle,
  strikeTrailWeight,
  trailsByStrike,
  trailForFlipLevel,
  trailForGammaFlip,
  trailForRank,
  trimHistoryForLiveTrails,
  trimHistoryToSession,
  LIVE_TRAIL_LOOKBACK_SEC,
  hasVexInHistory,
  type WallHistorySample,
} from "./vector-wall-history";
import type { GexWalls } from "@/lib/providers/gex-wall-levels";

function walls(callStrikes: number[], putStrikes: number[]): GexWalls {
  return {
    callWalls: callStrikes.map((strike, i) => ({ strike, pct: 10 - i })),
    putWalls: putStrikes.map((strike, i) => ({ strike, pct: 8 - i })),
  };
}

test("recordWallSample: appends a new bar time as a new entry", () => {
  const h1 = recordWallSample([], { time: 100, walls: walls([6800], [6700]) });
  const h2 = recordWallSample(h1, { time: 160, walls: walls([6810], [6700]) });
  assert.equal(h2.length, 2);
  assert.deepEqual(h2.map((s) => s.time), [100, 160]);
});

test("recordWallSample: replaces the last entry when the bar is still forming (same time)", () => {
  const h1 = recordWallSample([], { time: 100, walls: walls([6800], [6700]) });
  const h2 = recordWallSample(h1, { time: 100, walls: walls([6805], [6700]) });
  assert.equal(h2.length, 1);
  assert.equal(h2[0].walls.callWalls[0].strike, 6805);
});

test("recordWallSample: over the cap it THINS the old end — it must not amputate it", () => {
  // Rewritten 2026-08-07. This used to assert `length === 5760` and `history[0].time === 240*5`,
  // i.e. that the oldest 240 samples were dropped outright. That behaviour is the bug: at the
  // oracle 5s cadence the cap is 8 hours of wall clock, so post-close recording deleted SPX's
  // entire trading session (measured live: rail 15:54..23:59 against bars 09:30..16:05).
  let history: WallHistorySample[] = [];
  for (let i = 0; i < 6000; i++) {
    history = recordWallSample(history, { time: i * 5, walls: walls([6800], [6700]) });
  }
  assert.ok(history.length <= 5760, `cap must hold, got ${history.length}`);
  assert.equal(history[0].time, 0, "the oldest sample must SURVIVE, thinned rather than dropped");
  assert.equal(history[history.length - 1].time, 5999 * 5, "the newest is always kept");
  // And the live window keeps full recorder resolution.
  const newest = 5999 * 5;
  const live = history.filter((h) => h.time >= newest - 30 * 60);
  for (let i = 1; i < live.length; i++) {
    assert.equal(live[i]!.time - live[i - 1]!.time, 5, "the newest 30 min must stay at 5s");
  }
});

test("trailForRank: projects one rank's strike/pct across the history, in order", () => {
  const history: WallHistorySample[] = [
    { time: 100, walls: walls([6800, 6850], [6700]) },
    { time: 160, walls: walls([6810, 6850], [6700, 6650]) },
  ];
  assert.deepEqual(trailForRank(history, "callWalls", 0), [
    { time: 100, strike: 6800, pct: 10 },
    { time: 160, strike: 6810, pct: 10 },
  ]);
});

test("trailForRank: omits bars where that rank didn't exist, instead of inserting a placeholder", () => {
  const history: WallHistorySample[] = [
    { time: 100, walls: walls([6800, 6850], [6700]) }, // rank 1 exists
    { time: 160, walls: walls([6810], [6700]) }, // rank 1 dropped out (ladder thinned)
    { time: 220, walls: walls([6810, 6860], [6700]) }, // rank 1 reappears
  ];
  assert.deepEqual(trailForRank(history, "callWalls", 1), [
    { time: 100, strike: 6850, pct: 9 },
    { time: 220, strike: 6860, pct: 9 },
  ]);
});

test("trailForRank: returns an empty trail for an empty history", () => {
  assert.deepEqual(trailForRank([], "putWalls", 0), []);
});

test("seedWallHistoryForDisplay: seeds one honest dot at the last bar when history is empty", () => {
  const w = walls([6800], [6700]);
  const seeded = seedWallHistoryForDisplay([], [100, 160, 220], w, 6750);
  assert.equal(seeded.length, 1);
  assert.equal(seeded[0].time, 220);
  assert.deepEqual(seeded[0].walls, w);
  assert.equal(seeded[0].gammaFlip, 6750);
});

test("seedWallHistoryForDisplay: leaves existing history untouched", () => {
  const existing = recordWallSample([], { time: 100, walls: walls([6800], [6700]) });
  const seeded = seedWallHistoryForDisplay(existing, [100, 160], walls([6810], [6700]));
  assert.equal(seeded, existing);
});

test("seedWallHistoryForDisplay: vex-only seed when GEX ladder empty", () => {
  const vex = walls([6820], [6680]);
  const seeded = seedWallHistoryForDisplay([], [100, 160], null, null, vex, 6760);
  assert.equal(seeded.length, 1);
  assert.equal(seeded[0].time, 160);
  assert.deepEqual(seeded[0].vexWalls, vex);
  assert.equal(seeded[0].vexFlip, 6760);
});

test("seedWallHistoryForDisplay: no-op without walls or bars", () => {
  assert.deepEqual(seedWallHistoryForDisplay([], [], walls([6800], [6700])), []);
  assert.deepEqual(seedWallHistoryForDisplay([], [100], null), []);
});

test("trailsByStrike: groups horizontal bead rows per strike — migration splits into two rows", () => {
  const history: WallHistorySample[] = [
    { time: 100, walls: walls([6800], []) },
    { time: 160, walls: walls([6800], []) },
    { time: 220, walls: walls([6810], []) },
  ];
  const callTrails = trailsByStrike(history, "callWalls");
  assert.equal(callTrails.size, 2);
  assert.deepEqual(callTrails.get(6800)?.map((p) => p.time), [100, 160]);
  assert.deepEqual(callTrails.get(6810)?.map((p) => p.time), [220]);
});

test("backfillRailPrefix: fills only the pre-view gap with modeled ghosts; observed stays solid", () => {
  // Member opened the ticker mid-session: observed rail starts at 14:00 (t=50400 rel), bars start
  // at the open (t=0 rel). Model covers the whole session at 5-min cadence.
  const observed = [
    { time: 50400, walls: walls([100], [90]) },
    { time: 50700, walls: walls([100], [90]) },
  ];
  const modeled = [0, 300, 50100, 50400, 50700].map((time) => ({ time, walls: walls([101], [89]) }));
  const merged = backfillRailPrefix(observed, modeled, 0);
  // Prefix modeled buckets (< 50400) included as modeled:true; the modeled 50400/50700 buckets are
  // NOT allowed to overlap/extend the observed region.
  assert.deepEqual(merged.map((s) => s.time), [0, 300, 50100, 50400, 50700]);
  assert.equal(merged[0].modeled, true);
  assert.equal(merged[2].modeled, true);
  assert.equal(merged[3].modeled, false);
  assert.deepEqual(merged[3].walls, walls([100], [90]), "observed sample untouched");
});

test("backfillRailPrefix: no-op when observed already starts near the open, model empty, or no bars", () => {
  const observed = [{ time: 600, walls: walls([100], [90]) }];
  const modeled = [{ time: 0, walls: walls([101], [89]) }];
  assert.equal(backfillRailPrefix(observed, modeled, 0), observed, "gap ≤ 20min → untouched");
  assert.equal(backfillRailPrefix(observed, [], 0), observed, "empty model → untouched");
  assert.equal(backfillRailPrefix(observed, modeled, undefined), observed, "no bars → untouched");
  // Empty observed rail: the whole modeled session becomes the (ghost) rail.
  const seeded = backfillRailPrefix([], [{ time: 0, walls: walls([101], [89]) }, { time: 300, walls: walls([101], [89]) }], 0);
  assert.deepEqual(seeded.map((s) => [s.time, s.modeled]), [[0, true], [300, true]]);
});

test("trimHistoryToSession: drops samples strictly before the session's first bar", () => {
  const history = [0, 300, 50000, 50400, 50700].map((time) => ({ time, walls: walls([100], [90]) }));
  // Two prior sessions (t=0, t=300 from an earlier calendar day) plus the current session (>= 50000).
  const trimmed = trimHistoryToSession(history, 50000);
  assert.deepEqual(trimmed.map((s) => s.time), [50000, 50400, 50700]);
});

test("trimHistoryToSession: never clips backfillRailPrefix's modeled prefix (always >= firstBarTime)", () => {
  // Observed rail starts at 14:00 (t=50400 rel), session opens at t=0 — a 50400s gap, well past
  // the 20min backfill threshold, so the modeled prefix (>= firstBarTime=0) fills it.
  const observed = [{ time: 50400, walls: walls([100], [90]) }];
  const modeled = [0, 300, 50100, 50400].map((time) => ({ time, walls: walls([101], [89]) }));
  const backfilled = backfillRailPrefix(observed, modeled, 0);
  const trimmed = trimHistoryToSession(backfilled, 0);
  assert.deepEqual(trimmed.map((s) => s.time), [0, 300, 50100, 50400]);
});

test("trimHistoryToSession: no-op when firstBarTime is undefined/non-finite or history is empty", () => {
  const history = [{ time: 100, walls: walls([100], [90]) }];
  assert.equal(trimHistoryToSession(history, undefined), history);
  assert.equal(trimHistoryToSession(history, Number.NaN), history);
  assert.deepEqual(trimHistoryToSession([], 100), []);
});

test("trimHistoryToSession: no-op when every sample already belongs to the session", () => {
  const history = [100, 200, 300].map((time) => ({ time, walls: walls([100], [90]) }));
  assert.equal(trimHistoryToSession(history, 0), history);
});

test("trailsByStrike: a strike earns beads ONLY in buckets where it is a DOMINANT wall (birth ≠ session open)", () => {
  // The recorder stores a wide ladder (up to 20/side). 6900 sits at the BOTTOM of that ladder for
  // the first two buckets (rank 8 → below the top-6 dominant cut), then becomes the #1 wall. Its
  // trail must START when it became dominant (220), not at the open just because it was a minor
  // ladder member since 100 — the "SPX had the same walls all day" fix.
  const wide = (strikes: number[]): GexWalls => ({
    callWalls: strikes.map((strike, i) => ({ strike, pct: 10 - i })),
    putWalls: [],
  });
  const early = wide([7000, 6990, 6980, 6970, 6960, 6950, 6940, 6900]); // 6900 is rank 8 (excluded)
  const late = wide([6900, 7000, 6990, 6970, 6960, 6950]); // 6900 now rank 1 (dominant)
  const history: WallHistorySample[] = [
    { time: 100, walls: early },
    { time: 160, walls: early },
    { time: 220, walls: late },
  ];
  const trails = trailsByStrike(history, "callWalls");
  // Born at 220 (became dominant), NOT 100 — the whole point of the fix.
  assert.deepEqual(trails.get(6900)?.map((p) => p.time), [220]);
  // A genuinely persistent top wall still runs full-width (correct — it WAS a wall all session).
  assert.deepEqual(trails.get(7000)?.map((p) => p.time), [100, 160, 220]);
  // 6940 was only ever rank 7 (below the cut) then dropped out → no trail at all.
  assert.equal(trails.has(6940), false);
  // Lifecycle carries the honest birth through.
  const life = new Map(strikeTrailLifecycle(history, "callWalls").map((t) => [t.strike, t]));
  assert.equal(life.get(6900)?.bornAt, 220);
});

test("strikeTrailLifecycle: a late-appearing strike is birth-anchored, a departed one stops", () => {
  // 6800 is a wall in the first two buckets then drops out; 6810 only appears in the last two.
  const history: WallHistorySample[] = [
    { time: 100, walls: walls([6800], []) },
    { time: 160, walls: walls([6800], []) },
    { time: 220, walls: walls([6810], []) },
    { time: 280, walls: walls([6810], []) },
  ];
  const life = strikeTrailLifecycle(history, "callWalls");
  const byStrike = new Map(life.map((t) => [t.strike, t]));

  const late = byStrike.get(6810)!;
  // Birth-anchored: markers begin at first appearance (220), NOT back-filled to the open (100).
  assert.deepEqual(late.points.map((p) => p.time), [220, 280]);
  assert.equal(late.bornAt, 220);
  assert.equal(late.active, true); // still in the latest bucket → currently forming/holding

  const departed = byStrike.get(6800)!;
  // A wall that left the set stops at its last bucket (160) and is flagged inactive → the marker
  // layer fades it instead of persisting a full-width rail.
  assert.deepEqual(departed.points.map((p) => p.time), [100, 160]);
  assert.equal(departed.lastSeen, 160);
  assert.equal(departed.active, false);
});

test("strikeTrailLifecycle: active is per-side — a put present at the latest bucket stays active", () => {
  const history: WallHistorySample[] = [
    { time: 100, walls: walls([6800], [6700]) },
    { time: 160, walls: walls([6810], [6700]) }, // call migrated, put 6700 held through latest bucket
  ];
  const puts = new Map(strikeTrailLifecycle(history, "putWalls").map((t) => [t.strike, t]));
  assert.equal(puts.get(6700)!.active, true);
  assert.equal(puts.get(6700)!.bornAt, 100);
});

test("pickActiveStrikes: keeps the heaviest rows when capped", () => {
  const trails = new Map([
    [6800, [{ time: 100, pct: 3 }, { time: 160, pct: 3 }]],
    [6810, [{ time: 100, pct: 9 }]],
    [6820, [{ time: 100, pct: 2 }]],
  ]);
  assert.deepEqual(pickActiveStrikes(trails, 2), [6810, 6800]);
  // Peak-biased weight = max*0.6 + mean*0.4 → 3*0.6 + 3*0.4 = 3 (not the Σ=6 of the old scheme).
  assert.equal(strikeTrailWeight(trails.get(6800)!), 3);
});

test("pickActiveStrikes: a recently-strong wall outranks a persistent-but-weak one (peak-biased)", () => {
  const trails = new Map([
    // Weak wall present ALL session (10 samples @ 3%): old Σpct = 30.
    [6800, Array.from({ length: 10 }, (_, i) => ({ time: 100 + i, pct: 3 }))],
    // Strong wall that just appeared (2 samples @ 8%): old Σpct = 16 → would be DROPPED.
    [6810, [{ time: 200, pct: 8 }, { time: 201, pct: 8 }]],
  ]);
  // Old cumulative ranking hid the 8% wall (the exact live bug: strongest wall, no beads).
  // Peak-bias: 6810 weight 8 > 6800 weight 3 → the strong wall wins the single slot.
  assert.deepEqual(pickActiveStrikes(trails, 1), [6810]);
});

test("time-honest rail: a sparse recorded history is passed through untouched, never densified", () => {
  // Product decision 2026-07-11: the rail shows ONLY point-in-time recorded samples.
  // The page previously back-filled a dense full-session rail from the closing chain when
  // the recorded history was sparse (< 8 samples) — a flat, full-width reconstruction that
  // read as "walls everywhere all session". Time-honest means: whatever the recorder captured
  // is exactly what renders. Composing the two building blocks the page uses (mergeWallHistory
  // of recorded rows, then seedWallHistoryForDisplay) must NOT add rows to a non-empty history.
  const recorded: WallHistorySample[] = [
    { time: 100, walls: walls([6800], [6700]) },
    { time: 160, walls: walls([6810], [6700]) },
  ];
  const base = mergeWallHistory(recorded, []);
  const rail = seedWallHistoryForDisplay(base, [100, 160, 220], walls([6810], [6700]), 6750);
  // Exactly the two recorded samples — no reconstruction padding out to a full-width rail.
  assert.equal(rail.length, 2);
  assert.deepEqual(rail.map((s) => s.time), [100, 160]);
});

test("time-honest rail: an empty history yields exactly one as-of-close snapshot, not a fabricated day", () => {
  const rail = seedWallHistoryForDisplay([], [100, 160, 220], walls([6800], [6700]), 6750);
  assert.equal(rail.length, 1);
  assert.equal(rail[0].time, 220); // the last visible candle — session close, right edge
});

test("mergeWallHistory: unions by bar time so Redis + replica tails combine", () => {
  const local = [{ time: 100, walls: walls([6800], [6700]) }];
  const remote = [
    { time: 100, walls: walls([6805], [6700]) },
    { time: 160, walls: walls([6810], [6700]) },
  ];
  const merged = mergeWallHistory(local, remote);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].walls.callWalls[0].strike, 6805);
  assert.equal(merged[1].time, 160);
});

test("mergeWallHistory: keeps local-only bars when remote is shorter", () => {
  const local = [
    { time: 100, walls: walls([6800], [6700]) },
    { time: 160, walls: walls([6810], [6700]) },
    { time: 220, walls: walls([6820], [6700]) },
  ];
  const remote = [{ time: 100, walls: walls([6800], [6700]) }];
  assert.equal(mergeWallHistory(local, remote).length, 3);
});

test("mergeModeledUnderlay: an observed sample overwrites the modeled one at a shared bucket", () => {
  const observed: WallHistorySample[] = [{ time: 100, walls: walls([6800], [6700]) }];
  const modeled: WallHistorySample[] = [{ time: 100, walls: walls([6805], [6700]) }];
  const merged = mergeModeledUnderlay(observed, modeled);
  assert.equal(merged.length, 1);
  // Observed wins the bucket: its strike survives and it's tagged modeled:false.
  assert.equal(merged[0].walls.callWalls[0].strike, 6800);
  assert.equal(merged[0].modeled, false);
});

test("mergeModeledUnderlay: modeled fills gap buckets the recorder never observed", () => {
  const observed: WallHistorySample[] = [{ time: 100, walls: walls([6800], [6700]) }];
  const modeled: WallHistorySample[] = [
    { time: 100, walls: walls([6805], [6700]) },
    { time: 160, walls: walls([6810], [6700]) },
    { time: 220, walls: walls([6820], [6700]) },
  ];
  const merged = mergeModeledUnderlay(observed, modeled);
  assert.deepEqual(merged.map((s) => [s.time, s.modeled]), [
    [100, false], // observed
    [160, true], // modeled gap-fill
    [220, true], // modeled gap-fill
  ]);
});

test("mergeModeledUnderlay: empty observed → an all-modeled trail", () => {
  const modeled: WallHistorySample[] = [
    { time: 100, walls: walls([6800], [6700]) },
    { time: 160, walls: walls([6810], [6700]) },
  ];
  const merged = mergeModeledUnderlay([], modeled);
  assert.equal(merged.length, 2);
  assert.ok(merged.every((s) => s.modeled === true));
});

test("mergeModeledUnderlay: empty modeled → all observed, tagged modeled:false", () => {
  const observed: WallHistorySample[] = [
    { time: 100, walls: walls([6800], [6700]) },
    { time: 160, walls: walls([6810], [6700]) },
  ];
  const merged = mergeModeledUnderlay(observed, []);
  assert.equal(merged.length, 2);
  assert.ok(merged.every((s) => s.modeled === false));
});

test("mergeModeledUnderlay: result is sorted by time regardless of input ordering", () => {
  const observed: WallHistorySample[] = [{ time: 220, walls: walls([6820], [6700]) }];
  const modeled: WallHistorySample[] = [
    { time: 160, walls: walls([6810], [6700]) },
    { time: 100, walls: walls([6800], [6700]) },
  ];
  const merged = mergeModeledUnderlay(observed, modeled);
  assert.deepEqual(merged.map((s) => s.time), [100, 160, 220]);
});

test("mergeModeledUnderlay: over the cap it thins the old end, keeping full span", () => {
  // Rewritten 2026-08-07 alongside recordWallSample — same cap, same reason. Was:
  // `length === 5760` and `merged[0].time === (6000-5760)*5`, i.e. the oldest 240 dropped.
  const modeled: WallHistorySample[] = Array.from({ length: 6000 }, (_, i) => ({
    time: i * 5,
    walls: walls([6800], [6700]),
  }));
  const merged = mergeModeledUnderlay([], modeled);
  assert.ok(merged.length <= 5760, `cap must hold, got ${merged.length}`);
  assert.equal(merged[0].time, 0, "full span preserved — the old end is thinned, not cut");
  assert.equal(merged[merged.length - 1].time, 5999 * 5);
});

test("trailsByStrike: threads the sample's modeled flag onto each emitted trail point", () => {
  const history: WallHistorySample[] = [
    { time: 100, walls: walls([6800], []), modeled: true },
    { time: 160, walls: walls([6800], []) }, // observed (modeled absent)
  ];
  const trail = trailsByStrike(history, "callWalls").get(6800)!;
  assert.deepEqual(
    trail.map((p) => [p.time, p.modeled]),
    [
      [100, true],
      [160, undefined],
    ]
  );
});

test("trailForGammaFlip: horizontal bead row when flip is present", () => {
  const history: WallHistorySample[] = [
    { time: 100, walls: walls([6800], [6700]), gammaFlip: 6745 },
    { time: 160, walls: walls([6810], [6700]), gammaFlip: 6750 },
    { time: 220, walls: walls([6810], [6700]), gammaFlip: null },
  ];
  assert.deepEqual(trailForGammaFlip(history), [
    { time: 100, strike: 6745 },
    { time: 160, strike: 6750 },
  ]);
});

test("trailForFlipLevel: vanna flip trail from vexFlip field", () => {
  const history: WallHistorySample[] = [
    {
      time: 100,
      walls: walls([6800], [6700]),
      vexWalls: walls([6820], [6680]),
      vexFlip: 6760,
    },
  ];
  assert.deepEqual(trailForFlipLevel(history, "vex"), [{ time: 100, strike: 6760 }]);
});

test("hasVexInHistory: true when vex walls present", () => {
  assert.equal(
    hasVexInHistory([{ time: 1, walls: walls([6800], []), vexWalls: walls([6820], []) }]),
    true
  );
});

test("trailsByStrike: vex lens reads vexWalls rows", () => {
  const history: WallHistorySample[] = [
    {
      time: 100,
      walls: walls([6800], []),
      vexWalls: walls([6820], []),
    },
    {
      time: 160,
      walls: walls([6810], []),
      vexWalls: walls([6820], []),
    },
  ];
  const vexTrails = trailsByStrike(history, "callWalls", "vex");
  assert.equal(vexTrails.size, 1);
  assert.deepEqual(vexTrails.get(6820)?.map((p) => p.time), [100, 160]);
});

test("trimHistoryForLiveTrails: drops samples older than the lookback window", () => {
  const anchor = 10_000;
  const history: WallHistorySample[] = [
    { time: anchor - LIVE_TRAIL_LOOKBACK_SEC - 60, walls: walls([6700], []) },
    { time: anchor - 120, walls: walls([6800], []) },
    { time: anchor, walls: walls([6810], []) },
  ];
  const trimmed = trimHistoryForLiveTrails(history, LIVE_TRAIL_LOOKBACK_SEC, anchor);
  assert.deepEqual(trimmed.map((s) => s.time), [anchor - 120, anchor]);
});

test("liveTrailAnchorSec: uses the later of wall history tail and last bar", () => {
  assert.equal(liveTrailAnchorSec([{ time: 500, walls: walls([6800], []) }], [100, 700]), 700);
});

test("bucketWallHistoryForInterval: 1m collapses 15s samples to one bead per minute", () => {
  const history: WallHistorySample[] = [
    { time: 100, walls: walls([6800], [6700]) },
    { time: 115, walls: walls([6805], [6700]) },
    { time: 130, walls: walls([6810], [6700]) },
    { time: 160, walls: walls([6815], [6705]) },
  ];
  const out = bucketWallHistoryForInterval(history, 1);
  assert.deepEqual(out.map((s) => s.time), [60, 120]);
  assert.equal(out[0]!.walls.callWalls[0]!.strike, 6805);
  assert.equal(out[1]!.walls.callWalls[0]!.strike, 6815);
});

test("bucketWallHistoryForInterval: liveBeads keeps 5s density on 1m chart", () => {
  const history: WallHistorySample[] = [
    { time: 100, walls: walls([6800], [6700]) },
    { time: 105, walls: walls([6805], [6700]) },
    { time: 110, walls: walls([6810], [6700]) },
    { time: 115, walls: walls([6815], [6705]) },
  ];
  const out = bucketWallHistoryForInterval(history, 1, { minBucketSec: 5, liveBeads: true });
  assert.deepEqual(out.map((s) => s.time), [100, 105, 110, 115]);
});

test("bucketWallHistoryForInterval: 5m aligns to five-minute candle buckets", () => {
  const base = 300 * 60;
  const history: WallHistorySample[] = [
    { time: base + 15, walls: walls([6800], []) },
    { time: base + 120, walls: walls([6810], []) },
    { time: base + 300, walls: walls([6820], []) },
    { time: base + 420, walls: walls([6830], []) },
  ];
  const out = bucketWallHistoryForInterval(history, 5);
  assert.deepEqual(out.map((s) => s.time), [base, base + 300]);
  assert.equal(out[0]!.walls.callWalls[0]!.strike, 6810);
  assert.equal(out[1]!.walls.callWalls[0]!.strike, 6830);
});

test("narrowedHorizonTrail: narrowed GEX horizon → single scoped column; all/vex/empty → blended fallback", () => {
  const scoped = { callWalls: [{ strike: 105, pct: 40 }], putWalls: [{ strike: 95, pct: 30 }] };
  // Narrowed GEX horizon with scoped walls → one point-in-time sample at the last bar.
  const t = narrowedHorizonTrail("0dte", "gex", scoped, 1_700_000_000, 100.5);
  assert.ok(t && t.length === 1, "narrowed → single-sample trail");
  assert.equal(t![0]!.time, 1_700_000_000);
  assert.equal(t![0]!.walls, scoped);
  assert.equal(t![0]!.gammaFlip, 100.5);
  // "all" horizon → null (caller uses the blended recorded rail).
  assert.equal(narrowedHorizonTrail("all", "gex", scoped, 1_700_000_000, 100.5), null);
  // VEX lens has no horizon scope → null.
  assert.equal(narrowedHorizonTrail("weekly", "vex", scoped, 1_700_000_000, 100.5), null);
  // Empty scoped walls → null (never blank the rail on a toggle; fall back to blended).
  assert.equal(narrowedHorizonTrail("weekly", "gex", { callWalls: [], putWalls: [] }, 1_700_000_000, 100.5), null);
  assert.equal(narrowedHorizonTrail("weekly", "gex", null, 1_700_000_000, 100.5), null);
  // No last-bar time → null.
  assert.equal(narrowedHorizonTrail("weekly", "gex", scoped, 0, 100.5), null);
});

test("pickReplayTrailSource: narrowed GEX horizon replays the recorded trail; else the blended rail", () => {
  const w = walls([105], [95]);
  const recorded: WallHistorySample[] = [
    { time: 1_700_000_000, walls: w, gammaFlip: 100 },
    { time: 1_700_000_900, walls: w, gammaFlip: 100 },
  ];
  const blended: WallHistorySample[] = [{ time: 1_700_000_500, walls: w, gammaFlip: 99 }];

  // Narrowed GEX horizon with a recorded trail → replay THAT trail (not the blended "All" rail).
  assert.equal(pickReplayTrailSource("weekly", "gex", recorded, blended), recorded);
  assert.equal(pickReplayTrailSource("0dte", "gex", recorded, blended), recorded);

  // "all" → always the blended rail (no per-horizon recording for "all").
  assert.equal(pickReplayTrailSource("all", "gex", recorded, blended), blended);
  // VEX lens → blended (per-horizon rails are GEX-only).
  assert.equal(pickReplayTrailSource("weekly", "vex", recorded, blended), blended);
  // Narrowed horizon but nothing recorded yet → blended fallback (replay never blanks).
  assert.equal(pickReplayTrailSource("weekly", "gex", [], blended), blended);
  assert.equal(pickReplayTrailSource("monthly", "gex", null, blended), blended);
});

test("composeHorizonTrail: recorded per-horizon trail preferred, current column unioned in", () => {
  const w = walls([105], [95]);
  const recorded: WallHistorySample[] = [
    { time: 1_700_000_000, walls: w, gammaFlip: 100 },
    { time: 1_700_000_900, walls: w, gammaFlip: 100 },
  ];
  const current: WallHistorySample[] = [{ time: 1_700_001_800, walls: w, gammaFlip: 101 }];

  // Recorded + current → the frozen clusters plus the newest live column, unioned by time.
  const both = composeHorizonTrail(recorded, current);
  assert.ok(both && both.length === 3, "recorded (2) + fresher current column (1) → 3 buckets");
  assert.equal(both![both!.length - 1]!.time, 1_700_001_800, "newest bucket is the current column");

  // Current column at a time the recorder already wrote → overwrites, never duplicates.
  const overlap: WallHistorySample[] = [{ time: 1_700_000_900, walls: w, gammaFlip: 102 }];
  const merged = composeHorizonTrail(recorded, overlap);
  assert.equal(merged!.length, 2, "same-bucket current column overwrites, not appends");
  assert.equal(merged![1]!.gammaFlip, 102, "current column wins its bucket");

  // No recorded trail → fall back to the single current column (pre-recording behaviour).
  assert.deepEqual(composeHorizonTrail([], current), current);
  assert.deepEqual(composeHorizonTrail(null, current), current);

  // Recorded only (e.g. after close, no live column) → the frozen recorded trail as-is.
  assert.equal(composeHorizonTrail(recorded, null), recorded);
  assert.equal(composeHorizonTrail(recorded, []), recorded);

  // Neither → null so the caller draws the blended "All" rail (beads never blank on a toggle).
  assert.equal(composeHorizonTrail([], []), null);
  assert.equal(composeHorizonTrail(null, null), null);
});

// ---------------------------------------------------------------------------------------------
// SSR seed decimation (FINDINGS 2026-08-07): /vector shipped a 22.8MB HTML document, 22.6MB of it
// wall history at the recorder's 5s cadence. These pin the invariants the fix must never break.
// ---------------------------------------------------------------------------------------------

const seedSample = (time: number, strike: number): WallHistorySample => ({
  time,
  walls: { callWalls: [{ strike, pct: 1 }], putWalls: [] },
});

/** A full session at the oracle 5s cadence, exactly the shape prod serves. */
function session5s(count: number, startAt = 1_000_000): WallHistorySample[] {
  return Array.from({ length: count }, (_, i) => seedSample(startAt + i * 5, 7000 + i));
}

test("decimateSeedHistory: the newest full-resolution window is returned sample-for-sample", () => {
  const history = session5s(1200); // 100 minutes at 5s
  const out = decimateSeedHistory(history, { fullResolutionSec: 30 * 60, tailBucketSec: 15 });
  const newest = history[history.length - 1]!.time;
  const live = history.filter((s) => s.time >= newest - 30 * 60);
  const outLive = out.filter((s) => s.time >= newest - 30 * 60);
  assert.deepEqual(outLive, live, "the live window must not be touched at all");
});

test("decimateSeedHistory: the old tail collapses to one sample per bucket, keeping the LAST reading", () => {
  const history = session5s(1200);
  const out = decimateSeedHistory(history, { fullResolutionSec: 30 * 60, tailBucketSec: 15 });
  const newest = history[history.length - 1]!.time;
  const tail = out.filter((s) => s.time < newest - 30 * 60);
  const buckets = new Set(tail.map((s) => Math.floor(s.time / 15) * 15));
  assert.equal(tail.length, buckets.size, "one sample per 15s bucket in the tail");
  // "Last wins" mirrors bucketWallHistoryForInterval, so the bead a bucket shows is its freshest
  // reading — not a stale one from the top of the bucket.
  const byBucket = new Map<number, WallHistorySample>();
  for (const s of history) {
    if (s.time >= newest - 30 * 60) continue;
    byBucket.set(Math.floor(s.time / 15) * 15, s);
  }
  for (const s of tail.slice(1)) {
    assert.deepEqual(s, byBucket.get(Math.floor(s.time / 15) * 15), "bucket must keep its last reading");
  }
});

test("decimateSeedHistory: the first sample always survives (session-open bead / modeled prefix boundary)", () => {
  const history = session5s(1200);
  const out = decimateSeedHistory(history, { fullResolutionSec: 60, tailBucketSec: 600 });
  assert.deepEqual(out[0], history[0], "backfillRailPrefix's prefix boundary must never be decimated away");
});

test("decimateSeedHistory: output is an ordered SUBSET — real samples, original times, never re-keyed", () => {
  const history = session5s(1200);
  const out = decimateSeedHistory(history, { fullResolutionSec: 30 * 60, tailBucketSec: 15 });
  const times = new Set(history.map((s) => s.time));
  for (const s of out) assert.ok(times.has(s.time), `synthesised time ${s.time} — seeds must stay real samples`);
  for (let i = 1; i < out.length; i++) assert.ok(out[i]!.time > out[i - 1]!.time, "strictly increasing");
  assert.ok(out.length < history.length, "a full session at 5s must actually shrink");
});

test("decimateSeedHistory: a real session's payload shrinks ~3x, which is the point", () => {
  // 8.4h at 5s = the live SPX shape measured in prod (5,760 samples, 14.76MB).
  const history = session5s(5760);
  const out = decimateSeedHistory(history);
  // 30 min live at 5s (360) + ~7.9h tail at 15s (~1,896).
  assert.ok(out.length < history.length / 2.5, `expected >2.5x reduction, got ${history.length} -> ${out.length}`);
  assert.ok(out.length > 2000, `over-decimated: ${out.length}`);
});

test("decimateSeedHistory: short or degenerate inputs pass through untouched", () => {
  assert.deepEqual(decimateSeedHistory([]), []);
  const one = [seedSample(1, 7000)];
  assert.deepEqual(decimateSeedHistory(one), one);
  const h = session5s(100);
  assert.deepEqual(decimateSeedHistory(h, { tailBucketSec: 0 }), h, "a zero bucket must not divide by zero");
});

// ---------------------------------------------------------------------------------------------
// FULL-DAY RAIL (FINDINGS 2026-08-07). The bead recorder is viewer-driven for tickers outside the
// shared universe, so the rail has holes wherever nobody had the chart open. Reproduced from the
// REAL AMD 2026-08-06 shape: samples 09:30–16:00, a 30-minute hole at 14:45–15:15, and nothing
// from 16:00 to the 19:59 last bar.
// ---------------------------------------------------------------------------------------------

const H = (h: number, m = 0) => h * 3600 + m * 60;
const sample = (time: number, strike = 500): WallHistorySample => ({
  time,
  walls: { callWalls: [{ strike, pct: 1 }], putWalls: [] },
});

/** Observed rail with AMD's real holes; bars run 04:00 → 19:59. */
function amdShapedRail(): WallHistorySample[] {
  const out: WallHistorySample[] = [];
  for (let t = H(9, 30); t <= H(16); t += 60) {
    if (t > H(14, 45) && t < H(15, 15)) continue; // the real 30-minute viewing hole
    out.push(sample(t));
  }
  return out;
}

test("railCoverageGaps: finds the leading, mid-session AND trailing holes", () => {
  const gaps = railCoverageGaps(amdShapedRail(), H(4), H(19, 59));
  const mins = gaps.map((g) => [Math.round(g.from / 60), Math.round(g.to / 60)]);
  assert.equal(gaps.length, 3, `expected 3 gaps, got ${JSON.stringify(mins)}`);
  assert.deepEqual(mins[0], [H(4) / 60, H(9, 30) / 60], "pre-open prefix");
  assert.deepEqual(mins[1], [H(14, 45) / 60, H(15, 15) / 60], "the 30-minute viewing hole");
  assert.deepEqual(mins[2], [H(16) / 60, H(19, 59) / 60], "the post-close block — the one members saw");
});

test("railCoverageGaps: a rail covering the session end-to-end has no gaps", () => {
  const dense: WallHistorySample[] = [];
  for (let t = H(4); t <= H(19, 59); t += 60) dense.push(sample(t));
  assert.deepEqual(railCoverageGaps(dense, H(4), H(19, 59)), []);
});

test("railCoverageGaps: cadence slack — a sample just before a bucket still covers it", () => {
  // The recorder writes on a tick, so a 4-minute spacing is coverage, not a hole.
  const rail = [sample(H(10)), sample(H(10, 4)), sample(H(10, 8))];
  assert.deepEqual(railCoverageGaps(rail, H(10), H(10, 8)), []);
  assert.equal(railCoverageGaps(rail, H(10), H(10, 30)).length, 1, "but a 22-minute tail is");
});

test("backfillRailGaps: fills every hole, and NEVER displaces an observed sample", () => {
  const observed = amdShapedRail();
  const modeled: WallHistorySample[] = [];
  for (let t = H(4); t <= H(19, 59); t += 600) modeled.push(sample(t, 495));
  const merged = backfillRailGaps(observed, modeled, H(4), H(19, 59));

  const byTime = new Map(merged.map((s) => [s.time, s]));
  for (const o of observed) {
    assert.equal(byTime.get(o.time)?.modeled, false, `observed ${o.time} must stay solid`);
  }
  // The post-close block is now covered.
  assert.ok(
    merged.some((s) => s.time > H(16) && s.time < H(19, 59) && s.modeled),
    "the 16:00→19:59 block must carry ghost beads"
  );
  // As must the mid-session hole.
  assert.ok(
    merged.some((s) => s.time > H(14, 45) && s.time < H(15, 15) && s.modeled),
    "the 14:45→15:15 hole must carry ghost beads"
  );
  assert.ok(merged.every((s, i) => i === 0 || s.time > merged[i - 1]!.time), "strictly ordered");
});

test("backfillRailGaps: no modeled sample lands where the rail already has coverage", () => {
  const observed = amdShapedRail();
  const modeled: WallHistorySample[] = [];
  for (let t = H(4); t <= H(19, 59); t += 600) modeled.push(sample(t, 495));
  const merged = backfillRailGaps(observed, modeled, H(4), H(19, 59));
  const gaps = railCoverageGaps(observed, H(4), H(19, 59));
  for (const s of merged.filter((m) => m.modeled)) {
    assert.ok(
      gaps.some((g) => s.time >= g.from && s.time <= g.to),
      `modeled bead at ${s.time} sits inside covered territory`
    );
  }
});

test("backfillRailGaps: degrades to the observed rail rather than inventing structure", () => {
  const observed = amdShapedRail();
  assert.equal(backfillRailGaps(observed, [], H(4), H(19, 59)), observed, "no model → untouched");
  assert.equal(
    backfillRailGaps(observed, [sample(H(12))], undefined, undefined),
    observed,
    "no bar range → untouched (cannot know what a gap even is)"
  );
});

test("railUncoveredSec: sums the holes — this is what decides whether to reconstruct", () => {
  const uncovered = railUncoveredSec(amdShapedRail(), H(4), H(19, 59));
  // 5h30m pre-open + 30m mid + 3h59m post-close.
  assert.equal(uncovered, H(5, 30) + H(0, 30) + H(3, 59));
  assert.ok(uncovered > 20 * 60, "well past the reconstruct threshold");
});

// ---------------------------------------------------------------------------------------------
// FINDINGS 2026-08-07 — SPX's whole RTH session was evicted overnight. MAX_HISTORY was a flat
// count cap applied as slice(-N); at the oracle 5s cadence that is 8 hours of wall clock, so
// post-close recording deleted the trading day. Measured live: rail 15:54..23:59 against bars
// 09:30..16:05, 97% of the session gone.
// ---------------------------------------------------------------------------------------------

/** SPX's real shape: 5s samples from 09:30 to 23:59 — 1.8x the 5,760 budget. */
function spxShapedRail(): WallHistorySample[] {
  const out: WallHistorySample[] = [];
  for (let t = H(9, 30); t <= H(23, 59); t += 5) out.push(sample(t));
  return out;
}

test("compactHistoryToCap: keeps the SESSION instead of the last 8 hours", () => {
  const rail = spxShapedRail();
  assert.ok(rail.length > 5760, `precondition: ${rail.length} samples must exceed the budget`);

  const oldBehaviour = rail.slice(rail.length - 5760);
  assert.ok(
    oldBehaviour[0]!.time > H(15, 30),
    "the old slice(-N) really did start mid-afternoon — this is the bug being fixed"
  );

  const out = compactHistoryToCap(rail, 5760);
  assert.ok(out.length <= 5760, `must respect the cap, got ${out.length}`);
  assert.equal(out[0]!.time, H(9, 30), "the session open must survive");
  assert.equal(out[out.length - 1]!.time, H(23, 59), "so must the newest sample");
});

test("compactHistoryToCap: the newest 30 minutes stay at full recorder resolution", () => {
  const rail = spxShapedRail();
  const out = compactHistoryToCap(rail, 5760);
  const newest = rail[rail.length - 1]!.time;
  const live = rail.filter((s) => s.time >= newest - 30 * 60);
  assert.deepEqual(
    out.filter((s) => s.time >= newest - 30 * 60),
    live,
    "what is happening right now must not be thinned"
  );
});

test("compactHistoryToCap: the old end is thinned, not amputated", () => {
  const rail = spxShapedRail();
  const out = compactHistoryToCap(rail, 5760);
  // Every hour of the session keeps representation — that is the whole point.
  for (let h = 10; h <= 23; h++) {
    assert.ok(
      out.some((s) => s.time >= H(h) && s.time < H(h + 1)),
      `hour ${h}:00 lost all coverage`
    );
  }
});

test("compactHistoryToCap: under the cap is a no-op — normal operation is untouched", () => {
  const small: WallHistorySample[] = [];
  for (let t = H(9, 30); t <= H(10, 30); t += 5) small.push(sample(t));
  assert.ok(small.length < 5760);
  assert.equal(compactHistoryToCap(small, 5760), small, "same reference — nothing copied or changed");
});

test("compactHistoryToCap: the cap remains an absolute bound", () => {
  // A pathological burst that even a thinned tail cannot fit still gets clamped.
  const dense: WallHistorySample[] = [];
  for (let t = 0; t < 4000; t += 1) dense.push(sample(t)); // 1s cadence, all inside the live window
  const out = compactHistoryToCap(dense, 500);
  assert.ok(out.length <= 500, `cap must hold even when compaction cannot help, got ${out.length}`);
  assert.equal(out[out.length - 1]!.time, dense[dense.length - 1]!.time, "newest always survives");
});

test("compactHistoryToCap: strictly better than the old behaviour — never loses MORE coverage", () => {
  const rail = spxShapedRail();
  const out = compactHistoryToCap(rail, 5760);
  const old = rail.slice(rail.length - 5760);
  assert.ok(
    out[0]!.time < old[0]!.time,
    "the compacted rail must reach further back than the amputated one"
  );
  const span = (a: WallHistorySample[]) => a[a.length - 1]!.time - a[0]!.time;
  // SPX's real numbers: the compacted rail spans the full 14.5h session, the amputated one only
  // the 8h the cap allows at 5s. That is the entire bug, expressed as a ratio.
  assert.ok(
    span(out) > span(old) * 1.5,
    `compacted span ${(span(out) / 3600).toFixed(2)}h vs amputated ${(span(old) / 3600).toFixed(2)}h`
  );
});

// ── DOMINANT_WALLS_PER_BUCKET: 3 -> 5 (2026-08-07 product call) ──────────────────────────────

/** A bucket whose call ladder has 8 strikes at strictly descending |pct|, so rank is unambiguous. */
function ladderSample(time: number) {
  return {
    time,
    walls: {
      callWalls: [8, 7, 6, 5, 4, 3, 2, 1].map((p, i) => ({ strike: 100 + i * 5, pct: p })),
      putWalls: [],
    },
  } as never;
}

test("DOMINANT_WALLS_PER_BUCKET is 5 — widened coverage, measured trade recorded in the docblock", () => {
  // Not a tautology-with-extra-steps: this constant has moved twice (6 -> 3 on member feedback,
  // 3 -> 5 on the 2026-08-07 measurement). Pinning it means the next change is deliberate and
  // arrives with its own evidence rather than drifting.
  assert.equal(DOMINANT_WALLS_PER_BUCKET, 5);
});

test("trailsByStrike keeps exactly the top-N by |pct| — the selection the whole rail depends on", () => {
  const history = [ladderSample(1000), ladderSample(1005)];
  const rows = trailsByStrike(history, "callWalls", "gex", 5);
  // Strongest 5 are pct 8..4 -> strikes 100,105,110,115,120.
  assert.deepEqual([...rows.keys()].sort((a, b) => a - b), [100, 105, 110, 115, 120]);
  // The weaker three earn NO bead at all — that is what keeps the rail sparse.
  for (const absent of [125, 130, 135]) assert.equal(rows.has(absent), false, `${absent} must not draw`);
});

test("raising N is strictly additive — it can never REMOVE a row that N=3 drew", () => {
  // The property that makes this change safe to revert in either direction: every strike visible at
  // 3 is still visible at 5, so nobody loses a level they were watching. Only the tail grows.
  const history = [ladderSample(1000), ladderSample(1005), ladderSample(1010)];
  const at3 = new Set(trailsByStrike(history, "callWalls", "gex", 3).keys());
  const at5 = new Set(trailsByStrike(history, "callWalls", "gex", 5).keys());
  for (const strike of at3) assert.ok(at5.has(strike), `strike ${strike} vanished when N rose`);
  assert.equal(at3.size, 3);
  assert.equal(at5.size, 5);
});
