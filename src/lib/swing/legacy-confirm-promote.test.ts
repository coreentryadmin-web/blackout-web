import { test } from "node:test";
import assert from "node:assert/strict";
import type { PlaybookPlay } from "@/features/nighthawk/lib/types";
import {
  LEGACY_SWING_SIGNAL_KIND,
  buildLegacySwingArtifacts,
  carryLegacyPromotedIntoSnapshot,
  filterChainRowsForSwingPromotion,
  isCarriedContractLive,
  carriedContractExpiry,
  legacyPlayDirection,
  legacyCommitCandidatesFromSnapshot,
  mergeLegacyPromotedSnapshot,
  refreshCarriedLegacyPlay,
  removeCommittedLegacyFromSnapshot,
} from "./legacy-confirm-promote.ts";
import { HORIZONS } from "../horizons.ts";
import { subLaneForDte } from "./taxonomy.ts";
import { discoverSwingFromPersisted, persistSwingServingSnapshot } from "./serving-lane.ts";
import type { ChainStrikeRow } from "@/features/nighthawk/lib/option-chain-prompt";
import { swingThesisKey } from "./accumulation-store.ts";
import { computeSwingCommitPlan, type CommitBookPosition } from "./commit.ts";
import { DEFAULT_PORTFOLIO_BUDGET } from "./swing-portfolio-budget.ts";

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

test("buildLegacySwingArtifacts: absent 10d returns omit REL_STRENGTH (no fabricated 0/0)", () => {
  const artifact = buildLegacySwingArtifacts({
    play: legacyPlay(),
    checkedAt: "2026-08-04T13:20:00.000Z",
    editionFor: "2026-08-04",
    spot: 99.5,
    chainRows,
    chainSpot: 99.5,
  });
  assert.ok(artifact);
  assert.equal(artifact!.dossier.pillarSignals.REL_STRENGTH, null);
  assert.ok(
    artifact!.dossier.dataQuality.missing.includes("REL_STRENGTH"),
    "REL_STRENGTH must be listed missing, not scored as 0/0 outperformance",
  );
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
  assert.ok(
    (artifact!.play.contract?.dte ?? 0) >= HORIZONS.SWING.dteMin,
    "promoted contract must clear Swing dteMin",
  );
  assert.equal(
    artifact!.dossier.subLane,
    subLaneForDte(artifact!.play.contract!.dte),
    "dossier subLane must match the picked contract DTE",
  );
});

// ─── score/factors reconciliation (FINDINGS 2026-09-12) ───────────────────────────────────────
// Live commits showed the SHOWN score (Legacy's edition conviction score) diverge sharply from
// `factors`' sum (the dossier's own independently-computed synthetic pillar score) — e.g. real
// MRVL 81 vs 74.7, IREN 61 vs 75.8, SKHY(WATCH) 59 vs 26.6. `contributionsToFactors`'s own doc
// comment names this exact failure mode: pairing one run's factors with a different run's score.

test("buildLegacySwingArtifacts: factors sum to the play's own SHOWN score, not the dossier's synthetic one", () => {
  // A conviction score high enough that the dossier's synthetic pillar score (built from
  // structure/regime/data-quality heuristics, NOT from play.score) is very unlikely to coincide.
  const artifact = buildLegacySwingArtifacts({
    play: legacyPlay({ score: 97 }),
    checkedAt: "2026-08-04T13:20:00.000Z",
    editionFor: "2026-08-04",
    spot: 99.5,
    chainRows,
    chainSpot: 99.5,
  });
  assert.ok(artifact);
  const { play } = artifact!;
  assert.equal(play.score, 97, "score must stay Legacy's own published edition conviction score");
  const factorSum = (play.factors ?? []).reduce((n, f) => n + f.points, 0);
  assert.equal(
    factorSum,
    play.score,
    "the 'Why this play was picked' factor breakdown must sum to the score shown next to it",
  );
  assert.deepEqual(play.factors, [{ label: "Night Hawk edition score", points: 97 }]);
});

test("buildLegacySwingArtifacts: score/factor reconciliation holds even when it falls back to the default 70", () => {
  const artifact = buildLegacySwingArtifacts({
    play: legacyPlay({ score: undefined }),
    checkedAt: "2026-08-04T13:20:00.000Z",
    editionFor: "2026-08-04",
    spot: 99.5,
    chainRows,
    chainSpot: 99.5,
  });
  assert.ok(artifact);
  const { play } = artifact!;
  assert.equal(play.score, 70);
  const factorSum = (play.factors ?? []).reduce((n, f) => n + f.points, 0);
  assert.equal(factorSum, play.score);
});

