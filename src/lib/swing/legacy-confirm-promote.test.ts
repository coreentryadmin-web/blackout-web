import { test } from "node:test";
import assert from "node:assert/strict";
import type { PlaybookPlay } from "@/features/nighthawk/lib/types";
import {
  LEGACY_SWING_SIGNAL_KIND,
  buildLegacySwingArtifacts,
  carryLegacyPromotedIntoSnapshot,
  legacyPlayDirection,
  mergeLegacyPromotedSnapshot,
} from "./legacy-confirm-promote.ts";
import { discoverSwingFromPersisted, persistSwingServingSnapshot } from "./serving-lane.ts";
import type { ChainStrikeRow } from "@/features/nighthawk/lib/option-chain-prompt";
import { swingThesisKey } from "./accumulation-store.ts";

const chainRows: ChainStrikeRow[] = [
  {
    expiry: "2026-08-14",
    strike: 100,
    call_bid: 1.2,
    call_ask: 1.3,
    call_delta: 0.55,
    call_oi: 3000,
    call_iv: 0.35,
    put_bid: 0.8,
    put_ask: 0.9,
    put_delta: -0.45,
    put_oi: 2500,
    put_iv: 0.38,
  },
];

function legacyPlay(over: Partial<PlaybookPlay> = {}): PlaybookPlay {
  return {
    rank: 1,
    ticker: "NVDA",
    direction: "LONG",
    conviction: "HIGH",
    play_type: "stock",
    thesis: "Flow accumulation",
    key_signal: "Multi-day call flow",
    entry_range: "$98.00-$100.00",
    target: "110",
    stop: "95",
    options_play: "Aug 14 100C",
    score: 78,
    flow_streak_days: 3,
    ...over,
  };
}

test("legacyPlayDirection normalizes short variants", () => {
  assert.equal(legacyPlayDirection(legacyPlay({ direction: "SHORT" })), "SHORT");
  assert.equal(legacyPlayDirection(legacyPlay({ direction: "short" })), "SHORT");
  assert.equal(legacyPlayDirection(legacyPlay({ direction: "LONG" })), "LONG");
});

test("buildLegacySwingArtifacts stamps NIGHT HAWK provenance and serve-only graduation", () => {
  const artifact = buildLegacySwingArtifacts({
    play: legacyPlay(),
    checkedAt: "2026-08-04T13:20:00.000Z",
    editionFor: "2026-08-04",
    spot: 99.5,
    chainRows,
    chainSpot: 99.5,
  });
  assert.ok(artifact);
  assert.equal(artifact!.play.horizon, "SWING");
  assert.equal(artifact!.play.bucketGraduated, false);
  assert.deepEqual(artifact!.play.signalKinds, [LEGACY_SWING_SIGNAL_KIND]);
  assert.deepEqual(artifact!.watch.signalKinds, [LEGACY_SWING_SIGNAL_KIND]);
  assert.equal(artifact!.watch.distinctSessionDays, 2);
  assert.equal(artifact!.dossier.feature_vector?.accumulation?.net_signed_premium ?? 0, 0);
});

// ─── ATR-grounded plan levels (FINDINGS 2026-08-06 P2 follow-up, fix) ──────────────────────────────

test("buildLegacySwingArtifacts: with nameCloses, plan levels are ATR-grounded (deriveSwingPlanLevels), NOT Legacy's overnight stop/target", () => {
  // 20 closes trending up ~$1/day around spot 99.5 → atrProxyFromCloses ≈ 1.0, giving a materially
  // different stop/target than Legacy's own overnight band (stop 95 / target 110 from `legacyPlay()`).
  const nameCloses = Array.from({ length: 20 }, (_, i) => 80 + i);
  const artifact = buildLegacySwingArtifacts({
    play: legacyPlay(), // entry_range 98-100, stop 95, target 110 (Legacy's overnight band)
    checkedAt: "2026-08-04T13:20:00.000Z",
    editionFor: "2026-08-04",
    spot: 99.5,
    chainRows,
    chainSpot: 99.5,
    nameCloses,
  });
  assert.ok(artifact);
  const plan = artifact!.dossier.plan!;
  // deriveSwingPlanLevels: stop = entry - 1.5*atr, target = entry + 2.7*atr (LONG). atr ≈ 1 (unit closes).
  assert.equal(plan.entryUnderlyingPx, 99.5);
  assert.ok(Math.abs(plan.atr - 1) < 0.5, `atr should be ≈1 from the unit-step closes, got ${plan.atr}`);
  assert.notEqual(plan.thesisInvalidationPx, 95, "must NOT reuse Legacy's overnight stop");
  assert.notEqual(plan.targetUnderlyingPx, 110, "must NOT reuse Legacy's overnight target");
});

test("buildLegacySwingArtifacts: with NO nameCloses, falls back to Legacy's own overnight levels (unchanged prior behavior)", () => {
  const artifact = buildLegacySwingArtifacts({
    play: legacyPlay(), // stop 95, target 110
    checkedAt: "2026-08-04T13:20:00.000Z",
    editionFor: "2026-08-04",
    spot: 99.5,
    chainRows,
    chainSpot: 99.5,
    nameCloses: null,
  });
  assert.ok(artifact);
  const plan = artifact!.dossier.plan!;
  assert.equal(plan.thesisInvalidationPx, 95);
  assert.equal(plan.targetUnderlyingPx, 110);
});

