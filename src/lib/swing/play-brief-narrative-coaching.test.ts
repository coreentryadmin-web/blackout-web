import test from "node:test";
import assert from "node:assert/strict";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import type { SwingPlayBriefContext } from "./play-brief-types";
import {
  catalystCoaching,
  closedCoaching,
  collectCoachingBullets,
  confluenceCoaching,
  crossDeskCoaching,
  dataHonestyCoaching,
  execSlippageCoaching,
  flowPrintsCoaching,
  ivRankCoaching,
  magnetCoaching,
  manageLifecycleCoaching,
  progressRatchetCoaching,
  thesisBreakCoaching,
  thesisPillarCoaching,
  vectorPlayCoaching,
  vexCoaching,
  wallDynamicsCoaching,
  watchGateCoaching,
  technicalsCoaching,
  underlyingExcursionCoaching,
} from "./play-brief-narrative-coaching";

function play(overrides: Partial<TerminalPlay> = {}): TerminalPlay {
  return {
    id: "SWING:NRG",
    ticker: "NRG",
    direction: "LONG",
    contract: "110C · 13DTE",
    score: 45,
    status: "HOLD",
    horizon: "SWING",
    exitModel: "SCALE_OUT",
    recommendation: "HOLD",
    factors: [],
    gates: [],
    ...overrides,
  };
}

function ctx(overrides: Partial<SwingPlayBriefContext> = {}): SwingPlayBriefContext {
  return {
    play: play(),
    asOf: "2026-09-05T20:00:00.000Z",
    sessionDate: "2026-09-05",
    scanAsOf: null,
    scanSessionDay: null,
    ecosystem: null,
    vector: null,
    laneRows: [],
    meridian: null,
    ...overrides,
  };
}

test("thesisBreakCoaching: break level is urgent", () => {
  const line = thesisBreakCoaching(
    play({ thesisBreak: { level: "break", note: "persistence lost" } }),
  );
  assert.match(line!, /Thesis BREAK/i);
  assert.match(line!, /persistence lost/i);
});

test("thesisPillarCoaching: names fading pillar", () => {
  const line = thesisPillarCoaching(
    play({
      thesisHealth: {
        health: 42,
        entryIndex: 70,
        currentIndex: 42,
        delta: -28,
        rung: "DEGRADED",
        rungLabel: "Degraded",
        advisory: "Tighten risk.",
        moves: [],
        committedAtEt: null,
        computedAtEt: "20:00",
        thesisBreakLevel: "warn",
        thesisBreakNote: "fade",
        pillars: [
          {
            id: "structure",
            label: "Persistence",
            weight: 0.3,
            commitScore: 0.9,
            currentScore: 0.3,
            commitLabel: "mature",
            currentLabel: "fading",
            status: "faded",
            contributionPts: 9,
            deltaPts: -18,
          },
        ],
      },
    }),
  );
  assert.match(line!, /Pillar fade/i);
  assert.match(line!, /Persistence/i);
});

function uncalibratedThesisHealth() {
  return {
    health: 46,
    entryIndex: 60,
    currentIndex: 46,
    delta: -14,
    rung: "DEGRADED",
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
      {
        id: "momentum",
        label: "Entry geometry",
        weight: 0.22,
        commitScore: 0.5,
        currentScore: 0.45,
        commitLabel: "n/a",
        currentLabel: "n/a",
        status: "intact",
        contributionPts: 10,
        deltaPts: -1,
      },
      {
        id: "flow",
        label: "Signal stack",
        weight: 0.2,
        commitScore: 0.35,
        currentScore: 0.35,
        commitLabel: "no signals",
        currentLabel: "no signals",
        status: "intact",
        contributionPts: 7,
        deltaPts: 0,
      },
    ],
    moves: ["Persistence: unknown → unknown"],
    committedAtEt: null,
    computedAtEt: "10:00 ET",
    advisory: "Thesis fading — tighten risk or trim into strength.",
    thesisBreakLevel: "warn",
    thesisBreakNote: "pillars fading",
  };
}

test("thesisBreakCoaching: silent when thesis health is uncalibrated (extends #4318)", () => {
  assert.equal(thesisBreakCoaching(play({ thesisHealth: uncalibratedThesisHealth() })), null);
});

test("thesisPillarCoaching: silent when thesis health is uncalibrated (extends #4318)", () => {
  assert.equal(thesisPillarCoaching(play({ thesisHealth: uncalibratedThesisHealth() })), null);
});

test("manageLifecycleCoaching: trim ladder + time stop", () => {
  const line = manageLifecycleCoaching(
    play({
      manageAction: "TAKE_PARTIAL",
      exitPolicy: {
        trim_levels: [
          { trigger_pct: 50, fired: true },
          { trigger_pct: 100, fired: false },
        ],
        stop_premium: 1.5,
        target_premium: 5,
        time_stop_et: "15:50",
        runner_fraction: 0.25,
      },
    }),
    "open",
  );
  assert.match(line!, /1\/2 trims banked/i);
  assert.match(line!, /15:50 ET/i);
  assert.match(line!, /25% runner/i);
});

// Live repro (CRWD:19 brief, 2026-09-09): collapseRedundantIntelSections drops the whole
// "Hold plan" section whenever this narrative renders, claiming its content is folded in here —
// but the DTE-runway fact only appeared in this function's own line for dte<=7, so a 9DTE
// position lost the fact entirely (not just deduped, actually deleted with nothing folded in).
test("manageLifecycleCoaching: DTE > 7 still carries runway context, not just the <=7 urgency line", () => {
  const line = manageLifecycleCoaching(play({ contract: "110C · 9DTE" }), "open");
  assert.match(line!, /9 DTE.*remaining/i);
  assert.doesNotMatch(line!, /theta accelerating/i, "9 DTE is not yet the urgency threshold");
});

