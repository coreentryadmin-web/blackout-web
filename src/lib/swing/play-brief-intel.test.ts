import test from "node:test";
import assert from "node:assert/strict";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import {
  archetypeTrackRecordSection,
  bookContextSection,
  catalystsSection,
  chartLevelsSection,
  chartTechnicalsSection,
  cortexReadSection,
  dataFreshnessSection,
  deskConsensusSection,
  flowIntelSection,
  gexPostureSection,
  holdPlanSection,
  lessonsSection,
  meridianCatalystSection,
  meridianPeerSection,
  wallDynamicsSection,
  watchForSection,
  whyThisSetupSection,
  vectorDeskSection,
} from "./play-brief-intel";
import type { EcosystemContext } from "@/lib/bie/ecosystem-context";
import type { PortfolioPosition } from "./portfolio";
import type { SwingPlayBriefContext } from "./play-brief-types";
import type { VectorFullState } from "@/lib/bie/vector-full-state";
import type { PaneCortexView } from "@/lib/zerodte/pane";
import { catalystCoaching, collectCoachingBullets } from "./play-brief-narrative-coaching";
import { tradeManagerNarrativeSection } from "./play-brief-narrative";
import type { SwingArchetypeTrackRecordSnapshot, SwingTrackRecordEntry } from "./calibration-cache";

function fixturePlay(overrides: Partial<TerminalPlay> = {}): TerminalPlay {
  return {
    id: "SWING:NVDA",
    ticker: "NVDA",
    direction: "LONG",
    contract: "140C · 20DTE",
    score: 75,
    status: "WATCH",
    horizon: "SWING",
    exitModel: "SCALE_OUT",
    recommendation: "BUY",
    factors: [],
    gates: [],
    ...overrides,
  };
}

test("bookContextSection: null when openBook is undefined or empty", () => {
  assert.equal(bookContextSection(fixturePlay(), undefined), null);
  assert.equal(bookContextSection(fixturePlay(), []), null);
});

test("bookContextSection: null when the book has no theme overlap with the candidate", () => {
  const book: PortfolioPosition[] = [{ ticker: "KO", direction: "LONG" }];
  assert.equal(bookContextSection(fixturePlay(), book), null);
});

test("bookContextSection: flags CONCENTRATION when an existing same-theme same-direction position is held", () => {
  const book: PortfolioPosition[] = [
    { ticker: "AMD", direction: "LONG" },
    { ticker: "SMH", direction: "LONG" },
  ];
  const section = bookContextSection(fixturePlay({ ticker: "NVDA", direction: "LONG" }), book);
  assert.ok(section);
  assert.equal(section?.title, "Book context");
  assert.match(section?.body ?? "", /Concentration/i);
  assert.match(section?.body ?? "", /AMD LONG/);
  assert.match(section?.body ?? "", /SMH LONG/);
});

test("bookContextSection: flags INTERNAL CONFLICT when an existing same-theme opposed-direction position is held", () => {
  const book: PortfolioPosition[] = [{ ticker: "AMD", direction: "SHORT" }];
  const section = bookContextSection(fixturePlay({ ticker: "NVDA", direction: "LONG" }), book);
  assert.ok(section);
  assert.match(section?.body ?? "", /Internal conflict/i);
  assert.match(section?.body ?? "", /AMD SHORT/);
});

test("bookContextSection: a duplicate/rolled row on the SAME ticker+direction is not reported as overlap", () => {
  const book: PortfolioPosition[] = [{ ticker: "NVDA", direction: "LONG" }];
  assert.equal(bookContextSection(fixturePlay({ ticker: "NVDA", direction: "LONG" }), book), null);
});

test("bookContextSection: a genuine cross-engine sibling on the reviewed play's OWN ticker is labeled, not rendered as bare self-citation (Largo C4)", () => {
  // Live defect (2026-09-15, Ask Largo standing mandate): loadOpenBook() merges swing_positions
  // (real positionId) with banger_positions (positionId deliberately left unset -- separate DB
  // sequences that can collide on numeric id). Once the reviewed play's own positionId excludes
  // itself exactly, a real cross-engine sibling on the SAME ticker correctly falls through as
  // genuine concentration -- but rendered as bare "TICKER DIRECTION" it reads as a self-citation
  // bug. Live-confirmed on CRWD: swing position #39 (reviewed, excluded) vs a real, independently
  // committed Banger CRWD LONG (positionId unset) both existing at once.
  const book: PortfolioPosition[] = [
    { ticker: "CRWD", direction: "LONG" }, // cross-engine sibling, no positionId (Banger-shaped)
    { ticker: "ZS", direction: "LONG" },
  ];
  const section = bookContextSection(
    fixturePlay({ id: "SWING:CRWD:39", ticker: "CRWD", direction: "LONG", status: "OPEN" }),
    book,
  );
  assert.ok(section);
  assert.match(
    section!.body,
    /CRWD LONG \(separate, cross-engine position\)/,
    `same-ticker cross-engine sibling must be labeled distinctly, got: ${section!.body}`,
  );
  assert.match(section!.body, /ZS LONG/, "an unrelated ticker in the same theme is unaffected");
  assert.doesNotMatch(
    section!.body,
    /ZS LONG \(separate/,
    "the label must only apply to a sibling sharing the reviewed play's OWN ticker",
  );
});

test("bookContextSection: a genuine same-ticker swing-native sibling (known positionId) cites its own id", () => {
  const book: PortfolioPosition[] = [{ ticker: "CRWD", direction: "LONG", positionId: 51 }];
  const section = bookContextSection(
    fixturePlay({ id: "SWING:CRWD:39", ticker: "CRWD", direction: "LONG", status: "OPEN" }),
    book,
  );
  assert.ok(section);
  assert.match(section!.body, /CRWD LONG \(separate position #51\)/);
});

// FINDINGS 2026-09-12 (live repro, closed AAPL positionId 36): this section's copy is written for a
// PENDING entry decision ("Adding {ticker} stacks the same wager...") — wrong frame for a position
// that has already closed and has no forward decision left, even when the CURRENT book happens to
// overlap the ticker/theme (e.g. a later, unrelated re-entry).
test("bookContextSection: null for a CLOSED play even when the current book overlaps", () => {
  const book: PortfolioPosition[] = [
    { ticker: "AMD", direction: "LONG" },
    { ticker: "SMH", direction: "LONG" },
  ];
  const closedPlay = fixturePlay({ ticker: "NVDA", direction: "LONG", status: "CLOSED" });
  assert.equal(bookContextSection(closedPlay, book), null);
});

// Live repro 2026-09-12 (CRWD positionId 19, status TRIM / manageAction EXIT_RUNNER): the same
// "pending entry decision" tense bug the CLOSED guard above already fixed also applies to an
// already-committed OPEN/HOLD/TRIM position — "Adding CRWD stacks the same wager..." rendered on a
// position that is being TRIMMED OUT, not entered. There is no "adding" decision on the table for
// an already-open managed position; only a genuinely pending WATCH candidate has one.
test("bookContextSection: an already-open OPEN/HOLD/TRIM position reads as EXISTING exposure, not a pending 'adding' decision", () => {
  const book: PortfolioPosition[] = [
    { ticker: "AMD", direction: "LONG" },
    { ticker: "SMH", direction: "LONG" },
  ];
  for (const status of ["OPEN", "HOLD", "TRIM"] as const) {
    const section = bookContextSection(
      fixturePlay({ ticker: "NVDA", direction: "LONG", status }),
      book,
    );
    assert.ok(section, `expected a section for status ${status}`);
    assert.match(section?.body ?? "", /Concentration/i);
    assert.doesNotMatch(
      section?.body ?? "",
      /Adding NVDA stacks/i,
      `status ${status} should not use the pending-entry "Adding" phrasing`,
    );
  }
  // WATCH keeps the original pending-entry phrasing — there IS a decision to make there.
  const watchSection = bookContextSection(
    fixturePlay({ ticker: "NVDA", direction: "LONG", status: "WATCH" }),
    book,
  );
  assert.match(watchSection?.body ?? "", /Adding NVDA stacks/i);
});

test("bookContextSection: reviewing the second of two independent same-ticker rows does not flag self", () => {
  const book: PortfolioPosition[] = [
    { ticker: "EWZ", direction: "LONG", positionId: 29 },
    { ticker: "EWZ", direction: "LONG", positionId: 26 },
  ];
  const section = bookContextSection(
    fixturePlay({ id: "SWING:EWZ:26", ticker: "EWZ", direction: "LONG" }),
    book,
  );
  assert.ok(section);
  assert.match(section?.body ?? "", /Concentration/i);
  assert.match(section?.body ?? "", /EWZ LONG/);
  assert.doesNotMatch(section?.body ?? "", /26.*26/);
  assert.equal((section?.body ?? "").split("EWZ LONG").length - 1, 1);
});

// ── archetypeTrackRecordSection (Largo C10 historical context; Ask Largo mandate) ─────────────────
function trackRecordEntry(over: Partial<SwingTrackRecordEntry> = {}): SwingTrackRecordEntry {
  return {
    tier: "LIMITED",
    graduated: true,
    wilsonLbPct: 62.5,
    pointDeltaPts: 22.4,
    n: 60,
    wins: 45,
    losses: 15,
    winRatePct: 75,
    ...over,
  };
}
function trackRecordSnapshot(
  archetypes: SwingArchetypeTrackRecordSnapshot["archetypes"] = {},
): SwingArchetypeTrackRecordSnapshot {
  return { asOf: "2026-09-10T15:00:00.000Z", gradedPlays: 70, archetypes, subLanes: {} };
}

test("archetypeTrackRecordSection: null on a cold/missing snapshot (undefined or null) — never throws", () => {
  const play = fixturePlay({ archetype: "BREAKOUT" });
  assert.equal(archetypeTrackRecordSection(play, undefined), null);
  assert.equal(archetypeTrackRecordSection(play, null), null);
});

test("archetypeTrackRecordSection: null when the play has no archetype, or an archetype foreign to the taxonomy", () => {
  const snap = trackRecordSnapshot({ BREAKOUT: trackRecordEntry() });
  assert.equal(archetypeTrackRecordSection(fixturePlay({ archetype: null }), snap), null);
  assert.equal(archetypeTrackRecordSection(fixturePlay({ archetype: "NOT_A_REAL_ARCHETYPE" }), snap), null);
});

test("archetypeTrackRecordSection: null (OMITTED, not caveated) when the archetype's bucket has NOT graduated — Largo C6", () => {
  const snap = trackRecordSnapshot({
    BREAKOUT: trackRecordEntry({ graduated: false, tier: "RESEARCH", n: 4, wins: 3, losses: 1 }),
  });
  const play = fixturePlay({ archetype: "BREAKOUT" });
  assert.equal(archetypeTrackRecordSection(play, snap), null);
});

test("archetypeTrackRecordSection: null when the SNAPSHOT has no entry at all for this archetype (never fabricates one)", () => {
  const snap = trackRecordSnapshot({}); // no BREAKOUT key at all
  assert.equal(archetypeTrackRecordSection(fixturePlay({ archetype: "BREAKOUT" }), snap), null);
});

test("archetypeTrackRecordSection: renders a 'Track record' section citing wins/losses/n/win-rate/Wilson-LB/point-Δ when graduated", () => {
  const snap = trackRecordSnapshot({
    BREAKOUT: trackRecordEntry({ wins: 45, losses: 15, n: 60, winRatePct: 75, wilsonLbPct: 63.2, pointDeltaPts: 22.4 }),
  });
  const section = archetypeTrackRecordSection(fixturePlay({ archetype: "BREAKOUT" }), snap);
  assert.ok(section);
  assert.equal(section?.title, "Track record");
  assert.match(section?.body ?? "", /Breakout continuation/i);
  assert.match(section?.body ?? "", /45W \/ 15L/);
  assert.match(section?.body ?? "", /\*\*60\*\* graded plays/);
  assert.match(section?.body ?? "", /75%/, "raw win rate cited");
  assert.match(section?.body ?? "", /63%/, "Wilson lower-bound cited (rounded)");
  assert.match(section?.body ?? "", /\+22 pts/, "point-Δ edge cited");
});

test("archetypeTrackRecordSection: a BROAD-tier bucket says 'broad sample'; LIMITED says 'limited sample'", () => {
  const broadPlay = fixturePlay({ archetype: "BREAKOUT" });
  const broadSnap = trackRecordSnapshot({ BREAKOUT: trackRecordEntry({ tier: "BROAD", n: 80 }) });
  assert.match(archetypeTrackRecordSection(broadPlay, broadSnap)?.body ?? "", /broad sample/i);

  const limitedSnap = trackRecordSnapshot({ BREAKOUT: trackRecordEntry({ tier: "LIMITED", n: 40 }) });
  assert.match(archetypeTrackRecordSection(broadPlay, limitedSnap)?.body ?? "", /limited sample/i);
});

test("archetypeTrackRecordSection: omits the point-Δ line when pointDeltaPts is null (no off-signal baseline yet)", () => {
  const snap = trackRecordSnapshot({ BREAKOUT: trackRecordEntry({ pointDeltaPts: null }) });
  const body = archetypeTrackRecordSection(fixturePlay({ archetype: "BREAKOUT" }), snap)?.body ?? "";
  assert.doesNotMatch(body, /pts.*edge/);
});

// ── cortexReadSection (swing Cortex-visibility fix — the entry_context.cortex pinned at commit,
// previously computed honestly server-side but never reaching the play-brief; see PR comment
// thread on #4076, 2026-09-11 cycle) ───────────────────────────────────────────────────────────

function opposedCortexView(): PaneCortexView {
  return {
    abstained: false,
    decision: "NET_NEGATIVE",
    verdict: {
      score: -1.4,
      conviction: "C",
      asOf: "2026-09-10T14:00:00Z",
      vetoes: [{ source: "gex-walls", stance: "veto", weight: -2, detail: "pinned under a hard call wall" }],
      supports: [],
      opposes: [{ source: "wall-trend", stance: "opposes", weight: -0.6, detail: "trend fading into resistance" }],
      absent: [],
      narrative: [
        "Cortex vetoed on gex-walls: pinned under a hard call wall.",
        "wall-trend also opposed: trend fading into resistance.",
      ],
    },
  };
}

test("cortexReadSection: null when the play carries no Cortex read at all (pre-wire-in row, WATCH/lane-only candidate)", () => {
  assert.equal(cortexReadSection(fixturePlay({ cortex: null })), null);
  assert.equal(cortexReadSection(fixturePlay({ cortex: undefined })), null);
});

test("cortexReadSection: null when Cortex abstained — an abstain is not a signal to surface here", () => {
  const play = fixturePlay({ cortex: { abstained: true, reason: "all sources timed out" } });
  assert.equal(cortexReadSection(play), null);
});

test("cortexReadSection: null on a CLEAN read (no vetoes, no opposes) — never fabricates a 'Cortex is fine' line", () => {
  const clean: PaneCortexView = {
    abstained: false,
    decision: "PASS",
    verdict: {
      score: 1.2,
      conviction: "A",
      vetoes: [],
      supports: [{ source: "flow", stance: "supports", weight: 1.2, detail: "call sweep confirms" }],
      opposes: [],
      absent: [],
      narrative: [],
    },
  };
  assert.equal(cortexReadSection(fixturePlay({ cortex: clean })), null);
});

test("cortexReadSection: renders 'Cortex read' citing the pinned narrative when Cortex actually opposed/vetoed the position", () => {
  const section = cortexReadSection(fixturePlay({ cortex: opposedCortexView() }));
  assert.ok(section);
  assert.equal(section?.title, "Cortex read");
  assert.equal(section?.bias, "bearish");
  assert.match(section?.body ?? "", /NET_NEGATIVE/);
  assert.match(section?.body ?? "", /1 veto/);
  assert.match(section?.body ?? "", /1 opposing item/);
  assert.match(section?.body ?? "", /pinned under a hard call wall/);
  assert.match(section?.body ?? "", /trend fading into resistance/);
});

test("cortexReadSection: falls back to a constructed summary when narrative is empty but vetoes/opposes exist", () => {
  const view = opposedCortexView();
  const noNarrative: PaneCortexView = {
    ...view,
    verdict: { ...view.verdict, narrative: [] },
  };
  const body = cortexReadSection(fixturePlay({ cortex: noNarrative }))?.body ?? "";
  assert.match(body, /VETO — \[gex-walls\] pinned under a hard call wall/);
  assert.match(body, /Opposed — \[wall-trend\] trend fading into resistance/);
});

// SWING-SYSTEM-CTO-AUDIT-style finding (found live 2026-09-06 on NRG SWING_NRG_34): `recNote` is
// already rendered verbatim by managementSection (open bucket) or the Verdict section (watch
// bucket) — see play-brief.ts lines 64 and 292. whyThisSetupSection pushed the SAME string again
// for any non-CLOSED play, so every open/watch brief repeated one full sentence across two
// sections — a narrative-quality defect ("bullet dump", not one connected trade-manager voice),
// not just a cosmetic wart: it also crowds out the pillar/signal content this section exists for.
test("whyThisSetupSection: does not repeat recNote — that's already surfaced by Management/Verdict", () => {
  const play = fixturePlay({
    status: "OPEN",
    recNote: "live hold — swing thesis Thesis health 46% — Thesis fading — tighten risk or trim into strength.",
  });
  const section = whyThisSetupSection(play);
  assert.ok(!section.body.includes(play.recNote as string));
});

test("whyThisSetupSection: still reports pillar/signal content when present", () => {
  const play = fixturePlay({
    status: "OPEN",
    recNote: "some note",
    factors: [{ label: "Momentum", points: 5 }],
  });
  const section = whyThisSetupSection(play);
  assert.match(section.body, /Momentum/);
});

test("holdPlanSection: does not repeat recNote or Management-owned rails — unique time/theta coaching only", () => {
  const recNote = "live hold — thesis fading — tighten risk";
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({
      status: "HOLD",
      recommendation: "HOLD",
      recNote,
      contract: "14DTE 110C",
      manageAction: "TRIM_PARTIAL",
      exitPolicy: {
        policy: "trim_scale",
        hard_stop_pct: -50,
        target_pct: 100,
        trim_levels: [{ trigger_pct: 50, fraction: 0.33, premium: 7, fired: false }],
        runner_fraction: 0.34,
        stop_premium: 2,
        target_premium: 10,
        time_stop_et: "15:50",
      },
    }),
    asOf: "2026-09-05T20:00:00.000Z",
    sessionDate: "2026-09-05",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
  };
  const section = holdPlanSection(ctx);
  assert.ok(section);
  assert.ok(!section!.body.includes(recNote));
  assert.ok(!section!.body.includes("Desk stance"));
  assert.ok(!section!.body.includes("Trim ladder"));
  assert.ok(!section!.body.includes("Rails:"));
  assert.ok(!section!.body.includes("Manage engine"));
  assert.match(section!.body, /Contract runway/);
  assert.ok(!section!.body.includes("Time in trade"));
  assert.match(section!.body, /14 DTE/);
  assert.match(section!.body, /15:50/);
});

// #4261 fixed holdPlanSection's recNote/rails duplication but left a second, same-class duplicate:
// the thesis-health `advisory` sentence is the exact text tradeManagerNarrativeSection's
// pillar-fade narration already carries in "Trade manager read" (both sections render for any
// live play). Found during the 2026-09-06 Ask Largo deep-dive on live NRG SWING_NRG_34.
test("holdPlanSection: does not repeat the thesis-health advisory sentence — already narrated by Trade manager read", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({
      status: "HOLD",
      recommendation: "HOLD",
      contract: "110C · 12DTE",
      thesisHealth: {
        health: 72,
        entryIndex: 70,
        currentIndex: 72,
        delta: 2,
        rung: "MINOR",
        rungLabel: "Minor drift",
        pillars: [
          {
            id: "structure",
            label: "Persistence",
            weight: 0.28,
            commitScore: 0.9,
            currentScore: 0.9,
            commitLabel: "triggered",
            currentLabel: "triggered",
            status: "intact",
            contributionPts: 25,
            deltaPts: 0,
          },
          {
            id: "momentum",
            label: "Entry geometry",
            weight: 0.22,
            commitScore: 1,
            currentScore: 1,
            commitLabel: "at trigger",
            currentLabel: "at trigger",
            status: "intact",
            contributionPts: 22,
            deltaPts: 0,
          },
          {
            id: "flow",
            label: "Signal stack",
            weight: 0.2,
            commitScore: 0.6,
            currentScore: 0.6,
            commitLabel: "FLOW+VECTOR",
            currentLabel: "FLOW+VECTOR",
            status: "intact",
            contributionPts: 12,
            deltaPts: 0,
          },
        ],
        moves: [],
        committedAtEt: null,
        computedAtEt: "10:00 ET",
        advisory: "Thesis fading — tighten risk or trim into strength.",
        thesisBreakLevel: "warn",
      },
    }),
    asOf: "2026-09-05T20:00:00.000Z",
    sessionDate: "2026-09-05",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
  };
  const section = holdPlanSection(ctx);
  assert.ok(section);
  assert.doesNotMatch(section!.body, /Thesis fading — tighten risk or trim into strength\./);
  assert.match(section!.body, /Thesis health \*\*72%\*\* \(Minor drift\)/);
});

