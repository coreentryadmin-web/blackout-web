import test from "node:test";
import assert from "node:assert/strict";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import type { SwingPlayBriefContext } from "./play-brief-types";
import { describeDarkPoolLevel, counterThesisLine, tradeManagerNarrativeSection } from "./play-brief-narrative";
import { computeSwingThesisHealth, thesisHealthUncalibrated } from "./thesis-health";

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

test("tradeManagerNarrativeSection: narrates dark pool + dealer posture", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      vector: {
        spot: 100,
        gammaFlip: 98,
        maxPain: 99,
        darkPoolLevels: [{ strike: 99.5, premium: 12_000_000, pct: 42 }],
        regime: { posture: "long", label: "LONG GAMMA" },
        gexWalls: {
          callWalls: [{ strike: 105, gex: 1 }],
          putWalls: [{ strike: 97, gex: 1 }],
        },
      } as SwingPlayBriefContext["vector"],
      ecosystem: {
        ticker: "NRG",
        recent_flow: {
          window_hours: 24,
          print_count: 15,
          call_premium: 2_100_000,
          put_premium: 800_000,
          unknown_premium: 0,
        },
        gex_positioning: {
          spot: 100,
          flip: 98,
          gamma_posture: "long",
          gex_king_strike: 100,
        },
      } as SwingPlayBriefContext["ecosystem"],
    }),
    "open",
  );

  assert.ok(section);
  assert.equal(section!.title, "Trade manager read");
  assert.match(section!.body, /dark pool/i);
  assert.match(section!.body, /long gamma/i);
  assert.match(section!.body, /HELIX tape/i);
  assert.match(section!.body, /Break watch/i);
});

test("tradeManagerNarrativeSection: LONG Break watch never cites a level ABOVE spot as 'support' (2026-09-11)", () => {
  // breakTrigger picked the NEAREST put_wall/dark_pool match by unsigned distance without checking
  // which side of spot it sat on. A dark-pool print can be printed above OR below spot (see
  // narrateDarkPool's own price<spot side check a few lines down in this same file) — here the
  // nearest dark-pool level (101, 1% above spot=100) sat above spot while the real put wall (90)
  // was further away below spot. Pre-fix this produced "Break watch — lose 101.00 on a closing
  // basis" for a LONG at spot 100 — a level the play hasn't even reached yet, not a support it
  // could "lose". The fix requires a support candidate to actually be below spot.
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({ direction: "LONG" }),
      vector: {
        spot: 100,
        gammaFlip: 105, // also above spot — must not be used as the LONG break fallback either
        darkPoolLevels: [{ strike: 101, premium: 5_000_000, pct: 30 }],
        gexWalls: { callWalls: [], putWalls: [{ strike: 90, gex: 1 }] },
      } as SwingPlayBriefContext["vector"],
    }),
    "open",
  );

  assert.ok(section);
  assert.match(section!.body, /Break watch.*90\.00/i);
  assert.doesNotMatch(section!.body, /Break watch.*101\.00/i);
  assert.doesNotMatch(section!.body, /Break watch.*105\.00/i);
});

test("tradeManagerNarrativeSection: stale Vector snapshot does not say Right now (Largo C2)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      vector: {
        spot: 100,
        gammaFlip: 98,
        dataAgeMs: 180_000,
        freshness: "stale",
        regime: { posture: "long", label: "LONG GAMMA" },
      } as SwingPlayBriefContext["vector"],
    }),
    "open",
  );

  assert.ok(section);
  // Stale Vector spot is suppressed — without GEX fallback the brief degrades honestly.
  assert.match(section!.body, /Vector spot not wired on this tick/i);
  assert.doesNotMatch(section!.body, /Right now/i);
  assert.doesNotMatch(section!.body, /long gamma/i);
  assert.doesNotMatch(section!.body, /Break watch.*98\.00/i);
});

test("tradeManagerNarrativeSection: stale Vector suppresses proximity + wall event bullets (Largo C2)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      vector: {
        spot: 100,
        dataAgeMs: 180_000,
        freshness: "stale",
        proximity: { strike: 102, side: "call", callout: "reject here" },
        wallEvents: [{ kind: "call_wall_build", message: "wall building", strike: 102 }],
        gexWalls: { callWalls: [{ strike: 102, pct: 5 }], putWalls: [] },
      } as SwingPlayBriefContext["vector"],
    }),
    "open",
  );

  assert.ok(section);
  assert.doesNotMatch(section!.body, /Nearest wall/i);
  assert.doesNotMatch(section!.body, /Wall just moved/i);
});

test("tradeManagerNarrativeSection: stale Vector with live GEX fallback uses Last snapshot lead (Largo C2)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      vector: {
        spot: 100,
        gammaFlip: 98,
        dataAgeMs: 180_000,
        freshness: "stale",
        regime: { posture: "long", label: "LONG GAMMA" },
      } as SwingPlayBriefContext["vector"],
      ecosystem: {
        ticker: "NRG",
        gex_positioning: {
          spot: 100,
          flip: 98,
          gamma_posture: "short",
          matrix_age_sec: 30,
          freshness: "cached",
        },
      } as SwingPlayBriefContext["ecosystem"],
    }),
    "open",
  );

  assert.ok(section);
  assert.match(section!.body, /Last snapshot/i);
  assert.match(section!.body, /180s old/i);
  assert.match(section!.body, /short gamma/i);
  assert.doesNotMatch(section!.body, /Right now/i);
});

test("tradeManagerNarrativeSection: stale GEX-only matrix does not say Right now (Largo C2)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      vector: { spot: 100 } as SwingPlayBriefContext["vector"],
      ecosystem: {
        ticker: "NRG",
        gex_positioning: {
          spot: 100,
          flip: 98,
          gamma_posture: "long",
          matrix_age_sec: 180,
          freshness: "cached",
        },
      } as SwingPlayBriefContext["ecosystem"],
    }),
    "open",
  );

  assert.ok(section);
  assert.match(section!.body, /dealer gamma posture not resolved/i);
  assert.doesNotMatch(section!.body, /long gamma/i);
  assert.doesNotMatch(section!.body, /γ-flip/i);
  assert.doesNotMatch(section!.body, /Right now/i);
});

