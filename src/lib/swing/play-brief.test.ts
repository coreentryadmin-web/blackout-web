import test from "node:test";
import assert from "node:assert/strict";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import { composeSwingPlayBrief } from "./play-brief";
import type { SwingPlayBriefContext } from "./play-brief-types";
import type { SwingArchetypeTrackRecordSnapshot } from "./calibration-cache";
import type { HorizonPlay } from "@/lib/horizon-plays";

function fixturePlay(overrides: Partial<TerminalPlay> = {}): TerminalPlay {
  return {
    id: "SWING:INTC",
    ticker: "INTC",
    direction: "LONG",
    contract: "90C · 13DTE",
    score: 72,
    tierLabel: "B",
    status: "WATCH",
    horizon: "SWING",
    exitModel: "SCALE_OUT",
    recommendation: "BUY",
    recNote: "Pullback to entry zone — persistence confirmed.",
    factors: [
      { label: "Rel. strength", points: 18 },
      { label: "Regime", points: 12 },
    ],
    regime: "Sector rotation · regime 0.82",
    archetype: "BREAKOUT",
    servingSection: "WAITING_FOR_ENTRY",
    setupState: "FORMING",
    entryStatus: "PRE_TRIGGER",
    swingEntryAction: "buy",
    gateBlocks: [{ code: "G-S6", reason: "Bucket not graduated" }],
    thesisBreak: { level: "intact", note: "Structure holding" },
    ...overrides,
  };
}

test("composeSwingPlayBrief: WATCH WAIT recommendation uses WAIT label, not raw HOLD (verdict parity)", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({ recommendation: "HOLD", swingEntryAction: undefined, status: "WATCH" }),
    asOf: "2026-09-07T02:59:00.000Z",
    sessionDate: "2026-09-07",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
  };
  const brief = composeSwingPlayBrief(ctx);
  const entry = brief.envelope.sections.find((s) => s.title === "Entry");
  assert.ok(entry, "expected Entry section");
  assert.match(entry!.body, /\*\*Entry stance:\*\* WAIT/);
  assert.doesNotMatch(entry!.body, /\*\*Entry stance:\*\* HOLD/);
});

// Live repro 2026-09-11 (Ask Largo standing mandate — multi-position-same-ticker identity check):
// APPS/BAND/INSP/TWST each carried TWO concurrent, genuinely independent live Banger-engine
// positions on the same ticker (different strike/expiry/entry/P&L) because
// `horizonPlayFromBangerPosition` never stamps `HorizonPlay.positionId` even though it is
// documented as the ticker-collision disambiguator. A ticker-only brief request silently resolved
// to ONE of them with no indication the other existed. This must now be disclosed.
test("composeSwingPlayBrief: OPEN play with a same-ticker sibling live position discloses it (does not silently hide it)", () => {
  const siblingRow: HorizonPlay = {
    ticker: "APPS",
    direction: "LONG",
    horizon: "SWING",
    score: 64,
    status: "COMMIT",
    contract: {
      ticker: "O:APPS260918C00013000",
      strike: 13,
      expiry: "2026-09-18",
      right: "C",
      dte: 8,
      mid: 0.2,
      bid: null,
      ask: null,
      delta: null,
      gamma: null,
      theta: null,
      vega: null,
      iv: null,
      openInterest: 0,
    },
    scoreFloor: 60,
    reason: "Banger breakout +8.7% · 13C 2026-09-18",
    entryPremium: 0.2,
    livePnlPct: -12.5,
    liveStatus: "OPEN",
    committedAt: "2026-09-10T20:15:25.368Z",
  };
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({
      ticker: "APPS",
      status: "OPEN",
      recommendation: "HOLD",
      entry: 0.37,
      mark: 0.475,
      pnlPct: 28.4,
    }),
    asOf: "2026-09-11T15:00:00.000Z",
    sessionDate: "2026-09-11",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [siblingRow],
    meridian: null,
    ecosystem: null,
    vector: null,
  };
  const brief = composeSwingPlayBrief(ctx);
  const sib = brief.envelope.sections.find((s) => s.title === "Other concurrent position(s)");
  assert.ok(sib, "must disclose the concurrent sibling position instead of silently omitting it");
  assert.match(sib!.body, /13C 2026-09-18/);
  assert.match(sib!.body, /2 concurrent live position/);
  // Largo C7 (2026-09-15): the sibling-positions section makes a concrete, checkable claim — it
  // must have a matching envelope.evidence entry, same as every other data-sourced narrative claim.
  const sibEvidence = brief.envelope.evidence.find((e) => e.text.includes("concurrent live position"));
  assert.ok(sibEvidence, "sibling-position claim must carry a matching evidence entry (Largo C7)");
  assert.match(sibEvidence!.text, /2 concurrent live position/);
});

test("composeSwingPlayBrief: OPEN play with no same-ticker siblings omits the disclosure section", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({ status: "OPEN", recommendation: "HOLD", entry: 0.37, mark: 0.475, pnlPct: 28.4 }),
    asOf: "2026-09-11T15:00:00.000Z",
    sessionDate: "2026-09-11",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
  };
  const brief = composeSwingPlayBrief(ctx);
  const sib = brief.envelope.sections.find((s) => s.title === "Other concurrent position(s)");
  assert.equal(sib, undefined, "no sibling exists — section must not appear");
  assert.ok(
    !brief.envelope.evidence.some((e) => e.text.includes("concurrent live position")),
    "no sibling exists — no evidence entry either",
  );
});

test("composeSwingPlayBrief: Book context concentration carries a matching evidence entry (Largo C7)", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({ ticker: "NVDA", direction: "LONG", status: "OPEN", recommendation: "HOLD" }),
    asOf: "2026-09-15T15:00:00.000Z",
    sessionDate: "2026-09-15",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
    openBook: [
      { ticker: "AMD", direction: "LONG" },
      { ticker: "SMH", direction: "LONG" },
    ],
  };
  const brief = composeSwingPlayBrief(ctx);
  const book = brief.envelope.sections.find((s) => s.title === "Book context");
  assert.ok(book, "sanity: the section itself must fire for this fixture");
  const overlapEvidence = brief.envelope.evidence.find((e) => e.text.startsWith("Book overlap:"));
  assert.ok(overlapEvidence, "Book context's concentration claim must carry a matching evidence entry (Largo C7)");
  assert.match(overlapEvidence!.text, /2 same-direction position/);
});

test("composeSwingPlayBrief: CLOSED play never surfaces a Book overlap evidence entry (matches the section's own gating)", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({ ticker: "NVDA", direction: "LONG", status: "CLOSED" }),
    asOf: "2026-09-15T15:00:00.000Z",
    sessionDate: "2026-09-15",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
    openBook: [{ ticker: "AMD", direction: "LONG" }],
  };
  const brief = composeSwingPlayBrief(ctx);
  assert.ok(!brief.envelope.evidence.some((e) => e.text.startsWith("Book overlap:")));
});

test("composeSwingPlayBrief: SKIP-status Verdict line agrees with the envelope headline, not raw status (2026-09-10 gap fix)", () => {
  // Live repro (SLV, 2026-09-10 09:47 ET): a RESEARCH-section WATCH row gets
  // swingEntryVerdict's deliberate split — deckStatus:"SKIP" (drives play.status, so the
  // honest PASSED pill shows on the deck) but recommendation:"HOLD" (the member-facing word).
  // The envelope headline correctly falls back action.label -> recommendation -> status and
  // reads "HOLD — SLV 59C 6DTE". The Verdict section's own inline line built two lines below it
  // skipped the `recommendation` rung of that same fallback chain and fell straight to raw
  // `play.status`, so the SAME brief response showed "· SKIP" plus "Desk is passing this
  // setup — no entry recommended." directly under a headline that says HOLD — a real,
  // member-visible contradiction inside one answer, not two different reads.
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({
      status: "SKIP",
      recommendation: "HOLD",
      swingEntryAction: undefined,
      recNote: "Desk is passing this setup — no entry recommended.",
    }),
    asOf: "2026-09-10T13:47:00.000Z",
    sessionDate: "2026-09-10",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
  };
  const brief = composeSwingPlayBrief(ctx);
  assert.match(brief.envelope.headline, /^HOLD — /);
  const verdict = brief.envelope.sections.find((s) => s.title === "Verdict");
  assert.ok(verdict, "expected Verdict section");
  assert.match(verdict!.body, /· HOLD$/m, `Verdict must agree with the headline, got: ${verdict!.body}`);
  assert.doesNotMatch(verdict!.body, /· SKIP/, "Verdict must not show the raw internal SKIP deckStatus");
});

// Live repro 2026-09-13 (COIN, WATCH, real production play-brief): the same PULLBACK_CONTINUATION
// archetype rendered as raw-enum "PULLBACK_CONTINUATION" here in Verdict, underscore-replaced-only
// "PULLBACK CONTINUATION" in Why-this-setup's own Archetype line, and the already-humanized
// "Pullback continuation" (ARCHETYPE_META label) on the Discovery-read/Cross-desk-friction lines --
// three different renderings of one value in one document. Verdict now uses the same canonical
// label as the rest of the brief.
test("composeSwingPlayBrief: Verdict's Archetype line uses the canonical humanized label, not the raw enum", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({ archetype: "PULLBACK_CONTINUATION" }),
    asOf: "2026-09-13T13:47:00.000Z",
    sessionDate: "2026-09-13",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
  };
  const brief = composeSwingPlayBrief(ctx);
  const verdict = brief.envelope.sections.find((s) => s.title === "Verdict");
  assert.ok(verdict, "expected Verdict section");
  assert.match(verdict!.body, /Archetype: Pullback continuation/);
  assert.doesNotMatch(verdict!.body, /PULLBACK_CONTINUATION/);
});

test("composeSwingPlayBrief: WATCH play with detectedAt narrates real days-on-watch age (2026-09-10 gap fix)", () => {
  // detectedAt (the deck's "WATCH Published clock") was already threaded onto TerminalPlay and
  // shown on the Command Deck panel, but never narrated in the play-brief text — a live sweep
  // found real WATCH rows persisting 45+ days (AMD) below the commit floor, invisible to a member
  // asking Largo directly about them. This section surfaces it without any new plumbing.
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({ detectedAt: "2026-07-27T14:30:38.000Z" }),
    asOf: "2026-09-10T09:00:00.000Z",
    sessionDate: "2026-09-10",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
  };
  const brief = composeSwingPlayBrief(ctx);
  const entry = brief.envelope.sections.find((s) => s.title === "Entry");
  assert.ok(entry, "expected Entry section");
  assert.match(entry!.body, /First flagged \*\*\d+ days? ago\*\*/);
  assert.match(entry!.body, /still on WATCH, not yet graduated to a real position/);
});

test("composeSwingPlayBrief: WATCH play without detectedAt omits the age line entirely (never fabricated)", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({ detectedAt: null }),
    asOf: "2026-09-10T09:00:00.000Z",
    sessionDate: "2026-09-10",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
  };
  const brief = composeSwingPlayBrief(ctx);
  const entry = brief.envelope.sections.find((s) => s.title === "Entry");
  assert.ok(entry);
  assert.doesNotMatch(entry!.body, /First flagged/);
});

// BUG FIX (Ask Largo standing mandate, 2026-09-14): "Gates blocking entry:" implies clearing the
// gate opens entry — false once the play is already past its entry deadline, since entry-
// enterability.ts's own if-chain checks the deadline BEFORE gate-blocked and independently blocks
// entry either way. Live repro: ORCL WATCH brief — "Entry stance: EXPIRED" and "Gates blocking
// entry: g_s4_regime..." sat in the same section with nothing marking the gate as moot.
test("composeSwingPlayBrief: Entry section reframes gates as moot once the entry-validity window expired", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({ watchEntryExpired: true }),
    asOf: "2026-09-10T09:00:00.000Z",
    sessionDate: "2026-09-10",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
  };
  const brief = composeSwingPlayBrief(ctx);
  const entry = brief.envelope.sections.find((s) => s.title === "Entry");
  assert.ok(entry);
  assert.match(entry!.body, /\*\*Also gate-blocked\*\* \(moot — entry-validity window expired\):/);
  assert.doesNotMatch(entry!.body, /\*\*Gates blocking entry:\*\*/, "must not read as an active/clearable blocker");
});

// BUG FIX (Ask Largo standing mandate, 2026-09-18): the top-level `envelope.invalidation` line
// (the "**Invalidation:**" evidence-block callout) had the same root cause as the "Entry section
// reframes gates as moot" fix directly above, but was never itself fixed — it fell straight
// through to `play.gateBlocks?.[0]?.reason` with no `deadPlayReason` check, so a dead WATCH play
// showed the SAME moot gate text there, with no "moot" qualifier, reading as the live reason entry
// hasn't opened. Live repro: MU WATCH brief, 2026-09-17/18 — headline and Entry section both
// correctly said "EXPIRED"/"moot — entry-validity window expired", but Invalidation still read
// "Trading-halt feed unavailable — desk will not open until halt/LULD data recovers."
test("composeSwingPlayBrief: top-level Invalidation line reflects a dead entry window, not a moot gate reason", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({ watchEntryExpired: true }),
    asOf: "2026-09-10T09:00:00.000Z",
    sessionDate: "2026-09-10",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
  };
  const brief = composeSwingPlayBrief(ctx);
  assert.equal(
    brief.envelope.invalidation,
    "Entry-validity window expired — this setup is no longer live.",
  );
  assert.doesNotMatch(
    brief.envelope.invalidation ?? "",
    /Bucket not graduated/,
    "a moot gate reason must not stand in for the real dead-entry explanation",
  );
});