test("holdPlanSection: omits aggregate thesis health % when inputs uncalibrated", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({
      status: "HOLD",
      recommendation: "HOLD",
      contract: "110C · 12DTE",
      thesisHealth: {
        health: 46,
        entryIndex: 60,
        currentIndex: 46,
        delta: -14,
        rung: "degraded",
        rungLabel: "Degraded",
        pillars: [
          {
            id: "structure",
            label: "Persistence",
            weight: 0.28,
            commitScore: 0.4,
            currentScore: 0.35,
            commitLabel: "unknown",
            currentLabel: "unknown",
            status: "intact",
            contributionPts: 10,
            deltaPts: -1,
          },
        ],
        moves: [],
        committedAtEt: null,
        computedAtEt: "10:00 ET",
        advisory: "Thesis fading — tighten risk or trim into strength.",
        thesisBreakLevel: "warn",
      },
    }),
    asOf: "2026-09-05T20:00:00.000Z",
    sessionDate: "2026-09-05",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
  };
  const section = holdPlanSection(ctx);
  assert.ok(section);
  assert.doesNotMatch(section!.body, /Thesis health \*\*46%\*\*/);
});

// FINDINGS 2026-09-10 (live NRG repro): this bullet used to compute `play.peak - play.pnlPct` — a
// percentage-POINT subtraction of two already-percentage numbers — and label it "Gave back X%
// from peak", which reads as a RELATIVE retracement. Real production NRG position: peak 132.7,
// pnlPct 39.8 -> old math printed "Gave back 93% from peak" on a play still up +39.8%. Numbers
// below use that same live NRG case (capture ~30%, honest giveback ~70%) rather than the old
// fixture's 129/95 pair, which under the new honest math (capture ~74%) no longer clears the
// giveback floor and would silently stop testing this bullet at all.
test("holdPlanSection: peak giveback warning still shows when thesis health is uncalibrated (live NRG repro)", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({
      status: "HOLD",
      recommendation: "HOLD",
      contract: "110C · 12DTE",
      peak: 132.7,
      pnlPct: 39.8,
      thesisHealth: {
        health: 46,
        entryIndex: 60,
        currentIndex: 46,
        delta: -14,
        rung: "degraded",
        rungLabel: "Degraded",
        pillars: [
          {
            id: "structure",
            label: "Persistence",
            weight: 0.28,
            commitScore: 0.4,
            currentScore: 0.35,
            commitLabel: "unknown",
            currentLabel: "unknown",
            status: "intact",
            contributionPts: 10,
            deltaPts: -1,
          },
        ],
        moves: [],
        committedAtEt: null,
        computedAtEt: "10:00 ET",
        advisory: "Thesis fading — tighten risk or trim into strength.",
        thesisBreakLevel: "warn",
      },
    }),
    asOf: "2026-09-05T20:00:00.000Z",
    sessionDate: "2026-09-05",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
  };
  const section = holdPlanSection(ctx);
  assert.ok(section);
  assert.doesNotMatch(section!.body, /Thesis health \*\*46%\*\*/);
  assert.match(section!.body, /Gave back \*\*70%\*\* from peak/, `expected ~70% relative giveback, got: ${section!.body}`);
  assert.doesNotMatch(section!.body, /Gave back \*\*93%\*\*/, "must not regress to the point-difference bug");
});

test("holdPlanSection: peak giveback warning does not fire once retained capture clears the floor", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({
      status: "HOLD",
      recommendation: "HOLD",
      contract: "110C · 12DTE",
      // capture = 98/120*100 ~= 81.7% retained -> above the 70% floor, no giveback bullet.
      // (Old point-difference math: 120-98=22, which is NOT > 25, so this was already silent
      // under the old logic too — kept as a same-shape non-regression check.)
      peak: 120,
      pnlPct: 98,
      thesisHealth: {
        health: 46,
        entryIndex: 60,
        currentIndex: 46,
        delta: -14,
        rung: "degraded",
        rungLabel: "Degraded",
        pillars: [
          {
            id: "structure",
            label: "Persistence",
            weight: 0.28,
            commitScore: 0.4,
            currentScore: 0.35,
            commitLabel: "unknown",
            currentLabel: "unknown",
            status: "intact",
            contributionPts: 10,
            deltaPts: -1,
          },
        ],
        moves: [],
        committedAtEt: null,
        computedAtEt: "10:00 ET",
        advisory: "Thesis fading — tighten risk or trim into strength.",
        thesisBreakLevel: "warn",
      },
    }),
    asOf: "2026-09-05T20:00:00.000Z",
    sessionDate: "2026-09-05",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
  };
  const section = holdPlanSection(ctx);
  assert.ok(section, "contract runway line still renders regardless of giveback");
  assert.doesNotMatch(section!.body, /Gave back/i);
});

test("holdPlanSection: round-tripped-past-breakeven note fires when current pnl has gone negative after a positive peak", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({
      status: "HOLD",
      recommendation: "HOLD",
      contract: "110C · 12DTE",
      peak: 132.7,
      pnlPct: -10,
      thesisHealth: {
        health: 46,
        entryIndex: 60,
        currentIndex: 46,
        delta: -14,
        rung: "degraded",
        rungLabel: "Degraded",
        pillars: [
          {
            id: "structure",
            label: "Persistence",
            weight: 0.28,
            commitScore: 0.4,
            currentScore: 0.35,
            commitLabel: "unknown",
            currentLabel: "unknown",
            status: "intact",
            contributionPts: 10,
            deltaPts: -1,
          },
        ],
        moves: [],
        committedAtEt: null,
        computedAtEt: "10:00 ET",
        advisory: "Thesis fading — tighten risk or trim into strength.",
        thesisBreakLevel: "warn",
      },
    }),
    asOf: "2026-09-05T20:00:00.000Z",
    sessionDate: "2026-09-05",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
  };
  const section = holdPlanSection(ctx);
  assert.ok(section);
  assert.match(
    section!.body,
    /Round-tripped past breakeven.*was up \*\*133%\*\* at peak, now \*\*-10%\*\*/,
  );
  // The round-trip bullet must NOT claim "into strength" — the play just round-tripped past
  // breakeven into a loss, so there is no strength left to trim into. Same contradiction class
  // fixed in actionNarrative's TRIM branch (FINDINGS 2026-09-10) but this sibling call site was
  // missed by that fix's blast-radius check — live reproduction on SWING:NN:32, 2026-09-10.
  assert.doesNotMatch(section!.body, /consider trim into strength/);
  assert.match(section!.body, /consider protecting what's left/);
});

test("holdPlanSection: null when no unique hold-plan content beyond Management", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({
      status: "HOLD",
      recommendation: "HOLD",
      recNote: "only note",
      contract: "90C",
    }),
    asOf: "2026-09-05T20:00:00.000Z",
    sessionDate: "2026-09-05",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
  };
  assert.equal(holdPlanSection(ctx), null);
});

test("deskConsensusSection: null when only NH direction / 0DTE stance (covered by crossDeskCoaching)", () => {
  const eco: EcosystemContext = {
    nighthawk_recent: {
      edition_for: "2026-09-05",
      direction: "long",
      conviction: "high",
      outcome: "",
    },
    zerodte_today: { direction: "long", score: 82 },
  };
  assert.equal(deskConsensusSection(eco, fixturePlay()), null);
});

test("deskConsensusSection: narrates NH outcome history when present", () => {
  const eco: EcosystemContext = {
    nighthawk_recent: {
      edition_for: "2026-09-04",
      direction: "long",
      conviction: "medium",
      outcome: "WIN",
    },
  };
  const section = deskConsensusSection(eco, fixturePlay({ direction: "LONG" }));
  assert.ok(section);
  assert.equal(section?.title, "Desk context");
  assert.match(section?.body ?? "", /closed \*\*WIN\*\*/i);
  assert.match(section?.body ?? "", /weigh that track record/i);
});