test("tradeManagerNarrativeSection: stale Vector + stale GEX must not cite stale GEX spot (Largo C2)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      vector: {
        dataAgeMs: 200_000,
        freshness: "stale",
      } as SwingPlayBriefContext["vector"],
      ecosystem: {
        ticker: "NRG",
        gex_positioning: {
          spot: 100,
          flip: 98,
          gamma_posture: "long",
          matrix_age_sec: 180,
          freshness: "cached",
        },
      } as SwingPlayBriefContext["ecosystem"],
    }),
    "open",
  );

  assert.ok(section);
  assert.doesNotMatch(section!.body, /Spot \*\*100/i, "stale GEX spot must not render as live");
  assert.match(section!.body, /Vector spot not wired|dealer gamma posture not resolved/i);
});

test("tradeManagerNarrativeSection: stale GEX-only put wall must not drive Break watch (Largo C2)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      vector: null,
      ecosystem: {
        ticker: "INTC",
        gex_positioning: {
          spot: 100,
          put_wall: 98,
          matrix_age_sec: 200,
          freshness: "cached",
        },
      } as SwingPlayBriefContext["ecosystem"],
      play: play({ direction: "LONG", exitPolicy: undefined }),
    }),
    "open",
  );
  assert.ok(section);
  assert.doesNotMatch(section!.body, /Break watch.*98\.00/i, "stale GEX put wall must not anchor break trigger");
});

test("tradeManagerNarrativeSection: stale GEX-only gamma flip must not appear in dealer posture line (Largo C2)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      vector: {
        spot: 100,
        regime: { posture: "long", label: "LONG GAMMA" },
      } as SwingPlayBriefContext["vector"],
      ecosystem: {
        ticker: "INTC",
        gex_positioning: {
          spot: 100,
          flip: 98,
          matrix_age_sec: 200,
          freshness: "cached",
        },
      } as SwingPlayBriefContext["ecosystem"],
    }),
    "open",
  );
  assert.ok(section);
  assert.match(section!.body, /Right now/i, "live Vector posture must not be relabeled stale");
  assert.match(section!.body, /long gamma/i);
  assert.doesNotMatch(
    section!.body,
    /γ-flip/i,
    "stale GEX-only flip must not qualify a live-posture dealer read",
  );
});

test("tradeManagerNarrativeSection: live Vector gamma flip still shown when GEX matrix is stale", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      vector: {
        spot: 100,
        gammaFlip: 97,
        regime: { posture: "long", label: "LONG GAMMA" },
      } as SwingPlayBriefContext["vector"],
      ecosystem: {
        ticker: "INTC",
        gex_positioning: {
          spot: 100,
          flip: 98,
          matrix_age_sec: 200,
          freshness: "cached",
        },
      } as SwingPlayBriefContext["ecosystem"],
    }),
    "open",
  );
  assert.ok(section);
  assert.match(section!.body, /γ-flip \*\*97\.00\*\*/i, "live Vector flip must still render");
});

test("tradeManagerNarrativeSection: stale GEX-only gamma flip must not drive Break watch (Largo C2)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      vector: null,
      ecosystem: {
        ticker: "INTC",
        gex_positioning: {
          spot: 100,
          flip: 98,
          matrix_age_sec: 200,
          freshness: "cached",
        },
      } as SwingPlayBriefContext["ecosystem"],
      play: play({ direction: "LONG", exitPolicy: undefined }),
    }),
    "open",
  );
  assert.ok(section);
  assert.doesNotMatch(section!.body, /Break watch.*98\.00/i, "stale GEX flip must not anchor break trigger");
});

test("tradeManagerNarrativeSection: live Vector put wall still drives Break watch when GEX matrix is stale", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      vector: {
        spot: 100,
        gexWalls: { putWalls: [{ strike: 97 }], callWalls: [] },
      } as unknown as SwingPlayBriefContext["vector"],
      ecosystem: {
        ticker: "INTC",
        gex_positioning: {
          spot: 100,
          put_wall: 95,
          matrix_age_sec: 200,
          freshness: "cached",
        },
      } as SwingPlayBriefContext["ecosystem"],
      play: play({ direction: "LONG", exitPolicy: undefined }),
    }),
    "open",
  );
  assert.ok(section);
  assert.match(section!.body, /Break watch.*97\.00/i, "live Vector wall must still anchor break trigger");
});

test("tradeManagerNarrativeSection: stale GEX-only gamma posture must not drive GEX king narration (Largo C2)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      vector: {
        spot: 100,
        ladder: { rows: [{ strike: 103, isKing: true }] },
      } as unknown as SwingPlayBriefContext["vector"],
      ecosystem: {
        ticker: "INTC",
        gex_positioning: {
          spot: 100,
          gamma_posture: "long",
          matrix_age_sec: 200,
          freshness: "cached",
        },
      } as SwingPlayBriefContext["ecosystem"],
      play: play({ direction: "LONG", exitPolicy: undefined }),
    }),
    "open",
  );
  assert.ok(section);
  assert.match(section!.body, /GEX king 103\.00/i);
  assert.doesNotMatch(
    section!.body,
    /Pin risk/i,
    "stale GEX-only gamma posture must not drive the king strike's directional pin/acceleration call",
  );
  assert.match(section!.body, /Max-gamma node/i, "falls back to the posture-unknown narration");
});

test("tradeManagerNarrativeSection: live Vector gamma posture still drives GEX king narration despite stale GEX matrix", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      vector: {
        spot: 100,
        ladder: { rows: [{ strike: 103, isKing: true }] },
        regime: { posture: "long" },
      } as unknown as SwingPlayBriefContext["vector"],
      ecosystem: {
        ticker: "INTC",
        gex_positioning: {
          spot: 100,
          gamma_posture: "short",
          matrix_age_sec: 200,
          freshness: "cached",
        },
      } as SwingPlayBriefContext["ecosystem"],
      play: play({ direction: "LONG", exitPolicy: undefined }),
    }),
    "open",
  );
  assert.ok(section);
  assert.match(section!.body, /Pin risk/i, "live Vector posture must still drive the directional call");
});

test("magnetCoaching (via tradeManagerNarrativeSection): must not claim long-gamma regime when posture is short (live NRG repro 2026-09-06)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      vector: {
        spot: 118.95,
        magnet: { strike: 134.37, distancePct: 13.0, pull: "up" },
        regime: { posture: "short" },
      } as unknown as SwingPlayBriefContext["vector"],
      play: play({ direction: "LONG", exitPolicy: undefined }),
    }),
    "open",
  );
  assert.ok(section);
  assert.match(section!.body, /Gamma magnet 134\.37/i);
  assert.doesNotMatch(
    section!.body,
    /long-gamma regimes/i,
    "posture is measured SHORT — must not claim a long-gamma dealer regime",
  );
  assert.match(section!.body, /Pivot node/i, "short/unknown posture falls back to acceleration-risk framing");
});