test("composeSwingPlayBrief: top-level Invalidation line still uses the real gate reason when entry is genuinely still open", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay(),
    asOf: "2026-09-10T09:00:00.000Z",
    sessionDate: "2026-09-10",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
  };
  const brief = composeSwingPlayBrief(ctx);
  assert.equal(brief.envelope.invalidation, "Bucket not graduated");
});

test("composeSwingPlayBrief: Entry section still frames gates as the live blocker when the play is genuinely still enterable", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay(),
    asOf: "2026-09-10T09:00:00.000Z",
    sessionDate: "2026-09-10",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
  };
  const brief = composeSwingPlayBrief(ctx);
  const entry = brief.envelope.sections.find((s) => s.title === "Entry");
  assert.ok(entry);
  assert.match(entry!.body, /\*\*Gates blocking entry:\*\*/);
  assert.doesNotMatch(entry!.body, /Also gate-blocked/);
});

test("composeSwingPlayBrief: WATCH play emits entry + intel sections", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({ discoveryOrigin: ["FLOW", "BREAKOUT"] }),
    asOf: "2026-09-05T20:00:00.000Z",
    sessionDate: "2026-09-05",
    scanAsOf: "2026-09-05T19:30:00.000Z",
    scanSessionDay: "2026-09-05",
    laneRows: [],
    meridian: null,
    ecosystem: {
      ticker: "INTC",
      zerodte_today: null,
      nighthawk_recent: null,
      recent_audit_entries: [],
      recent_flow: {
        window_hours: 24,
        print_count: 12,
        call_premium: 1_200_000,
        put_premium: 400_000,
        unknown_premium: 0,
      },
      recent_anomalies: [],
      flow_full_state: null,
      spx_play: null,
      spx_full_state: null,
      spx_desk_convergence: null,
      flow_feed_fresh: true,
      gex_positioning: {
        ticker: "INTC",
        spot: 24.5,
        change_pct: 1.2,
        asof: "2026-09-05T20:00:00Z",
        as_of_et: "2026-09-05 16:00 ET",
        session_date_et: "2026-09-05",
        market_phase: "closed",
        call_wall: 26,
        put_wall: 22,
        flip: 24,
        gex_king_strike: 25,
        net_gex: null,
        nearest_wall: { strike: 26, kind: "resistance", distance_pts: 1.5 },
        gamma_posture: "long",
        vanna_posture: null,
        delta_posture: null,
        charm_posture: null,
      },
      vector_full_state: null,
      arsenal: {
        scope: "single_name",
        earnings: { earnings_date: "2026-09-12", days_until: 7, report_time: "AMC", is_confirmed: true },
        fundamentals: { days_to_cover: 2.1, short_volume_ratio: 0.35, price_target: null, as_of: "2026-09-05" },
        related: ["AMD", "NVDA"],
        news: { count: 2, newest: "2026-09-05", headlines: ["INTC restructures fab unit"] },
        macro: null,
        breadth: null,
        unavailable_sources: [],
      },
    },
    vector: null,
  };
  const brief = composeSwingPlayBrief(ctx);
  assert.equal(brief.engine, "swing_play_intelligence");
  assert.equal(brief.ticker, "INTC");
  assert.ok(brief.envelope.headline.includes("INTC"));
  const titles = brief.envelope.sections.map((s) => s.title);
  assert.ok(titles.includes("Verdict"));
  assert.ok(titles.includes("Entry"));
  assert.ok(titles.includes("Why this setup"));
  assert.ok(titles.includes("Trade manager read"));
  assert.ok(titles.includes("Catalysts & news"));
  assert.ok(titles.includes("Watch levels"));
  assert.ok(brief.envelope.sections.some((s) => s.body.includes("FLOW")));
  assert.ok(brief.envelope.sections.some((s) => s.body.includes("Earnings")));
  assert.ok(!titles.includes("Flow & positioning"), "flow intel folded into Trade manager read");
  assert.equal(brief.envelope.intent, "swing_play_brief");
  assert.deepEqual(brief.flowSnapshot, { callPremium: 1_200_000, putPremium: 400_000 });
});

test("composeSwingPlayBrief: invalidation prefers a real per-ticker technical break level over a generic system-wide commit-gate reason", () => {
  // Regression for the live defect found 2026-09-09: NBIS, CRCL and MU — three different
  // gate-blocked WATCH setups, three different archetypes — all showed the LITERAL SAME
  // "Trading-halt feed unavailable..." string in the UI's labeled "Invalidation" callout,
  // because play-brief.ts fell straight from thesisBreak to `gateBlocks?.[0]?.reason` without
  // ever checking whether a real technical level (put wall/gamma flip, already computed for
  // the "Trade manager read" narrative's own "Break watch" bullet) was available. Timestamps
  // are relative to Date.now() so this does not depend on the sandbox's wall clock matching a
  // hardcoded fixture date (gexMatrixStale/vectorSnapshotStale are real-Date.now()-based).
  const recentIso = new Date(Date.now() - 60_000).toISOString();
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({
      direction: "LONG",
      gateBlocks: [
        { code: "G-S12", reason: "Trading-halt feed unavailable — desk will not open until halt/LULD data recovers." },
      ],
      thesisBreak: { level: "intact", note: "Structure holding" },
    }),
    asOf: recentIso,
    sessionDate: "2026-09-09",
    scanAsOf: recentIso,
    scanSessionDay: "2026-09-09",
    laneRows: [],
    meridian: null,
    ecosystem: {
      ticker: "INTC",
      zerodte_today: null,
      nighthawk_recent: null,
      recent_audit_entries: [],
      recent_flow: null,
      recent_anomalies: [],
      flow_full_state: null,
      spx_play: null,
      spx_full_state: null,
      spx_desk_convergence: null,
      flow_feed_fresh: true,
      gex_positioning: {
        ticker: "INTC",
        spot: 24.5,
        change_pct: 1.2,
        asof: recentIso,
        as_of_et: "recent",
        session_date_et: "2026-09-09",
        market_phase: "open",
        call_wall: 26,
        put_wall: 22,
        flip: 24,
        gex_king_strike: 25,
        net_gex: null,
        nearest_wall: { strike: 26, kind: "resistance", distance_pts: 1.5 },
        gamma_posture: "long",
        vanna_posture: null,
        delta_posture: null,
        charm_posture: null,
      },
      vector_full_state: null,
      arsenal: {
        scope: "single_name",
        earnings: null,
        fundamentals: null,
        related: null,
        news: null,
        macro: null,
        breadth: null,
        unavailable_sources: [],
      },
    },
    vector: null,
  };
  const brief = composeSwingPlayBrief(ctx);
  assert.equal(
    brief.envelope.invalidation,
    "**Break watch** — lose **22.00** on a closing basis → structural support failed; exit or cut size.",
  );
  assert.doesNotMatch(
    brief.envelope.invalidation ?? "",
    /Trading-halt feed unavailable/,
    "a system-wide gate reason must not stand in for a real per-ticker invalidation level when one is computable",
  );
});

test("composeSwingPlayBrief: CLOSED play omits the live 'exit or cut size' invalidation callout", () => {
  // Live repro 2026-09-12 (Ask Largo standing mandate): NVDA/TSM CLOSED (STOPPED) briefs, weeks
  // after exit, still rendered a labeled "Invalidation" callout reading "Break watch — lose
  // 217.50 on a closing basis -> structural support failed; exit or cut size." — active trade-
  // management language computed off TODAY's live spot/walls, for a position that has no more
  // risk to manage. `resolveBreakInvalidation`/the gate-reason/premium-stop fallback chain never
  // checked `bucket`, only the OPEN-only premium-stop fallback did. Root cause: play-brief.ts's
  // `invalidation` assignment ran unconditionally for every bucket. A CLOSED play must render no
  // invalidation callout at all — there is nothing left to invalidate.
  const recentIso = new Date(Date.now() - 60_000).toISOString();
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({
      status: "CLOSED",
      direction: "LONG",
      gateBlocks: [
        { code: "G-S12", reason: "Trading-halt feed unavailable — desk will not open until halt/LULD data recovers." },
      ],
      thesisBreak: { level: "intact", note: "Structure holding" },
      exitPolicy: { stop_premium: 1.5, target_premium: 3, trim_levels: [] },
    }),
    asOf: recentIso,
    sessionDate: "2026-09-09",
    scanAsOf: recentIso,
    scanSessionDay: "2026-09-09",
    laneRows: [],
    meridian: null,
    ecosystem: {
      ticker: "INTC",
      zerodte_today: null,
      nighthawk_recent: null,
      recent_audit_entries: [],
      recent_flow: null,
      recent_anomalies: [],
      flow_full_state: null,
      spx_play: null,
      spx_full_state: null,
      spx_desk_convergence: null,
      flow_feed_fresh: true,
      gex_positioning: {
        ticker: "INTC",
        spot: 24.5,
        change_pct: 1.2,
        asof: recentIso,
        as_of_et: "recent",
        session_date_et: "2026-09-09",
        market_phase: "open",
        call_wall: 26,
        put_wall: 22,
        flip: 24,
        gex_king_strike: 25,
        net_gex: null,
        nearest_wall: { strike: 26, kind: "resistance", distance_pts: 1.5 },
        gamma_posture: "long",
        vanna_posture: null,
        delta_posture: null,
        charm_posture: null,
      },
      vector_full_state: null,
      arsenal: {
        scope: "single_name",
        earnings: null,
        fundamentals: null,
        related: null,
        news: null,
        macro: null,
        breadth: null,
        unavailable_sources: [],
      },
    },
    vector: null,
  };
  const brief = composeSwingPlayBrief(ctx);
  assert.equal(
    brief.envelope.invalidation,
    null,
    "a CLOSED play has nothing left to invalidate — no live 'exit or cut size' callout should render",
  );
});

test("composeSwingPlayBrief: dossier regime stays in Why this setup, not unlabeled Verdict", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({ regime: "Sector rotation · regime 0.82", archetype: "BREAKOUT" }),
    asOf: "2026-09-05T20:00:00.000Z",
    sessionDate: "2026-09-05",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
  };
  const brief = composeSwingPlayBrief(ctx);
  const verdict = brief.envelope.sections.find((s) => s.title === "Verdict");
  const why = brief.envelope.sections.find((s) => s.title === "Why this setup");
  assert.ok(verdict && why);
  assert.ok(!/Sector rotation · regime 0\.82/.test(verdict!.body), "dossier regime must not appear raw in Verdict");
  assert.match(why!.body, /\*\*Today's regime read:\*\* Sector rotation · regime 0\.82/);
});

// Live repro 2026-09-14 (KR, real committed swing position): the pinned "Archetype" line and the
// freshly re-derived regime line can genuinely diverge (archetype pinned at commit, regime re-read
// every scan) without either being wrong -- but the old bare "Discovery read:" label gave no signal
// that the two lines were reading DIFFERENT points in time, so a real brief showed "Archetype:
// Breakout continuation" next to "Discovery read: Event-driven directional" with nothing to explain
// why. The label now says "Today's regime read" so two different labels read as thesis evolution,
// not an internal contradiction.
test("composeSwingPlayBrief: regime read is labeled as TODAY's read, distinct from the pinned Archetype line", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({ regime: "Event-driven directional · regime 0.67", archetype: "BREAKOUT" }),
    asOf: "2026-09-05T20:00:00.000Z",
    sessionDate: "2026-09-05",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
  };
  const brief = composeSwingPlayBrief(ctx);
  const why = brief.envelope.sections.find((s) => s.title === "Why this setup");
  assert.ok(why);
  assert.match(why!.body, /\*\*Archetype:\*\*/);
  assert.match(why!.body, /\*\*Today's regime read:\*\* Event-driven directional · regime 0\.67/);
  assert.doesNotMatch(why!.body, /\*\*Discovery read:\*\*/, "old unqualified label must not reappear");
});

test("composeSwingPlayBrief: omits envelope.confidence (Largo C6 — no uncalibrated score)", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay(),
    asOf: "2026-09-05T20:00:00.000Z",
    sessionDate: "2026-09-05",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
  };
  const brief = composeSwingPlayBrief(ctx);
  assert.equal(brief.envelope.confidence, undefined);
});