test("deskConsensusSection: attributes the outcome history to Night Hawk LEGACY, not the Swing engine itself", () => {
  // Live production wording: "Night Hawk's last swing on this name" inside a SWING play brief reads
  // as "this same engine's own prior position" — but `nighthawk_recent` is Legacy's next-day-digest
  // pick history (confirmed by the `edition_for` field, Legacy's own vocabulary), a different product.
  const eco: EcosystemContext = {
    nighthawk_recent: {
      edition_for: "2026-09-04",
      direction: "long",
      conviction: "medium",
      outcome: "WIN",
    },
  };
  const section = deskConsensusSection(eco, fixturePlay({ direction: "LONG" }));
  assert.ok(section);
  assert.match(section?.body ?? "", /Night Hawk Legacy's last pick/i);
  assert.doesNotMatch(section?.body ?? "", /Night Hawk's last swing/i);
});

test("deskConsensusSection: an unresolved last swing (outcome 'open') never reads as 'closed open' — a live contradiction", () => {
  // Reproduces a live production case: AAPL positionId 36's CLOSED brief cited Night Hawk's
  // last swing (2026-07-29) as "closed **open**" because outcome is "open" | "pending" |
  // "target" | "stop" | "ambiguous" | "unfilled" (play-outcomes.ts) and only "target"/"stop"
  // are actually terminal — "open" and "pending" mean the swing hasn't resolved yet.
  const eco: EcosystemContext = {
    nighthawk_recent: {
      edition_for: "2026-07-29",
      direction: "long",
      conviction: "medium",
      outcome: "open",
    },
  };
  const section = deskConsensusSection(eco, fixturePlay({ direction: "LONG" }));
  assert.ok(section);
  assert.doesNotMatch(section?.body ?? "", /closed \*\*open\*\*/i);
  assert.match(section?.body ?? "", /still \*\*unresolved\*\*/i);
});

test("deskConsensusSection: outcome 'pending' also reads as unresolved, not closed", () => {
  const eco: EcosystemContext = {
    nighthawk_recent: {
      edition_for: "2026-07-29",
      direction: "short",
      conviction: "medium",
      outcome: "pending",
    },
  };
  const section = deskConsensusSection(eco, fixturePlay({ direction: "SHORT" }));
  assert.ok(section);
  assert.doesNotMatch(section?.body ?? "", /closed \*\*pending\*\*/i);
  assert.match(section?.body ?? "", /still \*\*unresolved\*\*/i);
});

test("deskConsensusSection: CLOSED bucket drops the 'before sizing' live-decision framing", () => {
  // Reproduces a live production case: AAPL positionId 36 is CLOSED (STOPPED, -56.2%) but its
  // brief's "Desk context" section still read "weigh that track record against today's LONG
  // setup before sizing" — sizing language on a trade that already exited. Same defect class as
  // watchForSection (#4570) and vectorDeskSection (#4571): a bucket-blind section rendering live,
  // forward-looking guidance for a play that has already resolved.
  const eco: EcosystemContext = {
    nighthawk_recent: {
      edition_for: "2026-07-29",
      direction: "long",
      conviction: "medium",
      outcome: "WIN",
    },
  };
  const section = deskConsensusSection(eco, fixturePlay({ direction: "LONG" }), "closed");
  assert.ok(section);
  assert.doesNotMatch(section?.body ?? "", /before sizing/i);
  assert.match(section?.body ?? "", /closed \*\*WIN\*\*/i);
  assert.match(section?.body ?? "", /for reference against/i);
});

test("deskConsensusSection: CLOSED bucket suppresses a Legacy pick dated AFTER the trade's own exit — cannot be 'reference against the setup this play traded' if it postdates the trade", () => {
  // Live repro (2026-09-12, real CLOSED position AAPL positionId 36): the swing position closed
  // 2026-09-04, but nighthawk_recent.edition_for read 2026-09-11 — a full week AFTER the trade
  // already exited. The existing staleness gate (added 2026-09-10) compares edition_for against
  // `sessionDate` (today), which is *always* satisfied for a CLOSED play once enough real time has
  // passed for edition_for to fall within the 4-day window of "today" — it never checks the fact
  // that actually matters for a CLOSED bucket: whether the Legacy pick could possibly have existed
  // AT THE TIME the trade was live. A pick from after the trade closed cannot be "reference against
  // the setup this play traded" (play-brief-intel.ts's own CLOSED-bucket tail wording) — it is
  // information from the future relative to that decision.
  const eco: EcosystemContext = {
    nighthawk_recent: {
      edition_for: "2026-09-11",
      direction: "long",
      conviction: "medium",
      outcome: "unresolved",
    },
  };
  const section = deskConsensusSection(
    eco,
    fixturePlay({ direction: "LONG", exitAt: "2026-09-04T13:45:00.000Z" }),
    "closed",
    "2026-09-12",
  );
  assert.equal(section, null);
});

test("deskConsensusSection: CLOSED bucket still narrates a Legacy pick dated at-or-before the trade's own exit, within the window", () => {
  const eco: EcosystemContext = {
    nighthawk_recent: {
      edition_for: "2026-09-02",
      direction: "long",
      conviction: "medium",
      outcome: "WIN",
    },
  };
  const section = deskConsensusSection(
    eco,
    fixturePlay({ direction: "LONG", exitAt: "2026-09-04T13:45:00.000Z" }),
    "closed",
    "2026-09-12",
  );
  assert.ok(section);
  assert.match(section?.body ?? "", /closed \*\*WIN\*\*/i);
});

test("deskConsensusSection: watch/open buckets are unchanged (default param, no regression)", () => {
  const eco: EcosystemContext = {
    nighthawk_recent: {
      edition_for: "2026-09-04",
      direction: "long",
      conviction: "medium",
      outcome: "WIN",
    },
  };
  const openSection = deskConsensusSection(eco, fixturePlay({ direction: "LONG" }), "open");
  const watchSection = deskConsensusSection(eco, fixturePlay({ direction: "LONG" }), "watch");
  assert.match(openSection?.body ?? "", /before sizing/i);
  assert.match(watchSection?.body ?? "", /before sizing/i);
});

test("deskConsensusSection: null when only flow anomaly (covered by flowNarrative + Flow & positioning)", () => {
  const eco: EcosystemContext = {
    recent_anomalies: [{ anomaly_type: "sweep_cluster", detail: "$4.2M call sweeps at 145" }],
  };
  assert.equal(deskConsensusSection(eco, fixturePlay()), null);
});

test("deskConsensusSection: a stale Legacy pick (>4 days old) is suppressed when sessionDate is known", () => {
  // Live production bug (2026-09-12, GOOGL): `nighthawk_recent` has no date filter — it is "the
  // last time this ticker appeared in Legacy," which can be weeks old. This section used to
  // narrate that unconditionally as current sizing context ("weigh that track record ... before
  // sizing") even though `unavailableSourcesFor()` (fixed 2026-09-10 for the identical staleness)
  // correctly labels the same fact "no recent Legacy edition for this ticker" in the same payload.
  const eco: EcosystemContext = {
    nighthawk_recent: {
      edition_for: "2026-08-26",
      direction: "short",
      conviction: "medium",
      outcome: "pending",
    },
  };
  const section = deskConsensusSection(eco, fixturePlay({ direction: "SHORT" }), "open", "2026-09-12");
  assert.equal(section, null);
});

test("deskConsensusSection: a recent Legacy pick (within the window) still narrates when sessionDate is known", () => {
  const eco: EcosystemContext = {
    nighthawk_recent: {
      edition_for: "2026-09-10",
      direction: "long",
      conviction: "medium",
      outcome: "WIN",
    },
  };
  const section = deskConsensusSection(eco, fixturePlay({ direction: "LONG" }), "open", "2026-09-12");
  assert.ok(section);
  assert.match(section?.body ?? "", /closed \*\*WIN\*\*/i);
});

test("deskConsensusSection: sessionDate omitted (default null) preserves prior unconditional behavior", () => {
  // Backward-compat: existing call sites (and the tests above this one) that don't pass a
  // sessionDate must not regress — the staleness gate only activates when one is supplied.
  const eco: EcosystemContext = {
    nighthawk_recent: {
      edition_for: "2026-08-26",
      direction: "long",
      conviction: "medium",
      outcome: "WIN",
    },
  };
  const section = deskConsensusSection(eco, fixturePlay({ direction: "LONG" }));
  assert.ok(section);
});

test("lessonsSection: a round-trip past breakeven never renders a nonsensical negative MFE capture", () => {
  // Reproduces a live production case: INTC:35 peak +25.7%, exited -40.8% used to render
  // "MFE capture: -158.9% of peak move" (exitPnlPct / peak * 100), a percentage with no honest reading.
  const section = lessonsSection(
    fixturePlay({
      status: "CLOSED",
      peak: 25.7,
      exitPnlPct: -40.8,
      mfeCapturePct: null,
      closedReason: "stopped",
    }),
  );
  assert.ok(section);
  assert.doesNotMatch(section!.body, /-158\.9%|MFE capture: \*\*-/i);
  assert.match(section!.body, /round-tripped past breakeven/i);
});

test("lessonsSection: omits the round-trip sentence when the Trade manager read section already stated it, but keeps the rest", () => {
  const play = fixturePlay({
    status: "CLOSED",
    peak: 1.3,
    exitPnlPct: -56.2,
    mfeCapturePct: null,
    closedReason: "stopped",
    archetype: "PULLBACK_CONTINUATION",
  });

  const withoutSuppression = lessonsSection(play);
  assert.ok(withoutSuppression);
  assert.match(withoutSuppression!.body, /round-tripped past breakeven/i);

  const suppressed = lessonsSection(play, true);
  assert.ok(suppressed);
  assert.doesNotMatch(suppressed!.body, /round-tripped past breakeven/i);
  // The rest of the post-mortem (peak/exit line, "gave back the move", exit reason, archetype tag)
  // is independent evidence and must survive the suppression, not just the duplicated sentence.
  assert.match(suppressed!.body, /gave back the move/i);
  assert.match(suppressed!.body, /stop loss/i);
  assert.match(suppressed!.body, /pullback continuation/i);
});

test("lessonsSection: omits the trim-rail advice and stop-loss advice when Trade manager read already stated them, but keeps everything independent", () => {
  // Live repro 2026-09-18 (NN:32, CLOSED, real production play-brief): "Trade manager read"
  // (closedCoaching) rendered "...tighten at first trim rail next time." and "...check if entry
  // was extended past invalidation." — "Lessons" then independently restated near-identical
  // advice for BOTH facts one section later in the same response. The prior roundTripAlreadyNoted
  // fix only deduped the round-trip FACT sentence, not these two advice clauses.
  const play = fixturePlay({
    status: "CLOSED",
    peak: 24.4,
    exitPnlPct: -60.3,
    mfeCapturePct: null,
    closedReason: "stopped",
    archetype: "PULLBACK_CONTINUATION",
  });

  const withoutSuppression = lessonsSection(play, false, false, false);
  assert.ok(withoutSuppression);
  assert.match(withoutSuppression!.body, /gave back the move/i);
  assert.match(withoutSuppression!.body, /stop loss/i);

  const suppressed = lessonsSection(play, false, true, true);
  assert.ok(suppressed);
  assert.doesNotMatch(suppressed!.body, /gave back the move/i);
  assert.doesNotMatch(suppressed!.body, /stop loss/i);
  // Independent evidence must survive: peak/exit line, archetype tag.
  assert.match(suppressed!.body, /Peak was/i);
  assert.match(suppressed!.body, /pullback continuation/i);
});

// Live repro 2026-09-13 (EWZ:29, CLOSED, real production play-brief): lessonsSection's own archetype
// tag used the same underscore-replace-only transform already fixed in play-brief.ts's Verdict line
// and play-brief-intel.ts's whyThisSetupSection (PR #4896) -- a third, missed call site. The SAME
// brief's Verdict/Why-this-setup lines correctly showed "Pullback continuation" (the canonical
// ARCHETYPE_META label) while this section's own tag showed the raw "PULLBACK CONTINUATION" --
// underscores replaced with spaces but never cased, and never routed through archetypeLabelFromRaw.
test("lessonsSection: Archetype tag uses the canonical humanized label, not the underscore-replace-only raw enum", () => {
  const section = lessonsSection(
    fixturePlay({
      status: "CLOSED",
      peak: 447.4,
      exitPnlPct: 438.8,
      mfeCapturePct: 98.1,
      closedReason: "target",
      archetype: "PULLBACK_CONTINUATION",
    }),
  );
  assert.ok(section);
  assert.match(section!.body, /Archetype \*\*Pullback continuation\*\*/);
  assert.doesNotMatch(section!.body, /PULLBACK CONTINUATION|PULLBACK_CONTINUATION/);
});

function fixtureVec(overrides: Partial<VectorFullState> = {}): VectorFullState {
  return {
    spot: 100,
    technicals: null,
    regime: null,
    play: null,
    ...overrides,
  } as unknown as VectorFullState;
}

test("catalystsSection: short vol ratio renders as a sane percent from a 0–1 fraction (audit #12)", () => {
  const section = catalystsSection({
    ticker: "CRWD",
    zerodte_today: null,
    nighthawk_recent: null,
    recent_audit_entries: [],
    recent_flow: null,
    recent_anomalies: [],
    flow_full_state: null,
    spx_play: null,
    spx_full_state: null,
    vector_full_state: null,
    gex_positioning: null,
    flow_feed_fresh: true,
    arsenal: {
      scope: "single_name",
      earnings: null,
      fundamentals: { days_to_cover: 3.4, short_volume_ratio: 0.6913, price_target: null, as_of: "2026-09-05" },
      related: null,
      news: null,
      macro: null,
      breadth: null,
      unavailable_sources: [],
    },
  } as import("@/lib/bie/ecosystem-context").EcosystemContext);
  assert.ok(section);
  assert.match(section!.body, /short vol ratio \*\*69%\*\*/);
  assert.doesNotMatch(section!.body, /6913%/);
});

test("catalystsSection: ancient short-interest as_of is omitted, not presented as current (Largo C3)", () => {
  // Same guard as play-brief.ts's evidenceFromContext short-interest entry (Largo C7 fix,
  // PR #5042) — catalystsSection reads the identical arsenal.fundamentals field and must not
  // present an 8+ month old FINRA read with the same unqualified confidence as a fresh one.
  const section = catalystsSection({
    ticker: "CRCG",
    zerodte_today: null,
    nighthawk_recent: null,
    recent_audit_entries: [],
    recent_flow: null,
    recent_anomalies: [],
    flow_full_state: null,
    spx_play: null,
    spx_full_state: null,
    vector_full_state: null,
    gex_positioning: null,
    flow_feed_fresh: true,
    arsenal: {
      scope: "single_name",
      earnings: null,
      fundamentals: { days_to_cover: 12.4, short_volume_ratio: 0.41, price_target: null, as_of: "2025-12-31" },
      related: null,
      news: null,
      macro: null,
      breadth: null,
      unavailable_sources: [],
    },
  } as import("@/lib/bie/ecosystem-context").EcosystemContext);
  assert.equal(section, null);
});

test("catalystsSection: headlines from a stale news read carry a staleness disclosure (Largo C2, 2026-09-18)", () => {
  // Live gap: `arsenal.news.as_of` (NewsResult.asOf, stamped once inside serverCache's cached
  // builder at true fetch time) can legitimately stay minutes stale under stale-while-revalidate
  // — the same exposure meridianCatalystSection already discloses for its own catalyst read.
  // catalystsSection was the one sibling that read a freshness-bearing field with zero disclosure.
  const staleAsOf = new Date(Date.now() - 20 * 60_000).toISOString(); // 20m old — well past the bound
  const section = catalystsSection({
    ticker: "CRWD",
    zerodte_today: null,
    nighthawk_recent: null,
    recent_audit_entries: [],
    recent_flow: null,
    recent_anomalies: [],
    flow_full_state: null,
    spx_play: null,
    spx_full_state: null,
    vector_full_state: null,
    gex_positioning: null,
    flow_feed_fresh: true,
    arsenal: {
      scope: "single_name",
      earnings: null,
      fundamentals: null,
      related: null,
      news: { count: 1, newest: staleAsOf, headlines: ["CrowdStrike stock moves higher"], as_of: staleAsOf },
      macro: null,
      breadth: null,
      unavailable_sources: [],
    },
  } as import("@/lib/bie/ecosystem-context").EcosystemContext);
  assert.ok(section);
  assert.match(section!.body, /\*\*Last snapshot\*\*.*old.*headlines may lag/s);
  assert.match(section!.body, /CrowdStrike stock moves higher/);
});

test("catalystsSection: headlines from a fresh news read carry NO staleness disclosure", () => {
  const freshAsOf = new Date(Date.now() - 5_000).toISOString(); // 5s old
  const section = catalystsSection({
    ticker: "CRWD",
    zerodte_today: null,
    nighthawk_recent: null,
    recent_audit_entries: [],
    recent_flow: null,
    recent_anomalies: [],
    flow_full_state: null,
    spx_play: null,
    spx_full_state: null,
    vector_full_state: null,
    gex_positioning: null,
    flow_feed_fresh: true,
    arsenal: {
      scope: "single_name",
      earnings: null,
      fundamentals: null,
      related: null,
      news: { count: 1, newest: freshAsOf, headlines: ["CrowdStrike stock moves higher"], as_of: freshAsOf },
      macro: null,
      breadth: null,
      unavailable_sources: [],
    },
  } as import("@/lib/bie/ecosystem-context").EcosystemContext);
  assert.ok(section);
  assert.doesNotMatch(section!.body, /Last snapshot/);
  assert.match(section!.body, /CrowdStrike stock moves higher/);
});

test("chartTechnicalsSection: bias reads bearish from the technicals on a SHORT play whose tape is entirely bullish (FINDINGS 2026-09-06 #13, INTC shape)", () => {
  // Reproduces the live INTC envelope: SHORT position, but EMA-up/above-VWAP/RSI-bull/CHOCH-up —
  // an entirely bullish technical picture. The badge must say bullish (the tape), not bearish
  // (the position direction it used to echo).
  const vec = fixtureVec({
    spot: 95,
    technicals: {
      vwap: 94.7,
      emaStack: "up",
      rsi: 67,
      macd: "bull",
      goldenPocket: null,
      structure: { type: "CHOCH", direction: "up", level: 94 },
    },
  });
  const section = chartTechnicalsSection(vec);
  assert.equal(section?.bias, "bullish");
});

test("chartTechnicalsSection: bias reads bearish from the technicals on a LONG play whose tape is entirely bearish (FINDINGS 2026-09-06 #13, NN shape)", () => {
  const vec = fixtureVec({
    spot: 15,
    technicals: {
      vwap: 15.29,
      emaStack: "down",
      rsi: 40,
      macd: "bear",
      goldenPocket: null,
      structure: { type: "BOS", direction: "down", level: 15.5 },
    },
  });
  const section = chartTechnicalsSection(vec);
  assert.equal(section?.bias, "bearish");
});

test("chartTechnicalsSection: Vector regime is labeled as dealer GAMMA posture, never bare long/short (2026-09-06)", () => {
  // Live NN repro: chart technicals showed "Vector regime: long" (long-GAMMA dealer posture)
  // immediately followed by the Vector desk section's own directional call "momentum short" for
  // the SAME ticker — bare "long"/"short" here reads as a contradicting directional signal, not
  // the unrelated gamma-regime fact it actually is.
  const vec = fixtureVec({
    spot: 15.18,
    technicals: {
      vwap: 15.29,
      emaStack: "down",
      rsi: 47,
      macd: "bear",
      goldenPocket: null,
      structure: { type: "BOS", direction: "down", level: 15.22 },
    },
    regime: { posture: "long" },
  });
  const section = chartTechnicalsSection(vec);
  assert.match(section!.body, /Dealer gamma regime: \*\*long gamma\*\*/);
  assert.doesNotMatch(section!.body, /Vector regime:/);
});

// BUG FIX (2026-09-15, Ask Largo standing mandate, live repro TSM WATCH brief): chartTechnicalsSection
// used to read vec.regime?.posture directly with no GEX-matrix fallback, so it silently OMITTED the
// "Dealer gamma regime" line whenever Vector's own read was "unknown" — even when a fresh GEX-matrix
// posture existed and the SAME brief's "Trade manager read" section (via resolveGammaPosture) showed
// a resolved answer for the identical fact. Not a wrong-value bug, a completeness gap.
test("chartTechnicalsSection: falls through to fresh GEX posture when Vector regime is 'unknown' and ctx is supplied", () => {
  const vec = fixtureVec({
    spot: 419.48,
    technicals: {
      vwap: 420,
      emaStack: "down",
      rsi: 45,
      macd: "bear",
      goldenPocket: null,
      structure: null,
    },
    regime: { posture: "unknown" },
  });
  const ctx = {
    play: fixturePlay(),
    asOf: "2026-09-14 21:07 ET",
    sessionDate: "2026-09-14",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: {
      ticker: "TSM",
      gex_positioning: {
        spot: 419.48,
        gamma_posture: "short",
      },
    } as SwingPlayBriefContext["ecosystem"],
    vector: vec,
  } as SwingPlayBriefContext;

  // Without ctx (old call shape): must keep the old silent-omission behavior — no regression for
  // any caller that hasn't been updated to pass ctx.
  const withoutCtx = chartTechnicalsSection(vec, "2026-09-14");
  assert.doesNotMatch(withoutCtx!.body, /Dealer gamma regime/);

  // With ctx (the real production call shape): must fall through to the fresh GEX-matrix posture.
  const withCtx = chartTechnicalsSection(vec, "2026-09-14", "watch", ctx);
  assert.match(
    withCtx!.body,
    /Dealer gamma regime: \*\*short gamma\*\*/,
    "must resolve from the GEX-matrix fallback instead of silently omitting the line",
  );
});

// FINDING (Ask Largo standing mandate, 2026-09-12): chartTechnicalsSection rendered TODAY's spot/
// EMA/VWAP/RSI/structure for a CLOSED play with no disclosure and a directional bias badge — unlike
// vectorDeskSection's already-fixed closed-bucket branch (forced neutral, "since this play closed"
// framing) a few sections later in the same envelope. Live repro: AAPL:36 (closed 2026-09-04)
// rendered "Chart technicals" full of live 2026-09-12 numbers with zero as-of-close framing.
test("chartTechnicalsSection: CLOSED bucket prefixes a current-not-as-traded disclosure and forces neutral bias", () => {
  const vec = fixtureVec({
    spot: 95,
    technicals: {
      vwap: 94.7,
      emaStack: "up",
      rsi: 67,
      macd: "bull",
      goldenPocket: null,
      structure: { type: "CHOCH", direction: "up", level: 94 },
    },
  });
  const closedSection = chartTechnicalsSection(vec, null, "closed");
  assert.ok(closedSection);
  assert.match(closedSection!.body, /Current chart read — not the technicals this trade closed under/);
  assert.equal(closedSection!.bias, "neutral", "closed bucket must not badge a directional bias");

  const openSection = chartTechnicalsSection(vec, null, "open");
  assert.ok(openSection);
  assert.doesNotMatch(openSection!.body, /Current chart read/, "open/watch buckets are unchanged");
  assert.equal(openSection!.bias, "bullish", "open bucket keeps its real technicals-derived bias");

  // Default (no bucket arg) must match every pre-existing call site — behavior unchanged.
  const defaultSection = chartTechnicalsSection(vec);
  assert.doesNotMatch(defaultSection!.body, /Current chart read/);
});

// A closed play with a live Vector snapshot carrying no actual technicals/spot content must still
// return null (not a section containing only the disclosure line, which would be a caveat about
// nothing).
test("chartTechnicalsSection: CLOSED bucket returns null rather than a disclosure-only section when there is no real content", () => {
  const vec = { spot: null, technicals: null, regime: null, play: null } as unknown as VectorFullState;
  assert.equal(chartTechnicalsSection(vec, null, "closed"), null);
});

// FINDING (Ask Largo standing mandate, 2026-09-12): same defect class — wallDynamicsSection
// rendered TODAY's building/fading wall events for a CLOSED play with no framing at all.
test("wallDynamicsSection: CLOSED bucket prefixes a current-not-as-traded disclosure", () => {
  const vec = fixtureVec({
    dataAgeMs: 1_000,
    wallEvents: [{ kind: "call_wall_building", strike: 105, message: "Call wall building at 105" }],
  });
  const closedSection = wallDynamicsSection(vec, null, "closed");
  assert.ok(closedSection);
  assert.match(closedSection!.body, /Current wall activity — not what this trade traded under/);

  const openSection = wallDynamicsSection(vec, null, "open");
  assert.ok(openSection);
  assert.doesNotMatch(openSection!.body, /Current wall activity/, "open/watch buckets are unchanged");

  // Default (no bucket arg) must match every pre-existing call site — behavior unchanged.
  const defaultSection = wallDynamicsSection(vec);
  assert.doesNotMatch(defaultSection!.body, /Current wall activity/);
});

test("vectorDeskSection: stale Vector play.bias must not badge bullish/bearish (Largo C2)", () => {
  const vec = fixtureVec({
    freshness: "stale",
    play: {
      bias: "long",
      headline: "Ride momentum",
      grade: "A",
      conviction: "high",
      thesis: "Breakout continuation",
      entryZone: "100-102",
      targets: ["110"],
      invalidation: "below 98",
      starred: ["watch 105"],
    },
  } as Partial<VectorFullState>);
  const section = vectorDeskSection(vec);
  assert.ok(section);
  assert.equal(section!.bias, "neutral", "stale Vector must not badge directional bias");
  assert.match(section!.body, /Last snapshot/i);
  assert.doesNotMatch(section!.body, /Breakout continuation/i, "stale Vector must not render thesis");
  assert.doesNotMatch(section!.body, /Entry zone/i);
});

test("vectorDeskSection: future-skewed Vector dataAgeMs (Infinity) renders 'clock-skewed', never the literal 'Infinitys' (Largo C2, 2026-09-16)", () => {
  const vec = fixtureVec({
    dataAgeMs: Number.POSITIVE_INFINITY,
    play: { bias: "long", headline: "Ride momentum", grade: "A" },
  } as Partial<VectorFullState>);
  const section = vectorDeskSection(vec);
  assert.ok(section);
  assert.match(section!.body, /Last snapshot/i);
  assert.match(section!.body, /\(~clock-skewed old\)/i);
  assert.doesNotMatch(section!.body, /Infinitys/i);
});

test("vectorDeskSection: live Vector play.bias badges bullish/bearish", () => {
  const live = vectorDeskSection(
    fixtureVec({
      freshness: "live",
      play: {
        bias: "long",
        headline: "Ride momentum",
        grade: "A",
        conviction: "high",
        thesis: "",
        entryZone: "",
        targets: [],
        invalidation: "",
        starred: [],
      },
    } as Partial<VectorFullState>),
  );
  assert.equal(live?.bias, "bullish");
});

// FINDINGS 2026-09-09 (live NRG repro): VectorPlayEmit.starred is documented (vector-play-engine.ts)
// to ALWAYS have the headline as its first element. The section rendered the headline once via
// `p.headline`, then rendered `p.starred.slice(0, 4)` as "Watch now:" — re-showing the same headline
// text as the first "watch now" bullet.
test("vectorDeskSection: 'Watch now' list does not repeat the headline (starred[0] IS the headline)", () => {
  const section = vectorDeskSection(
    fixtureVec({
      freshness: "live",
      play: {
        bias: "long",
        headline: "POSITION · pivot at the 119.71 gamma flip",
        grade: "B",
        conviction: 60,
        thesis: "",
        entryZone: "",
        targets: [],
        invalidation: "",
        starred: ["POSITION · pivot at the 119.71 gamma flip", "Flip cross imminent — watch 119.71"],
      },
    } as Partial<VectorFullState>),
  );
  assert.ok(section);
  const headlineOccurrences = (section!.body.match(/POSITION · pivot at the 119\.71 gamma flip/g) ?? []).length;
  assert.equal(headlineOccurrences, 1, `headline must appear once, not repeated in "Watch now": ${section!.body}`);
  assert.match(section!.body, /\*\*Watch now:\*\*\n• Flip cross imminent — watch 119\.71/);
});

test("vectorDeskSection: omits 'Watch now' entirely when starred has only the headline", () => {
  const section = vectorDeskSection(
    fixtureVec({
      freshness: "live",
      play: {
        bias: "long",
        headline: "Ride momentum",
        grade: "A",
        conviction: "high",
        thesis: "",
        entryZone: "",
        targets: [],
        invalidation: "",
        starred: ["Ride momentum"],
      },
    } as Partial<VectorFullState>),
  );
  assert.ok(section);
  assert.doesNotMatch(section!.body, /Watch now/);
});

test("vectorDeskSection: CLOSED bucket suppresses the live entry/targets/invalidation/watch-now directive block (bucket-blind Vector desk, 2026-09-07)", () => {
  // Live production repro (CCI/AMZN/GLW/NOW closed positions, 2026-09-07): vectorDeskSection had
  // no bucket parameter at all and rendered the FULL live, current-moment Vector recommendation
  // ("Watch now: POSITION · momentum long on continuation -> target 1sigma 264.84", entry zone,
  // targets, invalidation) under a CLOSED play's brief — reading as an actionable call to re-enter
  // a trade that already exited days earlier, badged bullish/bearish as if it were guidance on the
  // closed position. Same defect class already fixed for watchForSection's closed-bucket framing.
  const vec = fixtureVec({
    freshness: "live",
    play: {
      bias: "long",
      headline: "POSITION · momentum long on continuation -> target 1sigma 264.84",
      grade: "B",
      conviction: 68,
      thesis: "Short gamma amplifies the move: go WITH strength, not against it.",
      entryZone: "long on strength / pullback hold",
      targets: ["1sigma 264.84", "call wall 270"],
      invalidation: "5m close < 266.06",
      // starred[0] is always the headline (VectorPlayEmit convention) — a second real item is
      // needed here so the open-bucket assertion below exercises "Watch now" actually rendering
      // something, not the headline echoed back at itself.
      starred: ["POSITION · momentum long on continuation -> target 1sigma 264.84", "Flip cross imminent — watch 266.06"],
    },
  } as Partial<VectorFullState>);

  const closed = vectorDeskSection(vec, null, "closed");
  assert.ok(closed);
  assert.equal(closed!.bias, "neutral", "closed bucket must not badge a live directional call");
  assert.doesNotMatch(closed!.body, /Entry zone/i);
  assert.doesNotMatch(closed!.body, /Targets:/i);
  assert.doesNotMatch(closed!.body, /Invalidation:/i);
  assert.doesNotMatch(closed!.body, /Watch now/i);
  assert.doesNotMatch(closed!.body, /momentum long on continuation/i);
  assert.match(closed!.body, /since this play closed/i);

  // open/watch buckets are unchanged — still render the full live directive block.
  const open = vectorDeskSection(vec, null, "open");
  assert.ok(open);
  assert.equal(open!.bias, "bullish");
  assert.match(open!.body, /Entry zone/i);
  assert.match(open!.body, /Watch now/i);
});

test("chartTechnicalsSection: bias is neutral on a genuine split vote (2-2), never fabricated", () => {
  const vec = fixtureVec({
    spot: 105, // above vwap -> bull
    technicals: {
      vwap: 100,
      emaStack: "down", // bear
      rsi: 50,
      macd: "bull", // bull
      goldenPocket: null,
      structure: { type: "BOS", direction: "down", level: 90 }, // bear
    },
  });
  const section = chartTechnicalsSection(vec);
  assert.equal(section?.bias, "neutral");
});

test("dataFreshnessSection: option mark timestamp renders as a Largo C1 ET stamp, never a raw UTC instant (FINDINGS 2026-09-06 #21)", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({ markAsOf: "2026-09-04T21:45:18.663Z" }),
    asOf: "2026-09-05 16:00 ET",
    sessionDate: "2026-09-05",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
  };
  const section = dataFreshnessSection(ctx);
  assert.match(section!.body, /2026-09-04 17:45 ET/);
  assert.doesNotMatch(section!.body, /\.663Z/, "must not print a raw ISO mark timestamp");
});