test("magnetCoaching (via tradeManagerNarrativeSection): still claims long-gamma regime when posture is measured long", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      vector: {
        spot: 118.95,
        magnet: { strike: 134.37, distancePct: 13.0, pull: "up" },
        regime: { posture: "long" },
      } as unknown as SwingPlayBriefContext["vector"],
      play: play({ direction: "LONG", exitPolicy: undefined }),
    }),
    "open",
  );
  assert.ok(section);
  assert.match(section!.body, /long-gamma regimes/i);
});

test("maxPainCoaching (via tradeManagerNarrativeSection): must not claim long-gamma pin gravity when posture is short (live RDDT repro 2026-09-11)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      vector: {
        spot: 156.15,
        maxPain: 155,
        gammaFlip: 168.48,
        regime: { posture: "short" },
      } as unknown as SwingPlayBriefContext["vector"],
      play: play({ direction: "LONG", exitPolicy: undefined }),
    }),
    "open",
  );
  assert.ok(section);
  assert.match(section!.body, /Max pain 155\.00/i);
  assert.doesNotMatch(
    section!.body,
    /pulls toward pin when dealers are long gamma/i,
    "posture is measured SHORT — must not claim long-gamma pin gravity",
  );
  assert.match(section!.body, /short gamma here.*run through max pain/i, "short posture falls back to weaker-pin framing");
});

test("maxPainCoaching (via tradeManagerNarrativeSection): still claims long-gamma pin gravity when posture is measured long", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      vector: {
        spot: 100,
        maxPain: 99,
        regime: { posture: "long" },
      } as unknown as SwingPlayBriefContext["vector"],
      play: play({ direction: "LONG", exitPolicy: undefined }),
    }),
    "open",
  );
  assert.ok(section);
  assert.match(section!.body, /pulls toward pin when dealers are long gamma/i);
});

test("maxPainCoaching (via tradeManagerNarrativeSection): unresolved posture states the pin as unsettled, not long-gamma", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      vector: {
        spot: 100,
        maxPain: 99,
      } as unknown as SwingPlayBriefContext["vector"],
      play: play({ direction: "LONG", exitPolicy: undefined }),
    }),
    "open",
  );
  assert.ok(section);
  assert.match(section!.body, /Max pain 99\.00/i);
  assert.doesNotMatch(
    section!.body,
    /pulls toward pin when dealers are long gamma/i,
    "unresolved posture must not assert a long-gamma pin",
  );
  assert.match(section!.body, /depends on dealer gamma posture \(not resolved on this read\)/i);
});

test("tradeManagerNarrativeSection: SHORT break watch uses stop_premium not target", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({
        direction: "SHORT",
        status: "HOLD",
        recommendation: "HOLD",
        exitPolicy: {
          trim_levels: [],
          stop_premium: 3.5,
          target_premium: 1.2,
        },
      }),
    }),
    "open",
  );
  assert.ok(section);
  // Precise 2-decimal premium (matches play-brief.ts's own fmtUsd), sign-free (2026-09-09 fix —
  // stop_premium is an absolute price, never a signed delta; see the fmtOptionUsd regression
  // tests below) — not rounded to a whole dollar, which previously made this contradict the
  // Management section's "Rails: stop $3.50" rendered from the same stop_premium value.
  assert.match(section!.body, /Break watch.*reclaim \*\*\$3\.50\*\*/i);
  assert.doesNotMatch(section!.body, /reclaim \*\*\+?\$1/);
});

// FINDINGS 2026-09-10 (live NRG repro): actionNarrative's peak-giveback bullet used to compute
// `play.peak - play.pnlPct` — a percentage-POINT subtraction of two already-percentage numbers —
// and label it "Gave back X% from peak", which a trader unambiguously reads as a RELATIVE
// retracement. Real production NRG position: peak 132.7, pnlPct 39.8 -> old math printed
// "Gave back 93% from peak" on a play still up +39.8%, reading as a near-total round-trip when
// the honest relative retracement is ~70% (30% of the peak gain retained).
test("tradeManagerNarrativeSection: peak-giveback bullet uses honest relative retracement, not point-difference (live NRG repro)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({ status: "HOLD", recommendation: "HOLD", pnlPct: 39.8, peak: 132.7 }),
    }),
    "open",
  );
  assert.ok(section);
  assert.match(section!.body, /Gave back \*\*70%\*\* of peak/, `expected ~70% relative giveback, got: ${section!.body}`);
  assert.doesNotMatch(section!.body, /Gave back \*\*93%\*\*/, "must not regress to the point-difference bug");
});

test("tradeManagerNarrativeSection: peak-giveback bullet does not fire once retained capture clears the floor", () => {
  // capture = 98/120*100 ~= 81.7% retained -> NOT below the 75% floor, so no giveback bullet.
  // (Old point-difference math: 120-98=22 > 20 threshold WOULD have fired here — this is a
  // deliberate behavior change: 82% retention isn't a meaningful giveback to flag.)
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({ status: "HOLD", recommendation: "HOLD", pnlPct: 98, peak: 120 }),
    }),
    "open",
  );
  assert.ok(section);
  assert.doesNotMatch(section!.body, /Gave back/i);
});

test("tradeManagerNarrativeSection: round-tripped-past-breakeven bullet fires when current pnl has gone negative after a positive peak", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({ status: "HOLD", recommendation: "HOLD", pnlPct: -10, peak: 132.7 }),
    }),
    "open",
  );
  assert.ok(section);
  assert.match(
    section!.body,
    /Round-tripped past breakeven.*was up \*\*133%\*\* at peak, now \*\*-10%\*\*/,
  );
});

