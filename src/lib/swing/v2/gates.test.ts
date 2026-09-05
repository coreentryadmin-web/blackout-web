import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blockedByFromSwingGates,
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