test("composeSwingPlayBrief: arsenal.unavailable_sources reaches envelope.unavailableSources (BIE absence contract)", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay(),
    asOf: "2026-09-05T20:00:00.000Z",
    sessionDate: "2026-09-05",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: {
      ticker: "INTC",
      zerodte_today: null,
      nighthawk_recent: null,
      recent_audit_entries: [],
      recent_flow: null,
      recent_anomalies: [],
      flow_full_state: null,
      spx_play: null,
      spx_full_state: null,
      spx_desk_convergence: null,
      flow_feed_fresh: true,
      gex_positioning: null,
      vector_full_state: null,
      arsenal: {
        scope: "single_name",
        earnings: null,
        fundamentals: null,
        related: null,
        news: null,
        macro: null,
        breadth: null,
        unavailable_sources: [{ source: "short-interest", reason: "provider timeout" }],
      },
    },
    vector: null,
  };
  const brief = composeSwingPlayBrief(ctx);
  assert.deepEqual(brief.envelope.unavailableSources, [
    { source: "short-interest", reason: "provider timeout" },
    {
      source: "GEX positioning",
      reason: "cold matrix / no positioning read",
      what_is_missing: "a warm GEX positioning read for this ticker",
      retryable: true,
    },
    {
      source: "Vector desk state",
      reason: "snapshot unavailable",
      what_is_missing: "a live Vector desk-state snapshot with spot",
      retryable: true,
    },
  ]);
});

test("composeSwingPlayBrief: 'Track record' section appears ONLY when ctx.archetypeTrackRecord has a graduated bucket for the play's archetype (Largo C10 / Ask Largo)", () => {
  const graduatedSnap: SwingArchetypeTrackRecordSnapshot = {
    asOf: "2026-09-10T15:00:00.000Z",
    gradedPlays: 70,
    archetypes: {
      BREAKOUT: {
        tier: "LIMITED",
        graduated: true,
        wilsonLbPct: 63.2,
        pointDeltaPts: 22.4,
        n: 60,
        wins: 45,
        losses: 15,
        winRatePct: 75,
      },
    },
    subLanes: {},
  };
  const baseCtx: SwingPlayBriefContext = {
    play: fixturePlay({ archetype: "BREAKOUT" }),
    asOf: "2026-09-10T20:00:00.000Z",
    sessionDate: "2026-09-10",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
  };

  const withTrackRecord = composeSwingPlayBrief({ ...baseCtx, archetypeTrackRecord: graduatedSnap });
  const withSection = withTrackRecord.envelope.sections.find((s) => s.title === "Track record");
  assert.ok(withSection, "expected a Track record section when the archetype bucket has graduated");
  assert.match(withSection!.body, /45W \/ 15L/);

  // A cold/missing cache read (the timeout/miss degrade path) must not fabricate a section.
  const withoutTrackRecord = composeSwingPlayBrief({ ...baseCtx, archetypeTrackRecord: undefined });
  assert.equal(
    withoutTrackRecord.envelope.sections.some((s) => s.title === "Track record"),
    false,
    "no citation when the track-record read is absent",
  );

  // An ungraduated bucket for the SAME archetype must also omit the section, never caveat it.
  const ungraduatedSnap: SwingArchetypeTrackRecordSnapshot = {
    ...graduatedSnap,
    archetypes: { BREAKOUT: { ...graduatedSnap.archetypes.BREAKOUT!, graduated: false, tier: "RESEARCH" } },
  };
  const withUngraduated = composeSwingPlayBrief({ ...baseCtx, archetypeTrackRecord: ungraduatedSnap });
  assert.equal(
    withUngraduated.envelope.sections.some((s) => s.title === "Track record"),
    false,
    "an ungraduated bucket must be omitted, not shown caveated",
  );
});

test("composeSwingPlayBrief: stale GEX matrix surfaces in unavailableSources (Largo C3)", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay(),
    asOf: "2026-09-06T10:00:00.000Z",
    sessionDate: "2026-09-06",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: {
      ticker: "INTC",
      gex_positioning: {
        spot: 25,
        flip: 24,
        gamma_posture: "long",
        matrix_age_sec: 300,
        freshness: "cached",
      },
      vector_full_state: { spot: 25 } as SwingPlayBriefContext["ecosystem"] extends { vector_full_state: infer V } ? V : never,
    } as SwingPlayBriefContext["ecosystem"],
    vector: null,
  };
  const brief = composeSwingPlayBrief(ctx);
  assert.ok(
    brief.envelope.unavailableSources?.some(
      (u) => u.source === "GEX matrix" && u.reason.includes("dealer posture"),
    ),
    "expected stale GEX matrix in unavailableSources",
  );
});

test("composeSwingPlayBrief: envelope.asOf uses Largo C1 ET stamp (not a bare UTC instant)", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay(),
    asOf: "2026-09-05 16:00 ET",
    sessionDate: "2026-09-05",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
  };
  const brief = composeSwingPlayBrief(ctx);
  assert.equal(brief.envelope.asOf, "2026-09-05 16:00 ET");
  assert.equal(brief.asOf, "2026-09-05 16:00 ET");
  assert.equal(brief.sessionDate, "2026-09-05");
  assert.equal(brief.envelope.session_date, "2026-09-05", "envelope must carry session_date for Largo C1");
  assert.doesNotMatch(brief.envelope.asOf!, /Z$/, "asOf must not be a UTC ISO instant");
});

test("composeSwingPlayBrief: GEX evidence freshness honors matrix_age_sec over recent asof (Largo C2)", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay(),
    asOf: "2026-09-06 10:00 ET",
    sessionDate: "2026-09-06",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: {
      ticker: "INTC",
      gex_positioning: {
        spot: 25,
        flip: 24,
        gamma_posture: "long",
        asof: new Date().toISOString(),
        matrix_age_sec: 60,
        freshness: "cached",
      },
    } as SwingPlayBriefContext["ecosystem"],
    vector: null,
  };
  const brief = composeSwingPlayBrief(ctx);
  const postureEvidence = brief.envelope.evidence.find((e) => e.text.startsWith("Dealer posture:"));
  assert.ok(postureEvidence, "expected dealer posture evidence");
  assert.equal(
    postureEvidence!.provenance?.freshness,
    "recent",
    "matrix_age_sec must drive envelope freshness even when asof is recent (and matrix is not stale)",
  );
  assert.notEqual(
    postureEvidence!.provenance?.freshness,
    "live",
    "must not read live when matrix_age_sec is 60s while asof is fresh",
  );
});

// BUG FIX (2026-09-15, Ask Largo standing mandate, live repro TSM WATCH brief): evidenceFromContext
// used to treat Vector's literal "unknown" regime posture as an equally-resolved answer to
// "long"/"short", never falling through to a fresh, non-stale GEX-matrix gamma_posture — the same
// bug resolveGammaPosture (play-brief-absence.ts) was fixed for on 2026-09-12, just never ported to
// this call site. Live: TSM's evidence line said "Dealer posture: γ unknown ..." while the SAME
// brief's narrative (which already used resolveGammaPosture) correctly said "dealers short gamma".
test("composeSwingPlayBrief: Dealer posture evidence falls through to fresh GEX posture when Vector regime is 'unknown', not literal string (Largo)", () => {
  const nowIso = new Date().toISOString();
  const ctx: SwingPlayBriefContext = {
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
        ticker: "TSM",
        spot: 419.48,
        flip: 420,
        call_wall: 430,
        put_wall: 400,
        gamma_posture: "short",
        net_gex: -58_500_000,
        asof: nowIso,
        as_of_et: "2026-09-14 21:07 ET",
        matrix_age_sec: 30,
        freshness: "live",
      },
    } as SwingPlayBriefContext["ecosystem"],
    vector: {
      asOf: nowIso,
      asOfEt: "2026-09-14 21:07 ET",
      spot: 419.48,
      dataAgeMs: 5_000,
      freshness: "live",
      regime: { posture: "unknown", label: "UNKNOWN" },
    } as SwingPlayBriefContext["vector"],
  };
  const brief = composeSwingPlayBrief(ctx);
  const postureEvidence = brief.envelope.evidence.find((e) => e.text.startsWith("Dealer posture:"));
  assert.ok(postureEvidence, "expected dealer posture evidence to fall through to the GEX matrix");
  assert.match(
    postureEvidence!.text,
    /γ short/,
    "must resolve to the fresh GEX-matrix posture, not render literal 'γ unknown'",
  );
  assert.equal(
    postureEvidence!.provenance?.source,
    "GEX",
    "posture resolved from the GEX fallback must be attributed to GEX, not Vector",
  );
});

test("composeSwingPlayBrief: future-skewed fundamentals as_of freshness is stale, not unknown (Largo C2)", () => {
  const futureAsOf = new Date(Date.now() + 30_000).toISOString(); // 30s ahead — beyond tolerance
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay(),
    asOf: "2026-09-06 10:00 ET",
    sessionDate: "2026-09-06",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: {
      ticker: "INTC",
      recent_flow: null,
      flow_feed_fresh: false,
      arsenal: {
        scope: "single_name",
        earnings: null,
        fundamentals: {
          days_to_cover: 2.1,
          short_volume_ratio: 0.35,
          price_target: null,
          as_of: futureAsOf,
        },
        related: null,
        news: null,
        macro: null,
        breadth: null,
        unavailable_sources: [],
      },
    } as SwingPlayBriefContext["ecosystem"],
    vector: null,
  };
  const brief = composeSwingPlayBrief(ctx);
  const siEvidence = brief.envelope.evidence.find((e) => e.text.startsWith("Short interest:"));
  assert.ok(siEvidence, "expected short interest evidence");
  assert.equal(
    siEvidence!.provenance?.freshness,
    "stale",
    "future-skewed fundamentals as_of must fail-closed to stale, not unknown",
  );
});

test("composeSwingPlayBrief: GEX dealer posture grounds in envelope evidence (Largo C7)", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay(),
    asOf: "2026-09-05 16:00 ET",
    sessionDate: "2026-09-05",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: {
      ticker: "INTC",
      recent_flow: null,
      flow_feed_fresh: false,
      gex_positioning: {
        ticker: "INTC",
        spot: 24.5,
        change_pct: 1.2,
        asof: "2026-09-05T20:00:00Z",
        as_of_et: "2026-09-05 16:00 ET",
        session_date: "2026-09-05",
        market_session: "CLOSED",
        flip: 24,
        call_wall: 26,
        put_wall: 22,
        max_pain: null,
        gex_king_strike: 25,
        net_gex: 12_300_000,
        gamma_posture: "long",
        gamma_regime_read: "long gamma",
        net_vex: 0,
        vanna_posture: null,
        vanna_regime_read: "",
        net_dex: null,
        dex_posture: null,
        dex_regime_read: null,
        net_charm: null,
        charm_posture: null,
        charm_regime_read: null,
        nearest_wall: { strike: 26, kind: "resistance", distance_pts: 1.5 },
        freshness: "cached",
        matrix_age_sec: 30,
      },
      arsenal: null,
    } as SwingPlayBriefContext["ecosystem"],
    vector: null,
  };
  const brief = composeSwingPlayBrief(ctx);
  const postureEvidence = brief.envelope.evidence.find((e) => e.text.startsWith("Dealer posture:"));
  assert.ok(postureEvidence, "expected dealer posture evidence");
  assert.match(postureEvidence!.text, /γ long/);
  assert.match(postureEvidence!.text, /net GEX \+12\.3M/);
  assert.match(postureEvidence!.text, /nearest wall 26\.00/);
  assert.equal(postureEvidence?.provenance?.source, "GEX");
  assert.equal(postureEvidence?.provenance?.asOf, "2026-09-05 16:00 ET");
});

// FINDING 2026-09-08 (Ask Largo monitor cycle, live NN SWING_NN_32): "Dealer posture" evidence's
// nearest-wall computation read raw `gex.nearest_wall` (GEX-matrix call/put wall only), while the
// envelope's `levels` array and narrative both show the live Vector wall when Vector is fresh
// (call wall/put wall precedence already fixed to prefer Vector — see the sibling GEX-king fix).
// A member saw "nearest wall 13.00" in Dealer posture evidence but "put wall 14.00" everywhere
// else in the SAME envelope for the SAME ticker at the SAME instant.
test("composeSwingPlayBrief: Dealer posture nearest-wall evidence prefers the live Vector wall, matching envelope levels (Largo)", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay(),
    asOf: "2026-09-05 16:00 ET",
    sessionDate: "2026-09-05",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: {
      ticker: "INTC",
      recent_flow: null,
      flow_feed_fresh: false,
      gex_positioning: {
        ticker: "INTC",
        spot: 15.18,
        change_pct: 1.2,
        asof: "2026-09-05T20:00:00Z",
        as_of_et: "2026-09-05 16:00 ET",
        session_date: "2026-09-05",
        market_session: "CLOSED",
        flip: 14.72,
        call_wall: 18,
        put_wall: 13, // GEX-matrix-native put wall — must NOT win when Vector has a fresher one
        max_pain: null,
        gex_king_strike: 18,
        net_gex: 12_300_000,
        gamma_posture: "long",
        gamma_regime_read: "long gamma",
        net_vex: 0,
        vanna_posture: null,
        vanna_regime_read: "",
        net_dex: null,
        dex_posture: null,
        dex_regime_read: null,
        net_charm: null,
        charm_posture: null,
        charm_regime_read: null,
        nearest_wall: { strike: 13, kind: "support", distance_pts: -2.18 },
        freshness: "cached",
        matrix_age_sec: 30,
      },
      arsenal: null,
    } as SwingPlayBriefContext["ecosystem"],
    vector: {
      asOf: new Date().toISOString(),
      asOfEt: "2026-09-05 16:00 ET",
      spot: 15.18,
      dataAgeMs: 1_000,
      freshness: "live",
      gexWalls: { callWalls: [{ strike: 18, pct: 5 }], putWalls: [{ strike: 14, pct: 6 }] },
    } as unknown as SwingPlayBriefContext["vector"],
  };
  const brief = composeSwingPlayBrief(ctx);
  const levels = brief.envelope.levels ?? [];
  const putWallLevel = levels.find((l) => l.label === "put wall");
  const postureEvidence = brief.envelope.evidence.find((e) => e.text.startsWith("Dealer posture:"));
  assert.equal(putWallLevel?.price, 14, "envelope levels must show the live Vector put wall");
  assert.ok(postureEvidence, "expected dealer posture evidence");
  assert.match(
    postureEvidence!.text,
    /nearest wall 14\.00/,
    "Dealer posture must cite the SAME wall the envelope levels show, not the raw GEX-matrix one",
  );
});