// Live repro (NN, SWING:NN:32, 2026-09-10 12:00 ET): a TRIM recommendation whose position has
// ALREADY round-tripped past breakeven still rendered actionNarrative's generic "Bank partial
// into strength; don't give back peak." immediately before the accurate "Round-tripped past
// breakeven ... was up 24% at peak, now -35%" bullet — telling a member to protect a peak the very
// next clause says is already gone, past breakeven, into a loss. "Into strength" and "don't give
// back peak" are both stale/contradictory once the round-trip has already happened.
test("tradeManagerNarrativeSection: TRIM recommendation does not claim 'into strength' once the play has already round-tripped past breakeven", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({
        status: "HOLD",
        recommendation: "TRIM",
        pnlPct: -34.6,
        peak: 24.4,
        exitPolicy: {
          policy: "trim_scale",
          hard_stop_pct: -60,
          target_pct: 100,
          trim_levels: [{ trigger_pct: 100, fraction: 0.5, premium: 3.9, fired: false }],
          runner_fraction: 0.5,
        },
      }),
    }),
    "open",
  );
  assert.ok(section);
  assert.doesNotMatch(
    section!.body,
    /Bank partial into strength/i,
    `TRIM's generic "into strength" line must not survive a real round-trip, got: ${section!.body}`,
  );
  assert.match(section!.body, /Round-tripped past breakeven.*was up \*\*24%\*\* at peak, now \*\*-35%\*\*/);
});

test("tradeManagerNarrativeSection: TRIM recommendation keeps the 'into strength' line when the play has NOT round-tripped (still a live gain)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({
        status: "TRIM",
        recommendation: "TRIM",
        pnlPct: 8.6,
        peak: 129.7,
        exitPolicy: {
          policy: "trim_scale",
          hard_stop_pct: -60,
          target_pct: 100,
          trim_levels: [{ trigger_pct: 100, fraction: 0.5, premium: 33.3, fired: true }],
          runner_fraction: 0.5,
        },
      }),
    }),
    "open",
  );
  assert.ok(section);
  assert.match(section!.body, /Bank partial into strength; don't give back peak/);
});

// Live NRG repro, 2026-09-11: the position round-tripped from +132.7% to +2% with ZERO trim
// ever banked — the desk had been recommending TRIM the whole way up, but "Desk says TRIM —
// bank partial into strength" never disclosed that nothing auto-executes, so a member reading
// that line has no way to tell "already protected" from "still 100% exposed, act yourself".
// This is the product-honesty gap: disclose plainly whenever trimsFired is 0 (the trigger has
// already been crossed — that's why rec is TRIM at all — but nothing has actually been banked).
test("tradeManagerNarrativeSection: TRIM recommendation discloses advisory-only when nothing has been banked yet (live NRG repro)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({
        status: "HOLD",
        recommendation: "TRIM",
        pnlPct: 132.7,
        peak: 132.7,
        exitPolicy: {
          policy: "trim_scale",
          hard_stop_pct: -60,
          target_pct: 100,
          trim_levels: [{ trigger_pct: 100, fraction: 0.5, premium: 5.0, fired: false }],
          runner_fraction: 0.5,
        },
      }),
    }),
    "open",
  );
  assert.ok(section);
  assert.match(
    section!.body,
    /Nothing's banked yet — this is advisory only; place the trim yourself, the desk does not execute trades/,
    `expected an explicit advisory-only disclosure when trimsFired is 0, got: ${section!.body}`,
  );
});

// Sibling: once at least one trim rung HAS actually fired (mechanical + status===TRIM, per
// adapters.ts's gating comment), the position is no longer 100% exposed — the costliest gap
// (silent full exposure) no longer applies, so the disclosure should not fire.
test("tradeManagerNarrativeSection: TRIM recommendation does NOT add the advisory-only disclosure once a trim rung has already fired", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({
        status: "TRIM",
        recommendation: "TRIM",
        pnlPct: 8.6,
        peak: 129.7,
        exitPolicy: {
          policy: "trim_scale",
          hard_stop_pct: -60,
          target_pct: 100,
          trim_levels: [{ trigger_pct: 100, fraction: 0.5, premium: 33.3, fired: true }],
          runner_fraction: 0.5,
        },
      }),
    }),
    "open",
  );
  assert.ok(section);
  assert.doesNotMatch(section!.body, /Nothing's banked yet — this is advisory only/);
});

// FINDINGS 2026-09-10: degradedReadLine (the "Live read" fallback bullet, fires only when Vector
// spot isn't wired on this tick) independently carried the SAME peak-pnlPct point-difference bug
// right beside actionNarrative's copy in this same file — a 4th call site found while fixing the
// three named in the original finding (blast radius).
test("tradeManagerNarrativeSection: degraded-read 'Live read' giveback clause also uses honest relative retracement (4th call site, live NRG repro)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({ status: "HOLD", recommendation: "HOLD", pnlPct: 39.8, peak: 132.7 }),
    }),
    "open",
  );
  assert.ok(section);
  assert.match(section!.body, /Live read.*gave back \*\*70%\*\* from peak/, `expected ~70% relative giveback in Live read, got: ${section!.body}`);
  assert.doesNotMatch(section!.body, /gave back \*\*93%\*\*/, "must not regress to the point-difference bug");
});

test("describeDarkPoolLevel: support language for long below spot", () => {
  const line = describeDarkPoolLevel({ strike: 95, premium: 5_000_000, pct: 30 }, 100, "LONG");
  assert.match(line, /Watch 95\.00/);
  assert.match(line, /support/i);
});

test("tradeManagerNarrativeSection: watch bucket entry stance uses WAIT not raw HOLD", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({
        status: "WATCH",
        recommendation: "HOLD",
        gateBlocks: [{ code: "G1", reason: "wait" }],
      }),
      vector: { spot: 50 } as SwingPlayBriefContext["vector"],
    }),
    "watch",
  );
  assert.ok(section);
  assert.match(section!.body, /Entry stance.*WAIT/i);
  assert.doesNotMatch(section!.body, /Entry stance.*HOLD/i);
});

