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