test("dataFreshnessSection: stale option mark on an OPEN position is labeled stale, not a bare 'as of' (Largo C2, 2026-09-16)", () => {
  // Same three-way-disagreement bug the evidence[]/unavailableSources[] arrays already guard
  // against (optionMarkIsStale/collectOptionMarkStalenessAbsence) — this section, the one named
  // for freshness disclosure, must not be the one place that stays silent on a stale mark.
  const staleMarkAsOf = new Date(Date.now() - 20 * 60_000).toISOString();
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({ status: "OPEN", markAsOf: staleMarkAsOf, markIsSync: false }),
    asOf: "2026-09-16 10:00 ET",
    sessionDate: "2026-09-16",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
  };
  const section = dataFreshnessSection(ctx);
  assert.match(section!.body, /Option mark \*\*stale\*\*/);
});

test("dataFreshnessSection: fresh option mark on an OPEN position still renders the plain 'as of' line (no regression)", () => {
  const freshMarkAsOf = new Date(Date.now() - 5 * 60_000).toISOString();
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({ status: "OPEN", markAsOf: freshMarkAsOf, markIsSync: false }),
    asOf: "2026-09-16 10:00 ET",
    sessionDate: "2026-09-16",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
  };
  const section = dataFreshnessSection(ctx);
  assert.match(section!.body, /Option mark as of \*\*/);
  assert.doesNotMatch(section!.body, /stale/i);
});

test("dataFreshnessSection: stale ecosystem.vector_full_state warns when ctx.vector is null", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay(),
    asOf: "2026-09-05 16:00 ET",
    sessionDate: "2026-09-05",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: {
      vector_full_state: fixtureVec({ dataAgeMs: 180_000 }),
    } as EcosystemContext,
    vector: null,
  };
  const section = dataFreshnessSection(ctx);
  assert.match(section!.body, /Vector data \*\*180s\*\* old/);
});

test("dataFreshnessSection: prior-session scan warns when scanSessionDay lags sessionDate", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay(),
    asOf: "2026-09-06 09:00 ET",
    sessionDate: "2026-09-06",
    scanAsOf: "2026-09-05T20:00:00.000Z",
    scanSessionDay: "2026-09-05",
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
  };
  const section = dataFreshnessSection(ctx);
  assert.match(section!.body, /prior session 2026-09-05/);
  assert.match(section!.body, /today's discovery not yet run/);
});

test("dataFreshnessSection: closed play with markIsSync does not warn mark age unknown", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({ status: "CLOSED", markIsSync: true, markAsOf: null }),
    asOf: "2026-09-06 09:00 ET",
    sessionDate: "2026-09-06",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
  };
  const section = dataFreshnessSection(ctx);
  assert.equal(section, null, "closed play with no live mark should not emit a freshness section");
});

test("dataFreshnessSection: WATCH play with markIsSync does not warn mark age unknown", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({ status: "WATCH", markIsSync: true, markAsOf: null }),
    asOf: "2026-09-06 09:00 ET",
    sessionDate: "2026-09-06",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
  };
  const section = dataFreshnessSection(ctx);
  assert.equal(section, null, "WATCH static chain mid should not emit mark-age warning");
});

test("dataFreshnessSection: bias is never directional — a sync-quote-without-timestamp caveat is a DATA QUALITY fact, not a market read, and must not render as a Bearish pill (Ask Largo 2026-09-11)", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({ status: "OPEN", direction: "LONG", markIsSync: true, markAsOf: null }),
    asOf: "2026-09-06 09:00 ET",
    sessionDate: "2026-09-06",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
  };
  const section = dataFreshnessSection(ctx);
  assert.ok(section, "OPEN play with an unsynced mark must still emit the freshness caveat");
  assert.match(section!.body, /Mark age unknown/);
  // BieBias (bullish/bearish/neutral/mixed) renders a directional pill in the UI
  // (BiasPill, src/features/largo/answer/BieChips.tsx) — labeling a data-freshness
  // caveat "bearish" tells a member the desk sees a bearish signal on a LONG play
  // that has none; freshness/data-quality gaps are neutral facts, not market reads.
  assert.equal(
    section!.bias,
    "neutral",
    "a mark-timestamp caveat must never render as a directional (bearish) pill",
  );
});

test("dataFreshnessSection: stale HELIX pipeline warns when flow_feed_fresh is false", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay(),
    asOf: "2026-09-06 10:00 ET",
    sessionDate: "2026-09-06",
    scanAsOf: "2026-09-06T14:30:00.000Z",
    scanSessionDay: "2026-09-06",
    laneRows: [],
    meridian: null,
    ecosystem: { flow_feed_fresh: false } as EcosystemContext,
    vector: null,
  };
  const section = dataFreshnessSection(ctx);
  assert.match(section!.body, /HELIX flow: \*\*pipeline stale\*\*/);
  assert.match(section!.body, /tape read may lag/);
});

// ── CLOSED plays must not narrate "today's" live-desk staleness (FINDINGS 2026-09-12) ──────────
// A CLOSED play is a historical record; scan/Vector/GEX/HELIX staleness are all claims about
// TODAY's live desk state and fire forever once ANY time has passed since close if left ungated —
// reproduced live on a real INTC brief read a full week after the play closed.

test("dataFreshnessSection: CLOSED play suppresses prior-session scan staleness narration", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({ status: "CLOSED" }),
    asOf: "2026-09-11 16:00 ET",
    sessionDate: "2026-09-11",
    scanAsOf: "2026-08-04T20:00:00.000Z",
    scanSessionDay: "2026-08-04",
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
  };
  const section = dataFreshnessSection(ctx);
  assert.equal(section, null, "a CLOSED play must not narrate a live discovery-scan staleness claim");
});

test("dataFreshnessSection: CLOSED play suppresses stale HELIX pipeline narration", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({ status: "CLOSED" }),
    asOf: "2026-09-11 16:00 ET",
    sessionDate: "2026-09-11",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: { flow_feed_fresh: false } as EcosystemContext,
    vector: null,
  };
  const section = dataFreshnessSection(ctx);
  assert.equal(section, null, "a CLOSED play must not narrate live HELIX pipeline staleness");
});

test("dataFreshnessSection: CLOSED play suppresses stale GEX matrix and Vector data-age narration", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({ status: "CLOSED" }),
    asOf: "2026-09-11 16:00 ET",
    sessionDate: "2026-09-11",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: {
      gex_positioning: { spot: 100, gamma_posture: "long", matrix_age_sec: 200, freshness: "cached" },
      vector_full_state: fixtureVec({ dataAgeMs: 180_000 }),
    } as EcosystemContext,
    vector: null,
  };
  const section = dataFreshnessSection(ctx);
  assert.equal(section, null, "a CLOSED play must not narrate live GEX/Vector staleness");
});

test("dataFreshnessSection: an OPEN play with the exact same stale inputs still narrates them (not over-suppressed)", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({ status: "OPEN" }),
    asOf: "2026-09-11 16:00 ET",
    sessionDate: "2026-09-11",
    scanAsOf: "2026-08-04T20:00:00.000Z",
    scanSessionDay: "2026-08-04",
    laneRows: [],
    meridian: null,
    ecosystem: { flow_feed_fresh: false } as EcosystemContext,
    vector: null,
  };
  const section = dataFreshnessSection(ctx);
  assert.ok(section, "a live OPEN play must still get its real staleness caveats");
  assert.match(section!.body, /today's discovery not yet run/);
  assert.match(section!.body, /HELIX flow: \*\*pipeline stale\*\*/);
});

test("dataFreshnessSection: stale GEX matrix warns when ctx.vector is null (Largo C2)", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay(),
    asOf: "2026-09-06 10:00 ET",
    sessionDate: "2026-09-06",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: {
      gex_positioning: {
        spot: 100,
        gamma_posture: "long",
        matrix_age_sec: 200,
        freshness: "cached",
      },
    } as EcosystemContext,
    vector: null,
  };
  const section = dataFreshnessSection(ctx);
  assert.match(section!.body, /GEX matrix \*\*200s\*\* old/);
  assert.match(section!.body, /dealer posture may lag spot/);
});