test("filterChainRowsForSwingPromotion drops sub-floor expiries", () => {
  const rows = [
    { ...chainRows[0]!, expiry: "2026-08-07" },
    { ...chainRows[0]!, expiry: "2026-08-14" },
  ];
  const kept = filterChainRowsForSwingPromotion(rows, "2026-08-04");
  assert.deepEqual(
    kept.map((r) => r.expiry),
    ["2026-08-14"],
  );
});

test("buildLegacySwingArtifacts returns null when only sub-floor expiries exist", () => {
  const shortOnly = [{ ...chainRows[0]!, expiry: "2026-08-07" }];
  const artifact = buildLegacySwingArtifacts({
    play: legacyPlay(),
    checkedAt: "2026-08-04T13:20:00.000Z",
    editionFor: "2026-08-04",
    spot: 99.5,
    chainRows: shortOnly,
    chainSpot: 99.5,
  });
  assert.equal(artifact, null);
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


// ── EXPIRED CARRIED CONTRACTS ARE DROPPED (2026-08-07) ───────────────────────────────────────
// Carried rows re-attach the prior snapshot's play verbatim, contract blob included. Live on
// 2026-08-07 the board served CRWV 84C / SKHY 148C / RDDT 152.5C all labelled "3DTE" with expiry
// 2026-08-07 — zero DTE, expiring that session — at flag-day prices: SKHY mid 6.44 vs a live 0.22
// (-96.5%), AEM 9.38 vs 21.30 (BELOW intrinsic). Fail-closed: drop, never serve.

const carriedPlay = (expiry: string | undefined) =>
  ({
    ticker: "SKHY",
    direction: "LONG" as const,
    horizon: "SWING" as const,
    score: 70,
    contract: { strike: 148, right: "C" as const, expiry, dte: 3, mid: 6.44 },
    reason: "carried",
  }) as unknown as Parameters<typeof isCarriedContractLive>[0];

test("isCarriedContractLive: an EXPIRED frozen contract is not live", () => {
  assert.equal(isCarriedContractLive(carriedPlay("2026-08-06"), "2026-08-07"), false);
});

test("isCarriedContractLive: expiry ON the session day still trades that day", () => {
  assert.equal(isCarriedContractLive(carriedPlay("2026-08-07"), "2026-08-07"), true);
});

test("isCarriedContractLive: a future expiry is live", () => {
  assert.equal(isCarriedContractLive(carriedPlay("2026-08-14"), "2026-08-07"), true);
});

test("isCarriedContractLive: an UNDATEABLE contract is dropped, not trusted", () => {
  // A carried row we cannot date is exactly the row we cannot vouch for.
  assert.equal(isCarriedContractLive(carriedPlay(undefined), "2026-08-07"), false);
  assert.equal(carriedContractExpiry(carriedPlay(undefined)), null);
  assert.equal(isCarriedContractLive(carriedPlay("2026-08-14"), ""), false);
});

test("carryLegacyPromotedIntoSnapshot DROPS an expired carry and keeps the fresh scan row", () => {
  // The strip step removes carried tickers from the fresh scan, so carrying a DEAD row would also
  // suppress any live row the scan just produced for that name. Dropping it must leave the fresh
  // board intact.
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
  // Same snapshot, read on a LATER session — the frozen contract has since expired.
  const laterSession = {
    asOf: "2026-09-01T14:00:00.000Z",
    sessionDay: "2026-09-01",
    dossiers: [],
    plays: [],
    watch: [],
    observed: [],
    spotsByTicker: {},
  };
  const carried = carryLegacyPromotedIntoSnapshot(laterSession, prior);
  assert.equal(
    carried.plays.some((p) => p.ticker === "SKHY"),
    false,
    "an expired carried contract must not be served",
  );
  assert.equal(carried.watch.some((w) => w.ticker === "SKHY"), false);
});

test("refreshCarriedLegacyPlay recomputes DTE and merges a fresher organic quote", () => {
  const carried = {
    ticker: "NVDA",
    direction: "LONG" as const,
    horizon: "SWING" as const,
    score: 70,
    status: "WATCH" as const,
    scoreFloor: 60,
    reason: "NIGHT HAWK · 10DTE",
    contract: {
      strike: 100,
      expiry: "2026-08-14",
      right: "C" as const,
      dte: 10,
      mid: 6.44,
      bid: 6.2,
      ask: 6.6,
      openInterest: 0,
    },
  };
  const fresh = {
    ...carried,
    contract: { ...carried.contract, dte: 7, mid: 0.22, bid: 0.2, ask: 0.24 },
  };
  const refreshed = refreshCarriedLegacyPlay(
    carried,
    "2026-08-07",
    new Map([["NVDA", fresh]]),
  );
  assert.ok(refreshed);
  assert.equal(refreshed!.contract.dte, 7);
  assert.equal(refreshed!.contract.mid, 0.22);
  assert.match(refreshed!.reason ?? "", /7DTE/);
});

// ─── GRADUATION BRIDGE (PR #5577) ──────────────────────────────────────────────────────────────
// Legacy-promoted rows were permanently serve-only — `bucketGraduated: false` and
// `commitGateBlockedBy: ["legacy:exempt"]` hardcoded because these rows live entirely in this
// module's own persisted snapshot, structurally disjoint from accumulation-store.ts (the only
// store discovery.ts's commit loop reads candidates from). `legacyCommitCandidatesFromSnapshot` is
// the bridge: only a triple whose setupState/entryStatus has reached the same TRIGGERED+AT_TRIGGER
// bar an organic candidate needs for COMMIT_NOW becomes a real SwingCommitCandidate. These tests
// hand-construct the triggered play (the shape `swing-active-refresh`'s own live reclassification
// already produces in production — see the file header correction) rather than re-deriving it,
// since reclassification itself is proven to already work and isn't this file's concern.

test("legacyCommitCandidatesFromSnapshot: a still-FORMING triple is never offered to the commit gate", () => {
  const artifact = buildLegacySwingArtifacts({
    play: legacyPlay(),
    checkedAt: "2026-08-04T13:20:00.000Z",
    editionFor: "2026-08-04",
    spot: 97,
    chainRows,
    chainSpot: 97,
  })!;
  assert.equal(artifact.play.setupState, "FORMING", "sanity: promotion-day spot (97) is below the 99 trigger");
  const candidates = legacyCommitCandidatesFromSnapshot([artifact], { sessionDate: "2026-08-04" });
  assert.equal(candidates.length, 0, "FORMING/PRE_TRIGGER must never reach the commit gate");
});

test("legacyCommitCandidatesFromSnapshot: a TRIGGERED+AT_TRIGGER triple becomes a real SwingCommitCandidate", () => {
  const artifact = buildLegacySwingArtifacts({
    play: legacyPlay(),
    checkedAt: "2026-08-04T13:20:00.000Z",
    editionFor: "2026-08-04",
    spot: 97,
    chainRows,
    chainSpot: 97,
  })!;
  // The shape `swing-active-refresh` + `enrichPlay`'s live reclassification already produces in
  // production once price clears the trigger — proven live (PR #5577 correction), not re-derived here.
  const triggeredPlay = { ...artifact.play, setupState: "TRIGGERED" as const, entryStatus: "AT_TRIGGER" as const };
  const triggeredTriple = { ...artifact, play: triggeredPlay };

  const candidates = legacyCommitCandidatesFromSnapshot([triggeredTriple], { sessionDate: "2026-08-04" });
  assert.equal(candidates.length, 1);
  const c = candidates[0]!;
  assert.equal(c.ticker, "NVDA");
  assert.equal(c.direction, "LONG");
  assert.equal(c.entryUnderlyingPx, 99);
  assert.equal(c.thesisInvalidationPx, 95);
  assert.ok(c.contract, "must carry the already-materialized contract — no new fetch needed");
  assert.deepEqual(c.discoveryPaths, [], "a Legacy-only candidate carries no Tier-0 paths unless independently screened this scan");
});

test("legacyCommitCandidatesFromSnapshot: credits REAL Tier-0 provenance when pathsByTicker names one (never invents a NIGHT HAWK kind)", () => {
  const artifact = buildLegacySwingArtifacts({
    play: legacyPlay(),
    checkedAt: "2026-08-04T13:20:00.000Z",
    editionFor: "2026-08-04",
    spot: 97,
    chainRows,
    chainSpot: 97,
  })!;
  const triggeredPlay = { ...artifact.play, setupState: "TRIGGERED" as const, entryStatus: "AT_TRIGGER" as const };
  const candidates = legacyCommitCandidatesFromSnapshot(
    [{ ...artifact, play: triggeredPlay }],
    { sessionDate: "2026-08-04", pathsByTicker: new Map([["NVDA", ["FLOW", "STRUCTURE"]]]) },
  );
  assert.deepEqual(candidates[0]!.discoveryPaths, ["FLOW", "STRUCTURE"]);
});

test("removeCommittedLegacyFromSnapshot: drops a committed ticker so it is not ALSO carried as a WATCH row", () => {
  const artifact = buildLegacySwingArtifacts({
    play: legacyPlay({ ticker: "NVDA" }),
    checkedAt: "2026-08-04T13:20:00.000Z",
    editionFor: "2026-08-04",
    spot: 97,
    chainRows,
    chainSpot: 97,
  })!;
  const snap = mergeLegacyPromotedSnapshot(null, [artifact], {
    sessionDay: "2026-08-04",
    asOf: "2026-08-04T13:20:00.000Z",
    spotsByTicker: { NVDA: 97 },
  });
  const after = removeCommittedLegacyFromSnapshot(snap, new Set(["NVDA"]));
  assert.equal(after.plays.some((p) => p.ticker === "NVDA"), false);
  assert.equal(after.watch.some((w) => w.ticker === "NVDA"), false);
});

// ─── FULL LIFECYCLE PROOF — the REAL, unmodified commit.ts gate pipeline, not a reimplementation ──

test("FULL LIFECYCLE: a TRIGGERED+AT_TRIGGER Legacy play reaches ACTIVE (committable:true) through the real, unmodified computeSwingCommitPlan, with every real-time gate still applying", () => {
  const artifact = buildLegacySwingArtifacts({
    play: legacyPlay({ ticker: "NVDA", score: 85 }),
    checkedAt: "2026-08-04T13:20:00.000Z",
    editionFor: "2026-08-04",
    spot: 97,
    chainRows,
    chainSpot: 97,
  })!;
  const triggeredPlay = {
    ...artifact.play,
    setupState: "TRIGGERED" as const,
    entryStatus: "AT_TRIGGER" as const,
    contract: { ...artifact.play.contract!, bid: 1.3, ask: 1.4, mid: 1.35 },
  };

  const candidates = legacyCommitCandidatesFromSnapshot(
    [{ ...artifact, play: triggeredPlay }],
    { sessionDate: "2026-08-04" },
  );
  assert.equal(candidates.length, 1);

  // The REAL function from commit.ts — imported, never reimplemented.
  const plan = computeSwingCommitPlan({
    candidates,
    report: null,
    book: [],
    budget: DEFAULT_PORTFOLIO_BUDGET,
  });
  assert.equal(plan.committableCount, 1, "TRIGGERED -> ACTIVE: the real commit gate opens it");
  const decision = plan.decisions[0]!;
  assert.equal(decision.committable, true);
  assert.equal(decision.insert?.status, "OPEN");
  assert.equal(decision.insert?.ticker, "NVDA");

  // Deduplication / idempotency still applies — a SECOND run against a book that already holds
  // this exact thesis must refuse to double-open it (no bypass of Gate 3).
  const alreadyOpenBook: CommitBookPosition[] = [
    { ticker: "NVDA", direction: "LONG", archetype: decision.archetype, commitKey: decision.commitKey, riskUsd: decision.riskUsd, isEvent: false, isOvernight: true },
  ];
  const planAgain = computeSwingCommitPlan({ candidates, report: null, book: alreadyOpenBook, budget: DEFAULT_PORTFOLIO_BUDGET });
  assert.equal(planAgain.committableCount, 0, "idempotency must still block a duplicate open — never bypassed for a Legacy-sourced candidate");
  assert.ok(planAgain.decisions[0]!.blockedBy.includes("already_open"));
});

test("FULL LIFECYCLE: G-S6 confluence still blocks a Legacy-only candidate with zero independent corroboration when V2 confluence is enforced (no silent bypass)", () => {
  const artifact = buildLegacySwingArtifacts({
    play: legacyPlay({ ticker: "NVDA" }),
    checkedAt: "2026-08-04T13:20:00.000Z",
    editionFor: "2026-08-04",
    spot: 97,
    chainRows,
    chainSpot: 97,
  })!;
  const triggeredPlay = { ...artifact.play, setupState: "TRIGGERED" as const, entryStatus: "AT_TRIGGER" as const };
  const candidates = legacyCommitCandidatesFromSnapshot(
    [{ ...artifact, play: triggeredPlay }],
    { sessionDate: "2026-08-04" }, // no pathsByTicker -> zero Tier-0 provenance, same as a real Legacy-only name
  );
  const plan = computeSwingCommitPlan({
    candidates,
    report: null,
    book: [],
    budget: DEFAULT_PORTFOLIO_BUDGET,
    v2: { enforceConfluence: true },
  });
  assert.equal(plan.committableCount, 0, "a single human-curated signal must not satisfy G-S6 confluence alone");
  assert.ok(plan.decisions[0]!.blockedBy.some((b) => b.startsWith("gate:G-S6")));
});
