import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blockedByFromSwingGates,
  evaluateEarningsGate,
  evaluateConfluenceGate,
  evaluateRegimeGate,
  evaluateHaltGate,
  evaluateQuoteStaleGate,
  evaluateDailyBarGate,
  failingSwingCommitGates,
  SWING_QUOTE_MAX_AGE_MS,
} from "./gates";

test("evaluateConfluenceGate: pass at 3 kinds for BREAKOUT", () => {
  const v = evaluateConfluenceGate({
    discoveryPaths: ["FLOW", "STRUCTURE", "POSITIONING"],
    archetype: "BREAKOUT",
  });
  assert.equal(v.pass, true);
  assert.equal(v.gate, "G-S6");
});

test("evaluateConfluenceGate: fail at 2 kinds for BREAKOUT", () => {
  const v = evaluateConfluenceGate({
    discoveryPaths: ["FLOW", "STRUCTURE"],
    archetype: "BREAKOUT",
  });
  assert.equal(v.pass, false);
  assert.match(v.reason, /G-S6 confluence/);
});

test("evaluateEarningsGate: blocks when earningsInWindow without authorization", () => {
  const blocked = evaluateEarningsGate({ discoveryPaths: [], archetype: "EVENT_DRIVEN", earningsInWindow: true });
  assert.equal(blocked.pass, false);
  assert.equal(blocked.gate, "G-S3");
  const authed = evaluateEarningsGate({
    discoveryPaths: [],
    archetype: "EVENT_DRIVEN",
    earningsInWindow: true,
    eventAuthorized: true,
  });
  assert.equal(authed.pass, true);
});

test("failingSwingCommitGates: G-S3 when enforceEarnings on", () => {
  const fails = failingSwingCommitGates(
    { discoveryPaths: ["FLOW", "STRUCTURE", "CATALYST"], archetype: "EVENT_DRIVEN", earningsInWindow: true },
    { enforceEarnings: true },
  );
  assert.equal(fails.length, 1);
  assert.equal(fails[0]!.gate, "G-S3");
});

test("blockedByFromSwingGates: maps G-S3 to gate token", () => {
  const v = evaluateEarningsGate({ discoveryPaths: [], archetype: "EVENT_DRIVEN", earningsInWindow: true });
  assert.deepEqual(blockedByFromSwingGates([v]), ["gate:G-S3:earnings_in_window"]);
});

test("evaluateRegimeGate: blocks RISK_OFF and UNKNOWN; passes NEUTRAL/RISK_ON", () => {
  assert.equal(evaluateRegimeGate({ discoveryPaths: [], archetype: "BREAKOUT", regime01: 0.1 }).pass, false);
  assert.equal(evaluateRegimeGate({ discoveryPaths: [], archetype: "BREAKOUT", regime01: null }).pass, false);
  assert.equal(evaluateRegimeGate({ discoveryPaths: [], archetype: "BREAKOUT", regime01: 0.5 }).pass, true);
  assert.equal(evaluateRegimeGate({ discoveryPaths: [], archetype: "BREAKOUT", regime01: 0.8 }).pass, true);
});

test("failingSwingCommitGates: G-S4 when enforceRegime on", () => {
  const fails = failingSwingCommitGates(
    { discoveryPaths: [], archetype: "BREAKOUT", regime01: 0.1 },
    { enforceRegime: true },
  );
  assert.equal(fails.length, 1);
  assert.equal(fails[0]!.gate, "G-S4");
  assert.deepEqual(blockedByFromSwingGates(fails), ["gate:G-S4:regime_degraded"]);
});

test("blockedByFromSwingGates: maps G-S4 unknown regime", () => {
  const v = evaluateRegimeGate({ discoveryPaths: [], archetype: "BREAKOUT", regime01: null });
  assert.deepEqual(blockedByFromSwingGates([v]), ["gate:G-S4:regime_unknown"]);
});

test("evaluateHaltGate: blocks when halted", () => {
  const blocked = evaluateHaltGate({ discoveryPaths: [], archetype: "BREAKOUT", halted: true });
  assert.equal(blocked.pass, false);
  assert.equal(blocked.gate, "G-S12");
  const clear = evaluateHaltGate({ discoveryPaths: [], archetype: "BREAKOUT", halted: false });
  assert.equal(clear.pass, true);
});

test("evaluateHaltGate: blocks on halt feed stale when fail-closed enabled", () => {
  const blocked = evaluateHaltGate({
    discoveryPaths: [],
    archetype: "BREAKOUT",
    haltFeedStale: true,
  });
  assert.equal(blocked.pass, false);
  assert.match(blocked.reason, /feed cold/);
});

test("failingSwingCommitGates: G-S12 when enforceHalt on", () => {
  const fails = failingSwingCommitGates(
    { discoveryPaths: [], archetype: "BREAKOUT", halted: true },
    { enforceHalt: true },
  );
  assert.equal(fails.length, 1);
  assert.equal(fails[0]!.gate, "G-S12");
});

test("blockedByFromSwingGates: maps G-S12 tokens", () => {
  const halted = evaluateHaltGate({ discoveryPaths: [], archetype: "BREAKOUT", halted: true });
  assert.deepEqual(blockedByFromSwingGates([halted]), ["gate:G-S12:halted"]);
  const stale = evaluateHaltGate({ discoveryPaths: [], archetype: "BREAKOUT", haltFeedStale: true });
  assert.deepEqual(blockedByFromSwingGates([stale]), ["gate:G-S12:halt_feed_stale"]);
});

test("failingSwingCommitGates: empty when enforceConfluence off", () => {
  const fails = failingSwingCommitGates(
    { discoveryPaths: ["FLOW"], archetype: "BREAKOUT" },
    { enforceConfluence: false },
  );
  assert.deepEqual(fails, []);
});

test("blockedByFromSwingGates: maps G-S6 to gate token", () => {
  const v = evaluateConfluenceGate({ discoveryPaths: ["FLOW"], archetype: "BREAKOUT" });
  assert.deepEqual(blockedByFromSwingGates([v]), ["gate:G-S6:confluence"]);
});

test("evaluateQuoteStaleGate: blocks stale; passes unknown age", () => {
  const stale = evaluateQuoteStaleGate({
    discoveryPaths: [],
    archetype: "BREAKOUT",
    quoteAgeMs: SWING_QUOTE_MAX_AGE_MS + 1,
  });
  assert.equal(stale.pass, false);
  assert.deepEqual(blockedByFromSwingGates([stale]), ["gate:quote_stale"]);
  const unknown = evaluateQuoteStaleGate({ discoveryPaths: [], archetype: "BREAKOUT", quoteAgeMs: null });
  assert.equal(unknown.pass, true);
});

test("evaluateDailyBarGate: blocks when dailyBarComplete is false", () => {
  const blocked = evaluateDailyBarGate({ discoveryPaths: [], archetype: "BREAKOUT", dailyBarComplete: false });
  assert.equal(blocked.pass, false);
  assert.deepEqual(blockedByFromSwingGates([blocked]), ["gate:daily_bar_incomplete"]);
  const clear = evaluateDailyBarGate({ discoveryPaths: [], archetype: "BREAKOUT", dailyBarComplete: true });
  assert.equal(clear.pass, true);
});

test("failingSwingCommitGates: quote + daily bar when enforce flags on", () => {
  const fails = failingSwingCommitGates(
    { discoveryPaths: [], archetype: "BREAKOUT", quoteAgeMs: 600_000, dailyBarComplete: false },
    { enforceQuoteStale: true, enforceDailyBar: true },
  );
  assert.equal(fails.length, 2);
});