test("dataFreshnessSection: future-skewed Vector dataAgeMs (Infinity) renders 'clock-skewed', never the literal 'Infinitys' (Largo C2, 2026-09-16)", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay(),
    asOf: "2026-09-16 10:00 ET",
    sessionDate: "2026-09-16",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: fixtureVec({ dataAgeMs: Number.POSITIVE_INFINITY }),
  };
  const section = dataFreshnessSection(ctx);
  assert.match(section!.body, /Vector data \*\*clock-skewed\*\* old/);
  assert.doesNotMatch(section!.body, /Infinitys/);
});

test("dataFreshnessSection: null Vector dataAgeMs still flags staleness via vec.freshness (Largo C2, 2026-09-16)", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay(),
    asOf: "2026-09-16 10:00 ET",
    sessionDate: "2026-09-16",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: fixtureVec({ dataAgeMs: undefined, freshness: "stale" }),
  };
  const section = dataFreshnessSection(ctx);
  assert.match(section!.body, /Vector data \*\*clock-skewed\*\* old/);
});

test("dataFreshnessSection: future-skewed GEX matrix age fails closed instead of silently reading as fresh (Largo C2, 2026-09-16)", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay(),
    asOf: "2026-09-16 10:00 ET",
    sessionDate: "2026-09-16",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: {
      gex_positioning: {
        spot: 100,
        gamma_posture: "long",
        matrix_age_sec: -500,
        freshness: "cached",
      },
    } as EcosystemContext,
    vector: null,
  };
  const section = dataFreshnessSection(ctx);
  assert.ok(section, "a future-skewed GEX matrix must fail closed, not render as silently fresh");
  assert.match(section!.body, /GEX matrix \*\*clock-skewed\*\* old/);
});

test("gexPostureSection: stale matrix prefixes Last snapshot, suppresses gamma posture (Largo C2)", () => {
  const section = gexPostureSection({
    play: fixturePlay(),
    asOf: "2026-09-06 10:00 ET",
    sessionDate: "2026-09-06",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: {
      gex_positioning: {
        spot: 100,
        gamma_posture: "long",
        net_gex: 5_000_000,
        matrix_age_sec: 200,
        freshness: "cached",
      },
    } as EcosystemContext,
    vector: null,
  });
  assert.ok(section);
  assert.equal(section!.title, "GEX posture");
  assert.match(section!.body, /Last snapshot/i);
  assert.match(section!.body, /200s old/i);
  assert.doesNotMatch(section!.body, /long gamma/i, "stale GEX-only posture must not render as live");
  assert.doesNotMatch(section!.body, /Net GEX/i, "stale matrix numeric fields must not render as live");
});

test("gexPostureSection: future-skewed GEX matrix age renders 'clock-skewed', not a negative number (Largo C2, 2026-09-16)", () => {
  const section = gexPostureSection({
    play: fixturePlay(),
    asOf: "2026-09-06 10:00 ET",
    sessionDate: "2026-09-06",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: {
      gex_positioning: {
        spot: 100,
        gamma_posture: "long",
        net_gex: 5_000_000,
        matrix_age_sec: -500,
        freshness: "cached",
      },
    } as EcosystemContext,
    vector: null,
  });
  assert.ok(section);
  assert.match(section!.body, /Last snapshot/i);
  assert.match(section!.body, /\(~clock-skewed old\)/i);
  assert.doesNotMatch(section!.body, /-500s/);
});

// FINDING 2026-09-11 (Ask Largo monitor cycle, live MSTR:33): gexPostureSection's "Nearest wall"
// line read ONLY `gex.nearest_wall` (derived purely from the raw GEX-matrix call_wall/put_wall),
// while "Levels on chart" (chartLevelsSection) already prefers a live Vector-ladder wall over the
// GEX matrix — the same "two different precedence rules for one conceptual level" defect class
// already fixed for GEX king strike on 2026-09-09. Live evidence: MSTR:33 rendered "Put wall
// (GEX): 125.00" in "Levels on chart" (Vector ladder) but "Nearest wall: 120.00 (support, -7.3
// pts...)" in "GEX posture" (raw GEX-matrix put_wall) for the SAME spot (127.25) in the SAME
// envelope — 125 is also numerically nearer to spot than 120, so the un-reconciled number was
// both a different source AND a worse "nearest" by the matrix's own raw levels.
test("gexPostureSection: nearest wall prefers a live Vector ladder wall over the GEX matrix, matching Levels-on-chart precedence", () => {
  const section = gexPostureSection({
    play: fixturePlay(),
    asOf: "2026-09-06 10:00 ET",
    sessionDate: "2026-09-06",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: {
      gex_positioning: {
        spot: 127.25,
        gamma_posture: "short",
        net_gex: 17_800_000,
        call_wall: 135,
        put_wall: 120,
        nearest_wall: { strike: 120, kind: "support", distance_pts: -7.25 },
        matrix_age_sec: 30,
        freshness: "live",
      },
    } as EcosystemContext,
    vector: {
      spot: 127.25,
      dataAgeMs: 1_000,
      freshness: "live",
      gexWalls: { putWalls: [{ strike: 125 }], callWalls: [{ strike: 135 }] },
    } as unknown as VectorFullState,
  });
  assert.ok(section);
  assert.match(
    section!.body,
    /Nearest wall: \*\*125\.00\*\* \(support, -2\.3 pts from spot \*\*127\.25\*\*\)/,
    "must show the live Vector ladder's nearer put wall (125), not the GEX matrix one (120)",
  );
  assert.doesNotMatch(section!.body, /120\.00/);
});

// FINDING (Ask Largo standing mandate, 2026-09-12): gexPostureSection rendered TODAY's dealer
// posture for a CLOSED play with no disclosure at all — unlike vectorDeskSection/watchForSection/
// dataFreshnessSection, which were already fixed the same day for the identical defect class (a
// closed brief presenting live/current data as if it described the trade's own conditions). Live
// repro: AAPL:36 (closed 2026-09-04) rendered "Gamma posture: dealers long gamma" on 2026-09-12
// with zero indication this was today's read, not the trade's.
test("gexPostureSection: CLOSED bucket prefixes a current-not-as-traded disclosure", () => {
  const closedSection = gexPostureSection({
    play: fixturePlay({ status: "CLOSED" }),
    asOf: "2026-09-12 10:00 ET",
    sessionDate: "2026-09-12",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: {
      gex_positioning: {
        spot: 100,
        gamma_posture: "long",
        net_gex: 5_000_000,
        matrix_age_sec: 10,
        freshness: "live",
      },
    } as EcosystemContext,
    vector: null,
  });
  assert.ok(closedSection);
  assert.match(closedSection!.body, /Current dealer posture — not what this trade traded under/);

  const openSection = gexPostureSection({
    play: fixturePlay({ status: "OPEN" }),
    asOf: "2026-09-12 10:00 ET",
    sessionDate: "2026-09-12",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: {
      gex_positioning: {
        spot: 100,
        gamma_posture: "long",
        net_gex: 5_000_000,
        matrix_age_sec: 10,
        freshness: "live",
      },
    } as EcosystemContext,
    vector: null,
  });
  assert.ok(openSection);
  assert.doesNotMatch(openSection!.body, /Current dealer posture/, "open/watch buckets are unchanged");
});

test("chartTechnicalsSection: stale Vector snapshot neutralizes bias and omits live-looking technicals (Largo C2)", () => {
  const vec = fixtureVec({
    spot: 95,
    dataAgeMs: 200_000,
    play: { grade: "A" },
    technicals: {
      vwap: 94.7,
      emaStack: "up",
      rsi: 67,
      macd: "bull",
      goldenPocket: null,
      structure: { type: "CHOCH", direction: "up", level: 94 },
    },
  });
  const section = chartTechnicalsSection(vec);
  assert.equal(section?.bias, "neutral");
  assert.match(section!.body, /Last snapshot/i);
  assert.match(section!.body, /200s old/i);
  assert.match(section!.body, /from prior snapshot/i);
  assert.doesNotMatch(section!.body, /Spot:/i, "stale Vector spot must not render as live");
  assert.doesNotMatch(section!.body, /EMA 9\/21\/50/i, "stale EMA stack must not render as live");
  assert.doesNotMatch(section!.body, /VWAP/i, "stale VWAP must not render as live");
  assert.doesNotMatch(section!.body, /RSI:/i, "stale RSI must not render as live");
});

test("chartTechnicalsSection: future-skewed Vector dataAgeMs (Infinity) renders 'clock-skewed', never the literal 'Infinitys' (Largo C2, 2026-09-16)", () => {
  const vec = fixtureVec({
    spot: 95,
    dataAgeMs: Number.POSITIVE_INFINITY,
    play: { grade: "A" },
  });
  const section = chartTechnicalsSection(vec);
  assert.ok(section);
  assert.match(section!.body, /Last snapshot/i);
  assert.match(section!.body, /\(~clock-skewed old\)/i);
  assert.doesNotMatch(section!.body, /Infinitys/i);
});

test("chartLevelsSection: stale Vector omits max pain / dark pool / confluence (Largo C2)", () => {
  const section = chartLevelsSection({
    play: fixturePlay(),
    asOf: "2026-09-06 10:00 ET",
    sessionDate: "2026-09-06",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: fixtureVec({
      spot: 100,
      dataAgeMs: 200_000,
      maxPain: 98,
      darkPoolLevels: [{ strike: 99, pct: 40, premium: 5_000_000 }],
      confluenceZones: [{ center: 101, kinds: ["gex"], score: 80 }],
    }),
  });
  assert.equal(section, null, "stale Vector-only levels must not render a section");
});

// FINDING (Ask Largo standing mandate, 2026-09-15): fmtDist passed a SIGNED delta straight into
// fmtOptionUsd, whose own doc comment says it is "never signed" — negatives already carry a minus
// from `.toFixed(2)`, so prepending "$" produced "$-19.48" instead of "-$19.48" for every level
// below spot (fmt-money.ts's sibling `fmtPremium` already documents this exact trap: "Sign OUTSIDE
// the currency glyph so negatives read '-$1.2M', never '$-1.2M'" — fmtDist never got that fix).
// Live-confirmed on essentially every real brief with a below-spot level (TSM/ORCL/GOOG/AAPL/CRWD/
// NN/CG/RBLU/GMEU/DNA/SOFX/STLN, 2026-09-15).
test("chartLevelsSection: put wall distance below spot renders sign OUTSIDE the glyph (\"-$X\"), never \"$-X\"", () => {
  const section = chartLevelsSection({
    play: fixturePlay(),
    asOf: "2026-09-06 10:00 ET",
    sessionDate: "2026-09-06",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: {
      spot: 419.48,
      gexWalls: { putWalls: [{ strike: 400 }], callWalls: [] },
    } as VectorFullState,
  });
  assert.ok(section);
  assert.match(section!.body, /-\$19\.48 from spot/);
  assert.doesNotMatch(section!.body, /\$-/);
});

// FINDING (Ask Largo standing mandate, 2026-09-15): the dark-pool line formatted a summed
// institutional block-print notional (routinely hundreds of thousands to tens of millions of
// dollars) through `fmtOptionUsd` — a 2-decimal per-contract PRICE formatter — instead of the
// compact-magnitude `fmtPremium` the sibling `narrateDarkPool` (play-brief-narrative.ts) already
// uses for the identical `premium` field. Not live-confirmed (no ticker checked 2026-09-15 carried
// a populated darkPoolLevels array) but the defect is unconditional.
test("chartLevelsSection: dark pool level premium renders as a compact magnitude (\"$X.XM\"), not a raw per-contract price", () => {
  const section = chartLevelsSection({
    play: fixturePlay(),
    asOf: "2026-09-06 10:00 ET",
    sessionDate: "2026-09-06",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: {
      spot: 100,
      darkPoolLevels: [{ strike: 99, pct: 40, premium: 5_230_000 }],
    } as VectorFullState,
  });
  assert.ok(section);
  assert.match(section!.body, /\$5\.2M/);
  assert.doesNotMatch(section!.body, /\$5230000/);
});

// FINDING 2026-09-08 (Ask Largo monitor cycle): a confluence node's score is a weighted sum of
// half-point weights (call-wall 3, gamma-flip 2.5, max-pain 2, ...), so it can legitimately land
// on a half-point like 7.5 — but this section rounded it to a whole number (`.toFixed(0)`) while
// `confluenceCoaching`'s "Trade manager read" line displayed the SAME zone's SAME score unrounded.
// A member reading both sections for the SAME node saw two different numbers (7.5 vs 8) for what
// is one figure computed once — not real cross-product disagreement, just inconsistent display
// precision. Both sites now render `.toFixed(1)`.
test("chartLevelsSection: confluence score renders at one-decimal precision, not rounded to a whole number", () => {
  const section = chartLevelsSection({
    play: fixturePlay(),
    asOf: "2026-09-06 10:00 ET",
    sessionDate: "2026-09-06",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: fixtureVec({
      spot: 100,
      confluenceZones: [{ center: 101, kinds: ["gamma-flip", "call-wall"], score: 7.5 }],
    }),
  });
  assert.ok(section);
  assert.match(section!.body, /score 7\.5/, "must show the real half-point score, not rounded");
  assert.doesNotMatch(section!.body, /score 8\b/, "must not round 7.5 up to 8");
});

// BUG FIX (2026-09-14, Ask Largo standing mandate, live repro NAIL): "Confluence nodes" used to
// join a zone's `kinds` bare, sharing the exact "call-wall" name with the single top-ranked wall
// shown 3 lines above ("Call wall (GEX): 40.00") even when the confluence engine picked a
// LOWER-ranked wall at a materially different price (35.00) -- the two "call wall" figures in the
// SAME section silently disagreed with nothing to explain why. play-brief.ts's structured `levels`
// array already disambiguated this (2026-09-13); this prose call site never picked up the fix.
test("chartLevelsSection: 'Confluence nodes' disambiguates a zone's wall price when it differs from the primary wall shown above (live NAIL repro)", () => {
  const section = chartLevelsSection({
    play: fixturePlay(),
    asOf: "2026-09-14 10:00 ET",
    sessionDate: "2026-09-14",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: fixtureVec({
      spot: 33,
      gexWalls: { callWalls: [{ strike: 40 }], putWalls: [] },
      confluenceZones: [
        {
          center: 35,
          low: 34.5,
          high: 35.5,
          score: 5.0,
          kinds: ["call-wall", "max-pain"],
          levels: [
            { price: 35, kind: "call-wall" },
            { price: 35, kind: "max-pain" },
          ],
        },
      ],
    }),
  });
  assert.ok(section);
  assert.match(section!.body, /\*\*Call wall \(GEX\):\*\* 40\.00/, "the primary wall line itself is untouched");
  assert.match(
    section!.body,
    /\*\*35\.00\*\* \(call-wall@35\+max-pain, score 5\.0\)/,
    "the confluence node must disclose its OWN wall price (35), not silently share the primary wall's name (40)",
  );
});

// Sibling: when the confluence zone's wall genuinely agrees with the primary wall, the label
// stays plain -- the fix must not qualify every kind unconditionally.
test("chartLevelsSection: 'Confluence nodes' keeps the plain kind name when the zone's wall matches the primary wall", () => {
  const section = chartLevelsSection({
    play: fixturePlay(),
    asOf: "2026-09-14 10:00 ET",
    sessionDate: "2026-09-14",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: fixtureVec({
      spot: 33,
      gexWalls: { callWalls: [{ strike: 40 }], putWalls: [] },
      confluenceZones: [
        {
          center: 40,
          low: 39.5,
          high: 40.5,
          score: 5.0,
          kinds: ["call-wall", "max-pain"],
          levels: [
            { price: 40, kind: "call-wall" },
            { price: 40, kind: "max-pain" },
          ],
        },
      ],
    }),
  });
  assert.ok(section);
  assert.match(section!.body, /\*\*40\.00\*\* \(call-wall\+max-pain, score 5\.0\)/);
  assert.doesNotMatch(section!.body, /call-wall@/);
});

test("watchForSection: stale GEX-only flip and put wall omitted from watch levels (Largo C2)", () => {
  const section = watchForSection(
    {
      play: fixturePlay({ direction: "LONG" }),
      asOf: "2026-09-06 10:00 ET",
      sessionDate: "2026-09-06",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: {
        gex_positioning: {
          spot: 100,
          flip: 99,
          put_wall: 98,
          matrix_age_sec: 200,
          freshness: "cached",
        },
      } as EcosystemContext,
      vector: null,
    },
    "open",
  );
  assert.doesNotMatch(section.body, /Lose gamma flip/i);
  assert.doesNotMatch(section.body, /put wall \*\*/i);
});

test("watchForSection: stale Vector put wall omitted even when GEX matrix is live (Largo C2)", () => {
  const section = watchForSection(
    {
      play: fixturePlay({ direction: "LONG" }),
      asOf: "2026-09-06 10:00 ET",
      sessionDate: "2026-09-06",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: {
        gex_positioning: { spot: 100, freshness: "live" },
      } as EcosystemContext,
      vector: {
        spot: 100,
        dataAgeMs: 200_000,
        gexWalls: { putWalls: [{ strike: 98 }], callWalls: [] },
      } as unknown as VectorFullState,
    },
    "open",
  );
  assert.doesNotMatch(section.body, /put wall \*\*98\.00\*\*/);
});

