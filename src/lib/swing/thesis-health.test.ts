import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { computeSwingThesisHealth } from "./thesis-health.ts";

describe("computeSwingThesisHealth", () => {
  test("returns null for WATCH rows", () => {
    assert.equal(
      computeSwingThesisHealth({
        direction: "LONG",
        status: "WATCH",
        computedAtEt: "14:00 ET",
      }),
      null,
    );
  });

  test("working OPEN row returns health payload with swing pillars", () => {
    const h = computeSwingThesisHealth({
      direction: "LONG",
      status: "OPEN",
      setupState: "TRIGGERED",
      entryStatus: "AT_TRIGGER",
      signalKinds: ["FLOW", "VECTOR"],
      regime: "momentum long",
      dte: 12,
      subLane: "STANDARD",
      computedAtEt: "14:00 ET",
    });
    assert.ok(h);
    assert.ok(h!.health >= 50);
    assert.equal(h!.pillars.length, 5);
    assert.equal(h!.thesisBreakLevel, "intact");
  });

  test("EXIT manage action degrades persistence pillar", () => {
    const h = computeSwingThesisHealth({
      direction: "LONG",
      status: "OPEN",
      setupState: "TRIGGERED",
      manageAction: "EXIT",
      computedAtEt: "14:00 ET",
    });
    assert.ok(h);
    const persistence = h!.pillars.find((p) => p.label === "Persistence");
    assert.equal(persistence?.status, "lost");
  });
});
