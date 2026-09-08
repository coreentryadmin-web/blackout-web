import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateSwingEntryEnterability,
  swingEntryActionLabel,
} from "./entry-enterability";

describe("evaluateSwingEntryEnterability", () => {
  it("AT_TRIGGER + TRIGGERED + floor → buy when desk not committed", () => {
    const r = evaluateSwingEntryEnterability({
      setupState: "TRIGGERED",
      entryStatus: "AT_TRIGGER",
      aboveFloor: true,
      deskCommitted: false,
    });
    assert.equal(r.action, "buy");
    assert.equal(r.enterable, true);
    assert.equal(swingEntryActionLabel(r.action), "BUY");
  });

  it("AT_TRIGGER + TRIGGERED + floor → still_buy when desk committed", () => {
    const r = evaluateSwingEntryEnterability({
      setupState: "TRIGGERED",
      entryStatus: "AT_TRIGGER",
      aboveFloor: true,
      deskCommitted: true,
    });
    assert.equal(r.action, "still_buy");
    assert.equal(swingEntryActionLabel(r.action), "STILL BUY");
  });

  it("PULLBACK_TO_ENTRY + TRIGGERED → buy/still_buy (not wait)", () => {
    const buy = evaluateSwingEntryEnterability({
      setupState: "TRIGGERED",
      entryStatus: "PULLBACK_TO_ENTRY",
      aboveFloor: true,
      deskCommitted: false,
    });
    assert.equal(buy.action, "buy");
    const still = evaluateSwingEntryEnterability({
      setupState: "TRIGGERED",
      entryStatus: "PULLBACK_TO_ENTRY",
      aboveFloor: true,
      deskCommitted: true,
    });
    assert.equal(still.action, "still_buy");
  });

  it("PRE_TRIGGER → wait", () => {
    const r = evaluateSwingEntryEnterability({
      setupState: "TRIGGERED",
      entryStatus: "PRE_TRIGGER",
      aboveFloor: true,
    });
    assert.equal(r.action, "wait");
    assert.match(r.reason, /trigger/i);
  });

  it("EXTENDED_CHASE → dont_buy", () => {
    const r = evaluateSwingEntryEnterability({
      setupState: "TRIGGERED",
      entryStatus: "EXTENDED_CHASE",
      aboveFloor: true,
    });
    assert.equal(r.action, "dont_buy");
    assert.match(r.reason, /chase/i);
  });

  it("past entry deadline → dont_buy", () => {
    const r = evaluateSwingEntryEnterability({
      setupState: "TRIGGERED",
      entryStatus: "AT_TRIGGER",
      aboveFloor: true,
      entryDeadline: "2026-09-01T12:00:00.000Z",
      nowMs: Date.parse("2026-09-05T12:00:00.000Z"),
    });
    assert.equal(r.action, "dont_buy");
    assert.match(r.reason, /expired/i);
  });

  it("commit gate block → wait", () => {
    const r = evaluateSwingEntryEnterability({
      setupState: "TRIGGERED",
      entryStatus: "AT_TRIGGER",
      aboveFloor: true,
      commitGateBlockedBy: ["gate:G-S6:confluence"],
    });
    assert.equal(r.action, "wait");
    assert.equal(r.enterable, false);
  });

  it("roll child: entry deadline anchors from committedAt, not stale firstSeenAt", () => {
    const nowMs = Date.parse("2026-09-06T12:00:00.000Z");
    const rollCommittedAt = "2026-09-05T14:00:00.000Z";
    const staleFirstSeenAt = "2026-08-28T14:00:00.000Z";

    const fromRollCommit = evaluateSwingEntryEnterability({
      setupState: "TRIGGERED",
      entryStatus: "AT_TRIGGER",
      aboveFloor: true,
      deskCommitted: true,
      subLane: "TACTICAL",
      anchoredAt: rollCommittedAt,
      nowMs,
    });
    assert.equal(fromRollCommit.action, "still_buy");

    const fromStaleDiscovery = evaluateSwingEntryEnterability({
      setupState: "TRIGGERED",
      entryStatus: "AT_TRIGGER",
      aboveFloor: true,
      deskCommitted: true,
      subLane: "TACTICAL",
      anchoredAt: staleFirstSeenAt,
      nowMs,
    });
    assert.equal(fromStaleDiscovery.action, "dont_buy");
    assert.match(fromStaleDiscovery.reason, /expired/i);
  });
});
