import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  calibratedThesisPillars,
  computeSwingThesisHealth,
  thesisHealthUncalibrated,
  thesisHealthUnchangedSinceCommit,
  uncalibratedThesisPillars,
} from "./thesis-health.ts";
import type { SwingEntryState } from "./taxonomy.ts";

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

  // BUG FIX (2026-10-21, Ask Largo standing mandate, live repro CRWV:63): signalScore()'s label
  // used to silently drop any signal kind past the first 3, with no "+N more" disclosure, so a
  // 4-kind setup's "Signal stack" pillar disagreed with the same envelope's "Why this setup"
  // section (which lists every kind). Only the LABEL was lossy — the blended score already
  // accounts for every kind via hasFlow/hasVector/hasBanger/count>=3.
  test("signal stack label discloses truncation past 3 kinds instead of silently dropping one", () => {
    const h = computeSwingThesisHealth({
      direction: "LONG",
      status: "OPEN",
      setupState: "TRIGGERED",
      entryStatus: "AT_TRIGGER",
      signalKinds: ["FLOW", "STRUCTURE", "CATALYST", "BANGER"],
      regime: "momentum long",
      dte: 12,
      subLane: "STANDARD",
      computedAtEt: "14:00 ET",
    });
    assert.ok(h);
    const flow = h!.pillars.find((p) => p.id === "flow");
    assert.ok(flow, "flow_corroboration pillar must be present");
    assert.match(
      flow!.currentLabel,
      /\+1 more$/,
      `label must disclose the 1 hidden kind instead of silently dropping it — got "${flow!.currentLabel}"`,
    );
  });

  test("signal stack label is unchanged (no '+N more') when 3 or fewer kinds are present", () => {
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
    const flow = h!.pillars.find((p) => p.id === "flow");
    assert.ok(flow);
    assert.equal(flow!.currentLabel, "FLOW+VECTOR");
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

  test("uncalibratedThesisPillars: returns exactly the regime pillar for the live MRVL positionId 70 repro shape (2026-11-09)", () => {
    // Identical setup to the "unread" regime test directly above — persistence/entry_geometry/
    // flow_corroboration all real, only regime defaults to "unread". This is the exact shape
    // play-brief-absence.ts's collectBriefUnavailableSources needs to name the real missing
    // pillar(s) instead of a generic "setup/entry/signal" guess.
    const h = computeSwingThesisHealth({
      direction: "LONG",
      status: "OPEN",
      setupState: "TRIGGERED",
      entryStatus: "AT_TRIGGER",
      signalKinds: ["FLOW"],
      dte: 9,
      subLane: "STANDARD",
      computedAtEt: "14:00 ET",
    });
    assert.ok(h);
    const missing = uncalibratedThesisPillars(h);
    assert.deepEqual(missing.map((p) => p.id), ["market"], "only the regime pillar should be reported missing");
    assert.equal(missing[0]?.label, "Regime fit");
  });

  test("uncalibratedThesisPillars: returns every pillar for a Banger-origin row (all-or-nothing carve-out)", () => {
    const h = computeSwingThesisHealth({
      direction: "LONG",
      status: "OPEN",
      setupState: "TRIGGERED",
      entryStatus: "AT_TRIGGER",
      signalKinds: ["BANGER"],
      regime: "BREAKOUT · BANGER", // the Banger-ledger stamped-constant sentinel (BANGER_LEDGER_REGIME_LABEL)
      dte: 9,
      computedAtEt: "14:00 ET",
    });
    assert.ok(h);
    const missing = uncalibratedThesisPillars(h);
    assert.equal(missing.length, h!.pillars.length, "every pillar must be reported missing for a Banger-origin row");
  });

  test("uncalibratedThesisPillars: returns an empty array when every pillar is genuinely calibrated", () => {
    const h = computeSwingThesisHealth({
      direction: "LONG",
      status: "OPEN",
      setupState: "TRIGGERED",
      entryStatus: "AT_TRIGGER",
      signalKinds: ["FLOW", "VECTOR"],
      regime: "momentum long",
      dte: 9,
      computedAtEt: "14:00 ET",
    });
    assert.ok(h);
    assert.deepEqual(uncalibratedThesisPillars(h), []);
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

  // BUG FIX (2026-10-26, Ask Largo x Night Hawk Swings standing mandate): regimeScore() used to
  // take `factors?.[0]` — the HIGHEST-POINT factor in the array (contributionsToFactors in
  // swing-pillars.ts sorts descending before this ever sees it) — and treat it as if it were the
  // "Regime" pillar's own read whenever `regime` itself was null. Live repro: a position with
  // `regime: null` and a real `{label:"Regime", points:10.4}` entry present in `factors[]` (never
  // actually consulted) instead produced a fabricated-looking calibrated "Regime fit" read sourced
  // from whichever OTHER pillar happened to score highest (e.g. "Structure") — a green, partially-
  // filled bar showing the wrong pillar's label under the "Regime fit" heading.
  describe("regimeScore() consults the factor actually labeled \"Regime\", never factors[0] by array position", () => {
    test("regime:null, a real \"Regime\" factor exists but is NOT the highest-point entry — must use it, not the higher-scoring pillar's label", () => {
      const h = computeSwingThesisHealth({
        direction: "LONG",
        status: "OPEN",
        setupState: "TRIGGERED",
        entryStatus: "AT_TRIGGER",
        signalKinds: ["FLOW"],
        regime: null,
        factors: [
          { label: "Structure", points: 20.5 },
          { label: "Regime", points: 10.4 },
        ],
        dte: 9,
        subLane: "STANDARD",
        computedAtEt: "14:00 ET",
      });
      assert.ok(h);
      const regimePillar = h!.pillars.find((p) => p.id === "market");
      assert.ok(regimePillar);
      assert.notEqual(
        regimePillar!.currentLabel,
        "Structure",
        "must never borrow a different pillar's label just because it scored higher",
      );
      assert.equal(
        regimePillar!.currentLabel,
        "Regime",
        "the real factor actually labeled \"Regime\" must be consulted even though it isn't factors[0]",
      );
    });

    test("regime:null, factors[] present but NONE labeled \"Regime\" — must fall through to the honest uncalibrated \"unread\" state", () => {
      const h = computeSwingThesisHealth({
        direction: "LONG",
        status: "OPEN",
        setupState: "TRIGGERED",
        entryStatus: "AT_TRIGGER",
        signalKinds: ["FLOW"],
        regime: null,
        factors: [
          { label: "Structure", points: 25.5 },
          { label: "Flow", points: 15.2 },
        ],
        dte: 9,
        subLane: "STANDARD",
        computedAtEt: "14:00 ET",
      });
      assert.ok(h);
      const regimePillar = h!.pillars.find((p) => p.id === "market");
      assert.ok(regimePillar);
      assert.notEqual(
        regimePillar!.currentLabel,
        "Structure",
        "must never substitute the top-scoring pillar's label when no real \"Regime\" factor exists",
      );
      assert.equal(
        regimePillar!.currentLabel,
        "unread",
        "with no real \"Regime\" factor present, the honest uncalibrated default must render instead",
      );
      assert.ok(
        thesisHealthUncalibrated(h),
        "an \"unread\" regime pillar must trip the aggregate-withhold guard",
      );
    });

    // BUG FIX (2026-11-09, Ask Largo x Night Hawk Swings standing mandate, live repro MRVL
    // positionId 70): the #6931 fix above correctly stopped borrowing a DIFFERENT pillar's label
    // (e.g. "Structure") when `regime` is null, by consulting the factor actually labeled
    // "Regime" instead of `factors[0]`. But it left a new gap: when that "Regime" factor DOES
    // exist (the common case whenever the REGIME pillar scored any points at commit), the
    // fallback label becomes the bare, tautological word "Regime" itself -- just the category
    // name, with zero descriptive content -- and `UNCALIBRATED_PILLAR_LABELS.regime` was never
    // updated to recognize this new possible fallback value alongside the pre-existing
    // Banger-sentinel/"unread" cases. So this bare-"Regime" label slipped through both
    // `thesisHealthUncalibrated()` and `calibratedThesisPillars()` as if it were a real,
    // calibrated per-position regime read. Live evidence: GET
    // /api/market/nighthawk/horizons?view=swings showed MRVL (positionId 70) with top-level
    // `"regime": null` and a `factors[]` entry `{"label":"Regime","points":8.3}`; the play-brief
    // then rendered a shown (not withheld) "51% · Degraded" aggregate with a self-referential
    // "Regime fit -- Regime" line.
    test("regime:null, the real \"Regime\" factor's label IS the bare word \"Regime\" -- must be recognized as uncalibrated, not rendered as a real read (live repro MRVL positionId 70)", () => {
      const h = computeSwingThesisHealth({
        direction: "LONG",
        status: "OPEN",
        setupState: "TRIGGERED",
        entryStatus: "AT_TRIGGER",
        signalKinds: ["FLOW"],
        regime: null,
        factors: [{ label: "Regime", points: 8.3 }],
        dte: 9,
        subLane: "STANDARD",
        computedAtEt: "14:00 ET",
      });
      assert.ok(h);
      const regimePillar = h!.pillars.find((p) => p.id === "market");
      assert.ok(regimePillar);
      assert.equal(
        regimePillar!.currentLabel,
        "Regime",
        "test setup must actually hit the bare-\"Regime\" fallback label",
      );
      assert.ok(
        thesisHealthUncalibrated(h),
        "a bare-\"Regime\" fallback label must trip the aggregate-withhold guard, same as \"unread\"",
      );
      const kept = calibratedThesisPillars(h);
      const keptIds = kept.map((p) => p.id);
      assert.ok(
        !keptIds.includes("market"),
        "regime (bare-\"Regime\" fallback default) must be dropped, not rendered as a calibrated read",
      );
      assert.ok(keptIds.includes("structure"), "persistence (real: triggered) must still survive the filter");
      assert.ok(keptIds.includes("momentum"), "entry_geometry (real: at trigger) must still survive the filter");
      assert.ok(keptIds.includes("flow"), "flow_corroboration (real: FLOW signal) must still survive the filter");
    });
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

  // Live repro 2026-10-14, Ask Largo standing mandate, SWING:INTC:56: peak +15.3% -> trough -36.6%,
  // currently -36.5% (3.5pts short of the -40 capital-backstop trigger, thesisBreak still "intact" so
  // persistence never diverges either) -- none of `moves`'s own triggers fire, so the aggregate
  // headline (`thesisHealthSection`, play-brief.ts) read "unchanged since commit" for a position that
  // had just round-tripped through one of its most volatile days, directly contradicting the SAME
  // brief's "Trade manager read" section one scroll down. `roundTripSinceCommit` is this payload's own
  // independent signal for that exact case -- see its doc comment (zerodte/thesis-health.ts) for the
  // full structural account of why `moves` alone can never catch it.
  describe("roundTripSinceCommit", () => {
    test("true when pnlPct is negative despite a real positive peak (round-tripped past breakeven)", () => {
      const h = computeSwingThesisHealth({
        direction: "LONG",
        status: "HOLD",
        setupState: "TRIGGERED",
        entryStatus: "AT_TRIGGER",
        signalKinds: ["FLOW", "VECTOR", "CATALYST"],
        thesisBreak: { level: "intact" },
        pnlPct: -36.5,
        peak: 15.3,
        dte: 9,
        subLane: "STANDARD",
        computedAtEt: "14:00 ET",
      });
      assert.ok(h);
      assert.equal(h!.roundTripSinceCommit, true);
      // Sanity anchor on the exact failure mode: moves stays at its "unchanged" fallback even
      // though a real round-trip happened, because none of its own triggers (pillar
      // faded/lost, a non-HOLD manage action, or pnlPct <= -40) fire for this input -- that gap
      // is precisely why a separate, explicit signal was needed.
      assert.deepEqual(h!.moves, ["All swing pillars unchanged since commit."]);
    });

    test("false for a genuinely flat position (no peak ever recorded)", () => {
      const h = computeSwingThesisHealth({
        direction: "LONG",
        status: "HOLD",
        setupState: "TRIGGERED",
        entryStatus: "AT_TRIGGER",
        pnlPct: -5,
        peak: null,
        computedAtEt: "14:00 ET",
      });
      assert.ok(h);
      assert.equal(h!.roundTripSinceCommit, false);
    });

    test("false when currently favorable (peak and pnlPct both positive -- no round trip yet)", () => {
      const h = computeSwingThesisHealth({
        direction: "LONG",
        status: "HOLD",
        setupState: "TRIGGERED",
        entryStatus: "AT_TRIGGER",
        pnlPct: 9.1,
        peak: 9.1,
        computedAtEt: "14:00 ET",
      });
      assert.ok(h);
      assert.equal(h!.roundTripSinceCommit, false);
    });
  });

  // BUG FIX (Ask Largo standing mandate, 2026-10-16, Bug 4 of the standing Ask Largo x Night Hawk
  // Swings mandate -- live GOOG repro, positionId 59): `roundTripSinceCommit` above only covers a
  // round-trip into a NEGATIVE pnlPct. A position that gives back a material fraction of its peak
  // while STAYING net-positive (live GOOG: peak +9.2%, current +1.4%, capturePct ~15.2 -- well
  // under the 75% floor `play-brief-narrative.ts`'s own giveback narrative uses) printed the exact
  // same "unchanged since commit" contradiction, uncaught by `roundTripSinceCommit`'s narrower
  // `exitPnlPct < 0` test. `materialGivebackSinceCommit` closes this using the IDENTICAL
  // `capturePct < 75` threshold, reused verbatim rather than a new, independently-tuned number.
  describe("materialGivebackSinceCommit", () => {
    test("true when a round-trip already happened (strict superset of roundTripSinceCommit)", () => {
      const h = computeSwingThesisHealth({
        direction: "LONG",
        status: "HOLD",
        setupState: "TRIGGERED",
        entryStatus: "AT_TRIGGER",
        thesisBreak: { level: "intact" },
        pnlPct: -36.5,
        peak: 15.3,
        computedAtEt: "14:00 ET",
      });
      assert.ok(h);
      assert.equal(h!.roundTripSinceCommit, true);
      assert.equal(h!.materialGivebackSinceCommit, true);
    });

    test("true for a material giveback while STILL net-positive (live GOOG shape: peak +9.2%, current +1.4%)", () => {
      const h = computeSwingThesisHealth({
        direction: "LONG",
        status: "OPEN",
        setupState: "TRIGGERED",
        entryStatus: "AT_TRIGGER",
        thesisBreak: { level: "intact" },
        pnlPct: 1.4,
        peak: 9.2,
        computedAtEt: "14:00 ET",
      });
      assert.ok(h);
      assert.equal(h!.roundTripSinceCommit, false, "pnlPct is still positive -- this is NOT a round-trip");
      assert.equal(
        h!.materialGivebackSinceCommit,
        true,
        "capturePct = 1.4/9.2*100 ~= 15.2, well under the 75 floor -- a material giveback",
      );
    });

    test("false for a shallow, immaterial giveback (capturePct still at/above the 75 floor)", () => {
      const h = computeSwingThesisHealth({
        direction: "LONG",
        status: "OPEN",
        setupState: "TRIGGERED",
        entryStatus: "AT_TRIGGER",
        thesisBreak: { level: "intact" },
        pnlPct: 18,
        peak: 20,
        computedAtEt: "14:00 ET",
      });
      assert.ok(h);
      assert.equal(h!.roundTripSinceCommit, false);
      assert.equal(
        h!.materialGivebackSinceCommit,
        false,
        "capturePct = 18/20*100 = 90 -- well over the 75 floor, not a material giveback",
      );
    });

    test("false for a genuinely flat position (no peak ever recorded)", () => {
      const h = computeSwingThesisHealth({
        direction: "LONG",
        status: "HOLD",
        setupState: "TRIGGERED",
        entryStatus: "AT_TRIGGER",
        pnlPct: -5,
        peak: null,
        computedAtEt: "14:00 ET",
      });
      assert.ok(h);
      assert.equal(h!.materialGivebackSinceCommit, false);
    });
  });

  // BUG FIX (Ask Largo standing mandate, 2026-10-22): the shared predicate behind the 2026-10-07
  // play-brief.ts fix — pulled out so play-brief-narrative-coaching.ts and play-brief-intel.ts can
  // apply the identical "has this actually moved since commit" check their own rungLabel/advisory
  // renders were missing (live-shape repro: a position whose low health reflects imperfect ENTRY
  // geometry, never a decline, rendering "Weakening"/"Degraded" + "tighten risk" advice as if a
  // real deterioration had occurred).
  describe("thesisHealthUnchangedSinceCommit", () => {
    test("true when no pillar moved and no giveback occurred (the default commit==current case)", () => {
      const h = computeSwingThesisHealth({
        direction: "LONG",
        status: "OPEN",
        setupState: "TRIGGERED",
        entryStatus: "AT_TRIGGER",
        signalKinds: ["FLOW"],
        regime: "momentum long",
        dte: 12,
        subLane: "STANDARD",
        computedAtEt: "14:00 ET",
      });
      assert.ok(h);
      assert.equal(h!.moves[0], "All swing pillars unchanged since commit.");
      assert.equal(thesisHealthUnchangedSinceCommit(h!), true);
    });

    test("false when moves reports a real pillar fade, even phrased as 'unchanged' never applying", () => {
      const h = computeSwingThesisHealth({
        direction: "LONG",
        status: "OPEN",
        setupState: "TRIGGERED",
        entryStatus: "AT_TRIGGER",
        manageAction: "STOP_OUT",
        signalKinds: ["FLOW"],
        regime: "momentum long",
        dte: 12,
        subLane: "STANDARD",
        computedAtEt: "14:00 ET",
      });
      assert.ok(h);
      assert.notEqual(h!.moves[0], "All swing pillars unchanged since commit.");
      assert.equal(thesisHealthUnchangedSinceCommit(h!), false);
    });

    test("false when moves is the fallback sentinel BUT a material giveback has still occurred (round-trip hidden from the 4 non-theta pillars)", () => {
      const h = computeSwingThesisHealth({
        direction: "LONG",
        status: "OPEN",
        setupState: "TRIGGERED",
        entryStatus: "AT_TRIGGER",
        thesisBreak: { level: "intact" },
        dte: 12,
        subLane: "STANDARD",
        pnlPct: 1.4,
        peak: 9.2,
        computedAtEt: "14:00 ET",
      });
      assert.ok(h);
      assert.equal(h!.moves[0], "All swing pillars unchanged since commit.", "moves itself can't see this kind of giveback");
      assert.equal(h!.materialGivebackSinceCommit, true);
      assert.equal(
        thesisHealthUnchangedSinceCommit(h!),
        false,
        "a real giveback happened even though the other 4 pillars never flagged it -- must not read as unchanged",
      );
    });
  });

  // BUG FIX (2026-11-09, Ask Largo x Night Hawk Swings standing mandate, task #100): entryGeometryScore
  // is ONLY ever invoked here, from computeSwingThesisHealth, which itself only runs for already-
  // committed (OPEN/HOLD/TRIM) positions -- SwingEntryState's four geometric buckets are
  // direction-mirrored, so EXTENDED_CHASE always means price moved FURTHER in the position's own
  // favorable direction past its entry trigger, and PRE_TRIGGER always means price sits on the
  // WRONG side of the trigger (i.e. has reversed back through the entry level, adverse) -- once a
  // position is already committed, not before. The OLD mapping re-used the pre-entry WATCH-stage
  // score ordering unchanged (EXTENDED_CHASE worst/"chase risk", PRE_TRIGGER mid-decent/"pre-trigger"),
  // which is backwards for a committed row.
  describe("entryGeometryScore: post-entry favorability (live repros SWING:MRVL positionId 70, SWING:PLTR positionId 74)", () => {
    // `entryGeometryScore` itself is file-private -- this reads its mapping back out through the one
    // real production call site (`computeSwingThesisHealth`) instead of exporting an internal
    // implementation detail just for the test.
    const entryGeometryCurrentScore = (entryStatus: SwingEntryState): number => {
      const h = computeSwingThesisHealth({
        direction: "SHORT",
        status: "OPEN",
        setupState: "TRIGGERED",
        entryStatus,
        computedAtEt: "14:00 ET",
      });
      return h!.pillars.find((p) => p.id === "momentum")!.currentScore;
    };

    test("EXTENDED_CHASE (live MRVL shape: SHORT, price fell far past entry, livePnlPct +221.3%, the best-performing leg in the book) scores BEST, not worst, and is not labeled 'chase risk'", () => {
      const h = computeSwingThesisHealth({
        direction: "SHORT",
        status: "OPEN",
        setupState: "TRIGGERED",
        entryStatus: "EXTENDED_CHASE",
        signalKinds: ["FLOW"],
        regime: "momentum short",
        dte: 10,
        subLane: "STANDARD",
        pnlPct: 221.3,
        computedAtEt: "14:00 ET",
      });
      assert.ok(h);
      const entry = h!.pillars.find((p) => p.id === "momentum")!;
      assert.ok(entry, "entry_geometry pillar must be present");
      assert.notEqual(entry.currentLabel, "chase risk", "must not render the pre-entry 'chase risk' framing for an already-winning committed position");
      assert.notEqual(entry.currentLabel, "n/a");
      // EXTENDED_CHASE must now be the single BEST-scoring reachable bucket -- strictly higher than
      // AT_TRIGGER (neutral) and PRE_TRIGGER (adverse), the exact inversion of the pre-fix ordering.
      const neutral = entryGeometryCurrentScore("AT_TRIGGER");
      const adverse = entryGeometryCurrentScore("PRE_TRIGGER");
      assert.ok(entry.currentScore > neutral, "a favorable EXTENDED_CHASE must outscore the neutral AT_TRIGGER bucket");
      assert.ok(entry.currentScore > adverse, "a favorable EXTENDED_CHASE must outscore the adverse PRE_TRIGGER bucket");
    });

    test("PRE_TRIGGER (live PLTR shape: SHORT, price reversed past entry toward invalidation, already TAKE_PARTIAL) scores WORST, not mid-decent, and is not labeled 'pre-trigger' (which implies not yet entered)", () => {
      const h = computeSwingThesisHealth({
        direction: "SHORT",
        status: "TRIM",
        setupState: "TRIGGERED",
        entryStatus: "PRE_TRIGGER",
        signalKinds: ["FLOW"],
        regime: "momentum short",
        dte: 10,
        subLane: "STANDARD",
        manageAction: "TAKE_PARTIAL",
        pnlPct: -8.4,
        computedAtEt: "14:00 ET",
      });
      assert.ok(h);
      const entry = h!.pillars.find((p) => p.id === "momentum")!;
      assert.ok(entry, "entry_geometry pillar must be present");
      assert.notEqual(entry.currentLabel, "pre-trigger", "must not render a 'hasn't triggered yet' framing for an already-committed, already-trimmed position");
      assert.notEqual(entry.currentLabel, "n/a");
      // PRE_TRIGGER must now be the single WORST-scoring reachable bucket.
      const neutral = entryGeometryCurrentScore("AT_TRIGGER");
      const favorable = entryGeometryCurrentScore("EXTENDED_CHASE");
      assert.ok(entry.currentScore < neutral, "an adverse PRE_TRIGGER must score below the neutral AT_TRIGGER bucket");
      assert.ok(entry.currentScore < favorable, "an adverse PRE_TRIGGER must score below the favorable EXTENDED_CHASE bucket");
    });

    test("the full geometric ordering is EXTENDED_CHASE > AT_TRIGGER > PULLBACK_TO_ENTRY > PRE_TRIGGER (favorable to adverse), monotonic", () => {
      const favorable = entryGeometryCurrentScore("EXTENDED_CHASE");
      const neutral = entryGeometryCurrentScore("AT_TRIGGER");
      const mildAdverse = entryGeometryCurrentScore("PULLBACK_TO_ENTRY");
      const adverse = entryGeometryCurrentScore("PRE_TRIGGER");
      assert.ok(favorable > neutral);
      assert.ok(neutral > mildAdverse);
      assert.ok(mildAdverse > adverse);
    });

    test("WATCH-stage SwingEntryState semantics (entry-model.ts's deriveEntryState) are completely untouched by this fix -- this pillar's score mapping is local to thesis-health.ts and has no bearing on the pre-entry taxonomy", () => {
      // computeSwingThesisHealth never runs for a WATCH candidate (status must be OPEN/HOLD/TRIM),
      // so there is no pre-entry rendering of entryGeometryScore to regress -- documented here as an
      // explicit regression guard rather than left implicit.
      assert.equal(
        computeSwingThesisHealth({ direction: "SHORT", status: "WATCH", entryStatus: "EXTENDED_CHASE", computedAtEt: "14:00 ET" }),
        null,
      );
    });
  });
});