test("watchForSection: stale Vector + stale GEX must not resolve spot from GEX fallback (Largo C2)", () => {
  const section = watchForSection(
    {
      play: fixturePlay({ direction: "LONG" }),
      asOf: "2026-09-06 10:00 ET",
      sessionDate: "2026-09-06",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: {
        gex_positioning: {
          spot: 100,
          flip: 99,
          matrix_age_sec: 200,
          freshness: "cached",
        },
      } as EcosystemContext,
      vector: {
        dataAgeMs: 200_000,
        freshness: "stale",
        gammaFlip: 99,
      } as unknown as VectorFullState,
    },
    "open",
  );
  assert.doesNotMatch(section.body, /Lose gamma flip/i);
});

test("watchForSection: live Vector put wall still shown when GEX matrix is stale (per-wall gate)", () => {
  const section = watchForSection(
    {
      play: fixturePlay({ direction: "LONG" }),
      asOf: "2026-09-06 10:00 ET",
      sessionDate: "2026-09-06",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: {
        gex_positioning: {
          spot: 100,
          put_wall: 97,
          matrix_age_sec: 200,
          freshness: "cached",
        },
      } as EcosystemContext,
      vector: {
        spot: 100,
        gexWalls: { putWalls: [{ strike: 98 }], callWalls: [] },
      } as unknown as VectorFullState,
    },
    "open",
  );
  assert.match(section.body, /put wall \*\*98\.00\*\*/);
});

// Live 2026-09-12: a member read "Flag anchor" (the PINNED first-flagged reference price) as the
// actionable entry level, which it is not — entryTriggerUnderlyingPx is the live level that
// actually flips PRE_TRIGGER/FORMING to AT_TRIGGER/TRIGGERED, and the two can diverge once a
// dossier refreshes its plan on a later scan pass.
test("watchForSection: entry trigger level is shown distinctly from the flag anchor, watch bucket only", () => {
  const section = watchForSection(
    {
      play: fixturePlay({ direction: "LONG", flagUnderlyingPx: 175.87, entryTriggerUnderlyingPx: 182.5 }),
      asOf: "2026-09-12 10:00 ET",
      sessionDate: "2026-09-12",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: null,
      vector: null,
    },
    "watch",
  );
  assert.match(section.body, /Flag anchor: \*\*175\.87\*\*/);
  assert.match(section.body, /Entry trigger: \*\*182\.50\*\*/);
  assert.match(section.body, /Break\/reclaim above/);
});

// BUG FIX (Ask Largo standing mandate, 2026-09-12): the "Entry trigger" bullet used to claim,
// unconditionally, that crossing this level "is what actually fires the setup" — false once the
// setup itself is dead. Live repro: SKHY WATCH brief with `setupState: "INVALIDATED"` (thesis
// already broken) where spot had ALREADY crossed the stated trigger with no entry firing —
// directly contradicting the sentence next to the number. The level itself stays (still useful
// context); only the false causal claim is corrected.
test("watchForSection: entry trigger claim is corrected, not fabricated, once the setup is INVALIDATED", () => {
  const section = watchForSection(
    {
      play: fixturePlay({
        direction: "LONG",
        entryTriggerUnderlyingPx: 177.0,
        setupState: "INVALIDATED",
      }),
      asOf: "2026-09-12 10:00 ET",
      sessionDate: "2026-09-12",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: null,
      vector: null,
    },
    "watch",
  );
  assert.match(section.body, /Entry trigger: \*\*177\.00\*\*/);
  assert.doesNotMatch(section.body, /this is what actually fires the setup/);
  assert.match(section.body, /thesis already invalidated — this level no longer fires the setup/);
});

// Live repro, second shape: MRVL WATCH brief past its entry-validity DEADLINE
// (`watchEntryExpired: true`, entry-enterability.ts's `pastEntryDeadline`) — the headline
// correctly says EXPIRED, but "Watch levels" (this section) still framed the same trigger as
// live and actionable with no cross-reference to that framing.
test("watchForSection: entry trigger claim is corrected, not fabricated, once the entry-validity window has expired", () => {
  const section = watchForSection(
    {
      play: fixturePlay({
        direction: "LONG",
        entryTriggerUnderlyingPx: 221.25,
        watchEntryExpired: true,
      }),
      asOf: "2026-09-12 10:00 ET",
      sessionDate: "2026-09-12",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: null,
      vector: null,
    },
    "watch",
  );
  assert.match(section.body, /Entry trigger: \*\*221\.25\*\*/);
  assert.doesNotMatch(section.body, /this is what actually fires the setup/);
  assert.match(section.body, /entry-validity window expired — this level no longer fires the setup/);
});

// A live, still-enterable WATCH play (neither INVALIDATED nor past its entry-validity deadline)
// must keep the original, correct causal claim — this fix must not soften a claim that is true.
test("watchForSection: a live, still-enterable trigger keeps the unqualified causal claim", () => {
  const section = watchForSection(
    {
      play: fixturePlay({
        direction: "LONG",
        entryTriggerUnderlyingPx: 182.5,
        setupState: "TRIGGERED",
        watchEntryExpired: false,
      }),
      asOf: "2026-09-12 10:00 ET",
      sessionDate: "2026-09-12",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: null,
      vector: null,
    },
    "watch",
  );
  assert.match(section.body, /Entry trigger: \*\*182\.50\*\* — Break\/reclaim above this is what actually fires the setup/);
});

test("watchForSection: entry trigger phrasing mirrors below for SHORT direction", () => {
  const section = watchForSection(
    {
      play: fixturePlay({ direction: "SHORT", entryTriggerUnderlyingPx: 342.5 }),
      asOf: "2026-09-12 10:00 ET",
      sessionDate: "2026-09-12",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: null,
      vector: null,
    },
    "watch",
  );
  assert.match(section.body, /Entry trigger: \*\*342\.50\*\*/);
  assert.match(section.body, /Break\/reclaim below/);
});

test("watchForSection: entry trigger is omitted (never fabricated) when null, and never shown outside the watch bucket", () => {
  const withoutTrigger = watchForSection(
    {
      play: fixturePlay({ direction: "LONG", entryTriggerUnderlyingPx: null }),
      asOf: "2026-09-12 10:00 ET",
      sessionDate: "2026-09-12",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: null,
      vector: null,
    },
    "watch",
  );
  assert.doesNotMatch(withoutTrigger.body, /Entry trigger:/);

  const openBucket = watchForSection(
    {
      play: fixturePlay({ direction: "LONG", entryTriggerUnderlyingPx: 182.5 }),
      asOf: "2026-09-12 10:00 ET",
      sessionDate: "2026-09-12",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: null,
      vector: null,
    },
    "open",
  );
  assert.doesNotMatch(openBucket.body, /Entry trigger:/);
});

// BUG FIX (2026-09-12): `watchForSection`'s "Before entry, clear:" bullet used to re-render each
// gate's full `code: reason` text — but `watchEntrySection` (play-brief.ts, "Entry" section, which
// composeSwingPlayBrief always places BEFORE this section for a WATCH play) already renders the
// IDENTICAL `play.gateBlocks` list in full under "Gates blocking entry:". Live repro: ORCL WATCH
// brief 2026-09-12, both sections printed the same `g_s4_regime`/`g_s14_cortex` reason strings
// verbatim. This test pins the NEW behavior: a short count + pointer, not a second full copy.
test("watchForSection: gate-block bullet is a count + pointer, not a second full copy of Entry's reason text", () => {
  const section = watchForSection(
    {
      play: fixturePlay({
        direction: "LONG",
        gateBlocks: [
          { code: "g_s4_regime", reason: "Broad-market regime degraded — desk will not open new swings (WATCH only)." },
          { code: "g_s14_cortex", reason: "Cortex preflight vetoed this setup — desk will not open." },
        ],
      }),
      asOf: "2026-09-12 10:00 ET",
      sessionDate: "2026-09-12",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: null,
      vector: null,
    },
    "watch",
  );
  assert.match(section.body, /\*\*Before entry, clear:\*\* 2 gates — see Entry section above\./);
  // The full reason text must NOT be duplicated here — its one home is the Entry section.
  assert.doesNotMatch(section.body, /Broad-market regime degraded/);
  assert.doesNotMatch(section.body, /Cortex preflight vetoed/);
});

// BUG FIX (Ask Largo standing mandate, 2026-09-17): `watchForSection`'s "Watch levels" section
// re-rendered `play.entryStatus` as its own "Entry geometry" bullet — but `watchEntrySection`
// (play-brief.ts, "Entry" section, which composeSwingPlayBrief always places BEFORE this section
// for a WATCH play) already renders the IDENTICAL fact as its own "Entry geometry" bullet. Live
// repro: TSM WATCH brief 2026-09-17, "## Entry" printed "Entry geometry: **AT_TRIGGER**" and
// "## Watch levels" printed it again three sections later as "Entry geometry: **AT TRIGGER**" —
// same fact, inconsistent formatting (raw enum vs humanized), exactly the duplication shape the
// gate-block bullet above was already fixed to avoid. Unlike gateBlocks there is no count worth
// preserving here (it's a single scalar, not a list), so the second copy is dropped outright
// rather than replaced with a pointer.
test("watchForSection: entry geometry is not duplicated — its one home is the Entry section above", () => {
  const section = watchForSection(
    {
      play: fixturePlay({ direction: "LONG", entryStatus: "AT_TRIGGER" }),
      asOf: "2026-09-17 10:00 ET",
      sessionDate: "2026-09-17",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: null,
      vector: null,
    },
    "watch",
  );
  assert.doesNotMatch(section.body, /Entry geometry:/);
});

test("chartLevelsSection: stale GEX-only walls, flip, and king omitted (Largo C2)", () => {
  const section = chartLevelsSection({
    play: fixturePlay(),
    asOf: "2026-09-06 10:00 ET",
    sessionDate: "2026-09-06",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: {
      gex_positioning: {
        spot: 100,
        call_wall: 105,
        put_wall: 95,
        flip: 99,
        gex_king_strike: 100,
        matrix_age_sec: 200,
        freshness: "cached",
      },
    } as EcosystemContext,
    vector: null,
  });
  assert.equal(section, null);
});

// FINDING (Ask Largo standing mandate, 2026-09-12): same defect class as gexPostureSection above —
// "Levels on chart" rendered TODAY's call/put wall + gamma flip for a CLOSED play with no framing,
// duplicating the already-disclosed "Since it closed" section's numbers but without its caveat.
test("chartLevelsSection: CLOSED bucket prefixes a current-not-as-traded disclosure", () => {
  const ecosystem = {
    gex_positioning: {
      spot: 100,
      call_wall: 105,
      put_wall: 95,
      flip: 99,
      gex_king_strike: 100,
      matrix_age_sec: 10,
      freshness: "live",
    },
  } as EcosystemContext;
  const closedSection = chartLevelsSection({
    play: fixturePlay({ status: "CLOSED" }),
    asOf: "2026-09-12 10:00 ET",
    sessionDate: "2026-09-12",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem,
    vector: null,
  });
  assert.ok(closedSection);
  assert.match(closedSection!.body, /Current levels — not what this trade traded under/);

  const openSection = chartLevelsSection({
    play: fixturePlay({ status: "OPEN" }),
    asOf: "2026-09-12 10:00 ET",
    sessionDate: "2026-09-12",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem,
    vector: null,
  });
  assert.ok(openSection);
  assert.doesNotMatch(openSection!.body, /Current levels/, "open/watch buckets are unchanged");
});

test("chartLevelsSection: live Vector put wall still shown when GEX matrix is stale (per-wall gate)", () => {
  const section = chartLevelsSection({
    play: fixturePlay(),
    asOf: "2026-09-06 10:00 ET",
    sessionDate: "2026-09-06",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: {
      gex_positioning: {
        spot: 100,
        call_wall: 105,
        put_wall: 95,
        flip: 99,
        matrix_age_sec: 200,
        freshness: "cached",
      },
    } as EcosystemContext,
    vector: {
      spot: 100,
      gexWalls: { putWalls: [{ strike: 94 }], callWalls: [] },
    } as VectorFullState,
  });
  assert.ok(section);
  assert.match(section!.body, /\*\*Put wall \(GEX\):\*\* 94\.00/);
  assert.doesNotMatch(section!.body, /Call wall/);
  assert.doesNotMatch(section!.body, /Gamma flip/);
});

// BUG FIX (2026-09-12): the "Nearest wall" line used to PREPEND "{strike} ({side}, {pct}% away) —"
// ahead of `vec.proximity.callout` — but the real `deriveWallProximity` callout (vector-wall-
// proximity.ts) already states the same strike/side/"wall" itself as a complete sentence. Live
// repro: AAPL closed-position swing brief 2026-09-12 — "Nearest wall: 332.50 (put, -0.0% away) —
// Testing 332.5 put wall (0.02% below) — dealers buy weakness...". The exact same duplication was
// independently found and fixed the same day at a different call site reading the identical
// `WallProximity` shape (vector-play-engine.ts's `starred` array) — this is a second instance.
test("chartLevelsSection: Nearest wall line is the real callout verbatim, not double-prefixed with the wall it already names", () => {
  const realisticCallout =
    "Testing 332.50 put wall (0.02% below) — dealers buy weakness; support unless it breaks on volume.";
  const section = chartLevelsSection({
    play: fixturePlay(),
    asOf: "2026-09-06 10:00 ET",
    sessionDate: "2026-09-06",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: {
      spot: 332.58,
      proximity: { strike: 332.5, side: "put", distancePct: -0.02, nearness: "at", callout: realisticCallout },
    } as VectorFullState,
  });
  assert.ok(section);
  assert.equal(
    section!.body.includes(`Nearest wall: ${realisticCallout}`),
    true,
    "Nearest wall line must be the callout verbatim (with its label), not a duplicated prefix ahead of it",
  );
  // Strike must appear exactly once — not once in a prefix and again inside the callout.
  const occurrences = section!.body.split("332.50").length - 1;
  assert.equal(occurrences, 1, `strike must appear exactly once, found ${occurrences}`);
});

test("chartLevelsSection: live Vector spot wins over stale GEX spot for wall distance (Largo C2)", () => {
  const section = chartLevelsSection({
    play: fixturePlay(),
    asOf: "2026-09-06 10:00 ET",
    sessionDate: "2026-09-06",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: {
      gex_positioning: {
        spot: 100,
        matrix_age_sec: 200,
        freshness: "cached",
      },
    } as EcosystemContext,
    vector: {
      spot: 102,
      gexWalls: { putWalls: [{ strike: 94 }], callWalls: [] },
    } as VectorFullState,
  });
  assert.ok(section);
  assert.match(section!.body, /-7\.8%/);
  assert.doesNotMatch(section!.body, /-6\.0%/);
});

test("chartLevelsSection: stale GEX king strike omitted even when Vector desk is present", () => {
  const section = chartLevelsSection({
    play: fixturePlay(),
    asOf: "2026-09-06 10:00 ET",
    sessionDate: "2026-09-06",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: {
      gex_positioning: {
        spot: 100,
        gex_king_strike: 100,
        matrix_age_sec: 200,
        freshness: "cached",
      },
    } as EcosystemContext,
    vector: {
      spot: 100,
      gexWalls: { putWalls: [{ strike: 94 }], callWalls: [] },
    } as VectorFullState,
  });
  assert.ok(section);
  assert.match(section!.body, /\*\*Put wall \(GEX\):\*\* 94\.00/);
  assert.doesNotMatch(section!.body, /GEX king strike/);
});

// FINDING 2026-09-09 (Ask Largo monitor cycle, live AAPL:36): chartLevelsSection's "GEX king
// strike" line read ONLY gex.gex_king_strike, with no Vector-ladder fallback — unlike call
// wall/put wall/gamma flip immediately above it in this same section, which all correctly
// prefer a live Vector reading (`vecX ?? gex?.x`), and unlike play-brief.ts's structured
// `levels` array and play-brief-narrative.ts's `focalLevelsFrom` (both `vecKing ?? kingFromGex`).
// Same envelope, same conceptual level, two different precedence rules: live prod showed
// "GEX king strike: 330.00" in this section's narrative text and "GEX king: 320.00" in the
// structured Key levels / Trade manager read for the SAME AAPL:36 brief.
test("chartLevelsSection: GEX king strike prefers a live Vector ladder king over the GEX matrix, matching the structured levels/narrative precedence", () => {
  const section = chartLevelsSection({
    play: fixturePlay(),
    asOf: "2026-09-06 10:00 ET",
    sessionDate: "2026-09-06",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: {
      gex_positioning: {
        spot: 100,
        gex_king_strike: 105,
        matrix_age_sec: 30,
        freshness: "live",
      },
    } as EcosystemContext,
    vector: {
      spot: 100,
      dataAgeMs: 1_000,
      freshness: "live",
      gexWalls: { putWalls: [{ strike: 94 }], callWalls: [] },
      ladder: { rows: [{ strike: 102, isKing: true }] },
    } as unknown as VectorFullState,
  });
  assert.ok(section);
  assert.match(section!.body, /GEX king strike: \*\*102\.00\*\*/, "must show the live Vector ladder's king strike, not the GEX matrix one");
  assert.doesNotMatch(section!.body, /105\.00/);
});

