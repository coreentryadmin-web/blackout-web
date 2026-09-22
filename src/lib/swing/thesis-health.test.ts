import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { calibratedThesisPillars, computeSwingThesisHealth, thesisHealthUncalibrated } from "./thesis-health.ts";

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
      // regime must also be wired (real, non-"unread" value) for this to be a genuine
      // all-commit-inputs-wired case — 2026-09-22 fix: an omitted regime falls back to
      // regimeScore()'s "unread" default, which is now itself a recognized uncalibrated
      // sentinel (see UNCALIBRATED_PILLAR_LABELS), so leaving it out here would no longer
      // test what this test's name claims.
      regime: "momentum long",
      computedAtEt: "14:00 ET",
    });
    assert.ok(h);
    assert.equal(thesisHealthUncalibrated(h), false);
  });

  test("calibratedThesisPillars: keeps real persistence/entry-geometry pillars, drops only the honestly-empty flow_corroboration one (2026-09-21 live gap, AAPL position 40 SECTOR_ROTATION)", () => {
    // setupState/entryStatus are BOTH real, live-derived reads (matches how adapters.ts's
    // liveSetupState/liveEntryStatus derive them for a committed position with liveSpot +
    // entryTriggerUnderlyingPx) — only signalKinds is genuinely empty (this archetype's
    // discovery path never carries a Tier-0 FLOW/STRUCTURE/CATALYST screen path, or G-S6
    // confluence wasn't enforced at commit). thesisHealthUncalibrated() correctly still flags
    // the WHOLE payload uncalibrated (the flow_corroboration pillar IS a generic default), but
    // calibratedThesisPillars must not throw the two genuinely-real pillars out with it.
    const h = computeSwingThesisHealth({
      direction: "LONG",
      status: "OPEN",
      setupState: "TRIGGERED",
      entryStatus: "AT_TRIGGER",
      signalKinds: [],
      regime: "SECTOR_ROTATION",
      dte: 9,
      computedAtEt: "14:00 ET",
    });
    assert.ok(h);
    assert.equal(thesisHealthUncalibrated(h), true, "flow_corroboration alone must still trip the aggregate-withhold guard");
    const kept = calibratedThesisPillars(h);
    const keptIds = kept.map((p) => p.id).sort();
    assert.ok(keptIds.includes("structure"), "persistence (real: triggered) must survive the filter");
    assert.ok(keptIds.includes("momentum"), "entry_geometry (real: at trigger) must survive the filter");
    assert.ok(!keptIds.includes("flow"), "flow_corroboration (default: no signals) must still be dropped");
    const persistence = kept.find((p) => p.id === "structure");
    assert.equal(persistence?.currentLabel, "triggered");
  });

  test("calibratedThesisPillars: drops the regime pillar when it's regimeScore()'s own \"unread\" default, not just the Banger-ledger sentinel (live repro 2026-09-22, AAPL position 40)", () => {
    // regimeScore() falls back to the label "unread" when BOTH `regime` is null/undefined AND
    // there's no factors[0] to borrow a label from — a genuine, native "nothing to read" default,
    // distinct from (and independently reachable from) the Banger-ledger stamped-constant sentinel.
    // Before UNCALIBRATED_PILLAR_LABELS became an array-per-pillar map, `regime`'s one slot was
    // occupied by the Banger sentinel and "unread" was never recognized by either function — live
    // repro: AAPL position 40 (a NATIVE position, setupState/entryStatus/signalKinds all real)
    // rendered "**Regime fit** — unread (Δ +0.0 pts)" as if calibrated, right next to the
    // aggregate-withheld note (which fired only because of flow_corroboration in that live case).
    // Every other input here is real/wired so this isolates the regime pillar specifically.
    const h = computeSwingThesisHealth({
      direction: "LONG",
      status: "OPEN",
      setupState: "TRIGGERED",
      entryStatus: "AT_TRIGGER",
      signalKinds: ["FLOW"],
      dte: 9,
      subLane: "STANDARD",
      computedAtEt: "14:00 ET",
      // regime and factors both omitted -> regimeScore() falls back to label "unread".
    });
    assert.ok(h);
    const regimePillar = h!.pillars.find((p) => p.id === "market");
    assert.equal(regimePillar?.currentLabel, "unread", "test setup must actually hit the unread default");
    assert.equal(thesisHealthUncalibrated(h), true, "an unread regime pillar must still trip the aggregate-withhold guard");
    const kept = calibratedThesisPillars(h);
    const keptIds = kept.map((p) => p.id);
    assert.ok(!keptIds.includes("market"), "regime (unread default) must be dropped, not rendered as calibrated");
    assert.ok(keptIds.includes("structure"), "persistence (real: triggered) must still survive the filter");
    assert.ok(keptIds.includes("momentum"), "entry_geometry (real: at trigger) must still survive the filter");
    assert.ok(keptIds.includes("flow"), "flow_corroboration (real: FLOW signal) must still survive the filter");
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

  // Live repro 2026-09-14 (CLSK): theta_budget's commit/current SCORES genuinely diverge from a
  // single `dte` read (time decay), but commitLabel used to be copied from the current-state
  // label — "DTE 4 migrate" on both sides — so the pillar-fade narrative rendered "drifted DTE 4
  // migrate -> DTE 4 migrate", a no-op-looking transition despite the score crossing into "faded".
  test("theta_budget pillar in the migrate band: commitLabel differs from currentLabel (not a no-op drift)", () => {
    const h = computeSwingThesisHealth({
      direction: "LONG",
      status: "OPEN",
      setupState: "TRIGGERED",
      entryStatus: "AT_TRIGGER",
      dte: 4,
      subLane: "STANDARD",
      computedAtEt: "14:00 ET",
    });
    assert.ok(h);
    const theta = h!.pillars.find((p) => p.label === "Theta budget");
    assert.ok(theta);
    assert.equal(theta!.status, "faded");
    assert.equal(theta!.currentLabel, "DTE 4 migrate");
    assert.notEqual(
      theta!.commitLabel,
      theta!.currentLabel,
      "commit and current labels must differ once the score has genuinely faded",
    );
  });

  test("theta_budget pillar in the cliff band: commitLabel differs from currentLabel", () => {
    const h = computeSwingThesisHealth({
      direction: "LONG",
      status: "OPEN",
      setupState: "TRIGGERED",
      entryStatus: "AT_TRIGGER",
      dte: 1,
      subLane: "STANDARD",
      computedAtEt: "14:00 ET",
    });
    assert.ok(h);
    const theta = h!.pillars.find((p) => p.label === "Theta budget");
    assert.ok(theta);
    assert.equal(theta!.status, "lost");
    assert.equal(theta!.currentLabel, "DTE 1 cliff");
    assert.notEqual(theta!.commitLabel, theta!.currentLabel);
  });

  test("theta_budget pillar with ample runway: commit and current labels legitimately match (no fade to explain)", () => {
    const h = computeSwingThesisHealth({
      direction: "LONG",
      status: "OPEN",
      setupState: "TRIGGERED",
      entryStatus: "AT_TRIGGER",
      dte: 12,
      subLane: "STANDARD",
      computedAtEt: "14:00 ET",
    });
    assert.ok(h);
    const theta = h!.pillars.find((p) => p.label === "Theta budget");
    assert.ok(theta);
    assert.equal(theta!.status, "intact");
    assert.equal(theta!.commitLabel, theta!.currentLabel);
  });

  describe("Banger-origin ledger rows must not render a fabricated-precision pillar breakdown (found 2026-09-15)", () => {
    // Mirrors exactly what horizonPlayFromBangerPosition (banger-lane-merge.ts) stamps on EVERY
    // banger_positions row: setupState/entryStatus/regime are fixed constants, signalKinds is
    // always exactly ["BANGER"] (single mechanical price trigger, no real multi-pillar dossier).
    const bangerLedgerInput = {
      direction: "LONG" as const,
      status: "OPEN" as const,
      setupState: "TRIGGERED" as const,
      entryStatus: "AT_TRIGGER" as const,
      signalKinds: ["BANGER"],
      regime: "BREAKOUT · BANGER",
      dte: 3,
      subLane: "STANDARD",
      computedAtEt: "14:00 ET",
    };

    test("thesisHealthUncalibrated: true for the stamped Banger-ledger fingerprint", () => {
      const h = computeSwingThesisHealth(bangerLedgerInput);
      assert.ok(h);
      assert.equal(thesisHealthUncalibrated(h), true);
    });

    test("two different tickers at the same DTE produce byte-identical pillar output — proves the % is not per-position (the bug), independent of the uncalibrated flag fixing its display", () => {
      // computeSwingThesisHealth itself is a pure function of these inputs — it has no ticker/price
      // fields to differ on. This is what makes the payload "fabricated precision" rather than a
      // real per-position read: ALLT/CGEM/DRIP (different tickers, different prices, all DTE=3)
      // rendered exactly the same 70% health and pillar text live. The fix is NOT to make this
      // function ticker-aware — it's to correctly flag the output as uncalibrated so callers omit
      // it, which the test above proves.
      const a = computeSwingThesisHealth(bangerLedgerInput);
      const b = computeSwingThesisHealth({ ...bangerLedgerInput });
      assert.ok(a && b);
      assert.equal(a!.health, b!.health);
      assert.deepEqual(a!.pillars, b!.pillars);
    });

    test("does NOT false-positive on a NATIVE swing position whose sole discovery signal happens to be BANGER", () => {
      // discovery.ts's SwingDiscoveryPath includes "BANGER" as one of several real Tier-0 origins a
      // NATIVE swing_positions row can be discovered through (discovery.test.ts: JOBY -> ["BANGER"])
      // while still running the real scoring/setupState/entryStatus/regime engine — this is NOT the
      // stamped banger_positions ledger merge path. signalKinds=["BANGER"] alone must not be the
      // detection signal (that would wrongly suppress real thesis health for this case) — only the
      // regime string "BREAKOUT · BANGER", written exclusively by banger-lane-merge.ts, may.
      const h = computeSwingThesisHealth({
        direction: "LONG",
        status: "OPEN",
        setupState: "TRIGGERED",
        entryStatus: "AT_TRIGGER",
        signalKinds: ["BANGER"],
        regime: "momentum long", // a real regime read, NOT the stamped "BREAKOUT · BANGER" constant
        dte: 12,
        subLane: "STANDARD",
        computedAtEt: "14:00 ET",
      });
      assert.ok(h);
      assert.equal(thesisHealthUncalibrated(h), false);
    });

    test("calibratedThesisPillars: drops the fabricated regime pillar too, not just flow/persistence/entry-geometry defaults (live repro 2026-09-22, NMAX position 1264)", () => {
      // Before this fix, UNCALIBRATED_PILLAR_LABELS (and therefore UNCALIBRATED_MAPPED_LABELS,
      // which calibratedThesisPillars filters against) only carried persistence/entry_geometry/
      // flow_corroboration defaults — thesisHealthUncalibrated() had a SEPARATE hardcoded check
      // for the Banger-ledger regime sentinel that correctly withheld the aggregate score, but
      // calibratedThesisPillars() never saw it, so the "Regime fit — BREAKOUT · BANGER (Δ +0.0
      // pts)" line rendered in Ask Largo's play-brief as if it were a real, calibrated read —
      // live-verified on NMAX (positionId 1264) via GET /api/market/swing/play-brief. This is the
      // exact C6 violation this file's own header comment on thesisHealthUncalibrated names: a
      // fabricated value must be OMITTED, not just partially withheld.
      const h = computeSwingThesisHealth(bangerLedgerInput);
      assert.ok(h);
      const kept = calibratedThesisPillars(h);
      const keptIds = kept.map((p) => p.id);
      assert.ok(!keptIds.includes("market"), "regime (stamped Banger-ledger sentinel) must be dropped, not rendered as calibrated");
    });

    test("calibratedThesisPillars: drops EVERY pillar for a Banger-origin row, not just regime (live repro 2026-09-22, AMDL positionId 1210)", () => {
      // setupState/entryStatus/signalKinds are the SAME stamped constants on every Banger row (see
      // horizonPlayFromBangerPosition's header), so entry_geometry ("at trigger") and
      // flow_corroboration ("BANGER") are just as byte-identical-across-every-ticker fabricated as
      // regime is -- neither string happens to match the generic-default sentinels ("n/a"/"no
      // signals"), which only fire on a MISSING input, not a populated-but-fake one, so the general
      // per-pillar filter used to keep both. Live repro: AMDL (positionId 1210) rendered "Entry
      // geometry — at trigger" and "Signal stack — BANGER" in the Thesis health section as if
      // calibrated, alongside the already-fixed-away regime line.
      const h = computeSwingThesisHealth(bangerLedgerInput);
      assert.ok(h);
      const kept = calibratedThesisPillars(h);
      assert.deepEqual(kept, [], "a Banger-origin row has no real per-position dossier at all -- every pillar must be dropped, not just regime");
    });

    test("calibratedThesisPillars: still drops every pillar for a Banger-origin row even when a live manage action gives persistence a real-looking label", () => {
      // The trickiest case: degradeFromManage() overwrites persistence's currentLabel to
      // "scale-out"/"exit signal" off a REAL, live manageAction (TAKE_PARTIAL/EXIT/etc) -- not a
      // stamped constant -- so persistence alone might look like genuine live data. But the
      // UNDERLYING setup this manage action is degrading (setupState/entryStatus/signalKinds) is
      // still 100% fabricated for a Banger row, and the position's regime sentinel already proves
      // there is no real dossier to anchor a "persistence" read to at all. Must still drop ALL
      // pillars, including persistence.
      const h = computeSwingThesisHealth({ ...bangerLedgerInput, manageAction: "TAKE_PARTIAL" });
      assert.ok(h);
      const persistencePillar = h!.pillars.find((p) => p.id === "structure");
      assert.equal(persistencePillar?.currentLabel, "scale-out", "sanity: manage action did degrade persistence's label");
      const kept = calibratedThesisPillars(h);
      assert.deepEqual(kept, [], "persistence's manage-driven label must not exempt a Banger-origin row from the full withhold");
    });
  });
});