test("buildLegacySwingArtifacts: an empty nameCloses array also falls back to Legacy's levels (never throws on thin/empty data)", () => {
  const artifact = buildLegacySwingArtifacts({
    play: legacyPlay(),
    checkedAt: "2026-08-04T13:20:00.000Z",
    editionFor: "2026-08-04",
    spot: 99.5,
    chainRows,
    chainSpot: 99.5,
    nameCloses: [],
  });
  assert.ok(artifact);
  assert.equal(artifact!.dossier.plan!.targetUnderlyingPx, 110);
});

// SHORT-direction ATR math correctness (stop above entry, target below) is already directly tested
// against deriveSwingPlanLevels in structure-levels.test.ts — not re-verified here through the full
// contract-picking pipeline, which has its own strike/delta selection requirements unrelated to this fix.

test("mergeLegacyPromotedSnapshot dedupes existing thesis keys", () => {
  const artifact = buildLegacySwingArtifacts({
    play: legacyPlay(),
    checkedAt: "2026-08-04T13:20:00.000Z",
    editionFor: "2026-08-04",
    spot: 99.5,
    chainRows,
    chainSpot: 99.5,
  })!;
  const key = swingThesisKey(artifact.watch.ticker, artifact.watch.direction, artifact.watch.archetype);
  const existing = mergeLegacyPromotedSnapshot(null, [artifact], {
    sessionDay: "2026-08-04",
    asOf: "2026-08-04T13:20:00.000Z",
    spotsByTicker: { NVDA: 99.5 },
  });
  assert.equal(existing.watch.length, 1);
  const merged = mergeLegacyPromotedSnapshot(existing, [artifact], {
    sessionDay: "2026-08-04",
    asOf: "2026-08-04T13:21:00.000Z",
    spotsByTicker: { NVDA: 99.5 },
  });
  assert.equal(merged.watch.length, 1);
  assert.equal(
    swingThesisKey(merged.watch[0]!.ticker, merged.watch[0]!.direction, merged.watch[0]!.archetype),
    key,
  );
});

test("carryLegacyPromotedIntoSnapshot survives a discovery overwrite", () => {
  const artifact = buildLegacySwingArtifacts({
    play: legacyPlay({ ticker: "SKHY" }),
    checkedAt: "2026-08-04T13:20:00.000Z",
    editionFor: "2026-08-04",
    spot: 150.55,
    chainRows: [{ ...chainRows[0]!, strike: 150 }],
    chainSpot: 150.55,
  })!;
  const prior = mergeLegacyPromotedSnapshot(null, [artifact], {
    sessionDay: "2026-08-04",
    asOf: "2026-08-04T13:20:00.000Z",
    spotsByTicker: { SKHY: 150.55 },
  });
  const discoveryOnly = {
    asOf: "2026-08-04T14:00:00.000Z",
    sessionDay: "2026-08-04",
    dossiers: [],
    plays: [
      {
        ticker: "ORCL",
        direction: "LONG" as const,
        horizon: "SWING" as const,
        score: 70,
        contract: { strike: 137, right: "C" as const, expiry: "2026-08-14", dte: 10, mid: 3.2 },
        reason: "discovery row",
      },
    ],
    watch: [
      {
        ticker: "ORCL",
        direction: "LONG" as const,
        archetype: "SECTOR_ROTATION" as const,
        observationCount: 2,
        distinctSessionDays: 2,
        phasesSeen: ["RTH"],
        signalKinds: ["FLOW"],
        sessionSignalKinds: ["FLOW"],
        firstSeenAt: "2026-08-04T14:00:00.000Z",
        lastSeenAt: "2026-08-04T14:00:00.000Z",
        lastSessionDay: "2026-08-04",
      },
    ],
    observed: [],
    spotsByTicker: { ORCL: 137 },
  };
  const carried = carryLegacyPromotedIntoSnapshot(discoveryOnly, prior);
  assert.equal(carried.watch.some((w) => w.ticker === "SKHY"), true);
  assert.equal(
    carried.watch.find((w) => w.ticker === "SKHY")?.signalKinds?.[0],
    LEGACY_SWING_SIGNAL_KIND,
  );
  assert.equal(carried.plays.some((p) => p.ticker === "SKHY"), true);
  assert.equal(carried.plays.some((p) => p.ticker === "ORCL"), true);
});

test("persisted legacy promotion surfaces through discoverSwingFromPersisted gate", async () => {
  const artifact = buildLegacySwingArtifacts({
    play: legacyPlay({ ticker: "META" }),
    checkedAt: "2026-08-04T13:20:00.000Z",
    editionFor: "2026-08-04",
    spot: 780,
    chainRows: [{ ...chainRows[0]!, strike: 780 }],
    chainSpot: 780,
  })!;
  const snap = mergeLegacyPromotedSnapshot(null, [artifact], {
    sessionDay: "2026-08-04",
    asOf: "2026-08-04T13:20:00.000Z",
    spotsByTicker: { META: 780 },
  });
  const ok = await persistSwingServingSnapshot(snap);
  assert.equal(ok, true);
  const discovered = await discoverSwingFromPersisted();
  assert.ok(discovered);
  assert.equal(discovered!.plays.some((p) => p.ticker === "META"), true);
  assert.equal(discovered!.plays.find((p) => p.ticker === "META")?.signalKinds?.[0], LEGACY_SWING_SIGNAL_KIND);
});