test("composeSwingPlayBrief: wall/flip/king level provenance (asOf/freshness) matches the live Vector price actually shown, not GEX's (Largo C8)", () => {
  // Live defect (2026-09-15, Ask Largo standing mandate): `price` already prefers the live Vector
  // wall (vecCallWall ?? gex?.call_wall), but the provenance asOf/freshness ternary tested
  // `gex?.call_wall != null` — whether GEX has a value at all, not whether GEX was actually the
  // side `??` fell through to. Since both feeds carry a wall here, that always picked GEX's own
  // (staler) age bucket even though Vector's live price is the one displayed — a genuinely live
  // number reads as merely "recent". GEX matrix_age_sec=100 (the "recent" bucket, 60s-600s) vs
  // Vector's near-zero age (the "live" bucket, <60s) makes the two buckets provably different so
  // this test cannot pass by accident.
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay(),
    asOf: "2026-09-05 16:00 ET",
    sessionDate: "2026-09-05",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: {
      ticker: "INTC",
      recent_flow: null,
      flow_feed_fresh: false,
      gex_positioning: {
        ticker: "INTC",
        spot: 15.18,
        change_pct: 1.2,
        asof: "2026-09-05T20:00:00Z",
        as_of_et: "2026-09-05 16:00 ET",
        session_date: "2026-09-05",
        market_session: "CLOSED",
        flip: 14.72,
        call_wall: 18,
        put_wall: 13,
        max_pain: null,
        gex_king_strike: 18,
        net_gex: 12_300_000,
        gamma_posture: "long",
        gamma_regime_read: "long gamma",
        net_vex: 0,
        vanna_posture: null,
        vanna_regime_read: "",
        net_dex: null,
        dex_posture: null,
        dex_regime_read: null,
        net_charm: null,
        charm_posture: null,
        charm_regime_read: null,
        nearest_wall: { strike: 13, kind: "support", distance_pts: -2.18 },
        freshness: "cached",
        matrix_age_sec: 100, // "recent" bucket (60s-600s) — must NOT win provenance over live Vector
      },
      arsenal: null,
    } as SwingPlayBriefContext["ecosystem"],
    vector: {
      asOf: new Date().toISOString(), // "live" bucket (<60s) — the price actually shown
      asOfEt: "2026-09-05 16:00 ET",
      spot: 15.18,
      dataAgeMs: 1_000,
      freshness: "live",
      gexWalls: { callWalls: [{ strike: 18, pct: 5 }], putWalls: [{ strike: 14, pct: 6 }] },
    } as unknown as SwingPlayBriefContext["vector"],
  };
  const brief = composeSwingPlayBrief(ctx);
  const levels = brief.envelope.levels ?? [];
  const callWallLevel = levels.find((l) => l.label === "call wall");
  const putWallLevel = levels.find((l) => l.label === "put wall");
  assert.equal(callWallLevel?.price, 18, "sanity: call wall price");
  assert.equal(putWallLevel?.price, 14, "sanity: live Vector put wall must win over GEX's 13");
  assert.equal(
    callWallLevel?.provenance?.freshness,
    "live",
    `call wall provenance must report the live Vector age, not GEX's "recent" one — got: ${callWallLevel?.provenance?.freshness}`,
  );
  assert.equal(
    putWallLevel?.provenance?.freshness,
    "live",
    `put wall provenance must report the live Vector age, not GEX's "recent" one — got: ${putWallLevel?.provenance?.freshness}`,
  );
});

test("composeSwingPlayBrief: stale GEX-only envelope levels must not cite walls/flip/king (Largo C2)", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({ status: "HOLD", recommendation: "HOLD" }),
    asOf: "2026-09-05 16:00 ET",
    sessionDate: "2026-09-05",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: {
      ticker: "INTC",
      gex_positioning: {
        ticker: "INTC",
        spot: 24.5,
        flip: 24,
        call_wall: 26,
        put_wall: 22,
        asof: "2026-09-05T18:00:00Z",
        as_of_et: "2026-09-05 14:00 ET",
        session_date: "2026-09-05",
        market_session: "CLOSED",
        gex_king_strike: 25,
        net_gex: 12_300_000,
        gamma_posture: "long",
        matrix_age_sec: 200,
      },
    } as SwingPlayBriefContext["ecosystem"],
    vector: null,
  };
  const brief = composeSwingPlayBrief(ctx);
  const labels = (brief.envelope.levels ?? []).map((l) => l.label);
  assert.ok(!labels.includes("spot"), "stale GEX-only spot must be suppressed");
  assert.ok(!labels.includes("call wall"), "stale GEX-only call wall must be suppressed");
  assert.ok(!labels.includes("put wall"), "stale GEX-only put wall must be suppressed");
  assert.ok(!labels.includes("gamma flip"), "stale GEX-only gamma flip must be suppressed");
  assert.ok(!labels.includes("GEX king"), "stale GEX king strike must be suppressed");
});

test("composeSwingPlayBrief: stale Vector snapshot envelope levels must not cite walls/max pain/confluence (Largo C2)", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({ status: "HOLD", recommendation: "HOLD" }),
    asOf: "2026-09-05 16:00 ET",
    sessionDate: "2026-09-05",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: {
      ticker: "INTC",
      gex_positioning: {
        ticker: "INTC",
        spot: 24.5,
        matrix_age_sec: 30,
        asof: "2026-09-05T20:00:00Z",
        as_of_et: "2026-09-05 16:00 ET",
      },
    } as SwingPlayBriefContext["ecosystem"],
    vector: {
      asOf: "2026-09-05T18:00:00.000Z",
      asOfEt: "2026-09-05 14:00 ET",
      spot: 24.5,
      dataAgeMs: 200_000,
      freshness: "stale",
      regime: { posture: "long", label: "LONG" },
      gexWalls: { callWalls: [{ strike: 26, pct: 8 }], putWalls: [{ strike: 22, pct: 7 }] },
      gammaFlip: 24,
      maxPain: 23.5,
      confluenceZones: [{ center: 25, kinds: ["gex"], score: 80 }],
      darkPoolLevels: [{ strike: 24.8, premium: 1_200_000, pct: 35 }],
      magnet: { strike: 27, distancePct: 10.2, pull: "up" },
    } as SwingPlayBriefContext["vector"],
  };
  const brief = composeSwingPlayBrief(ctx);
  const labels = (brief.envelope.levels ?? []).map((l) => l.label);
  const spotLevel = brief.envelope.levels?.find((l) => l.label === "spot");
  assert.ok(spotLevel, "spot must fall through to live GEX when Vector snapshot is stale");
  assert.equal(spotLevel?.provenance?.source, "GEX");
  assert.equal(spotLevel?.provenance?.freshness, "live");
  assert.ok(!labels.includes("call wall"), "stale Vector call wall must be suppressed");
  assert.ok(!labels.includes("put wall"), "stale Vector put wall must be suppressed");
  assert.ok(!labels.includes("gamma flip"), "stale Vector gamma flip must be suppressed");
  assert.ok(!labels.includes("max pain"), "stale Vector max pain must be suppressed");
  assert.ok(!labels.some((l) => l.startsWith("confluence")), "stale Vector confluence must be suppressed");
  assert.ok(!labels.includes("dark pool"), "stale Vector dark pool must be suppressed");
  assert.ok(!labels.includes("gamma magnet"), "stale Vector gamma magnet must be suppressed");
  const postureEvidence = brief.envelope.evidence.find((e) => e.text.startsWith("Dealer posture:"));
  assert.equal(postureEvidence, undefined, "stale Vector regime must not ground envelope dealer posture");
});

test("composeSwingPlayBrief: a confluence zone citing a DIFFERENT call wall than the primary displayed one is disambiguated with its own price", () => {
  // Live repro (2026-09-13, real NRG/MU/SKHY positions, confirmed a 3-instance pattern, raised on
  // #4076 comments 5649059880/5649697371/5649766952): the confluence engine
  // (vector-full-state.ts) feeds confluenceZones() the FULL ranked gexWalls.callWalls list, not
  // just [0] -- so a lower-ranked call wall can cluster with max-pain/flip/golden-pocket under the
  // same "call-wall" kind this file's OWN primary "call wall" level (callWalls[0]) already uses,
  // at a materially different price. Before the fix this rendered "call wall: 145" (Key levels)
  // beside "confluence (call-wall+max-pain): 125" with no indication these are different strikes.
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({ status: "HOLD", recommendation: "HOLD" }),
    asOf: "2026-09-13 16:00 ET",
    sessionDate: "2026-09-13",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: {
      asOf: new Date().toISOString(),
      asOfEt: "2026-09-13 16:00 ET",
      spot: 113,
      dataAgeMs: 5_000,
      freshness: "live",
      gexWalls: { callWalls: [{ strike: 145, pct: 8 }], putWalls: [{ strike: 110, pct: 7 }] },
      gammaFlip: 124.09,
      maxPain: 125,
      confluenceZones: [
        {
          center: 125,
          kinds: ["call-wall", "max-pain"],
          score: 5,
          levels: [
            { price: 125, kind: "call-wall" },
            { price: 125, kind: "max-pain" },
          ],
        },
      ],
      darkPoolLevels: [],
    } as SwingPlayBriefContext["vector"],
  };
  const brief = composeSwingPlayBrief(ctx);
  const labels = (brief.envelope.levels ?? []).map((l) => l.label);
  assert.ok(labels.includes("call wall"), "primary call wall level must still render");
  const callWallLevel = brief.envelope.levels?.find((l) => l.label === "call wall");
  assert.equal(callWallLevel?.price, 145, "primary call wall must be the top-ranked strike, unaffected");
  const confluenceLabel = labels.find((l) => l.startsWith("confluence"));
  assert.equal(
    confluenceLabel,
    "confluence (call-wall@125+max-pain)",
    "confluence citing a call-wall strike different from the primary must disclose the actual strike",
  );
});

test("composeSwingPlayBrief: a confluence zone whose call wall MATCHES the primary is unaffected (no spurious @price qualifier)", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({ status: "HOLD", recommendation: "HOLD" }),
    asOf: "2026-09-13 16:00 ET",
    sessionDate: "2026-09-13",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: {
      asOf: new Date().toISOString(),
      asOfEt: "2026-09-13 16:00 ET",
      spot: 113,
      dataAgeMs: 5_000,
      freshness: "live",
      gexWalls: { callWalls: [{ strike: 145, pct: 8 }], putWalls: [{ strike: 110, pct: 7 }] },
      gammaFlip: 124.09,
      maxPain: 144.5,
      confluenceZones: [
        {
          center: 144.75,
          kinds: ["call-wall", "max-pain"],
          score: 5,
          levels: [
            { price: 145, kind: "call-wall" },
            { price: 144.5, kind: "max-pain" },
          ],
        },
      ],
      darkPoolLevels: [],
    } as SwingPlayBriefContext["vector"],
  };
  const brief = composeSwingPlayBrief(ctx);
  const labels = (brief.envelope.levels ?? []).map((l) => l.label);
  const confluenceLabel = labels.find((l) => l.startsWith("confluence"));
  assert.equal(
    confluenceLabel,
    "confluence (call-wall+max-pain)",
    "confluence agreeing with the primary wall keeps the original, unqualified label",
  );
});

test("composeSwingPlayBrief: stale Vector wall must fall through to a LIVE GEX wall, not drop the level entirely (Largo C2)", () => {
  // Both sources exist for the same level, only Vector has gone stale — the live GEX-sourced
  // wall must still render. Suppressing the whole entry because Vector happened to be
  // present-but-stale would hide a value the member could otherwise see.
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({ status: "HOLD", recommendation: "HOLD" }),
    asOf: "2026-09-05 16:00 ET",
    sessionDate: "2026-09-05",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: {
      ticker: "INTC",
      gex_positioning: {
        ticker: "INTC",
        spot: 24.5,
        matrix_age_sec: 30,
        asof: new Date().toISOString(),
        as_of_et: "2026-09-05 16:00 ET",
        call_wall: 25,
        put_wall: 23,
        flip: 24.2,
      },
    } as SwingPlayBriefContext["ecosystem"],
    vector: {
      asOf: "2026-09-05T18:00:00.000Z",
      asOfEt: "2026-09-05 14:00 ET",
      spot: 24.5,
      dataAgeMs: 200_000,
      freshness: "stale",
      gexWalls: { callWalls: [{ strike: 26, pct: 8 }], putWalls: [{ strike: 22, pct: 7 }] },
      gammaFlip: 24,
    } as SwingPlayBriefContext["vector"],
  };
  const brief = composeSwingPlayBrief(ctx);
  const levels = brief.envelope.levels ?? [];
  const callWall = levels.find((l) => l.label === "call wall");
  const putWall = levels.find((l) => l.label === "put wall");
  const flip = levels.find((l) => l.label === "gamma flip");
  assert.equal(callWall?.price, 25, "must fall through to the live GEX call wall, not the stale Vector one");
  assert.equal(callWall?.provenance?.source, "GEX");
  assert.equal(putWall?.price, 23, "must fall through to the live GEX put wall, not the stale Vector one");
  assert.equal(flip?.price, 24.2, "must fall through to the live GEX flip, not the stale Vector one");
});