test("manageLifecycleCoaching: DTE <= 7 keeps the urgency framing, not the plain 'remaining' line", () => {
  const line = manageLifecycleCoaching(play({ contract: "110C · 5DTE" }), "open");
  assert.match(line!, /5 DTE.*theta accelerating/i);
  assert.doesNotMatch(line!, /5 DTE\*\* remaining/i);
});

test("progressRatchetCoaching: stop/target rails render sign-free absolute prices (2026-09-09 blast-radius fix)", () => {
  // Same root cause as play-brief.ts's fmtUsd / play-brief-narrative.ts's fmtOptionUsd: this
  // file's own file-local fmtUsd carried the identical signed-delta "+" on an absolute premium
  // PRICE (stop_premium/target_premium are never negative deltas — see terminal-ladder.ts).
  const line = progressRatchetCoaching(
    play({
      exitModel: "RATCHET",
      progress: 0.4,
      exitPolicy: {
        trim_levels: [],
        stop_premium: 2.1,
        target_premium: 8,
      },
    }),
  );
  assert.ok(line);
  assert.match(line!, /rails \*\*\$2\.10\*\*.*\*\*\$8\.00\*\*/);
  assert.doesNotMatch(line!, /\*\*\+\$/, "stop_premium/target_premium are absolute prices, never signed deltas");
});

test("watchGateCoaching: includes reasons", () => {
  const line = watchGateCoaching(
    play({
      status: "WATCH",
      gateBlocks: [{ code: "G1", reason: "wait for trigger" }],
    }),
  );
  assert.match(line!, /wait for trigger/i);
});

test("crossDeskCoaching: friction when NH conflicts", () => {
  const line = crossDeskCoaching(
    ctx({
      ecosystem: {
        ticker: "NRG",
        nighthawk_recent: {
          edition_for: "2026-09-05",
          direction: "short",
          conviction: "high",
          outcome: "bearish",
          score: 80,
        },
      } as SwingPlayBriefContext["ecosystem"],
    }),
    play(),
  );
  assert.match(line!, /Cross-desk friction/i);
  assert.match(line!, /Night Hawk bearish/i);
});

test("crossDeskCoaching: Vector bearish bias conflicts with LONG swing", () => {
  const line = crossDeskCoaching(
    ctx({
      vector: {
        play: {
          bias: "short",
          headline: "Fade the rip",
          grade: "B",
        },
      } as SwingPlayBriefContext["vector"],
    }),
    play({ direction: "LONG" }),
  );
  assert.match(line!, /Cross-desk friction/i);
  assert.match(line!, /Vector bearish/i);
  assert.match(line!, /Fade the rip/i);
});

test("crossDeskCoaching: stale Vector play.bias must not invent cross-desk friction", () => {
  const line = crossDeskCoaching(
    ctx({
      vector: {
        freshness: "stale",
        play: {
          bias: "short",
          headline: "Fade the rip",
          grade: "B",
        },
      } as SwingPlayBriefContext["vector"],
    }),
    play({ direction: "LONG" }),
  );
  assert.equal(line, null, "stale Vector must not coach cross-desk Vector friction");
});

test("crossDeskCoaching: stale HELIX flow must not invent call-led / put-led friction", () => {
  const line = crossDeskCoaching(
    ctx({
      ecosystem: {
        ticker: "INTC",
        flow_feed_fresh: false,
        recent_flow: {
          window_hours: 24,
          print_count: 12,
          call_premium: 1_200_000,
          put_premium: 400_000,
          unknown_premium: 0,
        },
      } as SwingPlayBriefContext["ecosystem"],
    }),
    play({ direction: "SHORT" }),
  );
  assert.equal(line, null, "stale HELIX must not coach cross-desk flow friction");
});

test("crossDeskCoaching: prior-session 0DTE must not invent cross-desk friction (Largo C2)", () => {
  const line = crossDeskCoaching(
    ctx({
      sessionDate: "2026-09-06",
      ecosystem: {
        ticker: "NRG",
        zerodte_today: {
          session_date: "2026-09-05",
          direction: "short",
          score: 78,
          conviction: "high",
          status: "flagged",
          first_flagged_at: "2026-09-05T14:00:00Z",
        },
      } as SwingPlayBriefContext["ecosystem"],
    }),
    play({ direction: "LONG" }),
  );
  assert.equal(line, null, "yesterday's 0DTE short must not read as live cross-desk friction");
});

test("crossDeskCoaching: prior-session Night Hawk must not invent cross-desk friction (Largo C2)", () => {
  const line = crossDeskCoaching(
    ctx({
      sessionDate: "2026-09-06",
      ecosystem: {
        ticker: "NRG",
        nighthawk_recent: {
          edition_for: "2026-09-05",
          direction: "short",
          conviction: "high",
          outcome: "open",
          score: 78,
        },
      } as SwingPlayBriefContext["ecosystem"],
    }),
    play({ direction: "LONG" }),
  );
  assert.equal(line, null, "yesterday's Night Hawk short must not read as live cross-desk friction");
});

test("crossDeskCoaching: prior-session Vector must not invent cross-desk friction (Largo C2)", () => {
  const line = crossDeskCoaching(
    ctx({
      sessionDate: "2026-09-06",
      ecosystem: {
        ticker: "NRG",
        vector_full_state: {
          spot: 118,
          observed_session_date: "2026-09-05",
          dataAgeMs: 30_000,
          freshness: "recent",
          play: { bias: "short", headline: "Bearish desk read" },
        },
      } as SwingPlayBriefContext["ecosystem"],
    }),
    play({ direction: "LONG" }),
  );
  assert.equal(line, null, "yesterday's Vector short must not read as live cross-desk friction");
});