test("tradeManagerNarrativeSection: watch bucket gate reasons appear once, not duplicated across Entry stance + Gates blocking entry", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({
        status: "WATCH",
        recommendation: "HOLD",
        gateBlocks: [
          { code: "g_s12_halt_feed_stale", reason: "Trading-halt feed unavailable" },
          { code: "g_s6_confluence", reason: "Independent signal confluence below commit threshold" },
        ],
      }),
      vector: { spot: 50 } as SwingPlayBriefContext["vector"],
    }),
    "watch",
  );
  assert.ok(section);
  // BUG (found live on EWY/NRG WATCH briefs, 2026-09-10): actionNarrative's "Entry stance" bullet
  // used to re-render the same first-two gate code+reason strings watchGateCoaching's own "Gates
  // blocking entry" bullet already carries in full — the section's own de-dup (`seen`, keyed on
  // each line's first 48 chars) never caught it because the two bullets open with different
  // wording. Each gate's reason text must now appear exactly once in the composed narrative.
  const halt = (section!.body.match(/Trading-halt feed unavailable/g) ?? []).length;
  assert.equal(halt, 1, `expected the halt-feed gate reason to appear once, found ${halt}`);
  const confluence = (
    section!.body.match(/Independent signal confluence below commit threshold/g) ?? []
  ).length;
  assert.equal(confluence, 1, `expected the confluence gate reason to appear once, found ${confluence}`);
  // De-duplication, not deletion: the terse count-only "Entry stance" bullet and the detailed
  // "Gates blocking entry" bullet (with codes + reasons) must both still be present.
  assert.match(section!.body, /Entry stance.*2 gates blocking entry — see below/i);
  assert.match(section!.body, /Gates blocking entry.*g_s12_halt_feed_stale/i);
});

test("tradeManagerNarrativeSection: watch bucket entry stance", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({ status: "WATCH", recommendation: "BUY", gateBlocks: [{ code: "G1", reason: "wait" }] }),
      vector: { spot: 50 } as SwingPlayBriefContext["vector"],
    }),
    "watch",
  );
  assert.ok(section);
  assert.match(section!.body, /Entry stance/i);
});

test("tradeManagerNarrativeSection: degraded read when spot missing", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({
        status: "HOLD",
        recommendation: "HOLD",
        mark: 2.45,
        pnlPct: 98,
        peak: 120,
        thesisHealth: { health: 46, rungLabel: "Degraded", pillars: [] },
        exitPolicy: {
          trim_levels: [{ trigger_pct: 100, fired: false }],
          stop_premium: 1.96,
          target_premium: 9.8,
        },
      }),
    }),
    "open",
  );
  assert.ok(section);
  assert.match(section!.body, /Hold the line/i);
  assert.match(section!.body, /Live read/i);
  assert.match(section!.body, /Manage plan/i);
  assert.match(section!.body, /Break watch/i);
  // Regression (2026-09-07): degradedReadLine's "Live read" mark and the stop_premium fallback
  // Break watch line used fmtUsd's whole-dollar rounding (`$${n.toFixed(0)}`, built for HELIX/
  // dark-pool flow premiums in the hundreds-of-thousands+ range) for a PER-CONTRACT option
  // premium. mark=2.45 rendered as "$2" and stop_premium=1.96 as "$2" — same digit, wrong value,
  // and both disagreed with the Position section's precise "$2.45" rendered from the exact same
  // field in the same brief. Now both use fmtOptionUsd (2-decimal) so one fact reads as one
  // number everywhere in the document. Sign-free since 2026-09-09 (blast radius of the
  // play-brief.ts fmtUsd fix) — mark/stop_premium are absolute prices, never signed deltas.
  assert.match(section!.body, /Live read.*mark \*\*\$2\.45\*\*/i, "mark must render precise, not rounded to $2, and not signed");
  assert.match(section!.body, /Break watch.*lose premium stop \*\*\$1\.96\*\*/i, "stop_premium must render precise, not rounded to $2, and not signed");
});

test("tradeManagerNarrativeSection: railsFallback stop/target rails render sign-free absolute prices (2026-09-09 blast-radius fix)", () => {
  // Empty trim_levels + no manageAction/time_stop_et/runner_fraction + a contract with no DTE
  // token mean manageLifecycleCoaching contributes no "Manage plan" bullet, so railsFallback's own
  // "Manage rails" line is the one under test here — a separate code path (and a separate
  // fmtOptionUsd call site) from the "Break watch" fallback covered above.
  //
  // Contract override note (2026-09-09): the default fixture contract ("110C · 13DTE") no longer
  // isolates this path — manageLifecycleCoaching now always contributes a DTE-runway line for any
  // DTE it can parse (dte<=7 keeps the urgency framing, dte>7 gets a plain "N DTE remaining" one;
  // see play-brief-narrative-coaching.ts), a fix for the DTE fact being silently dropped above 7
  // DTE (live CRWD 9DTE repro, docs/audit/findings-staging/2026-09-09-swing-manage-plan-dte-
  // runway-gap.md). This test's own isolation intent is unaffected by that fix — it explicitly
  // wants the "no Manage plan bullet at all" precondition, which now requires a contract with no
  // DTE token at all, not merely one above the old 7-day threshold.
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({
        status: "HOLD",
        recommendation: "HOLD",
        contract: "110C",
        exitPolicy: {
          trim_levels: [],
          stop_premium: 1.5,
          target_premium: 6,
        },
      }),
    }),
    "open",
  );
  assert.ok(section);
  assert.doesNotMatch(section!.body, /Manage plan/i, "test setup must not accidentally exercise the Manage plan path");
  assert.match(section!.body, /Manage rails.*stop \*\*\$1\.50\*\*.*target \*\*\$6\.00\*\*/i);
  assert.doesNotMatch(section!.body, /stop \*\*\+/i, "stop_premium is an absolute price, never a signed delta");
  assert.doesNotMatch(section!.body, /target \*\*\+/i, "target_premium is an absolute price, never a signed delta");
});

test("tradeManagerNarrativeSection: bias reads bullish from technicals on SHORT play with bullish tape (FINDINGS 2026-09-06 #13 parity)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({ direction: "SHORT", status: "HOLD" }),
      vector: {
        spot: 95,
        technicals: {
          vwap: 94.7,
          emaStack: "up",
          rsi: 67,
          macd: "bull",
          goldenPocket: null,
          structure: { type: "CHOCH", direction: "up", level: 94 },
        },
      } as SwingPlayBriefContext["vector"],
    }),
    "open",
  );
  assert.ok(section);
  assert.equal(section!.bias, "bullish");
});

test("tradeManagerNarrativeSection: bias reads bearish from technicals on LONG play with bearish tape (FINDINGS 2026-09-06 #13 parity)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({ direction: "LONG", status: "HOLD" }),
      vector: {
        spot: 15,
        technicals: {
          vwap: 15.29,
          emaStack: "down",
          rsi: 40,
          macd: "bear",
          goldenPocket: null,
          structure: { type: "BOS", direction: "down", level: 15.5 },
        },
      } as SwingPlayBriefContext["vector"],
    }),
    "open",
  );
  assert.ok(section);
  assert.equal(section!.bias, "bearish");
});