// FINDING 2026-09-08 (Ask Largo monitor cycle, live CG SWING_CG_25): the structured `levels`
// array's "GEX king" entry read ONLY `gex?.gex_king_strike`, with no Vector-ladder fallback —
// unlike call wall/put wall/gamma flip immediately above it, which all correctly prefer a live
// Vector reading via `vecX ?? gex?.x`. Meanwhile play-brief-narrative.ts's `focalLevelsFrom`
// already computed king as `vecKing ?? kingFromGex`. Same envelope, same conceptual level, two
// different precedence rules: a member saw "GEX king 52.5" in Levels-on-chart (GEX matrix) and
// "GEX king 50.00" in the Trade manager read narrative (Vector ladder) for the SAME brief.
test("composeSwingPlayBrief: GEX king level prefers a live Vector ladder king over the GEX matrix, matching the narrative's precedence", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({ status: "HOLD", recommendation: "HOLD" }),
    asOf: "2026-09-05 16:00 ET",
    sessionDate: "2026-09-05",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: {
      ticker: "INTC",
      gex_positioning: {
        ticker: "INTC",
        spot: 24.5,
        matrix_age_sec: 30,
        asof: new Date().toISOString(),
        as_of_et: "2026-09-05 16:00 ET",
        gex_king_strike: 25,
      },
    } as SwingPlayBriefContext["ecosystem"],
    vector: {
      asOf: new Date().toISOString(),
      asOfEt: "2026-09-05 16:00 ET",
      spot: 24.5,
      dataAgeMs: 1_000,
      freshness: "live",
      ladder: { rows: [{ strike: 24, isKing: true }] },
    } as unknown as SwingPlayBriefContext["vector"],
  };
  const brief = composeSwingPlayBrief(ctx);
  const levels = brief.envelope.levels ?? [];
  const king = levels.find((l) => l.label === "GEX king");
  assert.equal(king?.price, 24, "must show the live Vector ladder's king strike, not the GEX matrix one");
});

test("composeSwingPlayBrief: diff snapshot must not bypass stale-gated envelope levels (Largo C2)", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({ status: "HOLD", recommendation: "HOLD" }),
    asOf: "2026-09-05 16:00 ET",
    sessionDate: "2026-09-05",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: {
      ticker: "INTC",
      gex_positioning: {
        ticker: "INTC",
        spot: 24.5,
        flip: 24,
        call_wall: 26,
        put_wall: 22,
        asof: "2026-09-05T18:00:00Z",
        as_of_et: "2026-09-05 14:00 ET",
        session_date: "2026-09-05",
        market_session: "CLOSED",
        gex_king_strike: 25,
        net_gex: 12_300_000,
        gamma_posture: "long",
        matrix_age_sec: 200,
      },
    } as SwingPlayBriefContext["ecosystem"],
    vector: null,
  };
  const brief = composeSwingPlayBrief(ctx);
  const snap = JSON.parse(brief.briefContentKey!) as {
    gammaFlip: number | null;
    callWall: number | null;
    putWall: number | null;
  };
  assert.equal(snap.gammaFlip, null, "diff snapshot must not carry stale GEX-only gamma flip");
  assert.equal(snap.callWall, null, "diff snapshot must not carry stale GEX-only call wall");
  assert.equal(snap.putWall, null, "diff snapshot must not carry stale GEX-only put wall");
});

test("composeSwingPlayBrief: stale GEX-only dealer posture must not ground envelope evidence (Largo C2)", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay(),
    asOf: "2026-09-05 16:00 ET",
    sessionDate: "2026-09-05",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: {
      ticker: "INTC",
      recent_flow: null,
      flow_feed_fresh: false,
      gex_positioning: {
        ticker: "INTC",
        spot: 24.5,
        change_pct: 1.2,
        asof: "2026-09-05T18:00:00Z",
        as_of_et: "2026-09-05 14:00 ET",
        session_date: "2026-09-05",
        market_session: "CLOSED",
        flip: 24,
        call_wall: 26,
        put_wall: 22,
        net_gex: 12_300_000,
        gamma_posture: "long",
        nearest_wall: { strike: 26, kind: "resistance", distance_pts: 1.5 },
        matrix_age_sec: 200,
      },
      arsenal: null,
    } as SwingPlayBriefContext["ecosystem"],
    vector: null,
  };
  const brief = composeSwingPlayBrief(ctx);
  const postureEvidence = brief.envelope.evidence.find((e) => e.text.startsWith("Dealer posture:"));
  assert.equal(postureEvidence, undefined, "stale GEX-only posture must not reach Largo evidence");
});

test("composeSwingPlayBrief: live Vector regime still drives dealer posture when GEX matrix is stale", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({ status: "HOLD", recommendation: "HOLD" }),
    asOf: "2026-09-05 16:00 ET",
    sessionDate: "2026-09-05",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: {
      ticker: "INTC",
      gex_positioning: {
        ticker: "INTC",
        spot: 24.5,
        gamma_posture: "short",
        matrix_age_sec: 200,
        asof: "2026-09-05T18:00:00Z",
        as_of_et: "2026-09-05 14:00 ET",
        net_gex: 9_000_000,
        nearest_wall: { strike: 26, kind: "resistance", distance_pts: 1.5 },
      },
    } as SwingPlayBriefContext["ecosystem"],
    vector: {
      asOf: new Date().toISOString(),
      asOfEt: "2026-09-05 16:00 ET",
      spot: 24.5,
      regime: { posture: "long", label: "LONG" },
      gexWalls: { callWalls: [{ strike: 26, pct: 8 }], putWalls: [{ strike: 22, pct: 7 }] },
      gammaFlip: 24,
    } as SwingPlayBriefContext["vector"],
  };
  const brief = composeSwingPlayBrief(ctx);
  const postureEvidence = brief.envelope.evidence.find((e) => e.text.startsWith("Dealer posture:"));
  assert.ok(postureEvidence, "Vector regime should still ground dealer posture");
  assert.match(postureEvidence!.text, /γ long/);
  assert.doesNotMatch(postureEvidence!.text, /net GEX/, "stale GEX net_gex must not append when matrix is stale");
  assert.equal(postureEvidence?.provenance?.source, "Vector");
});

test("composeSwingPlayBrief: future-skewed option mark freshness is stale, not unknown (Largo C2)", () => {
  const futureMark = new Date(Date.now() + 30_000).toISOString();
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({ status: "OPEN", recommendation: "HOLD", markAsOf: futureMark }),
    asOf: "2026-09-06 10:00 ET",
    sessionDate: "2026-09-06",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
  };
  const brief = composeSwingPlayBrief(ctx);
  const markEvidence = brief.envelope.evidence.find((e) => e.text.startsWith("Option mark as of"));
  assert.ok(markEvidence, "expected an option-mark evidence entry");
  assert.equal(
    markEvidence!.provenance?.freshness,
    "stale",
    "future-skewed markAsOf must fail-closed to stale, not unknown",
  );
});

test("composeSwingPlayBrief: option-mark evidence/provenance use the Largo C1 ET stamp, not a bare UTC instant (FINDINGS 2026-09-06 #21)", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({ status: "OPEN", recommendation: "HOLD", markAsOf: "2026-09-04T21:45:18.663Z" }),
    asOf: "2026-09-05 16:00 ET",
    sessionDate: "2026-09-05",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
  };
  const brief = composeSwingPlayBrief(ctx);
  const markEvidence = brief.envelope.evidence.find((e) => e.text.startsWith("Option mark as of"));
  assert.ok(markEvidence, "expected an option-mark evidence entry");
  assert.equal(markEvidence?.text, "Option mark as of 2026-09-04 17:45 ET.");
  assert.equal(markEvidence?.provenance?.asOf, "2026-09-04 17:45 ET");
  assert.doesNotMatch(markEvidence!.text, /Z\.$/, "mark evidence must not be a bare UTC instant");

  const positionSection = brief.envelope.sections.find((s) => s.title === "Position");
  assert.match(positionSection!.body, /2026-09-04 17:45 ET/);
  assert.doesNotMatch(positionSection!.body, /\.663Z/, "Position section must not print a raw ISO mark timestamp");
});

test("composeSwingPlayBrief: earnings evidence carries brief asOf for Largo C1 joins", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay(),
    asOf: "2026-09-05 16:00 ET",
    sessionDate: "2026-09-05",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: {
      ticker: "INTC",
      recent_flow: null,
      flow_feed_fresh: false,
      arsenal: {
        scope: "single_name",
        earnings: { earnings_date: "2026-09-12", days_until: 7, report_time: "AMC", is_confirmed: true },
        fundamentals: null,
        related: [],
        news: null,
        macro: null,
        breadth: null,
        unavailable_sources: [],
      },
    } as SwingPlayBriefContext["ecosystem"],
    vector: null,
  };
  const brief = composeSwingPlayBrief(ctx);
  const earningsEvidence = brief.envelope.evidence.find((e) => e.text.startsWith("Next earnings"));
  assert.ok(earningsEvidence, "expected earnings evidence");
  assert.equal(earningsEvidence?.provenance?.asOf, "2026-09-05 16:00 ET");
});

test("composeSwingPlayBrief: short interest evidence grounds Catalysts claims for Largo C7", () => {
  const recentAsOf = new Date(Date.now() - 5 * 60_000).toISOString();
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay(),
    asOf: "2026-09-05 16:00 ET",
    sessionDate: "2026-09-05",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: {
      ticker: "INTC",
      recent_flow: null,
      flow_feed_fresh: false,
      arsenal: {
        scope: "single_name",
        earnings: null,
        fundamentals: {
          days_to_cover: 2.1,
          short_volume_ratio: 0.35,
          price_target: null,
          as_of: recentAsOf,
        },
        related: null,
        news: null,
        macro: null,
        breadth: null,
        unavailable_sources: [],
      },
    } as SwingPlayBriefContext["ecosystem"],
    vector: null,
  };
  const brief = composeSwingPlayBrief(ctx);
  const siEvidence = brief.envelope.evidence.find((e) => e.text.startsWith("Short interest:"));
  assert.ok(siEvidence, "expected short interest evidence");
  assert.match(siEvidence!.text, /DTC 2\.1d/);
  assert.match(siEvidence!.text, /short vol ratio 35%/);
  assert.equal(siEvidence?.provenance?.source, "Polygon / Benzinga");
  assert.equal(siEvidence?.provenance?.freshness, "recent");
});

test("composeSwingPlayBrief: short interest evidence freshness is stale when fund.as_of is old (Largo C2)", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay(),
    asOf: "2026-09-05 16:00 ET",
    sessionDate: "2026-09-05",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: {
      ticker: "INTC",
      recent_flow: null,
      flow_feed_fresh: false,
      arsenal: {
        scope: "single_name",
        earnings: null,
        fundamentals: {
          days_to_cover: 2.1,
          short_volume_ratio: 0.35,
          price_target: null,
          as_of: "2026-08-01",
        },
        related: null,
        news: null,
        macro: null,
        breadth: null,
        unavailable_sources: [],
      },
    } as SwingPlayBriefContext["ecosystem"],
    vector: null,
  };
  const brief = composeSwingPlayBrief(ctx);
  const siEvidence = brief.envelope.evidence.find((e) => e.text.startsWith("Short interest:"));
  assert.ok(siEvidence, "expected short interest evidence");
  assert.equal(siEvidence?.provenance?.freshness, "stale");
  assert.equal(
    siEvidence?.provenance?.asOf,
    "2026-08-01 16:00 ET",
    "date-only as_of must anchor at session close ET, not prior evening",
  );
});

test("composeSwingPlayBrief: short interest evidence is OMITTED (not just tagged stale) when fund.as_of is ancient (found 2026-09-15, live: MSTX ~9yr, CRCG/ECO ~258d)", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay(),
    asOf: "2026-09-15 16:00 ET",
    sessionDate: "2026-09-15",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: {
      ticker: "MSTX",
      recent_flow: null,
      flow_feed_fresh: false,
      arsenal: {
        scope: "single_name",
        earnings: null,
        fundamentals: {
          days_to_cover: 1.0,
          short_volume_ratio: 0.36,
          price_target: null,
          as_of: "2017-03-31",
        },
        related: null,
        news: null,
        macro: null,
        breadth: null,
        unavailable_sources: [],
      },
    } as SwingPlayBriefContext["ecosystem"],
    vector: null,
  };
  const brief = composeSwingPlayBrief(ctx);
  const siEvidence = brief.envelope.evidence.find((e) => e.text.startsWith("Short interest:"));
  assert.equal(
    siEvidence,
    undefined,
    "a ~9-year-old short-interest figure must be omitted, not rendered under the same STALE tag as a few-days-old one",
  );
});