test("crossDeskCoaching: desk alignment omits undefined NH conviction and junk 0DTE score", () => {
  const line = crossDeskCoaching(
    ctx({
      ecosystem: {
        ticker: "NRG",
        nighthawk_recent: {
          edition_for: "2026-09-05",
          direction: "long",
          conviction: undefined as unknown as string,
          outcome: "bullish",
          score: 80,
        },
        zerodte_today: {
          direction: "long",
          score: undefined as unknown as number,
          ticker: "NRG",
        },
      } as SwingPlayBriefContext["ecosystem"],
    }),
    play({ direction: "LONG" }),
  );
  assert.equal(line, null, "thin aligned desks must not emit Desk alignment with undefined tokens");
});

// crossDeskCoaching used to render every conflict as a flat `conflicts.join(" · ")` behind one
// fixed generic closing line ("Size down until desks agree.") — it never said WHY the desks
// disagree (different timeframe/evidence base?), which disagreement is more load-bearing for THIS
// setup, or what would actually resolve it. The tests below prove the rewritten narrative reasons
// about the SOURCE of the disagreement (evidence kind + archetype fit), not just its existence —
// and that two different conflict sources produce two genuinely different readings, not the same
// template with names swapped in. (docs/audit/LARGO-PRODUCT-CONTRACT.md / CLAUDE.md's standing Ask
// Largo mandate names this exact gap as a scoped-but-not-yet-built item.)

test("crossDeskCoaching: Vector conflict on a structure-led archetype names the archetype and gives a structure-specific resolution, with the old generic instruction gone", () => {
  const line = crossDeskCoaching(
    ctx({
      vector: {
        play: { bias: "short", headline: "Fade the rip", grade: "B" },
      } as SwingPlayBriefContext["vector"],
    }),
    play({ direction: "LONG", archetype: "BREAKOUT" }),
  );
  assert.match(line!, /Cross-desk friction/i);
  assert.match(line!, /Vector bearish \(Fade the rip\)/);
  assert.match(line!, /live price structure/i);
  assert.match(line!, /\*\*Breakout continuation\*\* setup leans on/i, "must name the archetype, not just the desk");
  assert.match(line!, /trim rail/i, "structure conflicts resolve on the next trim rail, not a flow/digest timeline");
  assert.doesNotMatch(
    line!,
    /Size down until desks agree\./,
    "the old flat generic closer must be gone — replaced by a reasoned, kind-specific resolution",
  );
});

test("crossDeskCoaching: HELIX flow conflict on a flow-led archetype (FLOW_ACCUMULATION) reasons about order flow persistence, not price structure", () => {
  const line = crossDeskCoaching(
    ctx({
      ecosystem: {
        ticker: "XYZ",
        recent_flow: {
          window_hours: 24,
          print_count: 40,
          call_premium: 400_000,
          put_premium: 1_600_000,
          unknown_premium: 0,
        },
      } as SwingPlayBriefContext["ecosystem"],
    }),
    play({ direction: "LONG", archetype: "FLOW_ACCUMULATION" }),
  );
  assert.match(line!, /Cross-desk friction/i);
  assert.match(line!, /HELIX put-led/);
  assert.match(line!, /same-session options order flow, not price structure/i);
  assert.match(line!, /\*\*Multi-day flow accumulation\*\* setup leans on/i);
  assert.match(line!, /give it another session/i, "flow conflicts resolve on persistence across sessions, not a trim rail");
  assert.doesNotMatch(line!, /trim rail/i, "must not reuse Vector's structure-specific resolution for a flow conflict");
});

test("crossDeskCoaching: two different conflict sources produce two differently reasoned readings, not the same template with names swapped in", () => {
  const structureLine = crossDeskCoaching(
    ctx({
      vector: { play: { bias: "short", headline: "Fade the rip", grade: "B" } } as SwingPlayBriefContext["vector"],
    }),
    play({ direction: "LONG", archetype: "BREAKOUT" }),
  )!;
  const flowLine = crossDeskCoaching(
    ctx({
      ecosystem: {
        ticker: "XYZ",
        recent_flow: { window_hours: 24, print_count: 40, call_premium: 400_000, put_premium: 1_600_000, unknown_premium: 0 },
      } as SwingPlayBriefContext["ecosystem"],
    }),
    play({ direction: "LONG", archetype: "FLOW_ACCUMULATION" }),
  )!;
  assert.notEqual(structureLine, flowLine);
  assert.match(structureLine, /trim rail/i);
  assert.doesNotMatch(structureLine, /give it another session/i);
  assert.match(flowLine, /give it another session/i);
  assert.doesNotMatch(flowLine, /trim rail/i);
});