test("counterThesisLine: steelmans bear case for LONG when desks disagree", () => {
  const line = counterThesisLine(
    ctx({
      ecosystem: {
        ticker: "NRG",
        recent_flow: {
          window_hours: 24,
          print_count: 10,
          call_premium: 400_000,
          put_premium: 1_200_000,
          unknown_premium: 0,
        },
        nighthawk_recent: {
          edition_for: "2026-09-05",
          direction: "short",
          conviction: "high",
          outcome: "bearish",
          score: null,
        },
        zerodte_today: null,
        gex_positioning: null,
        arsenal: null,
        flow_feed_fresh: true,
        vector_full_state: null,
      } as SwingPlayBriefContext["ecosystem"],
      vector: { spot: 100, technicals: { emaStack: "down" } } as SwingPlayBriefContext["vector"],
    }),
    play({ direction: "LONG" }),
    100,
  );
  assert.ok(line);
  assert.match(line!, /Counter-thesis \(bear case\)/i);
  assert.match(line!, /Night Hawk bearish/i);
  assert.match(line!, /bear EMA stack/i);
});

test("counterThesisLine: stale HELIX flow must not steelman call-led / put-led", () => {
  const line = counterThesisLine(
    ctx({
      ecosystem: {
        ticker: "INTC",
        flow_feed_fresh: false,
        recent_flow: {
          window_hours: 24,
          print_count: 10,
          call_premium: 1_200_000,
          put_premium: 400_000,
          unknown_premium: 0,
        },
        nighthawk_recent: null,
        zerodte_today: null,
        gex_positioning: null,
        arsenal: null,
        vector_full_state: null,
      } as SwingPlayBriefContext["ecosystem"],
    }),
    play({ direction: "SHORT" }),
    100,
  );
  assert.equal(line, null, "stale HELIX must not appear in counter-thesis");
});

test("counterThesisLine: prior-session 0DTE must not steelman desk friction (Largo C2)", () => {
  const line = counterThesisLine(
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
    118,
  );
  assert.equal(line, null, "yesterday's 0DTE short must not appear in counter-thesis");
});

test("counterThesisLine: prior-session Night Hawk must not steelman desk friction (Largo C2)", () => {
  const line = counterThesisLine(
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
    118,
  );
  assert.equal(line, null, "yesterday's Night Hawk short must not appear in counter-thesis");
});

test("counterThesisLine: prior-session Vector must not steelman desk friction (Largo C2)", () => {
  const line = counterThesisLine(
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
    118,
  );
  assert.equal(line, null, "yesterday's Vector short must not appear in counter-thesis");
});

test("counterThesisLine: stale GEX-only posture must not steelman dealer gamma", () => {
  const line = counterThesisLine(
    ctx({
      vector: null,
      ecosystem: {
        ticker: "INTC",
        gex_positioning: {
          spot: 100,
          gamma_posture: "long",
          matrix_age_sec: 200,
          freshness: "cached",
        },
      } as SwingPlayBriefContext["ecosystem"],
    }),
    play({ direction: "LONG" }),
    100,
  );
  assert.equal(line, null, "stale GEX posture must not appear in counter-thesis");
});

test("counterThesisLine: stale GEX-only call wall must not steelman overhead resistance (Largo C2)", () => {
  const line = counterThesisLine(
    ctx({
      vector: null,
      ecosystem: {
        ticker: "INTC",
        gex_positioning: {
          spot: 100,
          call_wall: 102,
          matrix_age_sec: 200,
          freshness: "cached",
        },
      } as SwingPlayBriefContext["ecosystem"],
    }),
    play({ direction: "LONG" }),
    100,
  );
  assert.equal(line, null, "stale GEX call wall must not appear in counter-thesis");
});

test("counterThesisLine: stale GEX-only put wall must not steelman support break (Largo C2)", () => {
  const line = counterThesisLine(
    ctx({
      vector: null,
      ecosystem: {
        ticker: "INTC",
        gex_positioning: {
          spot: 100,
          put_wall: 98,
          matrix_age_sec: 200,
          freshness: "cached",
        },
      } as SwingPlayBriefContext["ecosystem"],
    }),
    play({ direction: "SHORT" }),
    100,
  );
  assert.equal(line, null, "stale GEX put wall must not appear in counter-thesis");
});

test("counterThesisLine: live Vector call wall still steelmans even when GEX matrix is stale (per-wall gate)", () => {
  const line = counterThesisLine(
    ctx({
      vector: {
        gexWalls: { callWalls: [{ strike: 101 }], putWalls: [] },
      } as unknown as SwingPlayBriefContext["vector"],
      ecosystem: {
        ticker: "INTC",
        gex_positioning: {
          spot: 100,
          call_wall: 102,
          matrix_age_sec: 200,
          freshness: "cached",
        },
      } as SwingPlayBriefContext["ecosystem"],
    }),
    play({ direction: "LONG" }),
    100,
  );
  assert.ok(line, "a live Vector wall must still steelman even when the GEX matrix is stale");
  assert.match(line!, /call wall/i);
});

test("counterThesisLine: Vector bearish bias steelmans bear case for LONG swing", () => {
  const line = counterThesisLine(
    ctx({
      vector: {
        play: { bias: "short", headline: "Fade the rip", grade: "B" },
      } as SwingPlayBriefContext["vector"],
    }),
    play({ direction: "LONG" }),
    100,
  );
  assert.ok(line);
  assert.match(line!, /Counter-thesis \(bear case\)/i);
  assert.match(line!, /Vector bearish/i);
  assert.match(line!, /Fade the rip/i);
});

test("counterThesisLine: stale Vector play bias must not steelman desk read (Largo C2)", () => {
  const line = counterThesisLine(
    ctx({
      vector: {
        play: { bias: "short", headline: "Fade the rip", grade: "B" },
        freshness: "stale",
        dataAgeMs: 180_000,
      } as SwingPlayBriefContext["vector"],
    }),
    play({ direction: "LONG" }),
    100,
  );
  assert.equal(line, null, "stale Vector play bias must not appear in counter-thesis");
});

test("counterThesisLine: stale Vector EMA stack must not steelman chart read (Largo C2)", () => {
  const line = counterThesisLine(
    ctx({
      vector: {
        technicals: { emaStack: "down", macd: "bear", vwapSide: "below", structure: "LH" },
        freshness: "stale",
        dataAgeMs: 180_000,
      } as SwingPlayBriefContext["vector"],
    }),
    play({ direction: "LONG" }),
    100,
  );
  assert.equal(line, null, "stale Vector EMA stack must not appear in counter-thesis");
});

