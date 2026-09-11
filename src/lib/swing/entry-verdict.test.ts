import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { swingEntryVerdict, resolveSwingServingSection } from "./entry-verdict";

describe("swingEntryVerdict — BUY / WAIT / SKIP", () => {
  it("COMMIT_NOW → WATCH + BUY", () => {
    const v = swingEntryVerdict({
      servingSection: "COMMIT_NOW",
      setupState: "TRIGGERED",
      entryStatus: "AT_TRIGGER",
    });
    assert.equal(v?.deckStatus, "WATCH");
    assert.equal(v?.recommendation, "BUY");
    assert.equal(v?.actionLabel, "BUY");
    assert.equal(v?.gateBlocks, null);
  });

  it("WAITING_FOR_ENTRY + PULLBACK → WATCH + BUY (enterable pullback)", () => {
    const v = swingEntryVerdict({
      servingSection: "WAITING_FOR_ENTRY",
      setupState: "TRIGGERED",
      entryStatus: "PULLBACK_TO_ENTRY",
      aboveFloor: true,
    });
    assert.equal(v?.deckStatus, "WATCH");
    assert.equal(v?.recommendation, "BUY");
    assert.equal(v?.actionLabel, "BUY");
  });

  it("WAITING_FOR_ENTRY + PRE_TRIGGER → WATCH + WAIT", () => {
    const v = swingEntryVerdict({
      servingSection: "WAITING_FOR_ENTRY",
      setupState: "TRIGGERED",
      entryStatus: "PRE_TRIGGER",
    });
    assert.equal(v?.deckStatus, "WATCH");
    assert.equal(v?.recommendation, "HOLD");
    assert.equal(v?.actionLabel, "WAIT");
    assert.match(v?.recNote ?? "", /trigger/i);
  });

  it("EXTENDED_CHASE in WAITING_FOR_ENTRY stays WAIT, not SKIP", () => {
    const v = swingEntryVerdict({
      servingSection: "WAITING_FOR_ENTRY",
      setupState: "TRIGGERED",
      entryStatus: "EXTENDED_CHASE",
    });
    assert.equal(v?.deckStatus, "WATCH");
    assert.equal(v?.actionLabel, "WAIT");
    assert.match(v?.recNote ?? "", /chase/i);
  });

  it("WATCH section (forming) → WATCH + WAIT", () => {
    const v = swingEntryVerdict({
      servingSection: "WATCH",
      setupState: "FORMING",
      aboveFloor: true,
    });
    assert.equal(v?.deckStatus, "WATCH");
    assert.equal(v?.actionLabel, "WAIT");
    assert.match(v?.recNote ?? "", /building/i);
  });

  it("RESEARCH + INVALIDATED → SKIP with thesis block", () => {
    const v = swingEntryVerdict({
      servingSection: "RESEARCH",
      setupState: "INVALIDATED",
    });
    assert.equal(v?.deckStatus, "SKIP");
    assert.equal(v?.actionLabel, null);
    assert.equal(v?.gateBlocks?.[0]?.code, "thesis_invalidated");
  });

  it("RESEARCH + persistence gap → SKIP with persistence reason", () => {
    const v = swingEntryVerdict({
      servingSection: "RESEARCH",
      persistenceObserved: true,
      persistenceGapReason: "Needs 1 more session",
    });
    assert.equal(v?.deckStatus, "SKIP");
    assert.equal(v?.gateBlocks?.[0]?.code, "persistence_gap");
    assert.match(v?.gateBlocks?.[0]?.reason ?? "", /1 more session/);
  });

  it("infers COMMIT_NOW from observables when serving is absent", () => {
    const section = resolveSwingServingSection({
      setupState: "TRIGGERED",
      entryStatus: "AT_TRIGGER",
      aboveFloor: true,
    });
    assert.equal(section, "COMMIT_NOW");
  });

  it("returns null when observables are too sparse to route", () => {
    assert.equal(swingEntryVerdict({}), null);
  });

  it("COMMIT_NOW + G-S6 block → WATCH/WAIT with gate blocks, not BUY", () => {
    const v = swingEntryVerdict({
      servingSection: "COMMIT_NOW",
      setupState: "TRIGGERED",
      entryStatus: "AT_TRIGGER",
      commitGateBlockedBy: ["gate:G-S6:confluence"],
    });
    assert.equal(v?.deckStatus, "WATCH");
    assert.equal(v?.actionLabel, "WAIT");
    assert.equal(v?.recommendation, "HOLD");
    assert.equal(v?.gateBlocks?.[0]?.code, "g_s6_confluence");
  });

  it("desk committed + AT_TRIGGER → STILL BUY label", () => {
    const v = swingEntryVerdict({
      servingSection: "COMMIT_NOW",
      setupState: "TRIGGERED",
      entryStatus: "AT_TRIGGER",
      aboveFloor: true,
      deskCommitted: true,
    });
    assert.equal(v?.recommendation, "BUY");
    assert.equal(v?.actionLabel, "STILL BUY");
    assert.equal(v?.entryAction, "still_buy");
  });

  it("past entry deadline + active commit gate blocks → WAIT with real gate blocks, not null (live MU repro 2026-09-11)", () => {
    // Live repro: MU flagged 2026-07-24 (STANDARD sub-lane, 3-day entry validity), so by
    // 2026-09-11 `pastEntryDeadline` fires FIRST inside evaluateSwingEntryEnterability
    // (entry-enterability.ts) and returns `dont_buy` with the generic "Entry-validity window
    // expired" reason BEFORE ever reaching its own gate-blocked check — so `commitGateBlockedBy`
    // (3 real, live gate codes: G-S12 halt-feed-stale, G-S4 regime-degraded, G-S6 confluence)
    // is computed but never returned on that enterability result. swingEntryVerdict's `dont_buy`
    // branch then unconditionally set `gateBlocks: null` for anything short of
    // INVALIDATED/persistence-gap, silently discarding those three already-computed, real gate
    // reasons — so every consumer of `TerminalPlay.gateBlocks` (the play-brief Entry section,
    // play-brief-intel's "Before entry, clear:", play-brief-narrative-coaching) rendered nothing,
    // even though the underlying gate evidence existed and was already mapped to member-facing
    // text via `commitGateBlocksForVerdict` for the sibling "wait" branch two cases above.
    const v = swingEntryVerdict({
      servingSection: "WATCH",
      setupState: "TRIGGERED",
      entryStatus: "AT_TRIGGER",
      subLane: "STANDARD",
      anchoredAt: "2026-07-24T13:38:31.000Z",
      commitGateBlockedBy: [
        "gate:G-S12:halt_feed_stale",
        "gate:G-S4:regime_degraded",
        "gate:G-S6:confluence",
      ],
      nowMs: Date.parse("2026-09-11T04:37:00.000Z"),
    });
    assert.equal(v?.entryAction, "dont_buy");
    assert.match(v?.recNote ?? "", /Entry-validity window expired/);
    assert.ok(v?.gateBlocks?.length, "gateBlocks should carry the real, already-computed gate reasons");
    const codes = v?.gateBlocks?.map((g) => g.code) ?? [];
    assert.ok(codes.includes("g_s12_halt_feed_stale"));
    assert.ok(codes.includes("g_s4_regime"));
    assert.ok(codes.includes("g_s6_confluence"));
  });

  it("COMMIT_NOW + legacy NIGHT HAWK only → WAIT with legacy_exempt, not BUY (Q22)", () => {
    const v = swingEntryVerdict({
      servingSection: "COMMIT_NOW",
      setupState: "TRIGGERED",
      entryStatus: "AT_TRIGGER",
      signalKinds: ["NIGHT HAWK"],
    });
    assert.equal(v?.deckStatus, "WATCH");
    assert.equal(v?.actionLabel, "WAIT");
    assert.notEqual(v?.recommendation, "BUY");
    assert.equal(v?.gateBlocks?.[0]?.code, "legacy_exempt");
  });
});