test("crossDeskCoaching: 0DTE-only conflict reasons about its mismatched hours-long clock, never claims to be 'the most direct read'", () => {
  const line = crossDeskCoaching(
    ctx({
      ecosystem: {
        ticker: "NRG",
        zerodte_today: {
          session_date: "2026-09-05",
          direction: "short",
          score: 78,
          conviction: "high",
          status: "flagged",
          first_flagged_at: "2026-09-05T14:00:00Z",
        },
      } as SwingPlayBriefContext["ecosystem"],
    }),
    // Archetype set to a structure-led one on purpose — 0DTE's evidenceKind never matches
    // ARCHETYPE_LEAD_EVIDENCE, so this proves the fallback reasoning (not an archetype bonus).
    play({ direction: "LONG", archetype: "BREAKOUT" }),
  );
  assert.match(line!, /0DTE short \(score 78\)/);
  assert.match(line!, /hours-long 0DTE clock, not this swing's multi-day one/i);
  assert.match(line!, /tape noise/i);
  assert.doesNotMatch(line!, /most direct read of the four/i, "an hours-long 0DTE clock is the LEAST direct read here, never the most");
});

test("crossDeskCoaching: Night-Hawk-only conflict (digest) reasons about the overnight cadence, not a live override", () => {
  const line = crossDeskCoaching(
    ctx({
      ecosystem: {
        ticker: "NRG",
        nighthawk_recent: {
          edition_for: "2026-09-05",
          direction: "short",
          conviction: "high",
          outcome: "bearish",
          score: 80,
        },
      } as SwingPlayBriefContext["ecosystem"],
    }),
    play(),
  );
  assert.match(line!, /Night Hawk bearish/i);
  assert.match(line!, /overnight next-day digest, not a live read/i);
  assert.match(line!, /secondary sanity check, not a live override/i);
});

// Live repro (MSFT WATCH brief, 2026-09-09/10): the desk read carried BOTH a Night Hawk (digest)
// and a Vector (structure) conflict for the same SHORT swing, and the OLD code rendered them as a
// flat "Night Hawk bullish · Vector bullish (...)" list in PUSH order (Night Hawk first, since it's
// checked first in the function body) with one generic closer. The new code must rank by
// load-bearing WEIGHT, not push order — Vector (live structure) outranks Night Hawk (an overnight
// digest) regardless of which was detected first.
test("crossDeskCoaching: multiple conflicting desks — ranks by load-bearing weight, not detection order, and demotes the rest to a lighter-weight mention", () => {
  const line = crossDeskCoaching(
    ctx({
      ecosystem: {
        ticker: "MSFT",
        nighthawk_recent: {
          edition_for: "2026-09-09",
          direction: "long",
          conviction: "B",
          outcome: "open",
          score: null,
        },
      } as SwingPlayBriefContext["ecosystem"],
      sessionDate: "2026-09-09",
      vector: {
        spot: 492.6,
        play: {
          bias: "long",
          headline: "POSITION · momentum long on continuation → target call wall 500",
          invalidation: "5m close < 448.49",
        },
      } as SwingPlayBriefContext["vector"],
    }),
    play({ direction: "SHORT", archetype: "EVENT_DRIVEN" }),
  );
  assert.ok(line);
  // Vector — the higher-weight, live structural read — must lead the sentence even though Night
  // Hawk is checked first in the function body (push order != rank order).
  assert.match(line!, /^\*\*Cross-desk friction\*\* — Vector bullish \(POSITION/);
  assert.match(line!, /so weight it heaviest/i, "a real multi-conflict comparison, not a solo reading");
  assert.match(line!, /Night Hawk also reads bullish \(B\)/);
  assert.match(line!, /lighter weight here/i);
});

test("catalystCoaching: earnings within 14d", () => {
  const line = catalystCoaching(
    ctx({
      ecosystem: {
        ticker: "NRG",
        arsenal: {
          earnings: { days_until: 5, earnings_date: "2026-09-10" },
        },
      } as SwingPlayBriefContext["ecosystem"],
    }),
  );
  assert.match(line!, /Earnings in 5d/i);
});

test("closedCoaching: MFE capture lesson", () => {
  const line = closedCoaching(
    play({
      status: "CLOSED",
      peak: 80,
      exitPnlPct: 20,
      mfeCapturePct: 25,
      closedReason: "thesis",
    }),
  );
  assert.match(line!, /Gave back the move/i);
  assert.match(line!, /thesis break/i);
});

test("closedCoaching: a round-trip past breakeven never renders a nonsensical negative MFE capture", () => {
  // Reproduces a live production case: INTC:35 peak +25.7%, exited -40.8% used to render
  // "only -158.9% MFE capture" (exitPnlPct / peak * 100), a percentage with no honest reading.
  const line = closedCoaching(
    play({
      status: "CLOSED",
      peak: 25.7,
      exitPnlPct: -40.8,
      mfeCapturePct: null,
      closedReason: "stopped",
    }),
  );
  assert.ok(line);
  assert.doesNotMatch(line!, /-158\.9%|MFE capture \*\*-/i);
  assert.match(line!, /round-tripped past breakeven/i);
});

// Regression for the run-on "Trade manager read" bullet (live repro AAPL:36, 2026-09-10, found
// during the standing Ask Largo deep-dive): closedCoaching joined its 2-3 distinct post-mortem
// points (outcome, MFE-capture/round-trip verdict, exit-reason lesson) with a bare space, and
// collectCoachingBullets wraps whatever closedCoaching returns as ONE "• " bullet — so a closed
// play with both an MFE-capture note and a closedReason rendered as one illegible run-on sentence
// instead of separate bullets, unlike every OPEN/WATCH coaching point (each gets its own push()).
test("closedCoaching: outcome + exit-reason are separate bullet points, not one run-on sentence", () => {
  const line = closedCoaching(
    play({
      status: "CLOSED",
      peak: 1.3,
      exitPnlPct: -56.2,
      mfeCapturePct: null,
      closedReason: "stopped",
    }),
  );
  assert.ok(line);
  const points = line!.split("\n• ");
  assert.equal(points.length, 3, `expected 3 separate bullet points, got: ${JSON.stringify(line)}`);
  assert.match(points[0], /^Exited \*\*-56\.2%\*\* vs peak \*\*\+1\.3%\*\*$/);
  assert.match(points[1], /^\*\*Round-tripped past breakeven\*\*/);
  assert.match(points[2], /^\*\*Stop fired\*\* \(stopped\)/);
});

// ─── underlyingExcursionCoaching ────────────────────────────────────────────
// FINDINGS 2026-09-10 (live NRG repro): the "option gave back X% from peak" aside used
// `play.peak - play.pnlPct` (percentage-POINT subtraction of two already-percentage numbers).
// Real production NRG position: peak 132.7, pnlPct 39.8 -> old math printed "gave back 93% from
// peak" on a play still up +39.8%, reading as a near-total round-trip when the honest relative
// retracement is ~70% (30% of peak retained). Fixed via the same mfeCaptureOutcome math
// mfe-capture.ts already ships for closed-play post-mortems.

test("underlyingExcursionCoaching: option-giveback aside uses honest relative retracement, not point-difference (live NRG repro)", () => {
  const line = underlyingExcursionCoaching(play({ stockMovePct: 5, peak: 132.7, pnlPct: 39.8 }));
  assert.ok(line);
  assert.match(line!, /option gave back \*\*70%\*\* from peak/, `expected ~70% relative giveback, got: ${line}`);
  assert.doesNotMatch(line!, /\*\*93%\*\*/, "must not regress to the point-difference bug");
});

test("underlyingExcursionCoaching: option-giveback aside does not fire once retained capture clears the floor", () => {
  // capture = 98/120*100 ~= 81.7% retained -> above the 80% floor's complement, no giveback aside.
  const line = underlyingExcursionCoaching(play({ stockMovePct: 5, peak: 120, pnlPct: 98 }));
  assert.ok(line);
  assert.doesNotMatch(line!, /option gave back/i);
});

test("underlyingExcursionCoaching: option round-tripped-past-breakeven aside fires when current option pnl has gone negative after a positive peak", () => {
  const line = underlyingExcursionCoaching(play({ stockMovePct: 5, peak: 132.7, pnlPct: -10 }));
  assert.ok(line);
  assert.match(line!, /option round-tripped past breakeven.*was up \*\*133%\*\* at peak, now \*\*-10%\*\*/);
});

// ─── vectorPlayCoaching ─────────────────────────────────────────────────────

test("vectorPlayCoaching: stale Vector returns null (Largo C2)", () => {
  const vec = {
    freshness: "stale",
    play: {
      bias: "long",
      headline: "Ride momentum",
      invalidation: "below 50",
    },
  } as unknown as Parameters<typeof vectorPlayCoaching>[0];
  assert.equal(vectorPlayCoaching(vec, play({ direction: "LONG" })), null);
});

test("vexCoaching: stale Vector returns null (Largo C2)", () => {
  const vec = {
    freshness: "stale",
    vexFlip: 100,
    vexWalls: { callWalls: [{ strike: 105, pct: 5 }], putWalls: [] },
  } as unknown as Parameters<typeof vexCoaching>[0];
  assert.equal(vexCoaching(vec, 102), null);
});

test("magnetCoaching: stale Vector returns null (Largo C2)", () => {
  const vec = {
    freshness: "stale",
    magnet: { strike: 100, distancePct: 0.5, pull: "at" },
    regime: { posture: "long", label: "LONG" },
  } as unknown as Parameters<typeof magnetCoaching>[1];
  assert.equal(magnetCoaching(ctx(), vec, 100), null);
});

test("flowPrintsCoaching: stale Vector returns null (Largo C2)", () => {
  const vec = {
    freshness: "stale",
    flowMarkers: {
      available: true,
      prints: [{ side: "call", strike: 100, premium: 2_000_000 }],
      meta: { largeFound: 1 },
    },
  } as unknown as Parameters<typeof flowPrintsCoaching>[0];
  assert.equal(flowPrintsCoaching(vec, play({ direction: "LONG" })), null);
});

test("wallDynamicsCoaching: stale Vector returns null (Largo C2)", () => {
  const vec = {
    freshness: "stale",
    wallEvents: [
      { kind: "call_wall_build", message: "wall building", strike: 100 },
      { kind: "put_wall_fade", message: "put fading", strike: 95 },
    ],
  } as unknown as Parameters<typeof wallDynamicsCoaching>[0];
  assert.equal(wallDynamicsCoaching(vec), null);
});

test("collectCoachingBullets: stale Vector suppresses VEX/magnet/flow coaching lines", () => {
  const bullets = collectCoachingBullets(
    ctx({
      vector: {
        freshness: "stale",
        dataAgeMs: 200_000,
        spot: 100,
        vexFlip: 98,
        magnet: { strike: 100, distancePct: 0.2, pull: "at" },
        flowMarkers: {
          available: true,
          prints: [{ side: "call", strike: 100, premium: 1_500_000 }],
          meta: { largeFound: 1 },
        },
        play: { bias: "long", headline: "Breakout", invalidation: "95" },
      } as SwingPlayBriefContext["vector"],
    }),
    "open",
    100,
  );
  const joined = bullets.join("\n");
  assert.doesNotMatch(joined, /VEX lens|Gamma magnet|Large print|Vector desk:/i);
});

// FINDINGS 2026-09-09 (live NRG repro): crossDeskCoaching's "Cross-desk friction" bullet and
// vectorPlayCoaching's own bullet both fired for the same Vector-vs-swing misalignment, each citing
// the identical headline as a separate fact — a bullet-dump duplicate, not two independent reads.
test("collectCoachingBullets: crossDeskCoaching's Vector-conflict bullet suppresses vectorPlayCoaching's redundant cross-check clause", () => {
  const bullets = collectCoachingBullets(
    ctx({
      vector: {
        spot: 100,
        play: { bias: "short", headline: "Fade the rip", invalidation: "102.00", thesis: "mean reversion" },
      } as SwingPlayBriefContext["vector"],
    }),
    "open",
    100,
  );
  const joined = bullets.join("\n");
  const friction = bullets.filter((b) => /Cross-desk friction/i.test(b));
  const vectorDesk = bullets.filter((b) => /^• Vector desk:/i.test(b));
  assert.equal(friction.length, 1, `expected exactly one Cross-desk friction bullet, got: ${joined}`);
  assert.match(friction[0]!, /Fade the rip/);
  assert.equal(vectorDesk.length, 1, `expected exactly one Vector desk bullet, got: ${joined}`);
  // The Vector desk bullet keeps its own non-duplicative content (headline/invalidation) but must
  // NOT repeat the "cross-check" framing already delivered by the Cross-desk friction bullet above.
  assert.match(vectorDesk[0]!, /Fade the rip/);
  assert.doesNotMatch(vectorDesk[0]!, /cross-check/i);
});

test("vectorPlayCoaching: null when Vector has no play headline or invalidation", () => {
  assert.equal(vectorPlayCoaching(null, play()), null);
  assert.equal(
    vectorPlayCoaching({ play: {} } as unknown as Parameters<typeof vectorPlayCoaching>[0], play()),
    null,
  );
});

test("vectorPlayCoaching: uses play.bias not thesis substring (long-gamma thesis vs short bias)", () => {
  const vec = {
    play: {
      bias: "short",
      headline: "Fade into wall",
      thesis: "Long gamma (spot pinned)",
      invalidation: "102.00",
    },
  } as unknown as Parameters<typeof vectorPlayCoaching>[0];
  const line = vectorPlayCoaching(vec, play({ direction: "LONG" }));
  assert.ok(line);
  assert.match(line!, /cross-check/i);
  assert.doesNotMatch(line!, /aligned with swing lane/i);
});

// FINDINGS 2026-09-09 (live NRG repro): crossDeskCoaching and vectorPlayCoaching independently
// derive the SAME misalignment (vp.bias vs play.direction) from the SAME vec.play input — when
// crossDeskCoaching already fires (its "Cross-desk friction" bullet names this exact headline),
// vectorPlayCoaching's own "cross-check" framing repeats the identical fact as a second bullet.
test("vectorPlayCoaching: omits the redundant cross-check clause when the conflict was already noted elsewhere, but keeps the headline/invalidation", () => {
  const vec = {
    play: {
      bias: "short",
      headline: "Fade into wall",
      thesis: "Long gamma (spot pinned)",
      invalidation: "102.00",
    },
  } as unknown as Parameters<typeof vectorPlayCoaching>[0];
  const line = vectorPlayCoaching(vec, play({ direction: "LONG" }), undefined, true);
  assert.ok(line);
  assert.doesNotMatch(line!, /cross-check/i);
  assert.match(line!, /Fade into wall/);
  assert.match(line!, /102\.00/);
});

test("vectorPlayCoaching: returned line has an EVEN count of ** bold markers (no unpaired marker corrupting markdown)", () => {
  const vec = {
    play: {
      headline: "Bull flag breakout",
      invalidation: "95.00",
      thesis: "long continuation",
      starred: ["102.50"],
    },
  } as unknown as Parameters<typeof vectorPlayCoaching>[0];
  const line = vectorPlayCoaching(vec, play({ direction: "LONG" }));
  assert.ok(line);
  const boldMarkerCount = (line!.match(/\*\*/g) ?? []).length;
  assert.equal(boldMarkerCount % 2, 0, `expected an even (paired) count of **, got ${boldMarkerCount} in: ${line}`);
  assert.match(line!, /\*\*Bull flag breakout\*\*/);
  assert.match(line!, /\*\*95\.00\*\*/);
  assert.doesNotMatch(line!, /^\*\*Vector desk: \*\*/);
});

// FINDINGS 2026-09-09 (live NRG repro): VectorPlayEmit.starred is documented (vector-play-engine.ts)
// to ALWAYS have the headline as its first element. This coaching bullet rendered the headline once
// via `vp.headline`, then rendered `vp.starred[0]` a second time under a separate "starred level"
// label — duplicating the exact same text verbatim in one bullet.
test("vectorPlayCoaching: does not duplicate the headline as a 'starred level' (starred[0] IS the headline)", () => {
  const vec = {
    play: {
      headline: "POSITION · pivot at the 119.71 gamma flip — long above / short below",
      invalidation: "5m close back through 119.71",
      starred: [
        "POSITION · pivot at the 119.71 gamma flip — long above / short below",
        "Flip cross imminent — watch 119.71",
      ],
    },
  } as unknown as Parameters<typeof vectorPlayCoaching>[0];
  const line = vectorPlayCoaching(vec, play({ direction: "LONG" }));
  assert.ok(line);
  const headlineOccurrences = (
    line!.match(/POSITION · pivot at the 119\.71 gamma flip — long above \/ short below/g) ?? []
  ).length;
  assert.equal(headlineOccurrences, 1, `headline must appear once, not duplicated as "starred level": ${line}`);
  assert.match(line!, /starred level \*\*Flip cross imminent — watch 119\.71\*\*/);
});

test("vectorPlayCoaching: omits the 'starred level' clause when there is no starred item beyond the headline", () => {
  const vec = {
    play: {
      headline: "Ride momentum",
      invalidation: "below 100",
      starred: ["Ride momentum"],
    },
  } as unknown as Parameters<typeof vectorPlayCoaching>[0];
  const line = vectorPlayCoaching(vec, play({ direction: "LONG" }));
  assert.ok(line);
  assert.doesNotMatch(line!, /starred level/);
});

test("vexCoaching: narrates vanna flip", () => {
  const line = vexCoaching(
    {
      vexFlip: 100,
      gammaFlip: 98,
      vexWalls: { callWalls: [{ strike: 105 }], putWalls: [] },
    } as import("@/lib/bie/vector-full-state").VectorFullState,
    101,
  );
  assert.match(line!, /VEX lens/i);
  assert.match(line!, /diverge/i);
});

// FINDING 2026-09-08 (Ask Largo monitor cycle): confluence-zone scores are half-point weighted
// sums (call-wall 3, gamma-flip 2.5, ...), so a real score can land on e.g. 7.5. This line used to
// interpolate `top.score` raw (no rounding) while chartLevelsSection's "Levels on chart" section
// rounded the SAME zone's SAME score to a whole number — a member reading both saw two different
// numbers for one figure. Both sites now render `.toFixed(1)` so they agree.
test("confluenceCoaching: score renders at one-decimal precision, matching Levels-on-chart", () => {
  const line = confluenceCoaching(
    {
      confluenceZones: [{ center: 101, kinds: ["gamma-flip", "call-wall"], score: 7.5 }],
    } as import("@/lib/bie/vector-full-state").VectorFullState,
    play({ direction: "LONG" }),
    100,
  );
  assert.match(line!, /score 7\.5/, "must show the real half-point score");
  assert.doesNotMatch(line!, /score 8\b/, "must not display a different rounding than Levels-on-chart");
});

test("dataHonestyCoaching: aged markAsOf warns not-live-synced (Largo C2/C3)", () => {
  const line = dataHonestyCoaching(
    ctx(),
    play({ markIsSync: false, markAsOf: "2026-09-04T21:45:18.731Z", status: "OPEN" }),
  );
  assert.match(line!, /option mark from \*\*2026-09-04/i);
  assert.match(line!, /not live-synced/i);
});

test("dataHonestyCoaching: markIsSync true (no timestamp) warns; fresh markAsOf does not", () => {
  const stale = dataHonestyCoaching(ctx(), play({ markIsSync: true, status: "OPEN" }));
  assert.match(stale!, /mark not synced to live tape/i);

  const fresh = dataHonestyCoaching(
    ctx(),
    play({ markIsSync: false, markAsOf: new Date().toISOString(), status: "OPEN" }),
  );
  assert.equal(fresh, null);
});

test("dataHonestyCoaching: closed play with markIsSync does not warn mark staleness", () => {
  const line = dataHonestyCoaching(ctx(), play({ markIsSync: true, status: "CLOSED" }));
  assert.equal(line, null);
});

test("dataHonestyCoaching: WATCH play with markIsSync does not warn mark staleness", () => {
  const line = dataHonestyCoaching(ctx(), play({ markIsSync: true, status: "WATCH" }));
  assert.equal(line, null);
});

test("dataHonestyCoaching: prior-session discovery scan warns", () => {
  const line = dataHonestyCoaching(
    ctx({ sessionDate: "2026-09-06", scanSessionDay: "2026-09-05" }),
    play(),
  );
  assert.match(line!, /swing discovery from \*\*2026-09-05\*\*/);
  assert.match(line!, /today's scan not yet run/);
});

test("dataHonestyCoaching: stale HELIX pipeline warns stale, not quiet", () => {
  const line = dataHonestyCoaching(
    ctx({ ecosystem: { flow_feed_fresh: false } as SwingPlayBriefContext["ecosystem"] }),
    play(),
  );
  assert.match(line!, /HELIX pipeline stale/);
  assert.match(line!, /not evidence of quiet tape/);
  assert.doesNotMatch(line!, /feed quiet/i);
});

test("dataHonestyCoaching: stale GEX matrix warns dealer posture may lag (Largo C2)", () => {
  const line = dataHonestyCoaching(
    ctx({
      ecosystem: {
        gex_positioning: {
          spot: 100,
          matrix_age_sec: 180,
          freshness: "cached",
        },
      } as SwingPlayBriefContext["ecosystem"],
    }),
    play(),
  );
  assert.match(line!, /GEX matrix \*\*180s\*\* stale/);
  assert.match(line!, /dealer posture may lag spot/);
});

test("execSlippageCoaching: flags wide mid vs fill gap", () => {
  const line = execSlippageCoaching(play({ pnlPct: 50, execPnlPct: 30 }));
  assert.match(line!, /slippage/i);
});

test("ivRankCoaching: fires when play carries ivRank", () => {
  const elevated = ivRankCoaching(play({ ivRank: 75 }));
  assert.match(elevated!, /IV rank 75/i);
  assert.match(elevated!, /vol elevated/i);

  const cheap = ivRankCoaching(play({ ivRank: 20 }));
  assert.match(cheap!, /IV rank 20/i);
  assert.match(cheap!, /vol cheap/i);

  assert.equal(ivRankCoaching(play({ ivRank: null })), null);
});

test("technicalsCoaching: bias reads bullish from tape on SHORT play (Largo C5 — chart evidence, not position direction)", () => {
  const vec = {
    spot: 95,
    technicals: {
      vwap: 94.7,
      emaStack: "up",
      rsi: 67,
      macd: "bull",
      goldenPocket: null,
      structure: { type: "CHOCH", direction: "up", level: 94 },
    },
  } as import("@/lib/bie/vector-full-state").VectorFullState;
  const line = technicalsCoaching(vec, play({ direction: "SHORT", ticker: "INTC" }));
  assert.match(line!, /chart reads bullish/i);
  assert.match(line!, /conflicts with swing direction/i);
  assert.doesNotMatch(line!, /supports short swing/i);
});

test("technicalsCoaching: bias reads bearish from tape on LONG play (Largo C5)", () => {
  const vec = {
    spot: 15,
    technicals: {
      vwap: 15.29,
      emaStack: "down",
      rsi: 40,
      macd: "bear",
      goldenPocket: null,
      structure: { type: "BOS", direction: "down", level: 15.5 },
    },
  } as import("@/lib/bie/vector-full-state").VectorFullState;
  const line = technicalsCoaching(vec, play({ direction: "LONG", ticker: "NN" }));
  assert.match(line!, /chart reads bearish/i);
  assert.match(line!, /conflicts with swing direction/i);
  assert.doesNotMatch(line!, /supports long swing/i);
});

test("technicalsCoaching: dissenting MACD must be visible even when it loses the bull/bear vote (2026-09-06 live NRG repro)", () => {
  // technicalsBias() counts emaStack/macd/vwap/structure as 4 independent votes; here 3 bull vs
  // 1 bear (macd) yields "bullish" — the narrative must still show the bear MACD vote, not just
  // the winning votes, or a reader sees "chart reads bullish" with no visibility into the dissent.
  const vec = {
    spot: 118.95,
    technicals: {
      vwap: 117.08,
      emaStack: "up",
      rsi: 58,
      macd: "bear",
      goldenPocket: null,
      structure: { type: "BOS", direction: "up", level: 118.22 },
    },
  } as import("@/lib/bie/vector-full-state").VectorFullState;
  const line = technicalsCoaching(vec, play({ direction: "LONG", ticker: "NRG" }));
  assert.match(line!, /chart reads bullish/i);
  assert.match(line!, /macd\s*\*\*bearish\*\*/i);
});

test("technicalsCoaching: aligned LONG + bullish tape notes alignment without echoing direction as bias", () => {
  const vec = {
    spot: 100,
    technicals: {
      vwap: 98,
      emaStack: "up",
      rsi: 55,
      macd: "bull",
      goldenPocket: null,
      structure: { type: "BOS", direction: "up", level: 99 },
    },
  } as import("@/lib/bie/vector-full-state").VectorFullState;
  const line = technicalsCoaching(vec, play({ direction: "LONG" }));
  assert.match(line!, /chart reads bullish/i);
  assert.match(line!, /aligns with swing direction/i);
});

test("technicalsCoaching: VWAP-vs-spot wording is not inverted (2026-09-09 live POET repro)", () => {
  // Root cause: `const above = vec.spot >= t.vwap` computes whether SPOT is at/above VWAP, but the
  // label it fed — `VWAP (${above ? "above" : "below"} spot)` — describes where VWAP sits relative
  // to spot, which is the OPPOSITE fact. "spot at/above vwap" means VWAP is BELOW spot, not above.
  // Live repro (POET, 2026-09-09 00:26 ET): spot 8.38 < vwap 8.44, so VWAP is genuinely ABOVE spot —
  // the shipped narrative printed "VWAP 8.44 (below spot)", stating the reverse of the real
  // relationship, directly contradicting the correct "Chart technicals" section's own "price below
  // session VWAP" line two blocks away in the same brief.
  const spotBelowVwap = {
    spot: 8.38,
    technicals: {
      vwap: 8.44,
      emaStack: "down",
      rsi: 52,
      macd: "bull",
      goldenPocket: null,
      structure: { type: "CHOCH", direction: "down", level: 8.35 },
    },
  } as import("@/lib/bie/vector-full-state").VectorFullState;
  const line1 = technicalsCoaching(spotBelowVwap, play({ direction: "LONG", ticker: "POET" }));
  // spot (8.38) is below vwap (8.44) => VWAP sits ABOVE spot.
  assert.match(line1!, /VWAP \*\*8\.44\*\* \(above spot\)/i);

  const spotAboveVwap = {
    spot: 95,
    technicals: {
      vwap: 90,
      emaStack: "up",
      rsi: 60,
      macd: "bull",
      goldenPocket: null,
      structure: { type: "BOS", direction: "up", level: 92 },
    },
  } as import("@/lib/bie/vector-full-state").VectorFullState;
  const line2 = technicalsCoaching(spotAboveVwap, play({ direction: "LONG", ticker: "NVDA" }));
  // spot (95) is above vwap (90) => VWAP sits BELOW spot.
  assert.match(line2!, /VWAP \*\*90\.00\*\* \(below spot\)/i);
});

test("technicalsCoaching: stale Vector snapshot returns null (Largo C2)", () => {
  const vec = {
    spot: 95,
    dataAgeMs: 200_000,
    technicals: {
      vwap: 94.7,
      emaStack: "up",
      rsi: 67,
      macd: "bull",
      goldenPocket: null,
      structure: { type: "CHOCH", direction: "up", level: 94 },
    },
  } as import("@/lib/bie/vector-full-state").VectorFullState;
  assert.equal(technicalsCoaching(vec, play({ direction: "LONG", ticker: "INTC" })), null);
});

test("technicalsCoaching: prior-session Vector returns null even when age is fresh (Largo C2)", () => {
  const vec = {
    spot: 95,
    observed_session_date: "2026-09-05",
    dataAgeMs: 30_000,
    freshness: "recent",
    technicals: {
      vwap: 94.7,
      emaStack: "up",
      rsi: 67,
      macd: "bull",
      goldenPocket: null,
      structure: { type: "CHOCH", direction: "up", level: 94 },
    },
  } as import("@/lib/bie/vector-full-state").VectorFullState;
  assert.equal(
    technicalsCoaching(vec, play({ direction: "LONG", ticker: "INTC" }), "2026-09-06"),
    null,
  );
});