test("counterThesisLine: stale Vector regime posture must not steelman dealer gamma (Largo C2)", () => {
  const line = counterThesisLine(
    ctx({
      vector: {
        regime: { posture: "long", label: "LONG GAMMA" },
        freshness: "stale",
        dataAgeMs: 180_000,
      } as SwingPlayBriefContext["vector"],
      ecosystem: {
        ticker: "AAPL",
        recent_flow: null,
        nighthawk_recent: null,
        zerodte_today: null,
        gex_positioning: null,
        arsenal: null,
        flow_feed_fresh: true,
        vector_full_state: null,
      } as SwingPlayBriefContext["ecosystem"],
    }),
    play({ direction: "LONG" }),
    100,
  );
  assert.equal(line, null, "stale Vector regime must not appear in counter-thesis");
});

// FINDINGS 2026-09-09 (live repro, 3 committed positions, different tickers/directions/scores):
// counterThesisLine's fading-pillar reason read play.thesisHealth.pillars[].status with NO
// thesisHealthUncalibrated() guard, while degradedReadLine (this file, above) and
// thesisPillarCoaching (play-brief-narrative-coaching.ts) already gate the identical read. Every
// committed row that has no setup/entry/signal inputs wired gets FORCED default pillar labels
// (computeSwingThesisHealth's UNCALIBRATED_PILLAR_LABELS) and degradeFromManage() then force-sets
// the persistence pillar's status straight off the manage action alone (TAKE_PARTIAL/EXIT_RUNNER
// -> "faded") regardless of calibration — so the unguarded read fabricated a byte-identical
// "fading pillar **Persistence**" bear/bull case on rows whose OWN Thesis-health section
// (thesisHealthSection, play-brief.ts) says "pillar breakdown not shown" for that same row.
test("counterThesisLine: uncalibrated thesisHealth must not fabricate a fading-pillar counter-thesis (Largo C2)", () => {
  // Built via the REAL computeSwingThesisHealth pipeline (not a hand-rolled fixture) so this test
  // exercises the exact same code path that produced the live bug: no setupState/entryStatus/
  // signalKinds wired (the committed-position case) + a scale-out manage action.
  const thesisHealth = computeSwingThesisHealth({
    direction: "LONG",
    status: "HOLD",
    manageAction: "TAKE_PARTIAL",
    computedAtEt: "10:00:00",
  });
  assert.ok(thesisHealth, "expected a thesis health payload for an OPEN/HOLD/TRIM row");
  assert.equal(thesisHealthUncalibrated(thesisHealth), true, "sanity: this is the uncalibrated case");
  const persistencePillar = thesisHealth!.pillars.find((p) => p.label === "Persistence");
  assert.equal(persistencePillar?.status, "faded", "sanity: manage action still force-fades the pillar");

  const line = counterThesisLine(ctx({}), play({ direction: "LONG", thesisHealth }), null);
  assert.ok(
    line == null || !/fading pillar/i.test(line),
    `counter-thesis fabricated a fading-pillar reason off an uncalibrated thesisHealth: ${line}`,
  );
});

test("counterThesisLine: calibrated thesisHealth with a genuinely faded pillar still steelmans it", () => {
  const thesisHealth = computeSwingThesisHealth({
    direction: "LONG",
    status: "HOLD",
    setupState: "TRIGGERED",
    entryStatus: "AT_TRIGGER",
    signalKinds: ["FLOW", "VECTOR"],
    manageAction: "TAKE_PARTIAL",
    computedAtEt: "10:00:00",
  });
  assert.ok(thesisHealth);
  assert.equal(
    thesisHealthUncalibrated(thesisHealth),
    false,
    "sanity: real commit inputs wired means this IS calibrated",
  );
  const persistencePillar = thesisHealth!.pillars.find((p) => p.label === "Persistence");
  assert.equal(persistencePillar?.status, "faded", "sanity: same manage-driven fade as the case above");

  const line = counterThesisLine(ctx({}), play({ direction: "LONG", thesisHealth }), null);
  assert.ok(line, "expected a counter-thesis line for a calibrated, genuinely faded pillar");
  assert.match(line!, /fading pillar \*\*Persistence\*\*/);
});

test("tradeManagerNarrativeSection: includes counter-thesis when opposing signals exist", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      vector: { spot: 100, regime: { posture: "long", label: "LONG GAMMA" } } as SwingPlayBriefContext["vector"],
      ecosystem: {
        ticker: "NRG",
        recent_flow: {
          window_hours: 24,
          print_count: 8,
          call_premium: 300_000,
          put_premium: 900_000,
          unknown_premium: 0,
        },
        nighthawk_recent: {
          edition_for: "2026-09-05",
          direction: "short",
          conviction: "medium",
          outcome: "bearish",
          score: null,
        },
        zerodte_today: null,
        gex_positioning: { gamma_posture: "long" },
        arsenal: null,
        flow_feed_fresh: true,
        vector_full_state: null,
      } as SwingPlayBriefContext["ecosystem"],
    }),
    "open",
  );
  assert.ok(section);
  assert.match(section!.body, /Counter-thesis/i);
});

// FINDINGS 2026-09-09 (live NRG repro): crossDeskCoaching's "Cross-desk friction" bullet and
// counterThesisLine's "Vector bearish/bullish" reason both independently derive the same
// Vector-vs-swing misalignment and, unfixed, both cite the same headline in the same document —
// e.g. "Cross-desk friction — Vector bearish (Fade the rip)." AND, several bullets later,
// "Counter-thesis (bear case) — Vector bearish (Fade the rip) · ...". A trade-manager voice states
// a fact once, not three times across three sections.
test("tradeManagerNarrativeSection: Counter-thesis omits the Vector reason when crossDeskCoaching already named it, but keeps other reasons", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      vector: {
        spot: 100,
        play: { bias: "short", headline: "Fade the rip", invalidation: "102.00", thesis: "mean reversion" },
        technicals: { emaStack: "down", macd: "bear", vwapSide: "above", structure: "BOS down" },
      } as SwingPlayBriefContext["vector"],
    }),
    "open",
  );
  assert.ok(section);
  const friction = (section!.body.match(/Cross-desk friction[^\n]*/g) ?? []);
  const counter = (section!.body.match(/Counter-thesis[^\n]*/g) ?? []);
  assert.equal(friction.length, 1, `expected one Cross-desk friction bullet, got: ${section!.body}`);
  assert.match(friction[0]!, /Fade the rip/);
  assert.equal(counter.length, 1, `expected one Counter-thesis bullet, got: ${section!.body}`);
  // The Vector-specific reason is dropped from Counter-thesis (already stated above)...
  assert.doesNotMatch(counter[0]!, /Vector bearish/);
  // ...but the independent EMA-stack reason survives, proving this isn't a blanket suppression.
  assert.match(counter[0]!, /bear EMA stack/);
});

