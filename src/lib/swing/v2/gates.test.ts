import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blockedByFromSwingGates,
  evaluateEarningsGate,
  evaluateConfluenceGate,
  failingSwingCommitGates,
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