test("composeSwingPlayBrief: short interest evidence still renders when fund.as_of is old-but-plausible (just under the ancient ceiling)", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay(),
    asOf: "2026-09-15 16:00 ET",
    sessionDate: "2026-09-15",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: {
      ticker: "INTC",
      recent_flow: null,
      flow_feed_fresh: false,
      arsenal: {
        scope: "single_name",
        earnings: null,
        fundamentals: {
          days_to_cover: 2.1,
          short_volume_ratio: 0.35,
          price_target: null,
          // 45 days old — under the 60-day ceiling, so it must still render (as "stale", honestly).
          as_of: "2026-08-01",
        },
        related: null,
        news: null,
        macro: null,
        breadth: null,
        unavailable_sources: [],
      },
    } as SwingPlayBriefContext["ecosystem"],
    vector: null,
  };
  const brief = composeSwingPlayBrief(ctx);
  const siEvidence = brief.envelope.evidence.find((e) => e.text.startsWith("Short interest:"));
  assert.ok(siEvidence, "a 45-day-old figure is under the ancient ceiling and must still render");
  assert.equal(siEvidence?.provenance?.freshness, "stale");
});

test("composeSwingPlayBrief: HELIX flow evidence carries brief asOf for Largo C1 joins", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay(),
    asOf: "2026-09-05 16:00 ET",
    sessionDate: "2026-09-05",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: {
      ticker: "INTC",
      recent_flow: {
        print_count: 12,
        window_hours: 24,
        call_premium: 1_000_000,
        put_premium: 500_000,
        unknown_premium: 0,
      },
      flow_feed_fresh: true,
    } as SwingPlayBriefContext["ecosystem"],
    vector: null,
  };
  const brief = composeSwingPlayBrief(ctx);
  const flowEvidence = brief.envelope.evidence.find((e) => e.text.startsWith("HELIX flow"));
  assert.ok(flowEvidence, "expected HELIX flow evidence");
  assert.match(flowEvidence!.text, /call-heavy/);
  assert.match(flowEvidence!.text, /\$1\.0M/);
  assert.match(flowEvidence!.text, /\$500K/);
  assert.match(flowEvidence!.text, /12 prints/);
  assert.equal(flowEvidence?.provenance?.asOf, "2026-09-05 16:00 ET");
  assert.equal(flowEvidence?.provenance?.freshness, "recent", "HELIX flow is a cached window aggregate, not tick-live");
});

test("composeSwingPlayBrief: swing-scan evidence/provenance use the Largo C1 ET stamp, not a bare UTC instant", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay(),
    asOf: "2026-09-05 16:00 ET",
    sessionDate: "2026-09-05",
    scanAsOf: "2026-09-05T19:30:00.000Z",
    scanSessionDay: "2026-09-05",
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
  };
  const brief = composeSwingPlayBrief(ctx);
  const scanEvidence = brief.envelope.evidence.find((e) => e.text.startsWith("Swing discovery scan as of"));
  assert.ok(scanEvidence, "expected a swing-scan evidence entry");
  assert.equal(scanEvidence?.text, "Swing discovery scan as of 2026-09-05 15:30 ET.");
  assert.equal(scanEvidence?.provenance?.asOf, "2026-09-05 15:30 ET");
  assert.doesNotMatch(scanEvidence!.text, /Z\.$/, "scan evidence must not be a bare UTC instant");

  const freshness = brief.envelope.sections.find((s) => s.title === "Data freshness");
  assert.ok(freshness, "expected Data freshness section when scanAsOf is set");
  assert.match(freshness!.body, /2026-09-05 15:30 ET/);
  assert.doesNotMatch(freshness!.body, /19:30:00\.000Z/, "Data freshness must not print a raw ISO scan timestamp");
});

test("composeSwingPlayBrief: prior-session scan evidence uses stale freshness, not recent", () => {
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
  const brief = composeSwingPlayBrief(ctx);
  const scanEvidence = brief.envelope.evidence.find((e) => e.text.startsWith("Swing discovery scan as of"));
  assert.ok(scanEvidence, "expected swing-scan evidence");
  assert.equal(scanEvidence?.provenance?.freshness, "stale", "prior-session scan must not claim recent freshness");
});

test("composeSwingPlayBrief: flowSnapshot is null when HELIX has no recent-flow read", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay(),
    asOf: "2026-09-05T20:00:00.000Z",
    sessionDate: "2026-09-05",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
  };
  const brief = composeSwingPlayBrief(ctx);
  assert.equal(brief.flowSnapshot, null);
});

test("composeSwingPlayBrief: stale HELIX flow omitted from snapshot and unavailableSources (C2/C3)", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay(),
    asOf: "2026-09-05T20:00:00.000Z",
    sessionDate: "2026-09-05",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: {
      ticker: "INTC",
      zerodte_today: null,
      nighthawk_recent: null,
      recent_audit_entries: [],
      recent_flow: {
        window_hours: 24,
        print_count: 12,
        call_premium: 1_200_000,
        put_premium: 400_000,
        unknown_premium: 0,
      },
      recent_anomalies: [],
      flow_full_state: null,
      spx_play: null,
      spx_full_state: null,
      spx_desk_convergence: null,
      flow_feed_fresh: false,
      gex_positioning: null,
      vector_full_state: null,
      arsenal: null,
    },
    vector: null,
  };
  const brief = composeSwingPlayBrief(ctx);
  assert.equal(brief.flowSnapshot, null);
  assert.ok(
    brief.envelope.unavailableSources?.some((u) => u.source === "HELIX flow" && u.reason === "pipeline stale"),
  );
  assert.ok(!brief.envelope.sections.some((s) => /call-heavy/i.test(s.body)), "stale flow must not coach tape bias");
  assert.ok(
    !brief.envelope.sections.some((s) => /HELIX call-led|HELIX put-led/i.test(s.body)),
    "stale flow must not coach cross-desk or counter-thesis HELIX friction",
  );
});

test("composeSwingPlayBrief: OPEN play emits management + thesis health", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({
      status: "HOLD",
      recommendation: "HOLD",
      entry: 4.9,
      mark: 9.7,
      pnlPct: 98,
      peak: 98,
      manageAction: "HOLD",
      thesisHealth: {
        health: 54,
        entryIndex: 60,
        currentIndex: 54,
        delta: -6,
        rung: "DEGRADED",
        rungLabel: "Thesis fading",
        pillars: [
          {
            id: "structure",
            label: "Persistence",
            weight: 0.28,
            commitScore: 0.9,
            currentScore: 0.4,
            commitLabel: "triggered",
            currentLabel: "unknown",
            status: "faded",
            contributionPts: 11,
            deltaPts: -8,
          },
        ],
        moves: ["Persistence weakened"],
        committedAtEt: "Sep 3, 10:00 AM",
        computedAtEt: "Sep 5, 4:00 PM",
        advisory: "Tighten risk",
        thesisBreakLevel: "warn",
        thesisBreakNote: "Thesis fading",
      },
      exitPolicy: {
        policy: "trim_scale",
        hard_stop_pct: -60,
        target_pct: 100,
        trim_levels: [{ trigger_pct: 50, fraction: 0.33, premium: 7.35, fired: true }],
        runner_fraction: 0.34,
        stop_premium: 1.96,
        target_premium: 9.8,
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
  const brief = composeSwingPlayBrief(ctx);
  const titles = brief.envelope.sections.map((s) => s.title);
  assert.ok(titles.includes("Management"));
  assert.ok(titles.includes("Thesis health"));
  assert.ok(titles.includes("Position"));
  assert.ok(titles.includes("Trade manager read"));
  assert.ok(titles.includes("Why this setup"));
  assert.ok(titles.includes("What to watch"));
  assert.ok(!titles.includes("Hold plan"), "hold plan folded into Trade manager read");
  assert.ok(
    brief.envelope.sections.some((s) => s.title === "Thesis health" && /score withheld/i.test(s.body)),
    "uncalibrated thesis health must not show aggregate %",
  );
  assert.ok(
    !brief.envelope.sections.some(
      (s) => s.title === "Thesis health" && /Persistence.*unknown/i.test(s.body),
    ),
    "uncalibrated thesis health must not show misleading default pillar rows",
  );
  const verdict = brief.envelope.sections.find((s) => s.title === "Verdict");
  assert.ok(verdict, "Verdict section expected");
  assert.ok(
    !/Thesis strength/i.test(verdict.body),
    `Verdict must not leak fabricated thesis strength, got: ${verdict.body}`,
  );
});

// FINDINGS (Ask Largo standing mandate): `play.greeks` (DeckGreeks: delta/gamma/theta/vega/iv) is a
// real, live per-contract read for every open swing position — the active-refresh cron fetches it
// on every tick (SwingLiveQuote, live-plays.ts), carries it onto the ChainContract
// (contractFromRow), and adapters.ts's terminalPlayFromHorizon already builds `play.greeks` from it
// via `greeksFromContract` (see that call site's own FINDINGS 2026-08-06 SEV-3 comment: "greeks
// never reached the desk... SWING/LEAPS greek strip could never render anything" — fixed for the
// Command Deck UI's greek strip, PlayTerminal.tsx). But the play-brief (Ask Largo's own consumer of
// the exact same TerminalPlay object) never reads `play.greeks` anywhere in play-brief*.ts — a member
// asking Largo "what's my theta decay / delta exposure on this position" gets nothing, even though
// the same live numbers are already rendering one click away on the deck's own greek strip. Same
// wiring-gap shape as the #4101 `unavailableSources` fix (data computed, even already surfaced on a
// sibling UI surface, never reaches the Largo envelope) — the Position section is the natural home
// since Greeks are position-level, per-contract facts alongside Entry/Mark/P&L.
test("composeSwingPlayBrief: OPEN position's live greeks (delta/gamma/theta/vega/iv) reach the Position section (Ask Largo wiring gap)", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({
      status: "HOLD",
      recommendation: "HOLD",
      entry: 4.9,
      mark: 6.1,
      pnlPct: 24.5,
      greeks: { delta: 0.62, gamma: 0.031, theta: -0.084, vega: 0.112, iv: 0.485 },
    }),
    asOf: "2026-09-18T18:00:00.000Z",
    sessionDate: "2026-09-18",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
  };
  const brief = composeSwingPlayBrief(ctx);
  const position = brief.envelope.sections.find((s) => s.title === "Position");
  assert.ok(position, "Position section expected");
  assert.match(position!.body, /Greeks:.*Δ \+0\.62/, `expected delta in Position body, got: ${position!.body}`);
  assert.match(position!.body, /Γ \+0\.03/);
  // theta stays unsigned-by-toFixed (matches the deck's own `fmtGreek` convention — a negative
  // theta value already carries its own minus sign, never a spurious "+").
  assert.match(position!.body, /θ -0\.08\/day/);
  assert.match(position!.body, /ν \+0\.11/);
  assert.match(position!.body, /IV 49%/);
});

test("composeSwingPlayBrief: OPEN position with no live greeks omits the Greeks line entirely (honest absence, never fabricated)", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({
      status: "HOLD",
      recommendation: "HOLD",
      entry: 4.9,
      mark: 6.1,
      pnlPct: 24.5,
      greeks: null,
    }),
    asOf: "2026-09-18T18:00:00.000Z",
    sessionDate: "2026-09-18",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
  };
  const brief = composeSwingPlayBrief(ctx);
  const position = brief.envelope.sections.find((s) => s.title === "Position");
  assert.ok(position, "Position section expected");
  assert.doesNotMatch(position!.body, /Greeks:/, "must not fabricate a Greeks line with no live quote");
});

