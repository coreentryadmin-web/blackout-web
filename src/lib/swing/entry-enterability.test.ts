import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  deadPlayReason,
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

  it("past entry deadline → dont_buy, flagged expired: true (distinguishes from every other dont_buy/wait reason)", () => {
    const r = evaluateSwingEntryEnterability({
      setupState: "TRIGGERED",
      entryStatus: "AT_TRIGGER",
      aboveFloor: true,
      entryDeadline: "2026-09-01T12:00:00.000Z",
      nowMs: Date.parse("2026-09-05T12:00:00.000Z"),
    });
    assert.equal(r.action, "dont_buy");
    assert.match(r.reason, /expired/i);
    assert.equal(r.expired, true);
  });

  // Gap fix (2026-09-18, Ask Largo standing mandate): `deadlineIso` used to only ever be computed
  // internally to derive the `expired` boolean, then discarded — a caller had no way to show the
  // forward-looking "entry window closes on X" fact while the setup was still enterable. It must
  // now be attached on EVERY branch a deadline is resolvable on, not only the already-expired one.
  it("deadlineIso is populated even on a still-enterable (buy) verdict, from an explicit entryDeadline", () => {
    const r = evaluateSwingEntryEnterability({
      setupState: "TRIGGERED",
      entryStatus: "AT_TRIGGER",
      aboveFloor: true,
      deskCommitted: false,
      entryDeadline: "2026-09-20T12:00:00.000Z",
      nowMs: Date.parse("2026-09-18T12:00:00.000Z"),
    });
    assert.equal(r.action, "buy");
    assert.equal(r.enterable, true);
    assert.equal(r.deadlineIso, "2026-09-20T12:00:00.000Z");
  });

  it("deadlineIso is populated on a still-enterable verdict from the anchoredAt+subLane fallback (no explicit entryDeadline)", () => {
    const r = evaluateSwingEntryEnterability({
      setupState: "TRIGGERED",
      entryStatus: "PRE_TRIGGER",
      aboveFloor: true,
      subLane: "STANDARD",
      anchoredAt: "2026-09-15T14:00:00.000Z", // Tuesday
      nowMs: Date.parse("2026-09-16T14:00:00.000Z"),
    });
    assert.equal(r.action, "wait");
    assert.ok(r.deadlineIso, "expected a resolved deadline from the sub-lane fallback");
    assert.ok(
      Date.parse(r.deadlineIso!) > Date.parse("2026-09-15T14:00:00.000Z"),
      "deadline must be strictly after the anchor",
    );
  });

  it("deadlineIso is null when neither entryDeadline nor anchoredAt is supplied (never fabricated)", () => {
    const r = evaluateSwingEntryEnterability({
      setupState: "TRIGGERED",
      entryStatus: "AT_TRIGGER",
      aboveFloor: true,
    });
    assert.equal(r.deadlineIso, null);
  });

  it("expired is NOT set on other dont_buy/wait reasons (invalidated, extended-chase, gate-blocked)", () => {
    const invalidated = evaluateSwingEntryEnterability({
      setupState: "INVALIDATED",
      aboveFloor: true,
    });
    assert.equal(invalidated.action, "dont_buy");
    assert.notEqual(invalidated.expired, true);

    const extended = evaluateSwingEntryEnterability({
      setupState: "TRIGGERED",
      entryStatus: "EXTENDED_CHASE",
      aboveFloor: true,
    });
    assert.equal(extended.action, "dont_buy");
    assert.notEqual(extended.expired, true);

    const gateBlocked = evaluateSwingEntryEnterability({
      setupState: "TRIGGERED",
      entryStatus: "AT_TRIGGER",
      aboveFloor: true,
      commitGateBlockedBy: ["gate:G-S6:confluence"],
    });
    assert.equal(gateBlocked.action, "wait");
    assert.notEqual(gateBlocked.expired, true);
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

  // Live repro 2026-09-14 (PLTR): setup FORMING/entry PRE_TRIGGER AND gate-blocked at once —
  // the old unconditional gate-blocked check (before the FORMING/PRE_TRIGGER checks in the
  // if-chain) claimed "At trigger, but commit gates have not cleared" on a play that had
  // explicitly NOT reached its trigger, contradicting the brief's own "Entry geometry:
  // PRE_TRIGGER" / "Setup: FORMING" fields shown right next to it.
  it("FORMING + gate-blocked → still reads 'thesis still building', never 'at trigger'", () => {
    const r = evaluateSwingEntryEnterability({
      setupState: "FORMING",
      aboveFloor: true,
      commitGateBlockedBy: ["gate:G-S6:confluence"],
    });
    assert.equal(r.action, "wait");
    assert.doesNotMatch(r.reason, /at trigger/i);
    assert.match(r.reason, /still building/i);
  });

  it("TRIGGERED + PRE_TRIGGER + gate-blocked → still reads 'waiting for price', never 'at trigger'", () => {
    const r = evaluateSwingEntryEnterability({
      setupState: "TRIGGERED",
      entryStatus: "PRE_TRIGGER",
      aboveFloor: true,
      commitGateBlockedBy: ["gate:G-S6:confluence"],
    });
    assert.equal(r.action, "wait");
    assert.doesNotMatch(r.reason, /at trigger/i);
    assert.match(r.reason, /trigger/i);
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

  it("entry-validity window counts real trading days, not raw calendar days across a weekend (live GOOGL/ORCL repro, 2026-09-13)", () => {
    // Flagged Thursday 2026-09-10 12:05 ET, STANDARD sub-lane (3-day window). Only Friday
    // 2026-09-11 is a real trading day between then and Sunday evening — the old
    // anchorMs + days*DAY_MS math counted Sat+Sun as if they were tradeable and expired this
    // by Sunday 16:05 UTC, well before Monday's market ever reopened.
    const anchoredAt = "2026-09-10T16:05:00.000Z"; // Thu 12:05 ET
    const sundayEveningNowMs = Date.parse("2026-09-13T21:00:00.000Z"); // Sun ~17:00 ET

    const r = evaluateSwingEntryEnterability({
      setupState: "TRIGGERED",
      entryStatus: "AT_TRIGGER",
      aboveFloor: true,
      subLane: "STANDARD",
      anchoredAt,
      nowMs: sundayEveningNowMs,
    });
    assert.notEqual(r.expired, true);
    assert.equal(r.action, "buy");

    // Sanity check the other direction: once TWO real trading days (Fri + Mon) plus the
    // weekend have actually elapsed, a 3-day STANDARD window should still expire on schedule —
    // this guards against overcorrecting into "never expires".
    const tuesdayAfternoonNowMs = Date.parse("2026-09-15T20:00:00.000Z"); // Tue ~16:00 ET
    const expired = evaluateSwingEntryEnterability({
      setupState: "TRIGGERED",
      entryStatus: "AT_TRIGGER",
      aboveFloor: true,
      subLane: "STANDARD",
      anchoredAt,
      nowMs: tuesdayAfternoonNowMs,
    });
    assert.equal(expired.expired, true);
    assert.equal(expired.action, "dont_buy");
  });
});

// GAP FOUND (Ask Largo standing mandate, 2026-09-18): deadPlayReason only recognized 2 of the 4
// `dont_buy` dead-entry states evaluateSwingEntryEnterability can return — INVALIDATED and
// deadline-expired — leaving contract-expired and extended-chase uncovered even though
// entry-verdict.ts's `dont_buy` branch keeps `gateBlocks` populated for exactly those two cases
// too (its own comment: "regardless of which dont_buy reason fired (deadline-expired,
// contract-expired, extended-chase)"). Every renderer gated on `deadPlayReason` (watchEntrySection
// in play-brief.ts, entryTriggerDeadReason in play-brief-intel.ts, the invalidation callout in
// play-brief.ts, and gateBlockCoaching in play-brief-narrative-coaching.ts) would render an
// un-qualified "Gates blocking entry" header for a contract-expired or extended-chase WATCH play
// that also happened to carry gate evidence — implying clearing the gate would reopen entry, which
// is false because the entry/setup state already blocks it first regardless of gates.
describe("deadPlayReason", () => {
  it("INVALIDATED thesis is dead", () => {
    assert.equal(deadPlayReason({ setupState: "INVALIDATED" }), "thesis already invalidated");
  });

  it("watchEntryExpired (deadline past) is dead", () => {
    assert.equal(
      deadPlayReason({ setupState: "TRIGGERED", watchEntryExpired: true }),
      "entry-validity window expired",
    );
  });

  it("entryStatus EXPIRED (contract expired) is dead — was previously NOT recognized", () => {
    assert.equal(deadPlayReason({ setupState: "TRIGGERED", entryStatus: "EXPIRED" }), "contract expired");
  });

  it("setupState EXTENDED is dead — was previously NOT recognized", () => {
    assert.equal(
      deadPlayReason({ setupState: "EXTENDED", entryStatus: "PRE_TRIGGER" }),
      "extended past the valid entry window",
    );
  });

  it("entryStatus EXTENDED_CHASE is dead — was previously NOT recognized", () => {
    assert.equal(
      deadPlayReason({ setupState: "TRIGGERED", entryStatus: "EXTENDED_CHASE" }),
      "extended past the valid entry window",
    );
  });

  it("a genuinely still-enterable play is not dead", () => {
    assert.equal(deadPlayReason({ setupState: "TRIGGERED", entryStatus: "AT_TRIGGER" }), null);
    assert.equal(deadPlayReason({ setupState: "FORMING", entryStatus: "PRE_TRIGGER" }), null);
  });
});