test("tradeManagerNarrativeSection: Break watch + Counter-thesis survive MAX_BULLETS on rich Vector data", () => {
  const richVector = {
    spot: 100,
    gammaFlip: 98.5,
    maxPain: 99,
    vexFlip: 99.2,
    vexWalls: { callWalls: [{ strike: 104, gex: 1 }], putWalls: [{ strike: 96, gex: 1 }] },
    darkPoolLevels: [{ strike: 99.5, premium: 12_000_000, pct: 42 }],
    regime: { posture: "long", label: "LONG GAMMA" },
    gexWalls: { callWalls: [{ strike: 105, gex: 1 }], putWalls: [{ strike: 97, gex: 1 }] },
    proximity: { strike: 105, side: "call", callout: "within 2% of call wall" },
    wallEvents: [{ kind: "call_wall_shift", message: "call wall lifted to 105" }],
    magnet: { strike: 100, distancePct: 0.3, pull: "at" },
    confluenceZones: [{ center: 101, score: 8, kinds: ["gex", "dark_pool"] }],
    expectedMove: { pct: 4.2, upper: 104.2, lower: 95.8 },
    technicals: { emaStack: "up", macd: "bull", vwapSide: "above", structure: "BOS up" },
  } as SwingPlayBriefContext["vector"];

  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({
        status: "HOLD",
        recommendation: "HOLD",
        score: 52,
        pnlPct: 18,
        peak: 32,
        manageAction: "HOLD",
        thesisHealth: {
          health: 48,
          rungLabel: "Degraded",
          advisory: "Tighten risk",
          pillars: [
            {
              id: "market",
              label: "Regime fit",
              status: "faded",
              commitLabel: "aligned",
              currentLabel: "neutral",
              deltaPts: -12,
            },
          ],
          moves: ["flow cooled vs open"],
        },
        exitPolicy: {
          trim_levels: [
            { trigger_pct: 25, fired: true },
            { trigger_pct: 50, fired: false },
          ],
          stop_premium: 1.85,
          target_premium: 4.2,
          time_stop_et: "15:45",
          runner_fraction: 0.25,
        },
      }),
      vector: richVector,
      laneRows: [
        { ticker: "NRG", direction: "LONG", horizon: "SWING", score: 52, status: "COMMIT", contract: {} as never, scoreFloor: 40, reason: "momentum" },
        { ticker: "INTC", direction: "LONG", horizon: "SWING", score: 61, status: "COMMIT", contract: {} as never, scoreFloor: 40, reason: "flow" },
        { ticker: "MU", direction: "LONG", horizon: "SWING", score: 44, status: "COMMIT", contract: {} as never, scoreFloor: 40, reason: "breakout" },
      ],
      meridian: {
        items: [{ kind: "earnings", days_until: 5, ticker: "NRG", importance: 4 }],
      } as SwingPlayBriefContext["meridian"],
      ecosystem: {
        ticker: "NRG",
        recent_flow: {
          window_hours: 24,
          print_count: 22,
          call_premium: 350_000,
          put_premium: 1_100_000,
          unknown_premium: 0,
        },
        nighthawk_recent: {
          edition_for: "2026-09-05",
          direction: "short",
          conviction: "high",
          outcome: "bearish",
          score: null,
        },
        zerodte_today: { direction: "long", conviction: "medium" },
        gex_positioning: {
          spot: 100,
          flip: 98.5,
          gamma_posture: "long",
          gex_king_strike: 100,
        },
        arsenal: null,
        flow_feed_fresh: true,
        vector_full_state: null,
      } as SwingPlayBriefContext["ecosystem"],
    }),
    "open",
  );

  assert.ok(section);
  const bulletCount = section!.body.split("\n").filter((l) => l.startsWith("• ")).length;
  assert.ok(bulletCount > 14, `expected >14 coaching bullets to stress the cap, got ${bulletCount}`);
  assert.match(section!.body, /Break watch/i, "safety-critical break coaching must not starve");
  assert.match(section!.body, /Counter-thesis/i, "counter-thesis must not starve behind MAX_BULLETS");
});

// Regression for the "thesis or ladder fired" mislabel (FINDINGS 2026-09-10, live repro NRG
// SWING:NRG:34): a SELL recommendation from a pure expiry_risk force-manage has an intact thesis
// and an un-fired ladder, so the old hardcoded line was factually wrong. manageReason (threaded
// from manage.ts's rung through live-plays.ts/adapters.ts) now drives the actual stated reason.
test("tradeManagerNarrativeSection: SELL from expiry_risk states time-based reason, not a false thesis/ladder claim", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({ recommendation: "SELL", manageReason: "expiry_risk", pnlPct: 25.5, peak: 132.7 }),
    }),
    "open",
  );

  assert.ok(section);
  assert.ok(
    section!.body.includes(
      "**Exit now** — time-based: DTE nearing the lane's theta cliff (thesis still intact). Flatten per manage engine.",
    ),
  );
  assert.doesNotMatch(section!.body, /thesis or ladder fired/i);
});

test("tradeManagerNarrativeSection: SELL from a real thesis break still says thesis broke", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({ recommendation: "SELL", manageReason: "structural_stop", pnlPct: -12, peak: 5 }),
    }),
    "open",
  );

  assert.ok(section);
  assert.ok(section!.body.includes("**Exit now** — thesis broke. Flatten per manage engine."));
});

test("tradeManagerNarrativeSection: SELL with unknown reason and no detected thesis break states no mechanism", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({ recommendation: "SELL", manageReason: null, pnlPct: -8, peak: 3 }),
    }),
    "open",
  );

  assert.ok(section);
  assert.ok(section!.body.includes("**Exit now**. Flatten per manage engine."));
  assert.doesNotMatch(section!.body, /thesis or ladder fired/i);
});