test("composeSwingPlayBrief: absolute premium prices (entry/mark/stop/target) never carry a '+' sign (live NN repro 2026-09-09)", () => {
  // Live repro: GET /api/market/swing/play-brief?ticker=NN&positionId=32&... rendered
  // "Entry: **+$1.95**" / "Mark: **+$1.35**" / "Rails: stop +$0.78 · target +$3.90" even
  // though the position is DOWN 30.8% (mark 1.35 < entry 1.95, well below the 0.78 stop).
  // `fmtUsd` in play-brief.ts (the file-local one used only for these four absolute premium
  // fields) is a signed-DELTA formatter (`n >= 0 ? "+" : ""`) misapplied to an absolute PRICE
  // level, which is never negative to begin with — so every open swing brief shows a "+" on
  // its entry/mark/stop/target regardless of whether the position is up or down, and the
  // stop-loss trigger price in particular reads like a gain.
  const brief = composeSwingPlayBrief({
    play: fixturePlay({
      status: "HOLD",
      recommendation: "HOLD",
      entry: 4.9,
      mark: 9.7,
      pnlPct: 98,
      peak: 98,
      manageAction: "HOLD",
      exitPolicy: {
        policy: "trim_scale",
        hard_stop_pct: -60,
        target_pct: 100,
        trim_levels: [{ trigger_pct: 50, fraction: 0.33, premium: 7.35, fired: true }],
        runner_fraction: 0.34,
        stop_premium: 1.96,
        target_premium: 9.8,
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
  });
  const position = brief.envelope.sections.find((s) => s.title === "Position");
  const management = brief.envelope.sections.find((s) => s.title === "Management");
  assert.ok(position, "expected Position section");
  assert.ok(management, "expected Management section");

  assert.match(position!.body, /Entry: \*\*\$4\.90\*\*/, `got: ${position!.body}`);
  assert.match(position!.body, /Mark: \*\*\$9\.70\*\*/, `got: ${position!.body}`);
  assert.doesNotMatch(position!.body, /\$\+|\+\$/, `Position must never sign an absolute price, got: ${position!.body}`);

  assert.match(management!.body, /Rails: stop \$1\.96 · target \$9\.80/, `got: ${management!.body}`);
  assert.doesNotMatch(
    management!.body,
    /\$\+|\+\$/,
    `Management must never sign an absolute premium price, got: ${management!.body}`,
  );
});

test("composeSwingPlayBrief: OPEN with vector emits trade manager narrative", () => {
  const brief = composeSwingPlayBrief({
    play: fixturePlay({ status: "HOLD", recommendation: "HOLD", direction: "LONG" }),
    asOf: "2026-09-05T20:00:00.000Z",
    sessionDate: "2026-09-05",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: {
      ticker: "INTC",
      recent_flow: { window_hours: 24, print_count: 5, call_premium: 500_000, put_premium: 200_000, unknown_premium: 0 },
      gex_positioning: { spot: 100, flip: 98, gamma_posture: "long", gex_king_strike: 100 },
    } as SwingPlayBriefContext["ecosystem"],
    vector: {
      spot: 100,
      gammaFlip: 98,
      darkPoolLevels: [{ strike: 99, premium: 5_000_000, pct: 35 }],
      regime: { posture: "long", label: "LONG" },
      gexWalls: { callWalls: [{ strike: 105, pct: 8 }], putWalls: [{ strike: 97, pct: 7 }] },
    } as SwingPlayBriefContext["vector"],
  });
  assert.ok(brief.envelope.sections.some((s) => s.title === "Trade manager read"));
  assert.ok(brief.envelope.sections.some((s) => s.title === "Trade manager read" && /dark pool|long gamma/i.test(s.body)));
});

test("composeSwingPlayBrief: expandIntel keeps collapsed sections visible", () => {
  const brief = composeSwingPlayBrief(
    {
      play: fixturePlay({ status: "HOLD", recommendation: "HOLD", direction: "LONG" }),
      asOf: "2026-09-05T20:00:00.000Z",
      sessionDate: "2026-09-05",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: {
        ticker: "INTC",
        recent_flow: { window_hours: 24, print_count: 5, call_premium: 500_000, put_premium: 200_000, unknown_premium: 0 },
        gex_positioning: { spot: 100, flip: 98, gamma_posture: "long", gex_king_strike: 100 },
      } as SwingPlayBriefContext["ecosystem"],
      vector: {
        spot: 100,
        gammaFlip: 98,
        gexWalls: { callWalls: [{ strike: 105, pct: 8 }], putWalls: [{ strike: 97, pct: 7 }] },
      } as SwingPlayBriefContext["vector"],
    },
    { expandIntel: true },
  );
  const titles = brief.envelope.sections.map((s) => s.title);
  assert.ok(titles.includes("Trade manager read"));
  assert.ok(titles.includes("GEX posture") || titles.includes("Flow & positioning"));
});

test("composeSwingPlayBrief: CLOSED play emits outcome section", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({
      status: "CLOSED",
      exitPnlPct: 42,
      closedReason: "scale_out_complete",
      mfeCapturePct: 68,
      exitAt: "2026-08-12T16:05:00.000Z",
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
  const brief = composeSwingPlayBrief(ctx);
  const outcome = brief.envelope.sections.find((s) => s.title === "Outcome");
  assert.ok(outcome?.body.includes("42"));
  assert.match(outcome!.body, /2026-08-12 12:05 ET/);
  assert.doesNotMatch(outcome!.body, /16:05:00\.000Z/, "Outcome must not print a raw ISO exit timestamp");
});

test("composeSwingPlayBrief: envelope levels use measured Vector/GEX freshness, not hardcoded live", () => {
  const staleAsOf = new Date(Date.now() - 20 * 60_000).toISOString();
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({ status: "HOLD", recommendation: "HOLD" }),
    asOf: "2026-09-05 16:00 ET",
    sessionDate: "2026-09-05",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: {
      ticker: "INTC",
      gex_positioning: {
        ticker: "INTC",
        spot: 24.5,
        flip: 24,
        call_wall: 26,
        put_wall: 22,
        asof: staleAsOf,
        as_of_et: "2026-09-05 16:00 ET",
        session_date_et: "2026-09-05",
        market_phase: "closed",
        gex_king_strike: 25,
        net_gex: null,
        nearest_wall: null,
        gamma_posture: "long",
        vanna_posture: null,
        delta_posture: null,
        charm_posture: null,
      },
    } as SwingPlayBriefContext["ecosystem"],
    vector: {
      asOf: staleAsOf,
      spot: 24.5,
      gammaFlip: 24,
      gexWalls: { callWalls: [{ strike: 26, pct: 8 }], putWalls: [{ strike: 22, pct: 7 }] },
    } as SwingPlayBriefContext["vector"],
  };
  const brief = composeSwingPlayBrief(ctx);
  const spot = brief.envelope.levels?.find((l) => l.label === "spot");
  assert.equal(spot, undefined, "stale GEX spot must not render when Vector snapshot is also stale");
  const callWall = brief.envelope.levels?.find((l) => l.label === "call wall");
  assert.equal(callWall, undefined, "stale Vector walls must be omitted from envelope levels, not merely tagged stale");
});

test("composeSwingPlayBrief: dark pool envelope levels attribute Vector provenance, not HELIX (C8)", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({ status: "HOLD", recommendation: "HOLD" }),
    asOf: "2026-09-05 16:00 ET",
    sessionDate: "2026-09-05",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: {
      asOf: new Date().toISOString(),
      asOfEt: "2026-09-05 16:00 ET",
      spot: 24.5,
      darkPoolLevels: [{ strike: 99, premium: 5_000_000, pct: 35 }],
    } as SwingPlayBriefContext["vector"],
  };
  const brief = composeSwingPlayBrief(ctx);
  const darkPool = brief.envelope.levels?.find((l) => l.label === "dark pool");
  assert.ok(darkPool, "dark pool level must be present");
  assert.equal(
    darkPool?.provenance?.source,
    "Vector",
    "dark pool levels come from Vector full-state, not HELIX tape",
  );
});

// FINDINGS 2026-09-09: the "Trade manager read" narrative (magnetCoaching) names the gamma
// magnet as a decision-relevant price ("pull up toward this node"), but levelsFromContext never
// surfaced it in the structured envelope.levels array — a "show on chart" follow-up or any other
// Largo consumer of structured levels had no way to see the value the prose was pointing at.
test("composeSwingPlayBrief: gamma magnet is surfaced as a structured envelope level, not narrative-only", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({ status: "HOLD", recommendation: "HOLD" }),
    asOf: "2026-09-05 16:00 ET",
    sessionDate: "2026-09-05",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: {
      asOf: new Date().toISOString(),
      asOfEt: "2026-09-05 16:00 ET",
      spot: 120,
      magnet: { strike: 134.06, distancePct: 11.7, pull: "up" },
    } as SwingPlayBriefContext["vector"],
  };
  const brief = composeSwingPlayBrief(ctx);
  const magnet = brief.envelope.levels?.find((l) => l.label === "gamma magnet");
  assert.ok(magnet, "gamma magnet level must be present");
  assert.equal(magnet?.price, 134.06);
  assert.equal(magnet?.provenance?.source, "Vector");
});

test("composeSwingPlayBrief: envelope level provenance uses ET stamps, not raw UTC ISO (C1)", () => {
  const staleAsOf = "2026-09-05T20:00:00.000Z";
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({ status: "HOLD", recommendation: "HOLD" }),
    asOf: "2026-09-05 16:00 ET",
    sessionDate: "2026-09-05",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: {
      ticker: "INTC",
      gex_positioning: {
        ticker: "INTC",
        spot: 24.5,
        flip: 24,
        call_wall: 26,
        put_wall: 22,
        asof: staleAsOf,
        as_of_et: "2026-09-05 16:00 ET",
        session_date_et: "2026-09-05",
        market_phase: "closed",
        gex_king_strike: 25,
        net_gex: null,
        nearest_wall: null,
        gamma_posture: "long",
        vanna_posture: null,
        delta_posture: null,
        charm_posture: null,
      },
    } as SwingPlayBriefContext["ecosystem"],
    vector: {
      asOf: staleAsOf,
      asOfEt: "2026-09-05 16:00 ET",
      spot: 24.5,
      gammaFlip: 24,
      gexWalls: { callWalls: [{ strike: 26, pct: 8 }], putWalls: [{ strike: 22, pct: 7 }] },
    } as SwingPlayBriefContext["vector"],
  };
  const brief = composeSwingPlayBrief(ctx);
  for (const level of brief.envelope.levels ?? []) {
    const asOf = level.provenance?.asOf;
    assert.ok(asOf, `${level.label} must carry asOf`);
    assert.doesNotMatch(asOf!, /T\d{2}:\d{2}:\d{2}\.\d{3}Z/, `${level.label} must not use raw UTC ISO`);
    assert.match(asOf!, / ET$/, `${level.label} asOf must be ET-stamped`);
  }
});

test("composeSwingPlayBrief: book concentration is reported ONCE, not duplicated across 'Trade manager read' and 'Book context'", () => {
  // Reproduces a live bug from PR #4110: bookContextCoaching (in the "Trade manager read" bullets)
  // and bookContextSection (the dedicated "Book context" section, #4101) both call
  // checkPortfolioOverlap on the same ctx.openBook and render near-identical concentration
  // language, so a member with an overlapping book saw the same warning twice on one brief.
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({ ticker: "NVDA", direction: "LONG", status: "HOLD", recommendation: "HOLD" }),
    asOf: "2026-09-05T20:00:00.000Z",
    sessionDate: "2026-09-05",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
    openBook: [
      { ticker: "AMD", direction: "LONG" },
      { ticker: "SMH", direction: "LONG" },
    ],
  };
  const brief = composeSwingPlayBrief(ctx);
  const concentrationSections = brief.envelope.sections.filter((s) => /concentration/i.test(s.body));
  assert.equal(
    concentrationSections.length,
    1,
    `expected book concentration to be reported in exactly one section, found it in: ${concentrationSections.map((s) => s.title).join(", ")}`,
  );
});

test("composeSwingPlayBrief: Position section shows a BLENDED P&L once a trim has fired (live CRWD repro 2026-09-11)", () => {
  // Live repro: GET /api/market/swing/play-brief?ticker=CRWD&positionId=19 — entry $16.65,
  // peak $38.25 (+129.7%, well past the +100% trim trigger), trim fired (SWING_SCALE_OUT_POLICY:
  // 50% banked at +100%, 50% runner), mark back down to $17.05. The runner-only `pnlPct` (+2.4%)
  // was the ONLY number shown, silently discarding the ~+100% already banked on the other half —
  // the true blended outcome is ~+51.2% (0.5*100 + 0.5*2.4), not +2.4%.
  const brief = composeSwingPlayBrief({
    play: fixturePlay({
      status: "TRIM",
      recommendation: "TRIM",
      entry: 16.65,
      mark: 17.05,
      pnlPct: 2.4,
      peak: 129.7,
      manageAction: "EXIT_RUNNER",
      exitPolicy: {
        policy: "ratchet",
        hard_stop_pct: -60,
        target_pct: 100,
        trim_levels: [{ trigger_pct: 100, fraction: 0.5, premium: 33.3, fired: true }],
        runner_fraction: 0.5,
        stop_premium: 6.66,
        target_premium: 33.3,
        time_stop_et: "16:00",
      },
    }),
    asOf: "2026-09-10T21:00:00.000Z",
    sessionDate: "2026-09-10",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
  });
  const position = brief.envelope.sections.find((s) => s.title === "Position");
  assert.ok(position, "expected Position section");
  // Runner-only line stays (still meaningful — "how is the open remainder doing") but is now
  // annotated so it is not mistaken for the whole position's outcome.
  assert.match(position!.body, /P&L: \*\*\+2\.4%\*\*.*open runner only/, `got: ${position!.body}`);
  // Blended = 0.5*100 (banked trim) + 0.5*2.4 (runner) = 51.2, rounded per fmtPct(1 digit).
  assert.match(
    position!.body,
    /Blended P&L \(realized trim \+ open runner\): \*\*\+51\.2%\*\*/,
    `got: ${position!.body}`,
  );
  // The blended composite is otherwise opaque arithmetic a member has to trust — show the fired
  // rung's own fraction/trigger/absolute premium so the +51.2% is self-verifying (0.5 @ +100% =
  // $33.30, the ladder's own frozen premium level for this tranche).
  assert.match(
    position!.body,
    /Banked: \*\*50% @ \+100%\*\* \(\$33\.30\)/,
    `got: ${position!.body}`,
  );
});

