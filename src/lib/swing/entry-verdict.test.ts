import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  swingEntryVerdict,
  resolveSwingServingSection,
  commitGateBlocksForVerdict,
} from "./entry-verdict";

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

  it("stamped non-RESEARCH section + INVALIDATED → SKIP with thesis block AND the real, already-computed gate blocks (live-shape repro, 2026-10-25)", () => {
    // Same defect class as the "past entry deadline + active commit gate blocks" test below and the
    // RESEARCH-section fix in swingEntryVerdict itself: a stamped `servingSection` that predates a
    // fresher setupState read bypasses sectionForSwingPlay's own INVALIDATED→RESEARCH routing
    // (resolveSwingServingSection trusts the stamped value), so this lands in the dont_buy/
    // INVALIDATED branch with real, live commit-gate codes already computed and in scope.
    const v = swingEntryVerdict({
      servingSection: "WATCH",
      setupState: "INVALIDATED",
      commitGateBlockedBy: ["gate:G-S12:halt_feed_stale", "gate:G-S4:regime_degraded"],
    });
    assert.equal(v?.deckStatus, "SKIP");
    assert.equal(v?.actionLabel, null);
    assert.equal(v?.gateBlocks?.[0]?.code, "thesis_invalidated"); // primary reason stays first
    const codes = v?.gateBlocks?.map((g) => g.code) ?? [];
    assert.ok(codes.includes("g_s12_halt_feed_stale"), "real gate evidence should not be dropped");
    assert.ok(codes.includes("g_s4_regime"), "real gate evidence should not be dropped");
  });

  it("stamped non-RESEARCH section + persistence gap → SKIP with persistence reason AND the real gate blocks", () => {
    const v = swingEntryVerdict({
      servingSection: "WATCH",
      persistenceObserved: true,
      persistenceGapReason: "Needs 1 more session",
      commitGateBlockedBy: ["gate:G-S6:confluence"],
    });
    assert.equal(v?.deckStatus, "SKIP");
    assert.equal(v?.gateBlocks?.[0]?.code, "persistence_gap");
    const codes = v?.gateBlocks?.map((g) => g.code) ?? [];
    assert.ok(codes.includes("g_s6_confluence"), "real gate evidence should not be dropped");
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

  // Live repro (2026-09-25): AMD (score 81.3, TRIGGERED+AT_TRIGGER, first seen 2026-07-30) routes to
  // RESEARCH solely because its entry window lapsed — not because the thesis is thin. Before this fix,
  // researchGateBlocks had no case for entryWindowExpired, so it fell through to the generic
  // "thesis needs more work" reason, misrepresenting a real, still-scoring setup as a rejected one.
  it("RESEARCH + expired entry window (real triggered setup) → SKIP with the expiry reason, not the generic fallback", () => {
    const v = swingEntryVerdict({
      servingSection: "RESEARCH",
      setupState: "TRIGGERED",
      entryStatus: "AT_TRIGGER",
      entryWindowExpired: true,
    });
    assert.equal(v?.deckStatus, "SKIP");
    assert.equal(v?.gateBlocks?.[0]?.code, "entry_window_expired");
    assert.match(v?.gateBlocks?.[0]?.reason ?? "", /entry window already lapsed/);
    assert.doesNotMatch(v?.gateBlocks?.[0]?.reason ?? "", /needs more work/);
  });

  // Live repro (2026-10-08, Ask Largo standing mandate): AMD (score 22.3, EVENT_DRIVEN/TACTICAL,
  // first flagged 2026-09-29) routes to RESEARCH via the SAME `entryWindowExpired` path as the
  // test above, but ALSO carries 3 real, live commit-gate blocks (G-S12 halt_feed_stale, G-S4
  // regime_degraded, G-S14 cortex_net_negative) — the exact structural evidence
  // `commitGateBlocksForVerdict` already maps to member-facing text for the sibling WATCH-section
  // "past entry deadline + active commit gate blocks" case below. The RESEARCH early-return above
  // never calls `resolveSwingCommitGateBlockedBy`/`commitGateBlocksForVerdict` at all, so those 3
  // real gates were silently discarded — a member reading the live AMD brief saw ONLY
  // "entry_window_expired" and had no idea AMD was also regime-degraded and Cortex-vetoed. This is
  // the identical "real, already-computed gate evidence silently dropped" defect class the MU
  // WATCH-section fix two tests below this one already fixed — just unfixed on this sibling path.
  it("RESEARCH + expired entry window ALSO carrying real commit-gate blocks → SKIP with BOTH the expiry reason and the real gates (live AMD repro 2026-10-08)", () => {
    const v = swingEntryVerdict({
      servingSection: "RESEARCH",
      setupState: "FORMING",
      entryStatus: "PRE_TRIGGER",
      entryWindowExpired: true,
      commitGateBlockedBy: [
        "gate:G-S12:halt_feed_stale",
        "gate:G-S4:regime_degraded",
        "gate:G-S14:cortex_net_negative",
      ],
    });
    assert.equal(v?.deckStatus, "SKIP");
    const codes = v?.gateBlocks?.map((g) => g.code) ?? [];
    assert.ok(codes.includes("entry_window_expired"), "must keep the primary expiry reason first");
    assert.ok(codes.includes("g_s12_halt_feed_stale"), "must surface the real halt-feed gate, not discard it");
    assert.ok(codes.includes("g_s4_regime"), "must surface the real regime gate, not discard it");
    assert.ok(codes.includes("g_s14_cortex"), "must surface the real cortex gate, not discard it");
  });

  // BUG FIX (2026-10-25, Ask Largo standing mandate, live repro SOXX WATCH): commitGateBlocksForVerdict
  // used to collapse every non-`cortex_unavailable` G-S14 block to "Cortex preflight vetoed this
  // setup" — but cortex-gate.ts's own decision table distinguishes a genuine veto from four
  // materially weaker, explicitly non-veto outcomes. Live SOXX WATCH row carried exactly
  // `gate:G-S14:cortex_net_negative` and rendered as if Cortex had issued a hard veto.
  it("commitGateBlocksForVerdict: G-S14 non-veto codes get their own honest reason, never the 'vetoed' sentence (live SOXX repro)", () => {
    const netNegative = commitGateBlocksForVerdict(["gate:G-S14:cortex_net_negative"]);
    assert.match(netNegative[0].reason, /nets negative/i);
    assert.doesNotMatch(netNegative[0].reason, /vetoed/i, "net-negative is NOT a veto — must not say so");

    const thinEvidence = commitGateBlocksForVerdict(["gate:G-S14:cortex_thin_evidence"]);
    assert.match(thinEvidence[0].reason, /thinly corroborated/i);
    assert.doesNotMatch(thinEvidence[0].reason, /vetoed/i, "thin evidence is NOT a veto — must not say so");

    const contested = commitGateBlocksForVerdict(["gate:G-S14:cortex_contested"]);
    assert.match(contested[0].reason, /contested/i);
    assert.doesNotMatch(contested[0].reason, /vetoed/i, "contested evidence is NOT a veto — must not say so");

    const gexWallsOppose = commitGateBlocksForVerdict(["gate:G-S14:cortex_gex_walls_oppose_unresolved"]);
    assert.match(gexWallsOppose[0].reason, /dealer-wall opposition is unresolved/i);
    assert.doesNotMatch(gexWallsOppose[0].reason, /vetoed/i, "an unresolved oppose is NOT a veto — must not say so");

    const vetoBlind = commitGateBlocksForVerdict(["gate:G-S14:cortex_veto_blind"]);
    assert.match(vetoBlind[0].reason, /failed to read/i);
    assert.doesNotMatch(vetoBlind[0].reason, /vetoed this setup/i, "the fail-closed blind firewall is NOT a confirmed veto — must not say so");

    // The genuine veto case must STILL say "vetoed" — this fix narrows the sentence to the real
    // veto case, it must not also suppress it there.
    const genuineVeto = commitGateBlocksForVerdict(["gate:G-S14:cortex_veto:gex-walls"]);
    assert.match(genuineVeto[0].reason, /vetoed/i);
  });

  // BUG FIX (2026-10-26, Ask Largo standing mandate, live repro MRNA WATCH): the genuine-veto
  // branch above (`b.includes("cortex_veto")`) is the ONE branch in this G-S14 block that the
  // 2026-10-25 fix (#6673) left untouched — it still collapses to a flat, source-less sentence
  // even though the persisted token itself (`gate:G-S14:cortex_veto:<source>`, stamped by
  // `swingCortexBlockedByFromAssessment` in v2/cortex-swing.ts off cortex-gate.ts's own
  // `cortex_veto:${v.source}` code) already names exactly which of the 8 CORTEX_SOURCES vetoed.
  // Live repro: GET /api/market/nighthawk/horizons?view=swings on 2026-10-26 served MRNA with
  // `commitGateBlockedBy: ["gate:G-S6:confluence", "gate:G-S14:cortex_veto:gex-walls"]`, yet the
  // rendered reason named no source. The sibling 0DTE board (zerodte/cortex-gate.ts's own
  // `cortexGateBlocks()` rendering, `Cortex veto [${v.source}]: ${v.detail}`) already preserves
  // this; only swing's member-facing text discarded it.
  it("commitGateBlocksForVerdict: genuine G-S14 veto names the specific Cortex source (live MRNA repro)", () => {
    const gexWallsVeto = commitGateBlocksForVerdict(["gate:G-S14:cortex_veto:gex-walls"]);
    assert.match(gexWallsVeto[0].reason, /gex-walls/, "must name which Cortex source vetoed, not a generic sentence");

    const darkpoolVeto = commitGateBlocksForVerdict(["gate:G-S14:cortex_veto:darkpool-confluence"]);
    assert.match(
      darkpoolVeto[0].reason,
      /darkpool-confluence/,
      "must name a different source correctly too, not hardcode one",
    );

    // No source present (shouldn't happen in production — the token always carries one — but the
    // fallback must stay honest/generic rather than render a garbage/empty source name).
    const noSource = commitGateBlocksForVerdict(["gate:G-S14:cortex_veto"]);
    assert.match(noSource[0].reason, /vetoed this setup/i);
  });

  it("RESEARCH with no expiry/persistence/invalidation signal still falls through to the generic reason", () => {
    const v = swingEntryVerdict({
      servingSection: "RESEARCH",
      setupState: "TRIGGERED",
      entryStatus: "AT_TRIGGER",
      entryWindowExpired: false,
    });
    assert.equal(v?.gateBlocks?.[0]?.code, "research_review");
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

  it("swingEntryVerdict end-to-end: WAIT branch threads signalKinds/archetype into the G-S6 reason", () => {
    const v = swingEntryVerdict({
      servingSection: "WATCH",
      setupState: "TRIGGERED",
      entryStatus: "AT_TRIGGER",
      signalKinds: ["FLOW"],
      archetype: "SECTOR_ROTATION",
      commitGateBlockedBy: ["gate:G-S6:confluence"],
    });
    assert.equal(v?.gateBlocks?.[0]?.code, "g_s6_confluence");
    assert.match(v?.gateBlocks?.[0]?.reason ?? "", /needs 2 more kind\(s\) — have FLOW/);
  });

  it("G-S6 block without signal-kind context falls back to the flat reason (no diagnostic to compute)", () => {
    const blocks = commitGateBlocksForVerdict(["gate:G-S6:confluence"]);
    assert.equal(
      blocks[0]?.reason,
      "Independent signal confluence below commit threshold — desk will not open."
    );
  });

  it("G-S6 block enriched with the real confluence diagnostic when signal kinds are supplied (#4076 ask)", () => {
    const blocks = commitGateBlocksForVerdict(["gate:G-S6:confluence"], {
      signalKinds: ["FLOW", "STRUCTURE"],
      archetype: "SECTOR_ROTATION",
    });
    assert.equal(blocks[0]?.code, "g_s6_confluence");
    // SECTOR_ROTATION requires 3 independent kinds; FLOW+STRUCTURE is 2, so this is 1 short —
    // the member now sees exactly how close the setup is, not just that it's blocked.
    assert.equal(
      blocks[0]?.reason,
      "Independent signal confluence below commit threshold — needs 1 more kind(s) — have FLOW+STRUCTURE."
    );
  });

  it("G-S6 block for an event archetype needing CATALYST reports the catalyst-specific diagnostic", () => {
    const blocks = commitGateBlocksForVerdict(["gate:G-S6:confluence"], {
      signalKinds: ["FLOW", "STRUCTURE"],
      archetype: "EVENT_DRIVEN",
    });
    assert.equal(
      blocks[0]?.reason,
      "Independent signal confluence below commit threshold — event archetype needs CATALYST kind + 1 other — have FLOW+STRUCTURE."
    );
  });

  it("G-S6 block falls back to the flat reason when the recomputed verdict disagrees it should still fail (live AVGO repro, 2026-10-14)", () => {
    // Live repro: a served WATCH row carried commitGateBlockedBy=["gate:G-S6:confluence"] (stamped
    // at the last discovery scan) alongside signalKinds that had since accumulated to 5 kinds —
    // enough to PASS the standard 3-kind SECTOR_ROTATION threshold. Recomputing the diagnostic
    // naively produced "5/3 kinds agree (...)" — a passing-shaped label rendered directly inside
    // the sentence explaining why entry was still blocked. The enrichment must never assert a
    // passing count next to a live block; it should fall back to the flat text instead.
    const blocks = commitGateBlocksForVerdict(["gate:G-S6:confluence"], {
      signalKinds: ["CATALYST", "FLOW", "POSITIONING", "STRUCTURE", "VECTOR"],
      archetype: "SECTOR_ROTATION",
    });
    assert.equal(blocks[0]?.code, "g_s6_confluence");
    assert.equal(
      blocks[0]?.reason,
      "Independent signal confluence below commit threshold — desk will not open."
    );
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

  it("past entry deadline + active commit gate blocks → WAIT with real gate blocks, not null (live MU repro 2026-09-11)", () => {
    // Live repro: MU flagged 2026-07-24 (STANDARD sub-lane, 3-day entry validity), so by
    // 2026-09-11 `pastEntryDeadline` fires FIRST inside evaluateSwingEntryEnterability
    // (entry-enterability.ts) and returns `dont_buy` with the generic "Entry-validity window
    // expired" reason BEFORE ever reaching its own gate-blocked check — so `commitGateBlockedBy`
    // (3 real, live gate codes: G-S12 halt-feed-stale, G-S4 regime-degraded, G-S6 confluence)
    // is computed but never returned on that enterability result. swingEntryVerdict's `dont_buy`
    // branch then unconditionally set `gateBlocks: null` for anything short of
    // INVALIDATED/persistence-gap, silently discarding those three already-computed, real gate
    // reasons — so every consumer of `TerminalPlay.gateBlocks` (the play-brief Entry section,
    // play-brief-intel's "Before entry, clear:", play-brief-narrative-coaching) rendered nothing,
    // even though the underlying gate evidence existed and was already mapped to member-facing
    // text via `commitGateBlocksForVerdict` for the sibling "wait" branch two cases above.
    const v = swingEntryVerdict({
      servingSection: "WATCH",
      setupState: "TRIGGERED",
      entryStatus: "AT_TRIGGER",
      subLane: "STANDARD",
      anchoredAt: "2026-07-24T13:38:31.000Z",
      commitGateBlockedBy: [
        "gate:G-S12:halt_feed_stale",
        "gate:G-S4:regime_degraded",
        "gate:G-S6:confluence",
      ],
      nowMs: Date.parse("2026-09-11T04:37:00.000Z"),
    });
    assert.equal(v?.entryAction, "dont_buy");
    assert.match(v?.recNote ?? "", /Entry-validity window expired/);
    assert.ok(v?.gateBlocks?.length, "gateBlocks should carry the real, already-computed gate reasons");
    const codes = v?.gateBlocks?.map((g) => g.code) ?? [];
    assert.ok(codes.includes("g_s12_halt_feed_stale"));
    assert.ok(codes.includes("g_s4_regime"));
    assert.ok(codes.includes("g_s6_confluence"));
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

  // GAP FOUND (Ask Largo standing mandate, 2026-10-18): live repro, UNH — the Q22 case above is
  // still correctly WAIT (the Legacy-commit bridge stays flag-gated OFF per the operator's own
  // recorded caution, FINDINGS.md 2026-10-09 #5577 — this test does NOT reopen that), but the
  // member-facing `recNote` said "commit gates have not cleared — wait before sizing", falsely
  // implying a real gate would eventually clear. Corrected to name the real reason instead.
  it("Q22's WAIT verdict no longer implies a real, clearable gate — live repro UNH", () => {
    const v = swingEntryVerdict({
      servingSection: "COMMIT_NOW",
      setupState: "TRIGGERED",
      entryStatus: "AT_TRIGGER",
      signalKinds: ["NIGHT HAWK"],
    });
    assert.doesNotMatch(v?.recNote ?? "", /commit gates have not cleared/i);
    assert.match(v?.recNote ?? "", /legacy-promoted/i);
  });
});