test("meridianCatalystSection: empty successful read states quiet calendar, not silence", () => {
  const section = meridianCatalystSection({
    play: fixturePlay(),
    asOf: "2026-09-06 09:00 ET",
    sessionDate: "2026-09-06",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: { as_of: "2026-09-06 09:00 ET", items: [], total_matched: 0 },
    ecosystem: null,
    vector: null,
  });
  assert.ok(section);
  assert.match(section!.body, /No catalysts in the \*\*14-day\*\* Meridian window/);
  assert.match(section!.body, /quiet, not missing/);
});

test("meridianCatalystSection: stale as_of (>120s, Largo C2) prefixes a Last snapshot caveat instead of reading as current", () => {
  // Real production shape: withServerCache's stale-while-revalidate path can keep serving the
  // same stored payload — and its true, un-bumped as_of — for up to 10 minutes under a degraded
  // Benzinga upstream (server-cache.ts MAX_STALE_AGE_MS). Prior to this fix `slice.as_of` was
  // captured on the type but never read here, so "calendar is quiet" could read as a fresh claim
  // while actually minutes stale.
  const readMs = Date.parse("2026-09-15T20:00:00.000Z");
  const origNow = Date.now;
  Date.now = () => readMs;
  try {
    const section = meridianCatalystSection({
      play: fixturePlay(),
      asOf: "2026-09-15 16:00 ET",
      sessionDate: "2026-09-15",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: { as_of: new Date(readMs - 300_000).toISOString(), items: [], total_matched: 0 },
      ecosystem: null,
      vector: null,
    });
    assert.ok(section);
    assert.match(section!.body, /Last snapshot/i);
    assert.match(section!.body, /~300s old/);
    assert.match(section!.body, /catalyst calendar may lag/);
    assert.match(section!.body, /No catalysts in the \*\*14-day\*\* Meridian window/);
  } finally {
    Date.now = origNow;
  }
});

test("meridianCatalystSection: future-skewed as_of renders 'clock-skewed', not a negative number (Largo C2, 2026-09-16)", () => {
  const readMs = Date.parse("2026-09-15T20:00:00.000Z");
  const origNow = Date.now;
  Date.now = () => readMs;
  try {
    const section = meridianCatalystSection({
      play: fixturePlay(),
      asOf: "2026-09-15 16:00 ET",
      sessionDate: "2026-09-15",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: { as_of: new Date(readMs + 300_000).toISOString(), items: [], total_matched: 0 },
      ecosystem: null,
      vector: null,
    });
    assert.ok(section);
    assert.match(section!.body, /Last snapshot/i);
  assert.match(section!.body, /\(~clock-skewed old\)/i);
    assert.doesNotMatch(section!.body, /-300s/);
  } finally {
    Date.now = origNow;
  }
});

test("meridianCatalystSection: fresh as_of renders with no Last snapshot caveat", () => {
  const readMs = Date.parse("2026-09-15T20:00:00.000Z");
  const origNow = Date.now;
  Date.now = () => readMs;
  try {
    const section = meridianCatalystSection({
      play: fixturePlay(),
      asOf: "2026-09-15 16:00 ET",
      sessionDate: "2026-09-15",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: { as_of: new Date(readMs - 30_000).toISOString(), items: [], total_matched: 0 },
      ecosystem: null,
      vector: null,
    });
    assert.ok(section);
    assert.doesNotMatch(section!.body, /Last snapshot/i);
    assert.match(section!.body, /No catalysts in the \*\*14-day\*\* Meridian window/);
  } finally {
    Date.now = origNow;
  }
});

test("meridianCatalystSection: does not restate the same earnings date catalystsSection already surfaced (audit #16)", () => {
  // Both sections read the SAME ticker's own upcoming earnings from two independently-sourced
  // reads: catalystsSection from arsenal.earnings (UW), meridianCatalystSection from the Meridian
  // Benzinga-backed timeline. When they land on the same date, showing both is the same fact
  // stated twice with no cross-reference — this test locks meridianCatalystSection to omit its
  // own copy of that one fact (while still surfacing any OTHER catalyst in the window).
  const ecosystem = {
    arsenal: {
      scope: "single_name",
      earnings: { earnings_date: "2026-09-10", days_until: 4, report_time: "premarket", is_confirmed: true },
      fundamentals: null,
      related: null,
      news: null,
      macro: null,
      breadth: null,
      unavailable_sources: [],
    },
  } as unknown as EcosystemContext;

  const catalysts = catalystsSection(ecosystem);
  assert.ok(catalysts);
  assert.match(catalysts!.body, /2026-09-10/);

  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({ ticker: "BBWI" }),
    asOf: "2026-09-06 09:00 ET",
    sessionDate: "2026-09-06",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    ecosystem,
    vector: null,
    meridian: {
      as_of: "2026-09-06 09:00 ET",
      items: [
        {
          id: "earnings:BBWI:2026-09-10",
          kind: "earnings",
          title: "BBWI earnings",
          subtitle: null,
          date: "2026-09-10",
          time: null,
          impact: "high",
          days_until: 4,
          ticker: "BBWI",
          date_status: null,
          importance: 3,
          is_printed: false,
          expected_move_pct: 8.5,
          sector_label: "Retail",
        },
      ],
      total_matched: 1,
    },
  };
  ctx.play.ticker = "BBWI";

  const meridian = meridianCatalystSection(ctx);
  // Not asserting null outright — Meridian may still have something to say (an "other catalyst"
  // framing), but it must never restate the exact earnings date catalystsSection already showed.
  if (meridian) {
    assert.doesNotMatch(
      meridian.body,
      /2026-09-10/,
      "meridianCatalystSection must not restate the same earnings date catalystsSection already surfaced",
    );
  }
});

test("meridianPeerSection: surfaces peer beat rates as dedicated section (not coaching-cap dependent)", () => {
  const section = meridianPeerSection({
    play: fixturePlay({ ticker: "BBWI" }),
    asOf: "2026-09-06 09:00 ET",
    sessionDate: "2026-09-06",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: {
      as_of: "2026-09-06 09:00 ET",
      items: [
        {
          id: "earnings:BBWI:2026-09-10",
          kind: "earnings",
          title: "BBWI earnings",
          subtitle: null,
          date: "2026-09-10",
          time: null,
          impact: "high",
          days_until: 4,
          ticker: "BBWI",
          date_status: null,
          importance: 3,
          is_printed: false,
          expected_move_pct: 8.5,
          sector_label: "Retail",
        },
      ],
      total_matched: 1,
    },
    meridianPeer: {
      available: true,
      id: "earnings:BBWI:2026-09-10",
      subject_ticker: "BBWI",
      position_summary: null,
      members: [
        {
          ticker: "ULTA",
          report_date: "2026-09-05",
          expected_move_pct: 6,
          avg_reaction_pct: -2,
          reaction_sample_n: 4,
          beat_rate: 0.75,
          beat_rate_n: 4,
          is_subject: false,
        },
      ],
      interpretation: "",
      sector_label: "Retail",
      major_group: "52",
      distribution: null,
      insufficient_reason: null,
    },
    ecosystem: null,
    vector: null,
  });
  assert.ok(section);
  assert.equal(section!.title, "Earnings peer lens");
  assert.match(section!.body, /ULTA/i);
  assert.match(section!.body, /75% beat/i);
});

test("meridianPeerSection: null for index swings (no per-name peer cohort)", () => {
  const section = meridianPeerSection({
    play: fixturePlay({ ticker: "SPY" }),
    asOf: "2026-09-06 09:00 ET",
    sessionDate: "2026-09-06",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: {
      as_of: "2026-09-06 09:00 ET",
      items: [
        {
          id: "earnings:AAPL:2026-09-10",
          kind: "earnings",
          title: "AAPL earnings",
          subtitle: null,
          date: "2026-09-10",
          time: null,
          impact: "high",
          days_until: 4,
          ticker: "AAPL",
          date_status: null,
          importance: 3,
          is_printed: false,
          expected_move_pct: 5,
          sector_label: "Tech",
        },
      ],
      total_matched: 1,
    },
    meridianPeer: null,
    ecosystem: null,
    vector: null,
  });
  assert.equal(section, null);
});

test("meridianPeerSection: dedicated section — coaching bullets must not duplicate peer lens", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({ ticker: "BBWI" }),
    asOf: "2026-09-06 09:00 ET",
    sessionDate: "2026-09-06",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: {
      as_of: "2026-09-06 09:00 ET",
      items: [
        {
          id: "earnings:BBWI:2026-09-10",
          kind: "earnings",
          title: "BBWI earnings",
          subtitle: null,
          date: "2026-09-10",
          time: null,
          impact: "high",
          days_until: 4,
          ticker: "BBWI",
          date_status: null,
          importance: 3,
          is_printed: false,
          expected_move_pct: 8.5,
          sector_label: "Retail",
        },
      ],
      total_matched: 1,
    },
    meridianPeer: {
      available: true,
      id: "earnings:BBWI:2026-09-10",
      subject_ticker: "BBWI",
      position_summary: null,
      members: [
        {
          ticker: "ULTA",
          report_date: "2026-09-05",
          expected_move_pct: 6,
          avg_reaction_pct: -2,
          reaction_sample_n: 4,
          beat_rate: 0.75,
          beat_rate_n: 4,
          is_subject: false,
        },
      ],
      interpretation: "",
      sector_label: "Retail",
      major_group: "52",
      distribution: null,
      insufficient_reason: null,
    },
    ecosystem: null,
    vector: null,
  };
  assert.ok(meridianPeerSection(ctx));
  const bullets = collectCoachingBullets(ctx, "watch", 100);
  assert.equal(
    bullets.filter((b) => /Earnings peer lens/i.test(b)).length,
    0,
    "peer lens belongs only in meridianPeerSection",
  );
  const narrative = tradeManagerNarrativeSection(ctx, "watch");
  if (narrative) {
    assert.equal(
      (narrative.body.match(/Earnings peer lens/gi) ?? []).length,
      0,
      "Trade manager read must not repeat dedicated peer section",
    );
  }
});

test("whyThisSetupSection: surfaces subLane alongside archetype", () => {
  const section = whyThisSetupSection(
    fixturePlay({ archetype: "BREAKOUT", subLane: "earnings_lead" }),
  );
  assert.match(section.body, /\*\*Archetype:\*\* Breakout continuation/);
  assert.match(section.body, /\*\*Sub-lane:\*\* earnings lead/);
});

// Live repro 2026-09-13 (COIN, WATCH, real production play-brief): the SAME archetype value
// rendered THREE differently-styled ways within one brief -- Verdict's raw enum ("Archetype:
// PULLBACK_CONTINUATION"), this section's own underscore-replace-only line ("Archetype: PULLBACK
// CONTINUATION"), and the Discovery-read/Cross-desk-friction lines' already-humanized
// ARCHETYPE_META label ("Pullback continuation"). A foreign/unclassifiable string (never seen on a
// real committed archetype in production -- TerminalPlay.archetype is populated only from
// classifyArchetype's own SwingArchetype union or null) now renders NOTHING rather than a blindly
// humanized guess, matching this repo's honest-absence discipline.
test("whyThisSetupSection: Archetype line uses the canonical humanized label, and omits a foreign/unclassifiable value rather than guessing", () => {
  const real = whyThisSetupSection(fixturePlay({ archetype: "PULLBACK_CONTINUATION" }));
  assert.match(real.body, /\*\*Archetype:\*\* Pullback continuation/);
  assert.doesNotMatch(real.body, /PULLBACK_CONTINUATION/);

  const foreign = whyThisSetupSection(fixturePlay({ archetype: "some_foreign_value" }));
  assert.doesNotMatch(foreign.body, /\*\*Archetype:\*\*/);
});

test("flowIntelSection: stale HELIX feed must not render recent prints or anomalies", () => {
  const eco = {
    ticker: "INTC",
    flow_feed_fresh: false,
    recent_flow: null,
    recent_anomalies: [{ anomaly_type: "sweep", detail: "big call sweep", direction: "bullish" }],
    flow_full_state: {
      recent: [{ option_type: "call", strike: 50, premium: 1_000_000 }],
    },
    zerodte_today: null,
    gex_positioning: null,
    arsenal: null,
    vector_full_state: null,
  } as EcosystemContext;

  const section = flowIntelSection(eco, fixturePlay());
  assert.equal(section, null, "stale feed with only cached prints/anomalies must not invent flow intel");
});

test("flowIntelSection: prior-session 0DTE must not render desk alignment (Largo C2)", () => {
  const eco = {
    ticker: "NRG",
    flow_feed_fresh: true,
    recent_flow: null,
    zerodte_today: {
      session_date: "2026-09-05",
      direction: "short",
      score: 78,
      conviction: "high",
      status: "flagged",
      first_flagged_at: "2026-09-05T14:00:00Z",
    },
  } as EcosystemContext;

  const section = flowIntelSection(eco, fixturePlay({ direction: "LONG" }), "2026-09-06");
  assert.equal(section, null, "yesterday's 0DTE stance must not read as live flow intel");
});

test("flowIntelSection: a committed CONDOR's nominal direction must not read as a directional alignment/conflict claim", () => {
  // A CONDOR's `direction` column is NOMINAL provenance only (the fade side of the pin it came
  // from) — the structure is delta-neutral, so comparing it against swing's directional call and
  // printing "aligned"/"conflict" fabricates a directional signal the 0DTE desk never took.
  const eco = {
    ticker: "SPY",
    flow_feed_fresh: true,
    recent_flow: null,
    zerodte_today: {
      session_date: "2026-09-11",
      direction: "long", // nominal fade-side only — real structure is neutral
      score: 78,
      conviction: "high",
      status: "committed",
      first_flagged_at: "2026-09-11T14:00:00Z",
      is_condor: true,
    },
  } as EcosystemContext;

  const section = flowIntelSection(eco, fixturePlay({ direction: "LONG" }), "2026-09-11");
  assert.ok(section, "condor row should still render a flow section");
  assert.doesNotMatch(section!.body, /\*\*aligned\*\*/);
  assert.doesNotMatch(section!.body, /\*\*conflict\*\*/);
  assert.match(section!.body, /sold iron condor/);
});

test("flowIntelSection: a non-condor directional 0DTE row still renders the aligned\\/conflict claim", () => {
  const eco = {
    ticker: "SPY",
    flow_feed_fresh: true,
    recent_flow: null,
    zerodte_today: {
      session_date: "2026-09-11",
      direction: "long",
      score: 78,
      conviction: "high",
      status: "committed",
      first_flagged_at: "2026-09-11T14:00:00Z",
      is_condor: false,
    },
  } as EcosystemContext;

  const section = flowIntelSection(eco, fixturePlay({ direction: "LONG" }), "2026-09-11");
  assert.ok(section);
  assert.match(section!.body, /\*\*aligned\*\*/);
});

test("flowIntelSection: a persisting anomaly re-written across two 30min cron cycles must render once, not twice", () => {
  // Live reproduction (NRG 2026-09-11): the market-regime-detector cron writes flow_anomalies
  // every 30min but only dedups (anomaly_type, ticker) within a 15-minute window at WRITE time,
  // so a pattern still active on the next cron cycle writes a second row with identical
  // anomaly_type/detail and only a newer detected_at. Undeduped, the brief rendered the exact
  // same "DIRECTIONAL_FLOW_SKEW" bullet twice in the "Flow anomalies" section.
  const eco = {
    ticker: "NRG",
    flow_feed_fresh: true,
    recent_flow: null,
    recent_anomalies: [
      {
        anomaly_type: "DIRECTIONAL_FLOW_SKEW",
        detail: "NRG: one-sided call flow — $0.7M calls vs no put premium",
        direction: "bullish",
      },
      {
        anomaly_type: "DIRECTIONAL_FLOW_SKEW",
        detail: "NRG: one-sided call flow — $0.7M calls vs no put premium",
        direction: "bullish",
      },
    ],
  } as EcosystemContext;

  const section = flowIntelSection(eco, fixturePlay());
  assert.ok(section);
  const occurrences = section!.body.split("DIRECTIONAL_FLOW_SKEW").length - 1;
  assert.equal(occurrences, 1, "identical anomaly_type+detail must render once, not once per write cycle");
});

test("flowIntelSection: two genuinely DIFFERENT anomalies on the same ticker both render", () => {
  const eco = {
    ticker: "NRG",
    flow_feed_fresh: true,
    recent_flow: null,
    recent_anomalies: [
      { anomaly_type: "DIRECTIONAL_FLOW_SKEW", detail: "NRG: call-skewed", direction: "bullish" },
      { anomaly_type: "PREMIUM_SPIKE", detail: "NRG: premium spike vs 20d avg", direction: null },
    ],
  } as EcosystemContext;

  const section = flowIntelSection(eco, fixturePlay());
  assert.ok(section);
  assert.match(section!.body, /DIRECTIONAL_FLOW_SKEW/);
  assert.match(section!.body, /PREMIUM_SPIKE/);
});