// ENHANCEMENT (2026-09-15, Ask Largo standing mandate, live repro SWING:CRWD/positionId 19):
// `play.trough` (adapters.ts's troughDisplay, computed symmetrically alongside peakDisplay on
// every TerminalPlay row) was fully computed and threaded onto every position but had ZERO
// consumers anywhere in src/lib/swing/ — the Position section showed "Peak: +161.3%" with no way
// to know the same position had also been down -57.2% before it worked. Conviction-relevant
// history a trade manager would cite that the data already supported.
test("composeSwingPlayBrief: Position section shows Trough alongside Peak (live CRWD repro 2026-09-15)", () => {
  const brief = composeSwingPlayBrief({
    play: fixturePlay({
      status: "TRIM",
      recommendation: "TRIM",
      entry: 16.65,
      mark: 39.0,
      pnlPct: 134.2,
      peak: 161.3,
      trough: -57.2,
    }),
    asOf: "2026-09-14T21:00:00.000Z",
    sessionDate: "2026-09-14",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
  });
  const position = brief.envelope.sections.find((s) => s.title === "Position");
  assert.ok(position, "expected Position section");
  assert.match(position!.body, /Peak: \*\*\+161\.3%\*\*/, `got: ${position!.body}`);
  assert.match(
    position!.body,
    /Trough: \*\*-57\.2%\*\*/,
    "the position's worst excursion must be shown alongside its best, not silently dropped",
  );
});

test("composeSwingPlayBrief: Position section shows Trough as em-dash when the field is null (never fabricated)", () => {
  const brief = composeSwingPlayBrief({
    play: fixturePlay({ status: "HOLD", recommendation: "HOLD", entry: 10, mark: 11, pnlPct: 10, peak: 15, trough: null }),
    asOf: "2026-09-14T21:00:00.000Z",
    sessionDate: "2026-09-14",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
  });
  const position = brief.envelope.sections.find((s) => s.title === "Position");
  assert.match(position!.body, /Trough: \*\*—\*\*/, `got: ${position!.body}`);
});

test("composeSwingPlayBrief: Position section lists every fired rung when a trim-scale ladder has banked more than one tranche", () => {
  const brief = composeSwingPlayBrief({
    play: fixturePlay({
      status: "TRIM",
      recommendation: "TRIM",
      entry: 10,
      mark: 12,
      pnlPct: 20,
      peak: 210,
      manageAction: "TAKE_PARTIAL",
      exitPolicy: {
        policy: "trim_scale",
        hard_stop_pct: -60,
        target_pct: 50,
        trim_levels: [
          { trigger_pct: 25, fraction: 0.33, premium: 12.5, fired: true },
          { trigger_pct: 50, fraction: 0.33, premium: 15, fired: true },
        ],
        runner_fraction: 0.34,
        stop_premium: 4,
        target_premium: 15,
        time_stop_et: "16:00",
      },
    }),
    asOf: "2026-09-10T21:00:00.000Z",
    sessionDate: "2026-09-10",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
  });
  const position = brief.envelope.sections.find((s) => s.title === "Position");
  assert.ok(position, "expected Position section");
  assert.match(
    position!.body,
    /Banked: \*\*33% @ \+25%\*\* \(\$12\.50\) · \*\*33% @ \+50%\*\* \(\$15\.00\)/,
    `got: ${position!.body}`,
  );
});

test("composeSwingPlayBrief: Position section omits the Banked line when a fired rung has no priced premium (no entry basis)", () => {
  const brief = composeSwingPlayBrief({
    play: fixturePlay({
      status: "TRIM",
      recommendation: "TRIM",
      entry: 10,
      mark: 12,
      pnlPct: 20,
      peak: 210,
      manageAction: "EXIT_RUNNER",
      exitPolicy: {
        policy: "ratchet",
        hard_stop_pct: -60,
        target_pct: 100,
        trim_levels: [{ trigger_pct: 100, fraction: 0.5, premium: null, fired: true }],
        runner_fraction: 0.5,
        stop_premium: null,
        target_premium: null,
        time_stop_et: "16:00",
      },
    }),
    asOf: "2026-09-10T21:00:00.000Z",
    sessionDate: "2026-09-10",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
  });
  const position = brief.envelope.sections.find((s) => s.title === "Position");
  assert.ok(position, "expected Position section");
  // Still shows the fraction/trigger (known) but never fabricates a dollar level it doesn't have.
  assert.match(position!.body, /Banked: \*\*50% @ \+100%\*\*(?!\s*\()/, `got: ${position!.body}`);
});

test("composeSwingPlayBrief: Position section omits blended P&L when no trim has fired yet (no false precision)", () => {
  const brief = composeSwingPlayBrief({
    play: fixturePlay({
      status: "HOLD",
      recommendation: "HOLD",
      entry: 4.9,
      mark: 5.2,
      pnlPct: 6.1,
      peak: 12,
      manageAction: "HOLD",
      exitPolicy: {
        policy: "trim_scale",
        hard_stop_pct: -60,
        target_pct: 100,
        trim_levels: [{ trigger_pct: 100, fraction: 0.5, premium: 9.8, fired: false }],
        runner_fraction: 0.5,
        stop_premium: 1.96,
        target_premium: 9.8,
        time_stop_et: "16:00",
      },
    }),
    asOf: "2026-09-10T21:00:00.000Z",
    sessionDate: "2026-09-10",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
  });
  const position = brief.envelope.sections.find((s) => s.title === "Position");
  assert.ok(position, "expected Position section");
  assert.doesNotMatch(position!.body, /Blended P&L/, `got: ${position!.body}`);
  assert.doesNotMatch(position!.body, /open runner only/, `got: ${position!.body}`);
});

test("composeSwingPlayBrief: Position section does not silently echo entry as Mark when the quote never synced (live IMPP/EBS/QCML repro 2026-09-11)", () => {
  // Live repro: GET /api/market/swing/play-brief?playId=SWING:IMPP (and EBS, QCML — all open
  // Engine-B/banger positions with no live-synced quote yet) rendered "Entry: $0.10 / Mark: $0.10
  // / P&L: —" for all three. `horizonPlayFromBangerPosition` (banger-lane-merge.ts) computes
  // `contract.mid = row.last_mark ?? entry_premium` as a deliberate numeric fallback for
  // downstream ranking/exit-ladder math, and that `mid` flows straight into `play.mark` — so
  // "Mark" here is byte-identical to Entry only because it IS Entry, not because the position
  // is flat. Every other section of this brief already discloses the unsynced mark via
  // `play.markIsSync` (unavailableSources' "option mark: sync quote without freshness
  // timestamp", and the "Data freshness" section's "Mark age unknown" line) — this was the one
  // place, the Position section's own Mark line, that printed the raw fallback number unguarded.
  const brief = composeSwingPlayBrief({
    play: fixturePlay({
      status: "OPEN",
      recommendation: "HOLD",
      entry: 0.1,
      mark: 0.1, // banger-lane-merge.ts's `mark ?? entry` fallback — literally the entry price
      pnlPct: null,
      peak: null,
      markIsSync: true,
      markAsOf: null,
      manageAction: "HOLD",
    }),
    asOf: "2026-09-11T08:16:00.000Z",
    sessionDate: "2026-09-11",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
  });
  const position = brief.envelope.sections.find((s) => s.title === "Position");
  assert.ok(position, "expected Position section");
  assert.match(position!.body, /Entry: \*\*\$0\.10\*\*/, `got: ${position!.body}`);
  assert.doesNotMatch(
    position!.body,
    /Mark: \*\*\$0\.10\*\*/,
    `Mark must not silently echo the entry-fallback price as a real quote, got: ${position!.body}`,
  );
  assert.match(position!.body, /Mark: \*\*unknown\*\*/, `got: ${position!.body}`);
});

test("composeSwingPlayBrief: Position section still shows a real Mark once the quote has synced (markIsSync false)", () => {
  const brief = composeSwingPlayBrief({
    play: fixturePlay({
      status: "OPEN",
      recommendation: "HOLD",
      entry: 0.1,
      mark: 0.14,
      pnlPct: 40,
      peak: 40,
      markIsSync: false,
      markAsOf: "2026-09-11T13:35:00.000Z",
      manageAction: "HOLD",
    }),
    asOf: "2026-09-11T13:36:00.000Z",
    sessionDate: "2026-09-11",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
  });
  const position = brief.envelope.sections.find((s) => s.title === "Position");
  assert.ok(position, "expected Position section");
  assert.match(position!.body, /Mark: \*\*\$0\.14\*\*/, `got: ${position!.body}`);
  assert.doesNotMatch(position!.body, /Mark: \*\*unknown\*\*/, `got: ${position!.body}`);
});

test("composeSwingPlayBrief: Position section does not call a mark 'unknown' when a real P&L was computed from it (live ALAB repro 2026-09-11)", () => {
  // Live repro: GET /api/market/swing/play-brief?playId=SWING:ALAB rendered
  // "Mark: **unknown** _(sync quote, no live price yet — do not read as flat)_" immediately
  // followed a few lines later by "P&L: **-35.9%**" — self-contradicting, since that P&L can only
  // exist if `livePnlPct(entry, mark)` (banger-lane-merge.ts) had a real, non-null mark to compute
  // it from. `markIsSync` (adapters.ts: `src.markAsOf == null`) is true here not because the mark
  // is unknown but because `BangerPositionRow` (positions-db.ts) has no `mark_as_of` column at
  // all — every banger-lane row reads markIsSync=true regardless of whether its `last_mark` is a
  // real, fresh quote. The true "mark is unknown" signature (from the entry-fallback bug this
  // guard was originally built for) is `pnlPct == null`, exercised by the IMPP/EBS/QCML test above
  // — this fixture is the other half: markIsSync true, but a real non-null pnlPct proves a real
  // mark was behind it, so the Position section must show the mark's real value (with a
  // not-timestamped caveat), never claim it is unknown.
  const brief = composeSwingPlayBrief({
    play: fixturePlay({
      status: "OPEN",
      recommendation: "HOLD",
      entry: 8.15,
      mark: 5.22, // a real, distinct-from-entry mark — proves markIsSync's "no timestamp" is not "no mark"
      pnlPct: -35.9,
      peak: -21.5,
      markIsSync: true,
      markAsOf: null,
      manageAction: "HOLD",
    }),
    asOf: "2026-09-11T09:23:00.000Z",
    sessionDate: "2026-09-11",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
  });
  const position = brief.envelope.sections.find((s) => s.title === "Position");
  assert.ok(position, "expected Position section");
  assert.doesNotMatch(
    position!.body,
    /Mark: \*\*unknown\*\*/,
    `Mark must not read "unknown" when a real P&L was derived from it, got: ${position!.body}`,
  );
  assert.match(position!.body, /Mark: \*\*\$5\.22\*\*/, `got: ${position!.body}`);
  assert.match(position!.body, /P&L: \*\*-35\.9%\*\*/, `got: ${position!.body}`);
});

test("composeSwingPlayBrief: Thesis health section carries no bias for a healthy SHORT (Largo C5 — a non-directional quality score must never badge bullish on a bearish trade)", () => {
  // Live defect (2026-09-15, Ask Largo standing mandate): thesisHealthSection mapped h.health
  // (a direction-agnostic "is the setup intact" score) straight to bullish/bearish. A SHORT play
  // with health>=65 (thesis performing exactly as intended, price falling) badged the section
  // green "Bullish" via BieSectionCard's BiasPill — the literal opposite of what the trade is
  // betting, contradicting the envelope's own top-level biasFromDirection(play.direction).
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({
      ticker: "XYZ",
      direction: "SHORT",
      status: "HOLD",
      recommendation: "HOLD",
      entry: 4.9,
      mark: 3.1,
      pnlPct: -36.7,
      thesisHealth: {
        health: 80,
        entryIndex: 78,
        currentIndex: 80,
        delta: 2,
        rung: "INTACT",
        rungLabel: "Thesis intact",
        pillars: [
          {
            id: "structure",
            label: "Persistence",
            weight: 0.28,
            commitScore: 0.85,
            currentScore: 0.9,
            commitLabel: "triggered",
            currentLabel: "confirmed",
            status: "intact",
            contributionPts: 25,
            deltaPts: 1,
          },
        ],
        moves: ["Persistence strengthened"],
        committedAtEt: "Sep 3, 10:00 AM",
        computedAtEt: "Sep 5, 4:00 PM",
        advisory: null,
        thesisBreakLevel: "intact",
        thesisBreakNote: null,
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
  const brief = composeSwingPlayBrief(ctx);
  assert.equal(brief.envelope.bias, "bearish", "sanity: the SHORT play's own top-level bias must be bearish");
  const thesis = brief.envelope.sections.find((s) => s.title === "Thesis health");
  assert.ok(thesis, "expected a calibrated Thesis health section for this fixture");
  assert.match(thesis!.body, /80%/);
  assert.equal(
    thesis!.bias,
    undefined,
    `Thesis health must carry no directional bias (it is a quality score, not a market call) — got: ${thesis!.bias}`,
  );
});

