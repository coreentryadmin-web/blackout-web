import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { computeSwingThesisHealth, thesisHealthUncalibrated } from "./thesis-health.ts";

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

  test("EXIT manage action's contributionPts/deltaPts reflect the degraded score, not the pre-degrade one (2026-09-13 fix)", () => {
    // Bug: contributionPts/deltaPts used to be computed BEFORE degradeFromManage mutated the
    // persistence pillar's currentScore to 0 on EXIT, so a pillar labeled "lost"/"exit signal"
    // could still display its OLD, undegraded point values — internally inconsistent with its
    // own status/currentLabel on the same row.
    const withoutExit = computeSwingThesisHealth({
      direction: "LONG",
      status: "OPEN",
      setupState: "TRIGGERED",
      computedAtEt: "14:00 ET",
    });
    const withExit = computeSwingThesisHealth({
      direction: "LONG",
      status: "OPEN",
      setupState: "TRIGGERED",
      manageAction: "EXIT",
      computedAtEt: "14:00 ET",
    });
    assert.ok(withoutExit && withExit);
    const before = withoutExit!.pillars.find((p) => p.label === "Persistence")!;
    const after = withExit!.pillars.find((p) => p.label === "Persistence")!;
    assert.equal(after.status, "lost");
    assert.equal(after.currentScore, 0);
    // currentScore is 0 post-degrade, so contributionPts must be exactly 0 — not the pre-degrade value.
    assert.equal(after.contributionPts, 0);
    assert.notEqual(after.contributionPts, before.contributionPts);
    // deltaPts must reflect (0 - commitScore) * weight, i.e. the full drop to zero, not a smaller
    // pre-degrade delta.
    const expectedDeltaPts = Math.round(after.weight * (0 - after.commitScore) * 100);
    assert.equal(after.deltaPts, expectedDeltaPts);
    assert.ok(after.deltaPts <= before.deltaPts, "post-EXIT delta must be at least as negative as the undegraded one");
  });

  test("TAKE_PARTIAL manage action's contributionPts/deltaPts reflect the capped score", () => {
    const h = computeSwingThesisHealth({
      direction: "LONG",
      status: "OPEN",
      setupState: "TRIGGERED",
      manageAction: "TAKE_PARTIAL",
      computedAtEt: "14:00 ET",
    });
    assert.ok(h);
    const persistence = h!.pillars.find((p) => p.label === "Persistence")!;
    assert.equal(persistence.status, "faded");
    assert.ok(persistence.currentScore <= 0.55 + 1e-9);
    const expectedContributionPts = Math.round(persistence.weight * persistence.currentScore * 100);
    assert.equal(persistence.contributionPts, expectedContributionPts);
    const expectedDeltaPts = Math.round(persistence.weight * (persistence.currentScore - persistence.commitScore) * 100);
    assert.equal(persistence.deltaPts, expectedDeltaPts);
  });

  test("thesisHealthUncalibrated: true when default pillar labels present", () => {
    const h = computeSwingThesisHealth({
      direction: "LONG",
      status: "OPEN",
      computedAtEt: "14:00 ET",
    });
    assert.ok(h);
    assert.equal(thesisHealthUncalibrated(h), true);
  });

  test("thesisHealthUncalibrated: false when commit inputs wired", () => {
    const h = computeSwingThesisHealth({
      direction: "LONG",
      status: "OPEN",
      setupState: "TRIGGERED",
      entryStatus: "AT_TRIGGER",
      signalKinds: ["FLOW", "VECTOR"],
      computedAtEt: "14:00 ET",
    });
    assert.ok(h);
    assert.equal(thesisHealthUncalibrated(h), false);
  });

  test("default persistence pillar stays intact at float boundary (not falsely faded)", () => {
    const h = computeSwingThesisHealth({
      direction: "LONG",
      status: "OPEN",
      computedAtEt: "14:00 ET",
    });
    assert.ok(h);
    const persistence = h!.pillars.find((p) => p.label === "Persistence");
    assert.equal(persistence?.status, "intact", "unknown setupState defaults must not read as faded");
  });
});