test("watchForSection: CLOSED bucket suppresses the live ticker-level thesis note (not this trade's thesis)", () => {
  // serving-ingest.ts computes thesisBreak from a LIVE, present-tense "is there a fresh setup on
  // this ticker right now" read — unrelated to the specific, already-resolved CLOSED position. Live
  // production (INTC positionId 35, 2026-09-07) rendered "Thesis **unknown** — no setup read
  // attached to this name yet" directly under a STOPPED outcome, implying the closed trade's own
  // thesis was still open. It must not appear for a closed play.
  const section = watchForSection(
    {
      play: fixturePlay({
        status: "CLOSED",
        direction: "SHORT",
        thesisBreak: { level: "unknown", note: "no setup read attached to this name yet" },
      }),
      asOf: "2026-09-07 16:15 ET",
      sessionDate: "2026-09-07",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: null,
      vector: null,
    },
    "closed",
  );
  assert.doesNotMatch(section.body, /Thesis \*\*/i);
  assert.equal(section.title, "Since it closed");
});

test("watchForSection: CLOSED bucket frames gamma flip as neutral positioning, not a live invalidation trigger", () => {
  // watch/open plays correctly get "Reclaim/Lose gamma flip ... invalidates thesis" — that IS the
  // live trigger to act on. A CLOSED play has no thesis left to invalidate, so the same imperative
  // phrasing misleadingly reads as guidance on a still-open position.
  const section = watchForSection(
    {
      play: fixturePlay({ status: "CLOSED", direction: "SHORT" }),
      asOf: "2026-09-07 16:15 ET",
      sessionDate: "2026-09-07",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: {
        gex_positioning: { spot: 95.8, flip: 99.31, freshness: "live" },
      } as EcosystemContext,
      vector: null,
    },
    "closed",
  );
  assert.doesNotMatch(section.body, /invalidates short thesis/i);
  assert.doesNotMatch(section.body, /turns against longs/i);
  assert.match(section.body, /Now trades \*\*95\.80\*\* vs gamma flip \*\*99\.31\*\*/);
});

test("watchForSection: watch/open buckets are unchanged — still show live thesis note and invalidation framing", () => {
  const section = watchForSection(
    {
      play: fixturePlay({
        status: "WATCH",
        direction: "SHORT",
        thesisBreak: { level: "unknown", note: "no setup read attached to this name yet" },
      }),
      asOf: "2026-09-07 16:15 ET",
      sessionDate: "2026-09-07",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: {
        gex_positioning: { spot: 95.8, flip: 99.31, freshness: "live" },
      } as EcosystemContext,
      vector: null,
    },
    "watch",
  );
  assert.match(section.body, /Thesis \*\*unknown\*\*/);
  assert.match(section.body, /Reclaim gamma flip \*\*99\.31\*\* — invalidates short thesis/);
  assert.equal(section.title, "Watch levels");
});

// Live repro 2026-09-13 (COIN WATCH brief): spot 174.98 vs flip 183.49 (spot well BELOW), direction
// LONG. The old code picked "Lose gamma flip" purely from `direction === "LONG"`, regardless of
// which side of the flip spot was actually on — but you can't "lose" a level you're already below.
// This directly contradicted the SAME brief's own "Dealer gamma regime: short gamma" line a few
// sections earlier. The four tests below pin all four (direction × spot-side) combinations.
test("watchForSection: LONG with spot ABOVE flip — still 'Lose', the level has something to lose", () => {
  const section = watchForSection(
    {
      play: fixturePlay({ status: "WATCH", direction: "LONG" }),
      asOf: "2026-09-07 16:15 ET",
      sessionDate: "2026-09-07",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: {
        gex_positioning: { spot: 190, flip: 183.49, freshness: "live" },
      } as EcosystemContext,
      vector: null,
    },
    "watch",
  );
  assert.match(section.body, /Lose gamma flip \*\*183\.49\*\* — dealer posture turns against longs/);
});

test("watchForSection: LONG with spot BELOW flip (live COIN repro) — 'Reclaim', not 'Lose' an already-lost level", () => {
  const section = watchForSection(
    {
      play: fixturePlay({ status: "WATCH", direction: "LONG" }),
      asOf: "2026-09-13 05:17 ET",
      sessionDate: "2026-09-12",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: {
        gex_positioning: { spot: 174.98, flip: 183.49, freshness: "live" },
      } as EcosystemContext,
      vector: null,
    },
    "watch",
  );
  assert.doesNotMatch(section.body, /Lose gamma flip/);
  assert.match(
    section.body,
    /Reclaim gamma flip \*\*183\.49\*\* — needed to restore dealer support for longs/,
  );
});

test("watchForSection: SHORT with spot ABOVE flip — 'Lose', needs to confirm the short (mirror of the LONG fix)", () => {
  const section = watchForSection(
    {
      play: fixturePlay({ status: "WATCH", direction: "SHORT" }),
      asOf: "2026-09-07 16:15 ET",
      sessionDate: "2026-09-07",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: {
        gex_positioning: { spot: 103, flip: 99.31, freshness: "live" },
      } as EcosystemContext,
      vector: null,
    },
    "watch",
  );
  assert.doesNotMatch(section.body, /Reclaim gamma flip/);
  assert.match(section.body, /Lose gamma flip \*\*99\.31\*\* — needed to confirm the short thesis/);
});

// Premium stop rail showed only the absolute dollar level ("thesis breaks if mark closes below
// $6.66"), forcing a member to mentally compute how much room the current mark still has before
// invalidation. Added a cushion percentage alongside the dollar level, computed the same way
// fmtDist already frames a spot-vs-level distance elsewhere in this file — additive only, the
// existing dollar level and "thesis breaks if..." wording are unchanged.
test("watchForSection: Premium stop rail shows the live cushion percentage above the stop, not just the dollar level", () => {
  const section = watchForSection(
    {
      play: fixturePlay({
        status: "HOLD",
        direction: "LONG",
        mark: 19.575,
        exitPolicy: {
          policy: "trim_scale",
          hard_stop_pct: -60,
          target_pct: 100,
          trim_levels: [],
          runner_fraction: 0.5,
          stop_premium: 6.66,
        },
      }),
      asOf: "2026-09-10 11:47 ET",
      sessionDate: "2026-09-10",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: null,
      vector: null,
    },
    "open",
  );
  // (19.575 - 6.66) / 19.575 * 100 = 65.96% -> 66%
  assert.match(section.body, /Premium stop rail: \*\*\$6\.66\*\* — 66% cushion from current mark/);
});

test("watchForSection: Premium stop rail omits the cushion note when mark is unavailable (never fabricated)", () => {
  const section = watchForSection(
    {
      play: fixturePlay({
        status: "HOLD",
        direction: "LONG",
        mark: null,
        exitPolicy: {
          policy: "trim_scale",
          hard_stop_pct: -60,
          target_pct: 100,
          trim_levels: [],
          runner_fraction: 0.5,
          stop_premium: 6.66,
        },
      }),
      asOf: "2026-09-10 11:47 ET",
      sessionDate: "2026-09-10",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: null,
      vector: null,
    },
    "open",
  );
  assert.match(section.body, /Premium stop rail: \*\*\$6\.66\*\* — thesis breaks if mark closes below/);
  assert.doesNotMatch(section.body, /cushion/);
});

// BUG FIX (2026-09-12, Ask Largo standing mandate, live repro EBS OPEN brief): `mark != null` alone
// is not "a real live mark" — a banger-lane row with no live quote synced yet carries
// `play.mark === play.entry` (the true entry-fallback echo, `markIsSync: true` + `pnlPct: null`,
// same signature `pnlSection`'s "Mark: unknown" already gates on) and the stop is set below entry
// by construction, so the old `mark > 0 && mark > stop` gate always passed for it too. EBS
// (entry/fallback-mark $0.10, stop $0.04) rendered "60% cushion from current mark" here in the
// SAME envelope whose Position section, a few lines above, correctly read "Mark: unknown _(sync
// quote, no live price yet — do not read as flat)_" — a confident percentage computed from the
// exact number the document itself says isn't known. The dollar stop level is still shown
// (real regardless of mark); only the fabricated cushion percentage is now omitted.
test("watchForSection: Premium stop rail omits the cushion note when the mark is the true entry-fallback echo (never fabricated)", () => {
  const section = watchForSection(
    {
      play: fixturePlay({
        status: "OPEN",
        direction: "LONG",
        entry: 0.1,
        mark: 0.1, // banger-lane fallback: mid = last_mark ?? entry_premium, no live quote yet
        markIsSync: true,
        pnlPct: null, // the true-fallback signature — no P&L basis exists because there is no real mark
        exitPolicy: {
          policy: "trim_scale",
          hard_stop_pct: -60,
          target_pct: 100,
          trim_levels: [],
          runner_fraction: 0.5,
          stop_premium: 0.04,
        },
      }),
      asOf: "2026-09-12 07:07 ET",
      sessionDate: "2026-09-12",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: null,
      vector: null,
    },
    "open",
  );
  assert.match(section.body, /Premium stop rail: \*\*\$0\.04\*\* — thesis breaks if mark closes below/);
  assert.doesNotMatch(section.body, /cushion/);
});

// BUG FIX (2026-09-12, live operator conversation, real NN#32 position): the cushion percentage
// is computed purely from `play.mark` (the MID) vs `stop` — it never checks whether the position's
// actual EXECUTABLE price (`play.execMark`, the bid a long would actually sell into) has already
// fallen to or through the stop. Live repro: NN's real contract carried mark $1.10 / stop $0.78 /
// execMark (bid) $0.70 — the brief rendered "Premium stop rail: $0.78 — 29% cushion from current
// mark", a confident safety-margin claim that does not survive the real bid/ask spread: a member
// selling right now would already be filling BELOW the stop rail the brief just told them they had
// 29% of room above. Same "plausible wrong number is worse than an obvious one" trap the Largo
// product contract's C4 identity section exists to prevent, and the same shape as the two fixes
// immediately above this one (mark-unavailable, entry-fallback-echo) — this is the third distinct
// way the mid-only cushion computation could misstate real safety margin.
test("watchForSection: Premium stop rail flags 'no real cushion' when the executable price has already reached the stop, even though mid is still above it", () => {
  const section = watchForSection(
    {
      play: fixturePlay({
        status: "HOLD",
        direction: "LONG",
        mark: 1.1,
        execMark: 0.7, // real bid — already AT/THROUGH the stop despite mid reading a 29% cushion
        exitPolicy: {
          policy: "trim_scale",
          hard_stop_pct: -60,
          target_pct: 100,
          trim_levels: [],
          runner_fraction: 0.5,
          stop_premium: 0.78,
        },
      }),
      asOf: "2026-09-12 16:47 ET",
      sessionDate: "2026-09-12",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: null,
      vector: null,
    },
    "open",
  );
  assert.match(section.body, /Premium stop rail: \*\*\$0\.78\*\*/);
  assert.match(section.body, /no real cushion/i);
  assert.doesNotMatch(section.body, /29% cushion/);
});

test("watchForSection: Premium stop rail keeps the normal cushion percentage when the executable price is still comfortably above the stop", () => {
  const section = watchForSection(
    {
      play: fixturePlay({
        status: "HOLD",
        direction: "LONG",
        mark: 1.1,
        execMark: 1.0, // executable price still well above the stop — normal case
        exitPolicy: {
          policy: "trim_scale",
          hard_stop_pct: -60,
          target_pct: 100,
          trim_levels: [],
          runner_fraction: 0.5,
          stop_premium: 0.78,
        },
      }),
      asOf: "2026-09-12 16:47 ET",
      sessionDate: "2026-09-12",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: null,
      vector: null,
    },
    "open",
  );
  // BUG FIX (2026-09-14): the cushion basis now prefers execMark (the real bid) over the mid
  // whenever both are known — (1.00 - 0.78) / 1.00 * 100 = 22.0% -> 22%, not the mid-based 29%.
  assert.match(section.body, /Premium stop rail: \*\*\$0\.78\*\* — 22% cushion from current bid/);
  assert.doesNotMatch(section.body, /29% cushion/);
  assert.doesNotMatch(section.body, /no real cushion/i);
});

// BUG FIX (2026-09-14, Ask Largo standing mandate, live repro SAME NN#32 position as the fix
// immediately above): the binary "gone" fix only handled the executable price already being
// AT/THROUGH the stop. The far more common state — execMark still above the stop but the mid-based
// cushion materially overstates the real room — was left completely unhandled: the cushion kept
// computing purely from the mid. Live repro: NN mark $1.13 / stop $0.78 / execMark (bid) $0.85 —
// execMark is above stop (so the "gone" branch never fires) but the REAL executable cushion is only
// (0.85-0.78)/0.85 = 8.2%, not the 31% the mid-only formula produced — a member deciding whether
// they have room before exiting was reading a number ~4x too generous on a real losing position.
test("watchForSection: Premium stop rail uses the executable (bid) cushion, not the more optimistic mid cushion, when they diverge but the position hasn't breached (live NN#32 repro)", () => {
  const section = watchForSection(
    {
      play: fixturePlay({
        status: "HOLD",
        direction: "LONG",
        mark: 1.13,
        execMark: 0.85, // real bid — above the stop, but the mid-based % would be far too generous
        exitPolicy: {
          policy: "trim_scale",
          hard_stop_pct: -60,
          target_pct: 100,
          trim_levels: [],
          runner_fraction: 0.5,
          stop_premium: 0.78,
        },
      }),
      asOf: "2026-09-14 12:17 ET",
      sessionDate: "2026-09-14",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: null,
      vector: null,
    },
    "open",
  );
  // (0.85 - 0.78) / 0.85 * 100 = 8.24% -> 8%, NOT the mid-based (1.13-0.78)/1.13*100 = 31%.
  assert.match(section.body, /Premium stop rail: \*\*\$0\.78\*\* — 8% cushion from current bid/);
  assert.doesNotMatch(section.body, /31% cushion/);
  assert.doesNotMatch(section.body, /no real cushion/i);
});

test("watchForSection: Premium stop rail falls back to the mid-based cushion when execMark is unknown (never fabricates a bid)", () => {
  const section = watchForSection(
    {
      play: fixturePlay({
        status: "HOLD",
        direction: "LONG",
        mark: 1.1,
        execMark: null,
        exitPolicy: {
          policy: "trim_scale",
          hard_stop_pct: -60,
          target_pct: 100,
          trim_levels: [],
          runner_fraction: 0.5,
          stop_premium: 0.78,
        },
      }),
      asOf: "2026-09-14 12:17 ET",
      sessionDate: "2026-09-14",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: null,
      vector: null,
    },
    "open",
  );
  // (1.10 - 0.78) / 1.10 * 100 = 29.09% -> 29%, correctly falling back to mark since no execMark.
  assert.match(section.body, /Premium stop rail: \*\*\$0\.78\*\* — 29% cushion from current mark/);
});

// Found during the 2026-09-11 Ask Largo catalysts-timing/cross-bucket-consistency pass. Same
// duplication class as #4261 (recNote/rails) and the thesis-health advisory fix above:
// catalystCoaching (play-brief-narrative-coaching.ts) already renders "Earnings in Nd (DATE) —
// size down or exit before report unless thesis is earnings-driven" into "Trade manager read"
// for every WATCH/OPEN play within 14 days of a known earnings date. holdPlanSection independently
// renders the near-identical sentence again into "Hold plan" for OPEN plays specifically — both
// sections render together for any live OPEN play (play-brief-intel.ts's buildIntelSections pushes
// `narrative` unconditionally and `hold` for bucket === "open"), so a member reading the full brief
// sees the same earnings warning twice, verbatim in substance.
test("holdPlanSection: does not repeat the near-term-earnings warning — already narrated by Trade manager read", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({
      status: "HOLD",
      recommendation: "HOLD",
      contract: "110C · 8DTE",
    }),
    asOf: "2026-09-10T20:00:00.000Z",
    sessionDate: "2026-09-10",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: {
      arsenal: {
        scope: "single_name",
        earnings: {
          earnings_date: "2026-09-18",
          days_until: 8,
          report_time: "premarket",
          is_confirmed: true,
        },
        fundamentals: null,
        related: null,
        news: null,
        macro: null,
        breadth: null,
        unavailable_sources: [],
      },
    } as unknown as EcosystemContext,
    vector: null,
  };
  const section = holdPlanSection(ctx);
  assert.ok(section);
  assert.doesNotMatch(section!.body, /\*\*Earnings in 8d\*\*/);
});

// The narrative sibling (catalystCoaching, play-brief-narrative-coaching.ts) still carries the
// warning for the exact same ctx — proof the fact isn't silently dropped, just no longer duplicated.
test("catalystCoaching: still carries the near-term-earnings warning (not duplicated, not dropped)", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({ status: "HOLD", recommendation: "HOLD", contract: "110C · 8DTE" }),
    asOf: "2026-09-10T20:00:00.000Z",
    sessionDate: "2026-09-10",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: {
      arsenal: {
        scope: "single_name",
        earnings: {
          earnings_date: "2026-09-18",
          days_until: 8,
          report_time: "premarket",
          is_confirmed: true,
        },
        fundamentals: null,
        related: null,
        news: null,
        macro: null,
        breadth: null,
        unavailable_sources: [],
      },
    } as unknown as EcosystemContext,
    vector: null,
  };
  const line = catalystCoaching(ctx);
  assert.ok(line);
  assert.match(line!, /\*\*Earnings in 8d\*\* \(2026-09-18/);
});
