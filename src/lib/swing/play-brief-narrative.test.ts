import test from "node:test";
import assert from "node:assert/strict";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import type { SwingPlayBriefContext } from "./play-brief-types";
import {
  describeDarkPoolLevel,
  counterThesisLine,
  tradeManagerNarrativeSection,
  rollRunwayExtensionDays,
  resolveInvalidationFocalLevel,
  type FocalLevel,
} from "./play-brief-narrative";
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

// GAP FOUND (Ask Largo standing mandate, 2026-10-24): every narrated level in this file states its
// distance from spot, "(X% from spot)" -- narrateWall/narrateMaxPain/narrateMagnet already do, but
// narrateDarkPool, narrateKing and narrateFlip silently did not, even though `level.distancePct`
// is the identical already-computed field. Pins the dark-pool fix: spot 100, dark pool 99.5 ->
// (99.5-100)/100 = -0.5% -> "-0.5% from spot".
test("tradeManagerNarrativeSection: dark pool narration states its distance from spot (2026-10-24)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({ direction: "LONG" }),
      vector: {
        spot: 100,
        darkPoolLevels: [{ strike: 99.5, premium: 12_000_000, pct: 42 }],
        gexWalls: { callWalls: [], putWalls: [] },
      } as SwingPlayBriefContext["vector"],
    }),
    "open",
  );
  assert.ok(section);
  assert.match(section!.body, /\*\*Watch 99\.50\*\* \(-0\.5% from spot\) — major \*\*dark pool\*\* print/i);
});

// PR #5994 added net_vex/net_dex/net_charm + their regime-read strings to gexPostureSection
// ("GEX posture"), but collapseRedundantIntelSections drops that WHOLE section for OPEN/WATCH
// buckets once a narrative is present, under a "folded into Trade manager read" note -- and
// dealerPostureLine (this file) never actually carried any vanna/dex/charm content, so the fields
// silently vanished for most members instead of folding into anything. Fixed by appending the
// same interpretive regime-read strings (not the raw $ figures -- parity with net_gex's own
// dollar value, which is likewise never narrated here) to the dealer-posture bullet itself.
test("tradeManagerNarrativeSection: carries vanna/delta/charm regime reads so collapsing 'GEX posture' doesn't lose them (2026-10-14)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      vector: {
        spot: 100,
        gammaFlip: 98,
        regime: { posture: "long", label: "LONG GAMMA" },
      } as SwingPlayBriefContext["vector"],
      ecosystem: {
        ticker: "NRG",
        gex_positioning: {
          spot: 100,
          flip: 98,
          gamma_posture: "long",
          net_vex: 2_000_000,
          vanna_regime_read: "vanna tailwind on rallies",
          net_dex: -1_500_000,
          dex_regime_read: "dealers short delta, hedging adds supply on bounces",
          net_charm: 800_000,
          charm_regime_read: "charm pinning builds into expiry",
        },
      } as SwingPlayBriefContext["ecosystem"],
    }),
    "open",
  );
  assert.ok(section);
  assert.match(section!.body, /vanna: vanna tailwind on rallies/i);
  assert.match(section!.body, /delta: dealers short delta, hedging adds supply on bounces/i);
  assert.match(section!.body, /charm: charm pinning builds into expiry/i);
  // Parity check: the raw $ figures stay out of the narrative (gexPostureSection's "Net GEX"/
  // "Net VEX"/etc. $-figure lines are the one place for those, same as net_gex already is).
  assert.doesNotMatch(section!.body, /\$2\.0M|\$1\.5M|\$0\.8M/);
});

test("tradeManagerNarrativeSection: stale GEX matrix suppresses vanna/delta/charm regime reads (Largo C2 parity)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      vector: {
        spot: 100,
        gammaFlip: 98,
        regime: { posture: "long", label: "LONG GAMMA" },
      } as SwingPlayBriefContext["vector"],
      ecosystem: {
        ticker: "NRG",
        gex_positioning: {
          spot: 100,
          flip: 98,
          gamma_posture: "long",
          matrix_age_sec: 200,
          freshness: "cached",
          net_vex: 2_000_000,
          vanna_regime_read: "vanna tailwind on rallies",
          net_dex: -1_500_000,
          dex_regime_read: "dealers short delta, hedging adds supply on bounces",
          net_charm: 800_000,
          charm_regime_read: "charm pinning builds into expiry",
        },
      } as SwingPlayBriefContext["ecosystem"],
    }),
    "open",
  );
  assert.ok(section);
  assert.doesNotMatch(section!.body, /vanna tailwind on rallies/i);
  assert.doesNotMatch(section!.body, /dealers short delta, hedging adds supply on bounces/i);
  assert.doesNotMatch(section!.body, /charm pinning builds into expiry/i);
});

// Largo deep-dive #2 (2026-10-14) found the SAME "folded into Trade manager read above" false
// claim also covers net_gex's own $ figure and the underlying session change% -- neither ever
// reached the narrative either, confirmed live on RKLB/GME (default envelope said "dealer gamma
// posture not resolved" while expandIntel=1 revealed real Net GEX/session-change content hidden
// behind the collapse note). Fixed by appending both (unlike VEX/DEX/CHARM's raw $ figures, which
// stay out -- their regime-read text already carries the "what it means" signal; net_gex has no
// such text elsewhere, so its number is the one still missing).
test("tradeManagerNarrativeSection: carries net GEX $ and session change% so the 'folded into Trade manager read' note is no longer false (2026-10-14)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      vector: {
        spot: 100,
        gammaFlip: 98,
        regime: { posture: "long", label: "LONG GAMMA" },
      } as SwingPlayBriefContext["vector"],
      ecosystem: {
        ticker: "NRG",
        gex_positioning: {
          spot: 100,
          flip: 98,
          gamma_posture: "long",
          net_gex: -6_100_000,
          change_pct: 2.34,
        },
      } as SwingPlayBriefContext["ecosystem"],
    }),
    "open",
  );
  assert.ok(section);
  assert.match(section!.body, /net GEX \*\*-6\.1M\*\*/i);
  assert.match(section!.body, /session \*\*\+2\.3%\*\*/i);
});

test("tradeManagerNarrativeSection: stale GEX matrix suppresses net GEX $ and session change% (Largo C2 parity)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      vector: {
        spot: 100,
        gammaFlip: 98,
        regime: { posture: "long", label: "LONG GAMMA" },
      } as SwingPlayBriefContext["vector"],
      ecosystem: {
        ticker: "NRG",
        gex_positioning: {
          spot: 100,
          flip: 98,
          gamma_posture: "long",
          matrix_age_sec: 200,
          freshness: "cached",
          net_gex: -6_100_000,
          change_pct: 2.34,
        },
      } as SwingPlayBriefContext["ecosystem"],
    }),
    "open",
  );
  assert.ok(section);
  assert.doesNotMatch(section!.body, /net GEX/i);
  assert.doesNotMatch(section!.body, /session \*\*\+2\.3%\*\*/i);
});

// BUG FIX (Ask Largo standing mandate, 2026-10-26): same bug class/fix shape as the VEX/DEX/CHARM
// and net-GEX/session-change% parity fixes above, for "Flow & positioning" instead of "GEX
// posture". collapseRedundantIntelSections (play-brief-intel-collapse.ts) drops the whole "Flow &
// positioning" section for OPEN/WATCH buckets with a "folded into Trade manager read above" note,
// but flowNarrative (this bullet) previously surfaced only the FIRST deduped anomaly and NO
// notable prints at all -- live-confirmed across 7 real OPEN positions (PANW/CRML/FLY/OUST/RDW/
// ASTS/FTNT), each collapsing to "aggregate + at most 1 anomaly, zero notable prints" vs the full
// section's real itemized lists under expandIntel=1.
test("tradeManagerNarrativeSection: HELIX tape bullet carries ALL deduped flow anomalies (not just the first) and itemized notable prints (2026-10-26)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      vector: { spot: 100, gexWalls: { callWalls: [], putWalls: [] } } as SwingPlayBriefContext["vector"],
      ecosystem: {
        ticker: "NRG",
        recent_flow: {
          window_hours: 6,
          print_count: 15,
          call_premium: 2_100_000,
          put_premium: 800_000,
          unknown_premium: 0,
        },
        flow_feed_fresh: true,
        recent_anomalies: [
          {
            anomaly_type: "CONCENTRATION",
            detail: "NRG: call flow concentrated in weekly 110s",
            detected_at: "2026-09-05T19:00:00.000Z",
            severity: "high",
            direction: "bullish",
          },
          {
            anomaly_type: "COORDINATED_SWEEP",
            detail: "NRG: three sweeps within 2 minutes",
            detected_at: "2026-09-05T18:30:00.000Z",
            severity: "high",
            direction: "bullish",
          },
          {
            anomaly_type: "PREMIUM_SPIKE",
            detail: "NRG: premium 4x the 20-day average",
            detected_at: "2026-09-05T17:00:00.000Z",
            severity: "medium",
            direction: null,
          },
        ],
        flow_full_state: {
          count: 15,
          total_premium: 2_900_000,
          top_tickers: [],
          recent: [
            { ticker: "NRG", option_type: "CALL", strike: 110, premium: 518_000, alerted_at: "2026-09-05T19:40:00.000Z" },
            { ticker: "NRG", option_type: "PUT", strike: 105, premium: 296_000, alerted_at: "2026-09-05T19:30:00.000Z" },
          ],
        },
      } as SwingPlayBriefContext["ecosystem"],
    }),
    "open",
  );
  assert.ok(section);
  // All three anomalies present, not just the first (the pre-fix behavior).
  assert.match(section!.body, /CONCENTRATION/);
  assert.match(section!.body, /COORDINATED_SWEEP/);
  assert.match(section!.body, /PREMIUM_SPIKE/);
  // Notable prints now reach the collapsed narrative at all.
  assert.match(section!.body, /Notable prints/);
  assert.match(section!.body, /CALL 110\.00 \$518K/);
  assert.match(section!.body, /PUT 105\.00 \$296K/);
});

test("tradeManagerNarrativeSection: HELIX tape bullet dedupes a persisting anomaly rewritten across two cron cycles (mirrors flowIntelSection's own dedup, 2026-10-26)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      vector: { spot: 100, gexWalls: { callWalls: [], putWalls: [] } } as SwingPlayBriefContext["vector"],
      ecosystem: {
        ticker: "NRG",
        recent_flow: {
          window_hours: 6,
          print_count: 10,
          call_premium: 700_000,
          put_premium: 0,
          unknown_premium: 0,
        },
        flow_feed_fresh: true,
        recent_anomalies: [
          {
            anomaly_type: "DIRECTIONAL_FLOW_SKEW",
            detail: "NRG: one-sided call flow — $0.7M calls vs no put premium",
            detected_at: "2026-09-05T19:30:00.000Z",
            severity: "medium",
            direction: "bullish",
          },
          {
            anomaly_type: "DIRECTIONAL_FLOW_SKEW",
            detail: "NRG: one-sided call flow — $0.7M calls vs no put premium",
            detected_at: "2026-09-05T19:00:00.000Z",
            severity: "medium",
            direction: "bullish",
          },
        ],
      } as SwingPlayBriefContext["ecosystem"],
    }),
    "open",
  );
  assert.ok(section);
  const occurrences = section!.body.split("DIRECTIONAL_FLOW_SKEW").length - 1;
  assert.equal(occurrences, 1, "identical anomaly_type+detail must render once, not once per write cycle");
});

// Largo deep-dive follow-up (2026-10-15, PR #4076 comment 6175832614): gex-positioning.ts computes
// flip_crossings/flip_nearest/distance_to_nearest_flip_pct unconditionally for every brief, and a
// crossings count > 1 means the regime is more fragile than the single stable `flip` implies -- but
// dealerPostureLine only ever cited that single flip. A SHORT-gamma book with a second nearby
// crossing should surface it as its own clause, distinct from a stable single-crossing flip.
test("tradeManagerNarrativeSection: fragile flip (multiple crossings) surfaces the nearer crossing distance", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      vector: {
        spot: 100,
        gammaFlip: 98,
        regime: { posture: "short", label: "SHORT GAMMA" },
      } as SwingPlayBriefContext["vector"],
      ecosystem: {
        ticker: "NRG",
        gex_positioning: {
          spot: 100,
          flip: 98,
          gamma_posture: "short",
          flip_crossings: 3,
          flip_nearest: 101.5,
          distance_to_nearest_flip_pct: -1.5,
        },
      } as SwingPlayBriefContext["ecosystem"],
    }),
    "open",
  );
  assert.ok(section);
  // BUG FIX (2026-10-17): flip_nearest 101.5 sits ABOVE spot 100 (true distance +1.5%, matching
  // this file's own distPct convention every sibling level uses) — the pre-fix expectation here
  // (-1.5%) encoded the sign-inverted raw gex-positioning.ts field verbatim; see the fix's comment
  // on nearestCrossingBit/fragileBit in play-brief-narrative.ts.
  assert.match(section!.body, /fragile flip — nearer crossing \*\*101\.50\*\* \(\+1\.5% away\)/i);
});

test("tradeManagerNarrativeSection: a single stable crossing (flip_crossings<=1) never says fragile flip", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      vector: {
        spot: 100,
        gammaFlip: 98,
        regime: { posture: "long", label: "LONG GAMMA" },
      } as SwingPlayBriefContext["vector"],
      ecosystem: {
        ticker: "NRG",
        gex_positioning: {
          spot: 100,
          flip: 98,
          gamma_posture: "long",
          flip_crossings: 1,
          flip_nearest: 98,
          distance_to_nearest_flip_pct: 2.0,
        },
      } as SwingPlayBriefContext["ecosystem"],
    }),
    "open",
  );
  assert.ok(section);
  assert.doesNotMatch(section!.body, /fragile flip/i);
});

test("tradeManagerNarrativeSection: stale GEX matrix suppresses the fragile-flip clause (Largo C2 parity)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      vector: {
        spot: 100,
        gammaFlip: 98,
        regime: { posture: "short", label: "SHORT GAMMA" },
      } as SwingPlayBriefContext["vector"],
      ecosystem: {
        ticker: "NRG",
        gex_positioning: {
          spot: 100,
          flip: 98,
          gamma_posture: "short",
          matrix_age_sec: 200,
          freshness: "cached",
          flip_crossings: 3,
          flip_nearest: 101.5,
          distance_to_nearest_flip_pct: -1.5,
        },
      } as SwingPlayBriefContext["ecosystem"],
    }),
    "open",
  );
  assert.ok(section);
  assert.doesNotMatch(section!.body, /fragile flip/i);
});

// Live repro (2026-10-14): SWING:AMD, WATCH bucket, setupState EXTENDED / entryStatus
// EXTENDED_CHASE (a dead watch per deadPlayReason), spot resolved via the GEX-matrix fallback
// (Vector's own snapshot stale, GEX matrix fresh) -- dealerPostureLine rendered "**Last snapshot**
// (~Ns old) — spot ... dealers short gamma..." while the SAME envelope's confidence/
// unavailableSources claimed every live source resolved cleanly. degradedReadLine already gates on
// isSwingPlayStaleCheckExempt (#5620's fix, extracted 2026-10-07 after the identical contradiction
// in dataFreshnessSection) but dealerPostureLine -- a sibling function in this same file -- never
// was updated, making it a fourth call site repeating the same disagreement.
test("tradeManagerNarrativeSection: dead-but-not-closed WATCH does not say 'Last snapshot' when Vector is stale but GEX-fallback spot is fresh (2026-10-14, live AMD repro)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({ status: "WATCH", entryStatus: "EXTENDED_CHASE", setupState: "EXTENDED" }),
      vector: {
        dataAgeMs: 180_000,
        freshness: "stale",
      } as SwingPlayBriefContext["vector"],
      ecosystem: {
        ticker: "AMD",
        gex_positioning: {
          spot: 570.18,
          gamma_posture: "short",
        },
      } as SwingPlayBriefContext["ecosystem"],
    }),
    "watch",
  );
  assert.ok(section);
  assert.match(section!.body, /Right now/i, "a dead watch has nothing left to refresh -- no stale-snapshot caveat to assert");
  assert.doesNotMatch(section!.body, /Last snapshot/i);
  assert.match(section!.body, /short gamma/i);
});

test("tradeManagerNarrativeSection: a LIVE (not dead) WATCH play still says 'Last snapshot' under the identical Vector-stale/GEX-fresh shape (regression guard)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({ status: "WATCH" }),
      vector: {
        dataAgeMs: 180_000,
        freshness: "stale",
      } as SwingPlayBriefContext["vector"],
      ecosystem: {
        ticker: "AMD",
        gex_positioning: {
          spot: 570.18,
          gamma_posture: "short",
        },
      } as SwingPlayBriefContext["ecosystem"],
    }),
    "watch",
  );
  assert.ok(section);
  assert.match(section!.body, /Last snapshot/i, "a genuinely live watch candidate must still disclose Vector staleness");
  assert.doesNotMatch(section!.body, /Right now/i);
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

// GAP FOUND (Ask Largo standing mandate, 2026-10-24): "Break watch" is the single most
// safety-critical, reserved, always-shown line in the whole brief, yet it never stated how close
// the cited risk currently is — even though `FocalLevel.distancePct` was already computed and
// sitting right there on the matched level, unused. Pins the fix for the real (non-flip-fallback)
// LONG case: spot 100, put wall 90 -> (90-100)/100 = -10% -> "10.0% away".
test("tradeManagerNarrativeSection: LONG Break watch states how far the structural support level is from spot (2026-10-24)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({ direction: "LONG" }),
      vector: {
        spot: 100,
        gexWalls: { callWalls: [], putWalls: [{ strike: 90, gex: 1 }] },
      } as SwingPlayBriefContext["vector"],
    }),
    "open",
  );

  assert.ok(section);
  assert.match(section!.body, /Break watch\*\* — lose \*\*90\.00\*\* \(10\.0% away\) on a closing basis/i);
});

// SHORT sibling: spot 100, GEX king 103 -> (103-100)/100 = +3% -> "3.0% away".
test("tradeManagerNarrativeSection: SHORT Break watch states how far the structural resistance level is from spot (2026-10-24)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({ direction: "SHORT" }),
      vector: {
        spot: 100,
        ladder: { rows: [{ strike: 103, isKing: true }] },
        gexWalls: { callWalls: [{ strike: 120, gex: 1 }], putWalls: [] },
      } as SwingPlayBriefContext["vector"],
    }),
    "open",
  );

  assert.ok(section);
  assert.match(section!.body, /Break watch\*\* — reclaim \*\*103\.00\*\* \(3\.0% away\)/i);
});

// The LONG gamma-flip FALLBACK (no put_wall/dark_pool/king candidate exists below spot at all)
// must get the same treatment, not just the primary wall/king/dark-pool path — the flip's own
// `FocalLevel` entry (collectFocalLevels always derives one when a flip is known) carries the
// identical `distancePct` field. Spot 100, flip 95 -> (95-100)/100 = -5% -> "5.0% away".
test("tradeManagerNarrativeSection: LONG Break watch states distance for the gamma-flip fallback too, not just the primary wall/king/dark-pool path (2026-10-24)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({ direction: "LONG" }),
      vector: {
        spot: 100,
        gammaFlip: 95,
        gexWalls: { callWalls: [], putWalls: [] },
      } as SwingPlayBriefContext["vector"],
    }),
    "open",
  );

  assert.ok(section);
  assert.match(section!.body, /Break watch\*\* — lose \*\*95\.00\*\* \(5\.0% away\) on a closing basis/i);
});

// FINDING (Ask Largo standing mandate, 2026-10-16, live repro SWING:GOOGL:58): an OPEN position's
// real, committed structural stop (`play.invalidationUnderlyingPx`, pinned at commit from
// `thesis_invalidation_px` — manage.ts's own PRECEDENCE RANK #1 exit trigger, "fires at ANY
// premium P&L... beats expiry_risk") never appeared anywhere in the OPEN-bucket narrative — only
// the GEX-heuristic "Break watch" level (nearest put wall/dark pool/GEX king) did, with the same
// confident framing, even when the real stop is 7x tighter. This fix ADDS a second, distinct,
// clearly-labeled "Structural stop (committed)" bullet alongside — never instead of — "Break
// watch", per the Largo product contract's additive principle.
test("tradeManagerNarrativeSection: OPEN LONG surfaces the real committed structural stop as a distinct bullet alongside the GEX Break watch level (2026-10-16)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      // Real repro shape: spot much closer to the real committed stop (345.33) than to the far
      // looser GEX put wall (330.00) — the exact "7x farther, same confident framing" gap found live.
      play: play({ direction: "LONG", invalidationUnderlyingPx: 345.33 }),
      vector: {
        spot: 349.63,
        gexWalls: { callWalls: [], putWalls: [{ strike: 330, gex: 1 }] },
      } as SwingPlayBriefContext["vector"],
    }),
    "open",
  );

  assert.ok(section);
  // The pre-existing GEX heuristic is untouched — still cites the put wall.
  assert.match(section!.body, /Break watch.*330\.00/i);
  // The new, distinct, additive line cites the REAL committed stop — a different number, never
  // folded into (or replacing) the line above.
  assert.match(section!.body, /Structural stop \(committed\).*345\.33/i);
  assert.match(section!.body, /enforced exit regardless of option P&L/i);
});

test("tradeManagerNarrativeSection: committed structural stop uses 'already through' framing once spot has actually crossed it", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({ direction: "LONG", invalidationUnderlyingPx: 345.33 }),
      vector: { spot: 344.0, gexWalls: { callWalls: [], putWalls: [] } } as SwingPlayBriefContext["vector"],
    }),
    "open",
  );

  assert.ok(section);
  assert.match(section!.body, /Structural stop \(committed\).*already through.*345\.33/i);
});

test("tradeManagerNarrativeSection: SHORT committed structural stop reads 'already through' once spot has reclaimed it", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({ direction: "SHORT", invalidationUnderlyingPx: 110 }),
      vector: { spot: 112, gexWalls: { callWalls: [], putWalls: [] } } as SwingPlayBriefContext["vector"],
    }),
    "open",
  );

  assert.ok(section);
  assert.match(section!.body, /Structural stop \(committed\).*already through.*110\.00/i);
});

// BUG FIX (2026-10-17, Ask Largo standing mandate, live repro CRWV: spot 60.99, inval 57.06,
// rendered "6.9% away" instead of the correct 6.4%). committedStructuralStopLine divided by the
// STOP level (inval), not spot — every sibling "% away from a level" figure in this same brief
// (call/put wall, max pain, gamma magnet — this file's own distPct() helper) divides by spot.
// Invisible at small distances (the already-fixed open design question's own TSLA repro sat at
// 0.6%, where /inval and /spot round to the same displayed value) — this fixture uses a gap wide
// enough (6%) that the two formulas produce visibly different results, so a regression reintroducing
// the wrong denominator fails loudly rather than rounding away.
test("tradeManagerNarrativeSection: committed structural stop distance is computed as % of SPOT, not % of the stop level itself", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({ direction: "LONG", invalidationUnderlyingPx: 94 }),
      vector: { spot: 100, gexWalls: { callWalls: [], putWalls: [] } } as SwingPlayBriefContext["vector"],
    }),
    "open",
  );

  assert.ok(section);
  // Correct: |100-94|/100 = 6.0%. The bug's formula (|100-94|/94) would render 6.4%.
  assert.match(
    section!.body,
    /Structural stop \(committed\).*\(6\.0% away\)/i,
    `expected the spot-denominator 6.0%, got: ${section?.body}`,
  );
});

test("tradeManagerNarrativeSection: no committed structural stop bullet when the real level is absent (no regression)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({ direction: "LONG" }), // invalidationUnderlyingPx left undefined — honest absence
      vector: {
        spot: 349.63,
        gexWalls: { callWalls: [], putWalls: [{ strike: 330, gex: 1 }] },
      } as SwingPlayBriefContext["vector"],
    }),
    "open",
  );

  assert.ok(section);
  assert.match(section!.body, /Break watch.*330\.00/i);
  assert.doesNotMatch(section!.body, /Structural stop \(committed\)/i);
});

test("tradeManagerNarrativeSection: committed structural stop bullet never fires for a WATCH-bucket candidate (no committed position yet)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({ status: "WATCH", direction: "LONG", invalidationUnderlyingPx: 345.33 }),
      vector: {
        spot: 349.63,
        gexWalls: { callWalls: [], putWalls: [{ strike: 330, gex: 1 }] },
      } as SwingPlayBriefContext["vector"],
    }),
    "watch",
  );

  assert.ok(section);
  assert.doesNotMatch(section!.body, /Structural stop \(committed\)/i);
});

// FINDING (Ask Largo standing mandate, forensic batch 30, 2026-09-15): breakTrigger's support/
// resist predicates only recognized put_wall/dark_pool (support) and call_wall (resist) -- never
// "king" (the GEX king strike), even though collectFocalLevels already includes it in the same
// nearest-sorted `focal` array buildStructureLadder's riskTheOtherSide reads for the identical
// purpose. Live on CRWD (LONG, +149.8% P&L): riskTheOtherSide correctly named the GEX king at
// -2.41% as the real nearest structural risk, while the SAME payload's "Break watch" bullet (this
// function) cited the put wall at -19.4% -- 8x farther, and the brief's own two risk-level widgets
// disagreed with each other in the same response. Also live on RBLU, ABTC, APPX, CGEM, CRWL, DRIP
// (support side) and GOOG (resist side).
test("tradeManagerNarrativeSection: LONG Break watch considers the GEX king strike, not just put wall/dark pool (2026-09-15, live CRWD shape)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({ direction: "LONG" }),
      vector: {
        spot: 100,
        ladder: { rows: [{ strike: 97, isKing: true }] }, // -3% -- nearer than the put wall below
        gexWalls: { callWalls: [], putWalls: [{ strike: 80, gex: 1 }] }, // -20% -- farther, real risk is the king
      } as SwingPlayBriefContext["vector"],
    }),
    "open",
  );

  assert.ok(section);
  assert.match(section!.body, /Break watch.*97\.00/i, "must cite the nearer GEX king strike, not the farther put wall");
  assert.doesNotMatch(section!.body, /Break watch.*80\.00/i);
});

// FINDING (Ask Largo standing mandate, 2026-09-19, sibling of #5253): #5253 fixed breakTrigger's
// position-management wording ("exit or cut size") for a WATCH play at the resolveBreakInvalidation
// call site (envelope.invalidation), but left this "Trade manager read" narrative bullet -- built
// from the SAME breakTrigger() -- calling it without `preEntry`, so it kept the OPEN-only wording
// even for a play that has never been entered. Live repro (LITE, 2026-09-19, WATCH status): the
// top-level invalidation field correctly said "this setup is no longer live -- skip it" while this
// bullet still said "exit or cut size" for the identical play. #5253's PR body assumed this call
// site was "OPEN-only in production" -- it is not: play-brief-intel.ts's real caller passes the
// live bucket straight through, and only bucket==="closed" short-circuits before this line runs.
test("tradeManagerNarrativeSection: WATCH-bucket Break watch uses entry-appropriate wording, not 'exit or cut size' (2026-09-19, live LITE shape)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({ direction: "LONG", status: "WATCH" }),
      vector: {
        spot: 100,
        gexWalls: { callWalls: [], putWalls: [{ strike: 90, gex: 1 }] },
      } as SwingPlayBriefContext["vector"],
    }),
    "watch",
  );

  assert.ok(section);
  assert.match(section!.body, /Break watch.*90\.00.*this setup is no longer live — skip it/i);
  assert.doesNotMatch(section!.body, /exit or cut size/i);
  assert.doesNotMatch(section!.body, /cover shorts/i);
});

test("tradeManagerNarrativeSection: SHORT WATCH-bucket Break watch also uses entry-appropriate wording, not 'cover shorts'", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({ direction: "SHORT", status: "WATCH" }),
      vector: {
        spot: 100,
        gexWalls: { callWalls: [{ strike: 110, gex: 1 }], putWalls: [] },
      } as SwingPlayBriefContext["vector"],
    }),
    "watch",
  );

  assert.ok(section);
  assert.match(section!.body, /Break watch.*110\.00.*this setup is no longer live — skip it/i);
  assert.doesNotMatch(section!.body, /cover shorts/i);
});

test("tradeManagerNarrativeSection: OPEN-bucket Break watch still says 'exit or cut size' (no regression)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({ direction: "LONG", status: "OPEN" }),
      vector: {
        spot: 100,
        gexWalls: { callWalls: [], putWalls: [{ strike: 90, gex: 1 }] },
      } as SwingPlayBriefContext["vector"],
    }),
    "open",
  );

  assert.ok(section);
  assert.match(section!.body, /Break watch.*90\.00.*exit or cut size/i);
});

test("tradeManagerNarrativeSection: SHORT Break watch considers the GEX king strike, not just call wall", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({ direction: "SHORT" }),
      vector: {
        spot: 100,
        ladder: { rows: [{ strike: 103, isKing: true }] }, // +3% -- nearer than the call wall above
        gexWalls: { callWalls: [{ strike: 120, gex: 1 }], putWalls: [] }, // +20% -- farther
      } as SwingPlayBriefContext["vector"],
    }),
    "open",
  );

  assert.ok(section);
  assert.match(section!.body, /Break watch.*103\.00/i, "must cite the nearer GEX king strike, not the farther call wall");
  assert.doesNotMatch(section!.body, /Break watch.*120\.00/i);
});

// GAP FOUND (Ask Largo standing mandate, 2026-10-24): same omission as the dark-pool one above --
// narrateKing never stated its distance from spot either. Spot 100, king 103 -> +3.0% from spot.
test("tradeManagerNarrativeSection: GEX king narration states its distance from spot (2026-10-24)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({ direction: "LONG" }),
      vector: {
        spot: 100,
        ladder: { rows: [{ strike: 103, isKing: true }] },
        gexWalls: { callWalls: [], putWalls: [] },
      } as SwingPlayBriefContext["vector"],
    }),
    "open",
  );
  assert.ok(section);
  assert.match(section!.body, /\*\*GEX king 103\.00\*\* \(\+3\.0% from spot\) — largest gamma concentration/i);
});

test("tradeManagerNarrativeSection: dead-but-not-closed WATCH (extended past entry) suppresses 'Vector spot not wired' — matches #5620's dataFreshnessSection fix, blast radius", () => {
  // Live repro: SWING:NTAP, entryStatus EXTENDED_CHASE, status COMMIT (bucket "watch"). Without a
  // live spot this function used to fall through to degradedReadLine's "Live read — Vector spot
  // not wired on this tick" line even though the play is a dead WATCH candidate that
  // isSwingPlayStaleCheckExempt (entry-enterability.ts) already treats as exempt from every other
  // "is today's live desk state current" claim in this same envelope (dataFreshnessSection,
  // collectBriefUnavailableSources) — producing the exact narrative-vs-chip contradiction #5620
  // fixed for the sibling section (confidence: "every live source resolved cleanly" right next to
  // a narrative line claiming one didn't resolve).
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({ status: "WATCH", entryStatus: "EXTENDED_CHASE", setupState: "EXTENDED" }),
      vector: null,
      ecosystem: null,
    }),
    "watch",
  );

  if (section) {
    assert.doesNotMatch(section.body, /Vector spot not wired on this tick/i);
  }
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
  // BUG FIX (2026-10-21, Ask Largo standing mandate): this used to assert /180s old/ — Vector's
  // OWN dataAgeMs — even though every field this bullet actually renders (posture, flip, "short
  // gamma") is GEX-sourced here (Vector is stale, so resolveGammaPosture/flip both fell through to
  // the GEX fallback). That assertion encoded the exact bug a live TSLA repro caught: the caption
  // ages itself off a source (Vector) that contributed nothing to the content on screen. The
  // correct age is GEX's own `matrix_age_sec` (30s), not Vector's 180s.
  assert.match(section!.body, /30s old/i);
  assert.doesNotMatch(section!.body, /180s old/i);
  assert.match(section!.body, /short gamma/i);
  assert.doesNotMatch(section!.body, /Right now/i);
});

test("tradeManagerNarrativeSection: future-skewed GEX matrix age renders 'clock-skewed', never the literal 'Infinitys' (Largo C2, 2026-09-16; re-scoped 2026-10-21 to GEX's own age, the field this caption now sources from)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      vector: {
        spot: 100,
        gammaFlip: 98,
        dataAgeMs: Number.POSITIVE_INFINITY,
        freshness: "stale",
        regime: { posture: "long", label: "LONG GAMMA" },
      } as SwingPlayBriefContext["vector"],
      ecosystem: {
        ticker: "NRG",
        gex_positioning: {
          spot: 100,
          flip: 98,
          gamma_posture: "short",
          // A small future-skew (within WS_TIMESTAMP_FUTURE_TOLERANCE_MS=5s) keeps gexMatrixStale
          // false (so the GEX fallback content this bullet renders is unaffected) while still
          // producing a negative ageMs for ageSecondsLabel's own "clock-skewed" guard — the shape
          // this test exists to cover, now exercised through the field the caption actually reads.
          matrix_age_sec: -2,
          freshness: "cached",
        },
      } as SwingPlayBriefContext["ecosystem"],
    }),
    "open",
  );

  assert.ok(section);
  assert.match(section!.body, /Last snapshot/i);
  assert.match(section!.body, /\(~clock-skewed old\)/i);
  assert.doesNotMatch(section!.body, /Infinitys/i);
  assert.match(section!.body, /short gamma/i, "a slightly future-skewed-but-in-tolerance GEX read must still be usable content, not suppressed as stale");
});

// Live repro (2026-10-21, Ask Largo standing mandate): TSLA WATCH showed "Last snapshot
// (~10659s old) ... net GEX 422.1M · session +1.8%" while the SAME envelope's evidence[] array
// attributed that identical GEX reading to an 80s-old read -- dealerPostureLine captioned
// GEX-sourced content (regime/net-GEX/session bits, all gated on `!gexStale`) with Vector's own,
// much older, unrelated age. Vector and GEX ages are deliberately ~133x apart here so any
// regression (falling back to Vector's age) fails loudly rather than by a rounding coincidence.
test("tradeManagerNarrativeSection: dealer-posture caption ages itself off GEX, not Vector, when the rendered content is GEX-sourced (2026-10-21, live TSLA repro)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      vector: {
        spot: 380.45,
        dataAgeMs: 10_659_000,
        freshness: "stale",
      } as SwingPlayBriefContext["vector"],
      ecosystem: {
        ticker: "TSLA",
        gex_positioning: {
          spot: 380.45,
          flip: 379.17,
          gamma_posture: "long",
          net_gex: 422_100_000,
          change_pct: 0.018,
          matrix_age_sec: 80,
          freshness: "cached",
        },
      } as SwingPlayBriefContext["ecosystem"],
    }),
    "watch",
  );

  assert.ok(section);
  assert.match(section!.body, /Last snapshot/i);
  assert.match(section!.body, /\(~80s old\)/i, "must caption with GEX's own age (80s), the actual source of the content");
  assert.doesNotMatch(section!.body, /10659s old/i, "must never caption GEX-sourced content with Vector's unrelated, far-older age");
  assert.match(section!.body, /long gamma/i);
  assert.match(section!.body, /net GEX/i);
});

// Live repro (2026-10-21, Ask Largo standing mandate): TSLA:60 and CRWV:63 "Trade manager read"
// briefs each showed a "Data caveat — Vector Ns stale..." bullet immediately followed by a
// "Last snapshot (~Ns old) — spot ... dealers ... gamma ..." bullet with no label telling the
// reader the second bullet's content comes from a DIFFERENT feed (GEX, not Vector) -- reading as
// a contradiction ("Vector mysteriously refreshed from 8642s to 72s between two adjacent
// bullets"). The prior fix (#6437) corrected the AGE NUMBER the GEX-substitution branch captions
// itself with but never named GEX as the source. Assert the disambiguating clause is present on
// the GEX-substitution (Vector-stale) branch and ABSENT on the normal Vector-fresh branch, proving
// the fix is scoped to exactly the branch that needed it.
test("tradeManagerNarrativeSection: dealer-posture bullet names GEX as the source when substituting for stale Vector (2026-10-21, live TSLA/CRWV repro)", () => {
  const staleVectorSection = tradeManagerNarrativeSection(
    ctx({
      vector: {
        spot: 387.18,
        dataAgeMs: 8_642_000,
        freshness: "stale",
      } as SwingPlayBriefContext["vector"],
      ecosystem: {
        ticker: "TSLA",
        gex_positioning: {
          spot: 387.18,
          gamma_posture: "long",
          matrix_age_sec: 72,
          freshness: "cached",
        },
      } as SwingPlayBriefContext["ecosystem"],
    }),
    "open",
  );
  assert.ok(staleVectorSection);
  assert.match(staleVectorSection!.body, /Last snapshot/i);
  assert.match(
    staleVectorSection!.body,
    /dealer posture may lag spot/i,
    "the GEX-substitution branch must name GEX as the source, matching play-brief-intel.ts's established clause",
  );

  const freshVectorSection = tradeManagerNarrativeSection(
    ctx({
      vector: {
        spot: 387.18,
        gammaFlip: 380,
        dataAgeMs: 5_000,
        freshness: "live",
        regime: { posture: "long", label: "LONG GAMMA" },
      } as SwingPlayBriefContext["vector"],
    }),
    "open",
  );
  assert.ok(freshVectorSection);
  assert.match(freshVectorSection!.body, /Right now/i);
  assert.doesNotMatch(
    freshVectorSection!.body,
    /dealer posture may lag spot/i,
    "the normal Vector-fresh branch must not gain the GEX-substitution clause",
  );
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

test("tradeManagerNarrativeSection: unresolved posture still surfaces flip_nearest — live repro GOOG (crossings_far_from_spot)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      vector: null,
      ecosystem: {
        ticker: "GOOG",
        gex_positioning: {
          spot: 344.87,
          flip: null,
          gamma_posture: null,
          flip_crossings: 1,
          flip_nearest: 388.43,
          distance_to_nearest_flip_pct: -12.63,
        },
      } as SwingPlayBriefContext["ecosystem"],
    }),
    "open",
  );
  assert.ok(section);
  assert.match(section!.body, /dealer gamma posture not resolved on this read/i);
  // BUG FIX (2026-10-17): flip_nearest 388.43 sits ABOVE spot 344.87 (true distance +12.6%,
  // matching this file's own distPct convention) — the pre-fix expectation here (-12.6%) encoded
  // the sign-inverted raw gex-positioning.ts field verbatim; see nearestCrossingBit's fix comment.
  assert.match(
    section!.body,
    /chain's only crossing sits at \*\*388\.43\*\* \(\+12\.6% away\), too far from spot to call a stable regime/i,
  );
});

test("tradeManagerNarrativeSection: unresolved posture with no flip_nearest stays a plain message", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      vector: null,
      ecosystem: {
        ticker: "NRG",
        gex_positioning: {
          spot: 100,
          flip: null,
          gamma_posture: null,
          flip_crossings: 0,
          flip_nearest: null,
          distance_to_nearest_flip_pct: null,
        },
      } as SwingPlayBriefContext["ecosystem"],
    }),
    "open",
  );
  assert.ok(section);
  assert.match(section!.body, /dealer gamma posture not resolved on this read\./i);
  assert.doesNotMatch(section!.body, /chain's only crossing/i);
});

test("tradeManagerNarrativeSection: stale GEX matrix suppresses the unresolved-posture nearest-crossing bit too", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      vector: { spot: 344.87 } as SwingPlayBriefContext["vector"],
      ecosystem: {
        ticker: "GOOG",
        gex_positioning: {
          spot: 344.87,
          flip: null,
          gamma_posture: null,
          matrix_age_sec: 200,
          freshness: "cached",
          flip_crossings: 1,
          flip_nearest: 388.43,
          distance_to_nearest_flip_pct: -12.63,
        },
      } as SwingPlayBriefContext["ecosystem"],
    }),
    "open",
  );
  assert.ok(section);
  assert.match(section!.body, /dealer gamma posture not resolved on this read\./i);
  assert.doesNotMatch(section!.body, /chain's only crossing/i);
});

test(
  "tradeManagerNarrativeSection: dealer posture line's spot matches roundFloats' rounding, not " +
    "plain toFixed(2) — live repro SPCX 2026-09-21 (Ask Largo standing mandate)",
  () => {
    // 152.035 is the exact floating-point shape of the live SPCX repro: plain toFixed(2) rounds
    // DOWN to "152.03" (152.035 is actually stored as 152.03499999999999...) while roundFloats'
    // Math.round(n*100)/100 rounds UP to "152.04" — and envelope.levels/structureLadder.spot (both
    // built via levelsFromContext -> roundFloats at the response boundary) carry the SAME raw spot
    // as a plain number, so a narrative built with plain toFixed(2) would silently disagree with
    // the rest of the SAME response for the SAME fact. See fmt-money.test.ts's fmtPriceLevel suite
    // for the isolated unit proof; this test proves the real call site actually uses it.
    const section = tradeManagerNarrativeSection(
      ctx({
        vector: { spot: 152.035 } as SwingPlayBriefContext["vector"],
        ecosystem: {
          ticker: "SPCX",
          gex_positioning: {
            spot: 152.035,
            flip: 150,
            gamma_posture: "unknown",
            matrix_age_sec: 30,
            freshness: "cached",
          },
        } as SwingPlayBriefContext["ecosystem"],
      }),
      "open",
    );

    assert.ok(section);
    assert.match(section!.body, /Spot \*\*152\.04\*\*/, "must round like roundFloats (152.04), not plain toFixed(2) (152.03)");
    assert.doesNotMatch(section!.body, /Spot \*\*152\.03\*\*/);
  },
);

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

// narrateFlip used to pick "Lose"/"Reclaim" purely from `play.direction`, never checking which
// side of the flip spot was actually on — same class of bug as narrateMaxPain's own fix above
// (live RDDT repro, 2026-09-11). Live repro this time: the swing play-brief's "Watch levels"
// section (play-brief-intel.ts's sibling watchForSection) hit the identical bug for COIN, spot
// 174.98 well BELOW flip 183.49, direction LONG — "Lose gamma flip" when there was nothing left
// to lose. These four pin narrateFlip's own (direction × spot-side) combinations, gated within
// the same `Math.abs(distancePct) < 3` window narrateFlip requires to fire at all.
test("tradeManagerNarrativeSection: Gamma flip narration — LONG with spot ABOVE flip still says 'Lose'", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({ direction: "LONG" }),
      vector: {
        spot: 100,
        gammaFlip: 98,
        regime: { posture: "long", label: "LONG GAMMA" },
      } as SwingPlayBriefContext["vector"],
      ecosystem: {
        ticker: "INTC",
        gex_positioning: { spot: 100, flip: 98 },
      } as SwingPlayBriefContext["ecosystem"],
    }),
    "open",
  );
  assert.ok(section);
  assert.match(section!.body, /Lose \*\*98\.00\*\* → dealer posture turns against longs/);
});

// GAP FOUND (Ask Largo standing mandate, 2026-10-24): same omission as the dark-pool/GEX-king
// ones above -- narrateFlip never stated its distance from spot either. Spot 100, flip 98 ->
// -2.0% from spot.
test("tradeManagerNarrativeSection: gamma flip narration states its distance from spot (2026-10-24)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({ direction: "LONG" }),
      vector: {
        spot: 100,
        gammaFlip: 98,
        regime: { posture: "long", label: "LONG GAMMA" },
      } as SwingPlayBriefContext["vector"],
      ecosystem: {
        ticker: "INTC",
        gex_positioning: { spot: 100, flip: 98 },
      } as SwingPlayBriefContext["ecosystem"],
    }),
    "open",
  );
  assert.ok(section);
  assert.match(section!.body, /\*\*Gamma flip 98\.00\*\* \(-2\.0% from spot\) — regime line\./);
});

test("tradeManagerNarrativeSection: Gamma flip narration — LONG with spot BELOW flip says 'Reclaim', not 'Lose' an already-lost level", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({ direction: "LONG" }),
      vector: {
        spot: 98,
        gammaFlip: 100,
        regime: { posture: "short", label: "SHORT GAMMA" },
      } as SwingPlayBriefContext["vector"],
      ecosystem: {
        ticker: "INTC",
        gex_positioning: { spot: 98, flip: 100 },
      } as SwingPlayBriefContext["ecosystem"],
    }),
    "open",
  );
  assert.ok(section);
  assert.doesNotMatch(section!.body, /Lose \*\*100\.00\*\*/);
  assert.match(section!.body, /Reclaim \*\*100\.00\*\* → needed to restore dealer support for longs/);
});

test("tradeManagerNarrativeSection: Gamma flip narration — SHORT with spot ABOVE flip says 'Lose', needs to confirm the short (mirror of the LONG fix)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({ direction: "SHORT" }),
      vector: {
        spot: 100,
        gammaFlip: 98,
        regime: { posture: "long", label: "LONG GAMMA" },
      } as SwingPlayBriefContext["vector"],
      ecosystem: {
        ticker: "INTC",
        gex_positioning: { spot: 100, flip: 98 },
      } as SwingPlayBriefContext["ecosystem"],
    }),
    "open",
  );
  assert.ok(section);
  assert.doesNotMatch(section!.body, /Reclaim \*\*98\.00\*\*/);
  assert.match(section!.body, /Lose \*\*98\.00\*\* → needed to confirm the short thesis/);
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

// BUG FOUND (2026-09-20, Ask Largo standing mandate): resolveGammaPosture (play-brief-absence.ts)
// returns a real FOUR-value regime — "long"/"short"/"transition"/"unknown" — and "transition"
// (verdict.ts: spot within 0.1% of the gamma flip) is a genuinely resolved, real posture, not an
// absence. dealerPostureLine (this file) and chartTechnicalsSection (play-brief-intel.ts, "Dealer
// gamma regime: **transition** (near flip)") both already branch on it explicitly as its own third
// state. narrateKing/narrateMaxPain/narrateMagnet never got that same three-way branch — they only
// test `posture === "long"` and treat everything else (short, transition, null/unresolved) as one
// bucket. For narrateMaxPain specifically this is a factual misstatement under the Largo absence
// principle: it renders "not resolved on this read" for a posture that WAS resolved (to
// "transition"), the exact class of bug this file's own comments (narrateMaxPain/narrateKing/
// narrateMagnet doc comments above) already document being fixed twice for the long-vs-short case.
test("maxPainCoaching (via tradeManagerNarrativeSection): transition posture is a real resolved regime, must not read as unresolved", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      vector: {
        spot: 100,
        maxPain: 99,
        regime: { posture: "transition" },
      } as unknown as SwingPlayBriefContext["vector"],
      play: play({ direction: "LONG", exitPolicy: undefined }),
    }),
    "open",
  );
  assert.ok(section);
  assert.match(section!.body, /Max pain 99\.00/i);
  assert.doesNotMatch(
    section!.body,
    /not resolved on this read/i,
    "transition IS a resolved posture (dealers sitting at the gamma flip) — must not claim it is unresolved",
  );
  assert.match(section!.body, /transition|at (the )?gamma flip/i, "must name the real transition regime, not a generic fallback");
});

test("kingCoaching (via tradeManagerNarrativeSection): transition posture must not silently read as the acceleration/short framing", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      vector: {
        spot: 100,
        ladder: { rows: [{ strike: 103, isKing: true }] },
        regime: { posture: "transition" },
      } as unknown as SwingPlayBriefContext["vector"],
      play: play({ direction: "LONG", exitPolicy: undefined }),
    }),
    "open",
  );
  assert.ok(section);
  const kingLine = section!.body.split("\n").find((l) => /GEX king 103\.00/i.test(l));
  assert.ok(kingLine, "GEX king bullet must render");
  assert.match(kingLine!, /transition|at (the )?gamma flip/i, "the king bullet itself must name the real transition regime, not the generic acceleration/short framing");
});

test("magnetCoaching (via tradeManagerNarrativeSection): transition posture must not silently read as the acceleration/short framing", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      vector: {
        spot: 118.95,
        magnet: { strike: 134.37, distancePct: 13.0, pull: "up" },
        regime: { posture: "transition" },
      } as unknown as SwingPlayBriefContext["vector"],
      play: play({ direction: "LONG", exitPolicy: undefined }),
    }),
    "open",
  );
  assert.ok(section);
  const magnetLine = section!.body.split("\n").find((l) => /Gamma magnet 134\.37/i.test(l));
  assert.ok(magnetLine, "Gamma magnet bullet must render");
  assert.match(magnetLine!, /transition|at (the )?gamma flip/i, "the magnet bullet itself must name the real transition regime, not the generic acceleration/short framing");
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
  //
  // BUG FIX (Ask Largo standing mandate, 2026-10-20): this test used to pin "reclaim **$3.50**",
  // which was itself the bug — a premium stop is breached by the premium FALLING to it, not rising
  // back to it, for both directions alike (see the LONG branch a few lines above this block, which
  // already says "lose"). Updated to assert the corrected wording.
  assert.match(section!.body, /Break watch.*lose premium stop \*\*\$3\.50\*\*/i);
  assert.doesNotMatch(section!.body, /lose premium stop \*\*\+?\$1/);
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

// BUG FIX (Ask Largo standing mandate, 2026-10-25, live repro SWING:DKNG): the giveback bullets
// above (`mfeCaptureOutcome(play.pnlPct, play.peak, null)`) are computed from the identical
// `play.pnlPct` the Position section's "P&L:" line already flags via `optionMarkStaleCaveat` when
// the underlying bid/ask quote is aged — but `actionNarrative` had no `readMs`/staleness parameter
// at all, so neither giveback bullet ever carried the caveat. A member could read "P&L: -9.8%
// (stale ...)" in Position and, a few sections later, an unqualified "Round-tripped past
// breakeven ... was up X% at peak, now -9.8%" built off that exact same stale quote.
test("tradeManagerNarrativeSection: round-trip giveback bullet carries the same stale-quote caveat as the Position section's P&L line", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({
        status: "HOLD",
        recommendation: "HOLD",
        pnlPct: -10,
        peak: 132.7,
        markAsOf: "2026-09-05T18:00:00.000Z", // well before readMs below — past the stale bar
        markIsSync: false,
      }),
      readMs: Date.parse("2026-09-05T20:00:00.000Z"),
    }),
    "open",
  );
  assert.ok(section);
  assert.match(
    section!.body,
    /Round-tripped past breakeven.*was up \*\*133%\*\* at peak, now \*\*-10%\*\*.*_\(stale — same quote Mark flagged above\)_/,
    `expected the round-trip bullet to carry the same stale-quote caveat as Position's P&L line, got: ${section!.body}`,
  );
});

test("tradeManagerNarrativeSection: capture-branch giveback bullet carries the same stale-quote caveat as the Position section's P&L line", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({
        status: "HOLD",
        recommendation: "HOLD",
        pnlPct: 39.8,
        peak: 132.7,
        markAsOf: "2026-09-05T18:00:00.000Z",
        markIsSync: false,
      }),
      readMs: Date.parse("2026-09-05T20:00:00.000Z"),
    }),
    "open",
  );
  assert.ok(section);
  assert.match(
    section!.body,
    /Gave back \*\*70%\*\* of peak — consider protecting runner\.\s*_\(stale — same quote Mark flagged above\)_/,
    `expected the capture-branch bullet to carry the same stale-quote caveat, got: ${section!.body}`,
  );
});

// Live repro (CRWD SWING:CRWD:19, 2026-09-14): 50% already banked at +100%, runner round-tripped
// from +129.7% to -9.5% — Blended P&L (realized trim + open runner) was still +45.3%, a solid win.
// The unqualified "Round-tripped past breakeven ... consider protecting what's left" bullet reads
// as if the WHOLE position round-tripped into a loss with nothing protected — the exact ambiguity
// the sibling "Desk says TRIM" bullet already disambiguates via its own trimsFired===0 check (see
// the "Product-honesty gap" comment above) but this bullet never got the same treatment.
test("tradeManagerNarrativeSection: round-trip bullet distinguishes a banked-trim runner round-trip from a fully-exposed round-trip (live CRWD repro)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({
        status: "TRIM",
        recommendation: "TRIM",
        pnlPct: -9.5,
        peak: 129.7,
        exitPolicy: {
          policy: "trim_scale",
          hard_stop_pct: -60,
          target_pct: 200,
          trim_levels: [{ trigger_pct: 100, fraction: 0.5, premium: 33.3, fired: true }],
          runner_fraction: 0.5,
        },
      }),
    }),
    "open",
  );
  assert.ok(section);
  assert.match(
    section!.body,
    /Runner round-tripped past breakeven.*was up \*\*130%\*\* at peak, now \*\*-10%\*\*.*already banked at a profit/,
    `expected a banked-aware runner round-trip bullet, got: ${section!.body}`,
  );
  assert.doesNotMatch(
    section!.body,
    /\*\*Round-tripped past breakeven\*\* — was up/,
    "the unqualified (nothing-banked) wording must not fire once a trim has been banked",
  );
});

test("tradeManagerNarrativeSection: round-trip bullet keeps the unqualified wording when nothing has been banked (NRG-shape repro)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({
        status: "HOLD",
        recommendation: "HOLD",
        pnlPct: -10,
        peak: 132.7,
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
  assert.match(
    section!.body,
    /\*\*Round-tripped past breakeven\*\* — was up \*\*133%\*\* at peak, now \*\*-10%\*\* — consider protecting what's left\./,
  );
  assert.doesNotMatch(section!.body, /already banked at a profit/);
});

// BUG FIX (2026-09-12): `degradedReadLine` (the "Live read" fallback bullet, fires whenever Vector
// spot isn't wired — the SAME condition as the test above, which never overrides `vector`/
// `ecosystem`) independently restated the identical round-trip fact `actionNarrative` already
// renders unconditionally — live repro: CRWD OPEN/TRIM swing brief 2026-09-12, the fact appeared
// twice in one "Trade manager read" section. This test pins that the fact now appears exactly
// once even though both functions fire in this exact scenario (spot null, round_trip giveback).
test("tradeManagerNarrativeSection: round-trip fact appears exactly once even when the degraded 'Live read' fallback also fires (live CRWD repro)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({ status: "HOLD", recommendation: "TRIM", pnlPct: -10, peak: 130 }),
    }),
    "open",
  );
  assert.ok(section);
  assert.match(section!.body, /Live read/i, "the degraded fallback must still fire in this test (spot is null)");
  const occurrences = (section!.body.match(/round-tripped past breakeven/gi) ?? []).length;
  assert.equal(occurrences, 1, `expected the round-trip fact exactly once, found ${occurrences} in: ${section!.body}`);
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

// Live repro (CG SWING:CG:25, 2026-09-14): pnlPct +169.2%, unfired trim_levels[0].trigger_pct
// 100 — "next rail at +100%" reads as forward-looking ("coming up") when the rail is actually
// 69 points BEHIND current price, already cleared and simply not yet banked (per the comment
// above this branch: the trigger has already been crossed whenever rec is TRIM at all).
test("tradeManagerNarrativeSection: TRIM's rail bullet says 'already cleared', not 'next', once price has passed the unfired trigger", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({
        status: "TRIM",
        recommendation: "TRIM",
        pnlPct: 169.2,
        peak: 169.2,
        exitPolicy: {
          policy: "trim_scale",
          hard_stop_pct: -60,
          target_pct: 100,
          trim_levels: [{ trigger_pct: 100, fraction: 0.5, premium: 5.2, fired: false }],
          runner_fraction: 0.5,
        },
      }),
    }),
    "open",
  );
  assert.ok(section);
  assert.match(
    section!.body,
    /\*\*\+100%\*\* rail already cleared \(now \*\*\+169\.2%\*\*\), not yet banked/,
  );
  assert.doesNotMatch(section!.body, /next rail at/);
});

// Sibling: when price genuinely has NOT reached the unfired trigger yet (or pnlPct is
// unavailable), the original forward-looking "next rail at" framing is correct and must stay.
test("tradeManagerNarrativeSection: TRIM's rail bullet keeps 'next rail at' when price has NOT reached the trigger yet", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({
        status: "TRIM",
        recommendation: "TRIM",
        pnlPct: 42,
        peak: 42,
        exitPolicy: {
          policy: "trim_scale",
          hard_stop_pct: -60,
          target_pct: 100,
          trim_levels: [{ trigger_pct: 100, fraction: 0.5, premium: 5.2, fired: false }],
          runner_fraction: 0.5,
        },
      }),
    }),
    "open",
  );
  assert.ok(section);
  assert.match(section!.body, /next rail at \*\*\+100%\*\*/);
  assert.doesNotMatch(section!.body, /already cleared/);
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
//
// Fixture updated 2026-09-21 (Ask Largo standing mandate): the original NRG numbers
// (pnlPct=39.8, peak=132.7 -> capturePct 30%) sat BELOW both this function's 80% floor and
// actionNarrative's own 75% floor, so — unnoticed until now — this exact fixture was ALSO live
// evidence of the duplication bug fixed below (see the new test right after this one). Moved the
// fixture into the [75,80) band that's the only range where this bit is genuinely additive rather
// than an echo of actionNarrative's own "Gave back X% of peak" line, so this test still exercises
// the honest-relative-retracement math it was written for without asserting on since-fixed
// duplicate output.
test("tradeManagerNarrativeSection: degraded-read 'Live read' giveback clause also uses honest relative retracement (4th call site)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({ status: "HOLD", recommendation: "HOLD", pnlPct: 77, peak: 100 }),
    }),
    "open",
  );
  assert.ok(section);
  assert.match(section!.body, /Live read.*gave back \*\*23%\*\* from peak/, `expected ~23% relative giveback in Live read, got: ${section!.body}`);
});

// BUG FIX (2026-09-21, Ask Largo standing mandate): degradedReadLine's own "gave back X% from
// peak" clause fired for ANY capturePct < 80, which overlaps actionNarrative's identical "Gave
// back X% of peak" line for ANY capturePct < 75 — the two functions read the exact same
// mfeCaptureOutcome result, so below 75% capture BOTH rendered the same fact, and the section's
// `seen` de-dup (keyed on each line's first 48 chars) can't catch it because the two bullets open
// with different prose. Live repro: COIN SWING:COIN:1190 (committed swing position, 2026-09-21
// RTH) — pnlPct 115.2%, peak 178.5% -> capturePct 64.54%. The real served "Trade manager read"
// section carried "Gave back **35%** of peak — consider protecting runner." in the "Desk says
// TRIM" bullet, then "gave back **35%** from peak" again in the "Live read" bullet three lines
// later. This fixture reproduces the same shape off the file's own NRG numbers (capturePct 30%,
// well under both floors, previously exercised — unnoticed — by the test above before its
// fixture was moved).
test("tradeManagerNarrativeSection: degraded-read 'Live read' no longer duplicates actionNarrative's own giveback line below the 75% floor (live COIN repro)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({ status: "HOLD", recommendation: "HOLD", pnlPct: 39.8, peak: 132.7 }),
    }),
    "open",
  );
  assert.ok(section);
  const givebackMentions = (section!.body.match(/gave back \*\*70%\*\*/gi) ?? []).length;
  assert.equal(givebackMentions, 1, `expected the 70% giveback fact exactly once, got ${givebackMentions} in: ${section!.body}`);
  assert.doesNotMatch(section!.body, /Live read.*gave back/i, "below the 75% floor, Live read must defer to actionNarrative's own giveback line rather than repeating it");
});

// BUG FIX (Ask Largo standing mandate, 2026-10-07): the [75,80) `givebackBit` above divides the
// same runner-only `play.pnlPct` the round_trip branch (fixed 2026-09-14) and actionNarrative's
// own capture branch (fixed same day as this test) both divide — but never disclosed an
// already-banked trim tranche either. Same fixture shape (pnlPct 77, peak 100 -> capturePct 77%,
// squarely in the one band this bit is genuinely additive) with a fired trim added.
test("tradeManagerNarrativeSection: degraded-read 'Live read' giveback bit discloses an already-banked trim tranche", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({
        status: "HOLD",
        recommendation: "HOLD",
        pnlPct: 77,
        peak: 100,
        exitPolicy: {
          policy: "trim_scale",
          hard_stop_pct: -60,
          target_pct: 200,
          trim_levels: [{ trigger_pct: 50, fraction: 0.5, premium: 10, fired: true }],
          runner_fraction: 0.5,
        },
      }),
    }),
    "open",
  );
  assert.ok(section);
  assert.match(
    section!.body,
    /Live read.*gave back \*\*23%\*\* from the runner's own peak \(part already banked at a profit\)/,
    `expected a banked-aware Live-read giveback bit, got: ${section!.body}`,
  );
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

// BUG FIX (2026-09-15, Ask Largo standing mandate, forensic batch 33, live repro NN#32): the
// fallback "Break watch" line always framed the premium stop as a FUTURE risk ("lose premium
// stop $X -> cut size or exit"), even when play.execMark (the bid, always the honest exit fill
// for a swing play -- see executableFill's own doc comment) was already AT or THROUGH the stop
// right now. That fact already existed elsewhere in the brief (watchForSection's "no real
// cushion on the executable side" footnote) but never reached this reserved, always-surfaced
// bullet -- the one a member reading "HOLD" at the top would actually see as the risk headline.
test("tradeManagerNarrativeSection: Break watch says the stop is ALREADY breached when the executable bid is at/through it (live NN#32 shape)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({
        direction: "LONG",
        status: "HOLD",
        recommendation: "HOLD",
        mark: 1.13,
        execMark: 0.7,
        pnlPct: -42,
        exitPolicy: {
          trim_levels: [{ trigger_pct: 100, fired: false }],
          stop_premium: 0.78,
          target_premium: 3.9,
        },
      }),
    }),
    "open",
  );
  assert.ok(section);
  assert.match(
    section!.body,
    /Break watch — stop already breached on the executable side.*bid \*\*\$0\.70\*\*.*through your premium stop \*\*\$0\.78\*\*/i,
  );
  assert.doesNotMatch(section!.body, /Break watch.*lose premium stop/i, "must not use the forward-looking framing once the stop is already breached");
});

// BUG FIX (Ask Largo standing mandate, 2026-10-25, live repro EXPE: GET
// /api/market/swing/play-brief?playId=SWING:EXPE:2071 -- bid $0.00, ask $1.20, a real two-sided
// quote, not a missing one). `play.execMark` is null both when there's no bid at all AND when the
// bid is a confirmed genuine $0.00 -- executableFill() (terminal-ladder.ts) correctly never
// fabricates a fill at $0, so this bullet's `play.execMark != null` guard used to read a confirmed
// worthless bid identically to "we don't know the bid at all" and fell through to the softer
// forward-looking "Break watch -- lose premium stop" framing instead of this reserved
// already-breached bullet -- the single WORST real executable state getting WEAKER disclosure than
// the $0.70-bid NN case the test above pins. `play.execBidZero: true` (adapters.ts) distinguishes
// the two null-shaped cases.
test("tradeManagerNarrativeSection: Break watch says the stop is ALREADY breached for a CONFIRMED zero bid even though execMark itself is null (live EXPE repro)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({
        direction: "LONG",
        status: "HOLD",
        recommendation: "HOLD",
        mark: 0.6, // mid = (0 + 1.2) / 2 -- a real, live quote
        execMark: null, // executableFill() correctly never fabricates a fill at a zero bid
        execBidZero: true, // but the book IS real and the bid IS a confirmed $0.00
        pnlPct: -36.8,
        exitPolicy: {
          trim_levels: [{ trigger_pct: 100, fired: false }],
          stop_premium: 0.38,
          target_premium: 1.9,
        },
      }),
    }),
    "open",
  );
  assert.ok(section);
  assert.match(
    section!.body,
    /Break watch — stop already breached on the executable side.*bid \*\*\$0\.00\*\*.*through your premium stop \*\*\$0\.38\*\*/i,
    `confirmed $0.00 bid must render as already-breached, not the softer forward-looking framing -- got: ${section!.body}`,
  );
  assert.doesNotMatch(section!.body, /Break watch.*lose premium stop/i, "must not use the forward-looking framing once a confirmed zero bid is already through the stop");
});

// BUG FIX (Ask Largo standing mandate, 2026-10-26, live repro PHM, adversarially verified via
// background workflow): the already-breached bullet says the breach is happening "right now",
// priced off the exact same bid/ask/markAsOf snapshot every sibling quote-derived line in this
// brief discloses as stale when it's old -- but this one bullet never called
// optionMarkStaleCaveat, so it kept asserting freshness regardless of how stale the underlying
// quote actually was. Live PHM repro: a 2026-10-23 16:00 ET quote read on 2026-10-25/26 (2+ days
// stale) still said "right now" on the single most action-driving line in the brief ("exit or cut
// size"), while every other bullet in the same section/response correctly said "stale".
test("tradeManagerNarrativeSection: Break watch already-breached bullet carries the same stale-quote caveat as its sibling lines (live PHM repro)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      readMs: Date.parse("2026-10-26T01:00:00.000Z"), // 2+ days after markAsOf below
      play: play({
        direction: "LONG",
        status: "HOLD",
        recommendation: "HOLD",
        mark: 0.6,
        execMark: null,
        execBidZero: true,
        markAsOf: "2026-10-23T20:00:00.000Z", // well past the stale bar
        markIsSync: false,
        pnlPct: -100,
        exitPolicy: {
          trim_levels: [{ trigger_pct: 100, fired: false }],
          stop_premium: 0.4,
          target_premium: 2.0,
        },
      }),
    }),
    "open",
  );
  assert.ok(section);
  assert.match(
    section!.body,
    /Break watch — stop already breached on the executable side.*bid \*\*\$0\.00\*\*.*through your premium stop \*\*\$0\.40\*\* right now → exit or cut size\.\s*_\(stale — same quote Mark flagged above\)_/i,
    `already-breached bullet must carry the same staleness caveat its sibling lines carry, got: ${section!.body}`,
  );
});

// BUG FIX (Ask Largo standing mandate, 2026-10-26, live repro PANW SWING:PANW:67): degradedReadLine
// (the "Live read" fallback bullet, fires only when Vector/GEX spot isn't wired this tick) built
// its markBit by guarding ONLY the TRUE entry-fallback case (`optionMarkGenuinelyUnknown`, fixed
// 2026-09-14 above) -- it never called the shared `optionMarkStaleCaveat` helper for the far more
// common "real mark, but its `markAsOf` timestamp is old" case, even though every OTHER
// quote-derived line in the identical brief/section already does (Position section's own Mark/
// P&L lines; this same "Trade manager read" section's "Manage plan"/"Executable P&L" bullets; the
// "Break watch" already-breached bullet the test directly above this one pins for the exact same
// root cause at a sibling call site, #6756). Live PANW repro: Position section correctly flagged
// "Mark: **$19.45** ... _(stale)_" for a `markAsOf` 64+ hours old, and the same brief's "Manage
// plan"/"Executable P&L" bullets both carried the stale caveat for the identical $19.45 figure --
// but this "Live read" bullet rendered "mark **$19.45**" with no caveat at all.
test("tradeManagerNarrativeSection: degraded-read 'Live read' mark bullet carries the same stale-quote caveat as its sibling lines (live PANW repro)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      readMs: Date.parse("2026-10-26T12:24:00.000Z"), // 64+ hours after markAsOf below
      play: play({
        status: "HOLD",
        recommendation: "HOLD",
        mark: 19.45,
        markAsOf: "2026-10-23T20:00:00.000Z", // 2026-10-23 16:00 ET, well past the 18-min stale bar
        markIsSync: false,
        pnlPct: 9.9, // a real P&L basis -- not the entry-fallback echo case
        peak: 15,
        exitPolicy: {
          trim_levels: [{ trigger_pct: 100, fired: false }],
          stop_premium: 12,
          target_premium: 35.4,
        },
      }),
    }),
    "open",
  );
  assert.ok(section);
  assert.match(
    section!.body,
    /Live read.*mark \*\*\$19\.45\*\*\s*_\(stale — same quote Mark flagged above\)_/i,
    `degraded-read mark must carry the same staleness caveat its sibling lines carry, got: ${section!.body}`,
  );
});

// A fresh (non-stale) mark must render with no caveat at all -- optionMarkStaleCaveat returns ""
// when the mark isn't actually stale, so threading readMs through must be a no-op here.
test("tradeManagerNarrativeSection: degraded-read 'Live read' mark bullet carries no caveat when the mark is fresh", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      readMs: Date.parse("2026-10-26T12:24:00.000Z"),
      play: play({
        status: "HOLD",
        recommendation: "HOLD",
        mark: 19.45,
        markAsOf: "2026-10-26T12:20:00.000Z", // 4 minutes old -- well within the fresh window
        markIsSync: false,
        pnlPct: 9.9,
        peak: 15,
        exitPolicy: {
          trim_levels: [{ trigger_pct: 100, fired: false }],
          stop_premium: 12,
          target_premium: 35.4,
        },
      }),
    }),
    "open",
  );
  assert.ok(section);
  assert.match(section!.body, /Live read.*mark \*\*\$19\.45\*\*\. Levels refresh on next poll\./i);
  assert.doesNotMatch(section!.body, /Live read.*mark.*stale/i);
});

test("tradeManagerNarrativeSection: Break watch keeps the forward-looking framing when the executable bid is still above the stop", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({
        direction: "LONG",
        status: "HOLD",
        recommendation: "HOLD",
        mark: 1.13,
        execMark: 0.85, // above the 0.78 stop -- not yet breached
        pnlPct: -12,
        exitPolicy: {
          trim_levels: [{ trigger_pct: 100, fired: false }],
          stop_premium: 0.78,
          target_premium: 3.9,
        },
      }),
    }),
    "open",
  );
  assert.ok(section);
  assert.match(section!.body, /Break watch.*lose premium stop \*\*\$0\.78\*\*/i);
  assert.doesNotMatch(section!.body, /already breached/i);
});

test("tradeManagerNarrativeSection: SHORT Break watch also flags an already-breached executable stop", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({
        direction: "SHORT",
        status: "HOLD",
        recommendation: "HOLD",
        mark: 1.13,
        execMark: 0.7,
        pnlPct: -42,
        exitPolicy: {
          trim_levels: [{ trigger_pct: 100, fired: false }],
          stop_premium: 0.78,
          target_premium: 3.9,
        },
      }),
    }),
    "open",
  );
  assert.ok(section);
  assert.match(
    section!.body,
    /Break watch — stop already breached on the executable side.*bid \*\*\$0\.70\*\*.*through your premium stop \*\*\$0\.78\*\*/i,
  );
  assert.doesNotMatch(section!.body, /Break watch.*reclaim/i);
});

// BUG FIX (Ask Largo standing mandate, 2026-10-20): the SHORT forward-looking premium-stop
// fallback (no structural GEX level found, stop not yet breached) used to say "reclaim $X -> cover
// shorts", implying the trigger is the premium RISING back to X -- backwards. execBreached (used by
// the sibling test above) fires on a FALL to or through the stop, for both directions alike -- a
// swing play is always long premium regardless of direction. The LONG branch already says "lose"
// for the identical kind of value; this fixture (bid still above the stop, no vector/ecosystem spot
// data so breakTrigger finds no structural level) exercises the SHORT branch and pins the fix.
test("tradeManagerNarrativeSection: SHORT Break watch premium-stop fallback says 'lose', not 'reclaim' (the trigger is a fall, not a rise)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({
        direction: "SHORT",
        status: "HOLD",
        recommendation: "HOLD",
        mark: 1.13,
        execMark: 0.85, // above the 0.78 stop -- not yet breached
        pnlPct: -12,
        exitPolicy: {
          trim_levels: [{ trigger_pct: 100, fired: false }],
          stop_premium: 0.78,
          target_premium: 3.9,
        },
      }),
    }),
    "open",
  );
  assert.ok(section);
  assert.match(section!.body, /Break watch.*lose premium stop \*\*\$0\.78\*\*.*cover shorts/i);
  assert.doesNotMatch(section!.body, /Break watch.*reclaim/i);
  assert.doesNotMatch(section!.body, /already breached/i);
});

// BUG FIX (2026-10-17, Ask Largo standing mandate, live repro SWING:GTLB): every test above for
// the "stop already breached on the executable side" bullet uses a bare `ctx()` with no
// vector/ecosystem spot data, so `breakTrigger()` always returned null and the old `!breakLine`
// guard never actually got exercised against a real structural break. Live on GTLB, a put wall
// WAS present (breakTrigger found "lose 27.50"), which under the old guard silently swallowed the
// executable-breach headline entirely -- it only survived as a footnote elsewhere in the brief.
// This fixture supplies BOTH a structural put wall AND an executable-side breach to prove the two
// are independent, additive bullets, neither eclipsing the other.
test("tradeManagerNarrativeSection: executable-side stop breach still surfaces when a structural GEX break ALSO exists (live GTLB shape)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({
        direction: "LONG",
        status: "HOLD",
        recommendation: "HOLD",
        mark: 0.3,
        execMark: 0.1,
        pnlPct: -53.8,
        exitPolicy: {
          trim_levels: [{ trigger_pct: 100, fired: false }],
          stop_premium: 0.26,
          target_premium: 1.3,
        },
      }),
      vector: {
        spot: 52.75,
        gexWalls: { callWalls: [{ strike: 60, gex: 1 }], putWalls: [{ strike: 27.5, gex: 1 }] },
      } as SwingPlayBriefContext["vector"],
    }),
    "open",
  );
  assert.ok(section);
  // The structural GEX break is untouched -- still cites the put wall.
  assert.match(section!.body, /Break watch.*27\.50.*exit or cut size/i);
  // The executable-side breach gets its OWN bullet, not swallowed by the structural one above.
  assert.match(
    section!.body,
    /Break watch — stop already breached on the executable side.*bid \*\*\$0\.10\*\*.*through your premium stop \*\*\$0\.26\*\*/i,
  );
});

// BUG FIX (2026-09-14, Ask Largo standing mandate, live repro RKLX/PGY OPEN briefs, forensic
// batch 8): degradedReadLine's markBit rendered `play.mark` unconditionally whenever it was
// non-null, including the TRUE entry-fallback case (a fresh banger-lane row with no synced quote
// carries mark === entry, per horizonPlayFromBangerPosition). RKLX's real brief showed "Live
// read ... mark **$0.51**" (the entry premium) a few lines below a Position section correctly
// reading "Mark: **unknown** _(sync quote, no live price yet — do not read as flat)_" — the exact
// self-contradiction class `optionMarkGenuinelyUnknown` (play-brief-absence.ts) already guards at
// two sibling call sites (pnlSection's own "Mark: unknown" line, the "Premium stop rail" cushion)
// but never picked up here, a 3rd instance of the same root cause.
test("tradeManagerNarrativeSection: degraded-read 'Live read' omits mark entirely for the TRUE entry-fallback case (live RKLX/PGY repro)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({
        status: "HOLD",
        recommendation: "HOLD",
        mark: 0.51, // entry-fallback echo, not a real quote
        markIsSync: true,
        pnlPct: null, // the TRUE entry-fallback signature per optionMarkGenuinelyUnknown
        peak: null,
        exitPolicy: {
          trim_levels: [{ trigger_pct: 100, fired: false }],
          stop_premium: 0.3,
          target_premium: 1.5,
        },
      }),
    }),
    "open",
  );
  assert.ok(section);
  assert.match(section!.body, /Live read/i);
  assert.doesNotMatch(
    section!.body,
    /Live read.*mark \*\*\$/i,
    "a genuinely-unknown mark (entry-fallback echo) must never render as a confident dollar figure",
  );
});

// Same shape, but with a real (if untimestamped) mark distinct from entry — pnlPct is a real
// number, so optionMarkGenuinelyUnknown is false and the mark must still render, proving the fix
// above narrows to the true-fallback case rather than suppressing every synced-without-timestamp
// mark.
test("tradeManagerNarrativeSection: degraded-read 'Live read' still shows mark when markIsSync but pnlPct is a real number", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({
        status: "HOLD",
        recommendation: "HOLD",
        mark: 3.1,
        markIsSync: true,
        pnlPct: 12.5, // a real P&L basis exists -- the mark behind it is real too
        peak: 20,
        exitPolicy: {
          trim_levels: [{ trigger_pct: 100, fired: false }],
          stop_premium: 1.5,
          target_premium: 6,
        },
      }),
    }),
    "open",
  );
  assert.ok(section);
  assert.match(section!.body, /Live read.*mark \*\*\$3\.10\*\*/i);
});

// Live repro (SKHY WATCH brief, 2026-09-14): thesis already INVALIDATED pre-entry (never
// traded, never will be per this setup), yet a degraded-spot read rendered "Manage rails --
// trim ladder +100%. Honor stops on closing basis; bank trims into strength" -- open-position
// exit-management guidance for a setup that was never entered. railsFallback's own guard only
// checked whether "Manage plan" had already rendered, not the bucket -- and manageLifecycleCoaching
// unconditionally returns null for bucket==="watch", so that guard was ALWAYS true there, making
// this the de-facto WATCH-bucket path rather than the rare open-bucket edge case (a contract
// string with no parseable DTE) it was actually designed to cover.
test("tradeManagerNarrativeSection: WATCH bucket never shows railsFallback's open-position 'Manage rails' language", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({
        status: "HOLD",
        recommendation: "HOLD",
        thesisBreak: { level: "break", note: "structure invalidated — thesis broke pre-entry" },
        exitPolicy: {
          trim_levels: [{ trigger_pct: 100, fired: false }],
          stop_premium: 1.5,
          target_premium: 6,
        },
      }),
    }),
    "watch",
  );
  assert.ok(section);
  assert.doesNotMatch(section!.body, /Manage rails/i);
});

// Sibling: the genuine OPEN-bucket edge case (no DTE token to parse -> manageLifecycleCoaching
// returns null despite bucket==="open") must still fall back to railsFallback -- this is the
// case the guard was actually built for, and the fix must not remove it.
test("tradeManagerNarrativeSection: OPEN bucket still falls back to railsFallback when Manage plan has nothing to say", () => {
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
  assert.match(section!.body, /Manage rails/i);
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

// BUG FIX (Ask Largo standing mandate, 2026-10-15): `weight` used to be computed from
// `shown.length` (the join-string array, capped at 3 by `.slice(0,3)`) while the function's own
// comment always said the count was `reasons.length` — so whenever 4+ of the ~10 independently
// gated votes corroborated, the label understated the real count. This test stacks 4 independent
// reasons (HELIX flow, Night Hawk, 0DTE, EMA stack) and asserts the label says "4", not "3".
test("counterThesisLine: evidence-count label reflects the full reasons count, not the display-capped shown count", () => {
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
        zerodte_today: {
          session_date: "2026-09-05",
          direction: "short",
          score: 70,
          conviction: "high",
          status: "flagged",
          first_flagged_at: "2026-09-05T14:00:00Z",
        },
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
  assert.match(line!, /corroborated across 4 independent reads/i, "must count all 4 real reasons, not the 3 displayed");
  assert.doesNotMatch(line!, /corroborated across 3 independent reads/i, "must not understate the count to the display cap");
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

// BUG FIX (Ask Largo standing mandate, 2026-10-15): this function's own HELIX put/call-led gate
// used a 1.2x threshold while EVERY OTHER HELIX call/put-heavy check in this exact file (and its
// two sibling files, play-brief-intel.ts/play-brief.ts/play-brief-narrative-coaching.ts) uses 1.3x
// — `flowNarrative` (this file, the "HELIX tape" bullet landing in the SAME "Trade manager read"
// bullet list this function also feeds), `flowIntelSection`'s "Flow & positioning" bias label, and
// `crossDeskCoaching`'s "Cross-desk friction" conflict check all agree on 1.3x; only this one
// isolated call site drifted to 1.2x, with no comment explaining a deliberate difference (unlike
// every other place in this file that intentionally differs from a sibling, which documents why).
// At a ratio between 1.2x and 1.3x, the brief said two incompatible things about the identical
// flow numbers in the SAME section: `flowNarrative` labels the tape "balanced" (1.3x not cleared)
// while this function steelmanned "HELIX put-led" as a counter-thesis reason (1.2x cleared) —
// a visible self-contradiction a member could read in one document. Standardized on the 1.3x every
// other call site already uses rather than picking a third number.
test("counterThesisLine: HELIX put/call-led threshold matches flowNarrative's 1.3x — a ratio between 1.2x and 1.3x must not steelman a reason the sibling 'HELIX tape' bullet calls balanced", () => {
  const ecosystem = {
    ticker: "NRG",
    flow_feed_fresh: true,
    recent_flow: {
      window_hours: 24,
      print_count: 10,
      // put/call ratio = 1.25 — clears the old 1.2x gate but not the 1.3x every sibling uses.
      call_premium: 1_000_000,
      put_premium: 1_250_000,
      unknown_premium: 0,
    },
    nighthawk_recent: null,
    zerodte_today: null,
    gex_positioning: null,
    arsenal: null,
    vector_full_state: null,
  } as SwingPlayBriefContext["ecosystem"];

  const belowConsistentThreshold = counterThesisLine(ctx({ ecosystem }), play({ direction: "LONG" }), null);
  assert.equal(
    belowConsistentThreshold,
    null,
    "a 1.25x put/call ratio must not steelman HELIX put-led — flowNarrative's sibling bullet calls this same ratio 'balanced'",
  );

  // Past the shared 1.3x threshold, the reason must still fire — this only tightens the gate to
  // match the rest of the file, it doesn't disable the check.
  const aboveThreshold = counterThesisLine(
    ctx({
      ecosystem: {
        ...ecosystem,
        recent_flow: { ...ecosystem!.recent_flow!, call_premium: 1_000_000, put_premium: 1_350_000 },
      } as SwingPlayBriefContext["ecosystem"],
    }),
    play({ direction: "LONG" }),
    null,
  );
  assert.ok(aboveThreshold);
  assert.match(aboveThreshold!, /HELIX put-led/i);
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

// BUG FIX (same bug class as #4788, third call site): a committed iron condor's `direction` is
// NOMINAL provenance only (the fade side of the pin it came from, per EcosystemZeroDteTake's own
// doc comment) — the structure itself is delta-neutral, so comparing it against the swing's own
// direction is meaningless. crossDeskCoaching (play-brief-narrative-coaching.ts) and
// flowIntelSection (play-brief-intel.ts) already gate on `is_condor` before making this exact
// comparison; counterThesisLine did not, so a condor fade could render as a fabricated directional
// "0DTE short/long bias" counter-thesis reason.
test("counterThesisLine: condor 0DTE take must not steelman a directional counter-thesis reason (same bug class as #4788)", () => {
  const line = counterThesisLine(
    ctx({
      sessionDate: "2026-09-05",
      ecosystem: {
        ticker: "NRG",
        zerodte_today: {
          session_date: "2026-09-05",
          direction: "short",
          score: 78,
          conviction: "high",
          status: "flagged",
          first_flagged_at: "2026-09-05T14:00:00Z",
          is_condor: true,
        },
      } as SwingPlayBriefContext["ecosystem"],
    }),
    play({ direction: "LONG" }),
    118,
  );
  assert.equal(line, null, "a condor's nominal fade-side direction must not appear in counter-thesis");
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

// BUG FIX (2026-09-15, Ask Largo standing mandate, sibling of the play-brief.ts evidenceFromContext
// fix same day): counterThesisLine used to treat Vector's literal "unknown" regime posture as an
// equally-resolved answer to "long"/"short" (`vecPosture = vec?.regime?.posture ?? null`), which
// silently dropped a real, resolved, fresh GEX-matrix-fallback dealer-posture counter-thesis reason
// whenever Vector's own read landed on "unknown" — the exact resolveGammaPosture bug fixed on
// 2026-09-12 for other call sites, never ported here.
test("counterThesisLine: 'unknown' Vector regime posture falls through to fresh GEX posture, not silently dropped", () => {
  const line = counterThesisLine(
    ctx({
      vector: {
        regime: { posture: "unknown", label: "UNKNOWN" },
      } as SwingPlayBriefContext["vector"],
      ecosystem: {
        ticker: "TSM",
        gex_positioning: {
          spot: 419.48,
          gamma_posture: "short",
        },
      } as SwingPlayBriefContext["ecosystem"],
    }),
    play({ direction: "SHORT" }),
    419.48,
  );
  assert.ok(line, "expected a counter-thesis line from the fresh GEX-matrix posture fallback");
  assert.match(
    line!,
    /dealer short-gamma can squeeze shorts/,
    "must resolve posture from the fresh GEX matrix when Vector's own regime read is 'unknown'",
  );
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

// BUG FIX (2026-09-21, Ask Largo standing mandate — #5351/#5353 follow-up): counterThesisLine used
// to sample the wall clock with FIVE separate bare `Date.now()` calls instead of consulting
// `ctx.readMs` — the single canonical "now" `composeSwingPlayBrief` stamps once before any section
// builds. This test proves the threading without mocking global time: `vec.asOf` carries no
// `dataAgeMs`, so staleness falls through to the `readMs - Date.parse(vec.asOf)` branch
// (`vectorAgeStale`, play-brief-absence.ts) — set `ctx.readMs` to the SAME instant as `vec.asOf`
// (genuinely fresh, 0ms age) while the real wall clock (whatever `Date.now()` returns when this
// suite actually runs) is weeks later than that fixed 2026-09-05 fixture date. Pre-fix, the bare
// `Date.now()` calls judge `vec` stale off the real run-time clock and drop every Vector-sourced
// counter-thesis reason; post-fix, `ctx.readMs` correctly judges it fresh.
test("counterThesisLine: uses ctx.readMs, not the real wall clock, to judge Vector freshness", () => {
  const readMs = Date.parse("2026-09-05T20:00:00.000Z");
  const line = counterThesisLine(
    ctx({
      readMs,
      vector: {
        spot: 100,
        regime: { posture: "long", label: "LONG GAMMA" },
        asOf: "2026-09-05T20:00:00.000Z",
      } as SwingPlayBriefContext["vector"],
      ecosystem: null,
    }),
    play({ direction: "LONG" }),
    100,
  );
  assert.ok(line, "ctx.readMs-fresh Vector regime must steelman dealer-gamma counter-thesis");
  assert.match(line!, /dealer long-gamma pins rallies/);
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
    // regime must also be wired (real, non-"unread" value) for "real commit inputs wired means
    // this IS calibrated" to actually hold — 2026-09-22 fix: an omitted regime falls back to
    // regimeScore()'s "unread" default, now itself a recognized uncalibrated sentinel.
    regime: "momentum long",
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

// BUG FIX (2026-10-21, Ask Largo round-3 deep-dive, live repro TSLA): Theta budget transitions
// PURELY off DTE vs a fixed cliff/migration threshold (thetaBudgetScore, thesis-health.ts — "time
// decay is the whole point of the pillar"), with zero dependence on price, flow, or any other market
// signal. counterThesisLine used to push its fade into the SAME reasons[] array the "corroborated
// across N independent reads" weight label counts, so a position with exactly ONE real opposing
// signal (dealer long-gamma) plus a mechanically-expiring Theta pillar read as "corroborated across
// 2 independent reads" — inflating conviction with a fact that fires on the calendar alone, whether
// the position is winning or losing.
test("counterThesisLine: a mechanical, DTE-driven Theta budget fade no longer inflates 'corroborated across N independent reads'", () => {
  const thesisHealth = computeSwingThesisHealth({
    direction: "LONG",
    status: "HOLD",
    setupState: "TRIGGERED",
    entryStatus: "AT_TRIGGER",
    signalKinds: ["FLOW", "VECTOR"],
    regime: "momentum long",
    dte: 2,
    subLane: "TACTICAL",
    computedAtEt: "10:00:00",
  });
  assert.ok(thesisHealth);
  assert.equal(thesisHealthUncalibrated(thesisHealth), false, "sanity: real commit inputs wired means this IS calibrated");
  const thetaPillar = thesisHealth!.pillars.find((p) => p.label === "Theta budget");
  assert.equal(thetaPillar?.status, "faded", "sanity: dte=2 on TACTICAL genuinely fades the theta pillar");

  // ONE genuine market-side push (dealer long-gamma) alongside the mechanical theta fade above.
  const line = counterThesisLine(
    ctx({
      vector: { spot: 100, regime: { posture: "long", label: "LONG GAMMA" } } as SwingPlayBriefContext["vector"],
    }),
    play({ direction: "LONG", thesisHealth }),
    100,
  );
  assert.ok(line);
  assert.match(line!, /fading pillar \*\*Theta budget\*\*/, "the mechanical fact must still be shown");
  assert.match(line!, /dealer long-gamma pins rallies/, "the one genuine market read must still be shown");
  assert.match(
    line!,
    /a single, uncorroborated signal/i,
    `theta-budget fade must not count toward corroboration weight — got: ${line}`,
  );
  assert.doesNotMatch(line!, /corroborated across/i);
});

// A single-reason counter-thesis and a 3-reason one rendered with identical prose weight —
// "Counter-thesis (bear case) — <reason(s)>" either way — live-confirmed both shapes exist today
// (AAPL: 3 corroborating reasons; NRG/NN/META: exactly 1 each), so a member had no way to tell an
// isolated signal from a genuinely corroborated one without counting clauses themselves.
test("counterThesisLine: a single reason is labeled as uncorroborated, not silently equal-weighted", () => {
  const line = counterThesisLine(
    ctx({
      vector: { spot: 100, technicals: { emaStack: "down" } } as SwingPlayBriefContext["vector"],
    }),
    play({ direction: "LONG" }),
    100,
  );
  assert.ok(line);
  assert.match(line!, /a single, uncorroborated signal/i);
  assert.doesNotMatch(line!, /corroborated across/i);
  assert.match(line!, /bear EMA stack on chart/i);
});

test("counterThesisLine: 2+ reasons are labeled as corroborated, with the real count", () => {
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
  assert.match(line!, /corroborated across 3 independent reads/i);
  assert.doesNotMatch(line!, /a single, uncorroborated signal/i);
});

// GAP FIX (Ask Largo standing mandate, 2026-10-09, live repro GDDY committed position):
// technicalsBias() (play-brief-technicals.ts) — the SAME function technicalsCoaching uses to print
// "chart reads bearish (conflicts with swing direction)" two bullets above this one in the real
// brief — counts FOUR votes (EMA stack, MACD, VWAP side, structure direction), but counterThesisLine
// only ever checked EMA stack. A chart that turns bearish on MACD + structure alone (EMA merely
// "mixed", casting no vote) used to return NO counter-thesis reason at all, silently dropping real,
// already-computed, independently-voted evidence instead of steelmanning it like every sibling
// reason in this function. See the fix's own comment in play-brief-narrative.ts.
test("counterThesisLine: MACD + market-structure direction steelman the bear case even when EMA stack doesn't vote (2026-10-09)", () => {
  const line = counterThesisLine(
    ctx({
      vector: {
        spot: 103.19,
        technicals: {
          emaStack: "mixed",
          macd: "bear",
          structure: { type: "CHOCH", direction: "down", level: 103.17 },
        },
      } as SwingPlayBriefContext["vector"],
    }),
    play({ direction: "LONG" }),
    103.19,
  );
  assert.ok(line, "MACD+structure disagreement must steelman a counter-thesis, not return null");
  assert.match(line!, /Counter-thesis \(bear case\)/i);
  assert.match(line!, /bear MACD on chart/i);
  assert.match(line!, /bearish structure break \(CHOCH down\)/i);
  assert.match(line!, /corroborated across 2 independent reads/i);
});

test("counterThesisLine: SHORT play steelmans bull MACD + bullish structure break", () => {
  const line = counterThesisLine(
    ctx({
      vector: {
        spot: 50,
        technicals: {
          emaStack: "mixed",
          macd: "bull",
          structure: { type: "BOS", direction: "up", level: 49.5 },
        },
      } as SwingPlayBriefContext["vector"],
    }),
    play({ direction: "SHORT" }),
    50,
  );
  assert.ok(line);
  assert.match(line!, /Counter-thesis \(bull case\)/i);
  assert.match(line!, /bull MACD on chart/i);
  assert.match(line!, /bullish structure break \(BOS up\)/i);
});

test("counterThesisLine: stale Vector MACD/structure must not steelman chart read (Largo C2)", () => {
  const line = counterThesisLine(
    ctx({
      vector: {
        spot: 103.19,
        technicals: {
          emaStack: "mixed",
          macd: "bear",
          structure: { type: "CHOCH", direction: "down", level: 103.17 },
        },
        freshness: "stale",
        dataAgeMs: 180_000,
      } as SwingPlayBriefContext["vector"],
    }),
    play({ direction: "LONG" }),
    103.19,
  );
  assert.equal(line, null, "stale Vector MACD/structure must not appear in counter-thesis");
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

// Sibling gap to the Vector dedup above: crossDeskCoaching checks FOUR desks for conflicts (Night
// Hawk, 0DTE, Vector, HELIX — play-brief-narrative-coaching.ts lines ~878-879 push a HELIX
// put-led/call-led conflict off the exact same `trustedHelixFlow` input and 1.3x ratio
// counterThesisLine's own HELIX check uses), but the caller's dedup regex at this file's own
// `vectorConflictAlreadyNoted` call site only ever matched the literal word "Vector" — never
// "HELIX" — so counterThesisLine's separate, ungated HELIX push re-cited the identical flow
// numbers as a second, independent-sounding "corroborating read" whenever crossDeskCoaching named
// HELIX as the conflict (lead or demoted "rest"). Same NRG-class double-citation as the Vector
// case above, just on the sibling desk the original fix didn't cover.
test("tradeManagerNarrativeSection: Counter-thesis omits the HELIX reason when crossDeskCoaching already named it, but keeps other reasons", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({ direction: "LONG" }),
      ecosystem: {
        ticker: "NRG",
        flow_feed_fresh: true,
        recent_flow: {
          window_hours: 24,
          print_count: 10,
          // put/call ratio = 1.5 -- clears the shared 1.3x gate both crossDeskCoaching's "HELIX
          // put-led" conflict check and counterThesisLine's own HELIX reason use.
          call_premium: 1_000_000,
          put_premium: 1_500_000,
          unknown_premium: 0,
        },
        nighthawk_recent: null,
        zerodte_today: null,
        gex_positioning: { spot: 100, flip: 98, gamma_posture: "long", gex_king_strike: 100, call_wall: 101 },
        arsenal: null,
        vector_full_state: null,
      } as SwingPlayBriefContext["ecosystem"],
    }),
    "open",
  );
  assert.ok(section);
  const friction = (section!.body.match(/Cross-desk friction[^\n]*/g) ?? []);
  const counter = (section!.body.match(/Counter-thesis[^\n]*/g) ?? []);
  assert.equal(friction.length, 1, `expected one Cross-desk friction bullet, got: ${section!.body}`);
  assert.match(friction[0]!, /HELIX put-led/);
  assert.equal(counter.length, 1, `expected one Counter-thesis bullet, got: ${section!.body}`);
  // The HELIX-specific reason is dropped from Counter-thesis (already stated above in
  // "Cross-desk friction")...
  assert.doesNotMatch(counter[0]!, /HELIX put-led/);
  // ...but the independent call-wall reason survives, proving this isn't a blanket suppression.
  assert.match(counter[0]!, /call wall/);
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

// BUG FIX (Ask Largo standing mandate, 2026-10-08, live repro: PROF WATCH brief). Unlike the
// fixture above (where the live Vector put wall sits close to spot, at -3%, and survives the
// cap on nearest-first merit alone), a LONG breakout commonly has its resistance levels (call
// wall / GEX king / max pain) clustered NEAR spot while its one real support (put wall) sits much
// farther away. `collectFocalLevels` sorts nearest-first, so that far put wall is reliably the
// LAST entry the narration loop reaches — and on a ticker with a couple of extra coaching bullets
// ahead of it (short interest + a confluence node, both present here), the cap was already hit by
// the time the loop got there. Pre-fix, this produced a brief whose reserved "Break watch" bullet
// said "lose $70.00" with NO bullet anywhere in "Trade manager read" explaining what $70 even is —
// while two bullets were spent narrating call wall and GEX king, the same $105 strike, twice.
test("tradeManagerNarrativeSection: a distant put wall still gets its own bullet when it anchors Break watch, even past MAX_BULLETS (2026-10-08, live PROF shape)", () => {
  const vector = {
    spot: 100,
    gammaFlip: 98.5,
    maxPain: 105,
    vexFlip: 99.2,
    vexWalls: { callWalls: [{ strike: 104, gex: 1 }], putWalls: [{ strike: 70, gex: 1 }] },
    regime: { posture: "long", label: "LONG GAMMA" },
    // The one real support is FAR below spot (-30%) — last in the nearest-first sort — while
    // every resistance level clusters within a few percent of spot, exactly the PROF shape.
    gexWalls: { callWalls: [{ strike: 105, gex: 1 }], putWalls: [{ strike: 70, gex: 1 }] },
    proximity: { strike: 105, side: "call", callout: "within 5% of call wall" },
    wallEvents: [{ kind: "call_wall_shift", message: "call wall lifted to 105" }],
    magnet: { strike: 103, distancePct: 3, pull: "up" },
    confluenceZones: [{ center: 105, score: 8, kinds: ["gex", "max_pain"] }],
    expectedMove: { bands: [{ sigma: 1, low: 95.8, high: 104.2, movePts: 4.2 }] },
    technicals: { emaStack: "up", macd: "bull", vwapSide: "above", structure: "BOS up" },
    play: {
      headline: "POSITION · momentum long on continuation → target magnet 103",
      bias: "long",
      invalidation: "5m close < 98.50",
      thesis: "trend continuation",
    },
  } as SwingPlayBriefContext["vector"];

  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({
        status: "HOLD",
        recommendation: "HOLD",
        score: 63,
        exitPolicy: {
          trim_levels: [{ trigger_pct: 100, fired: false }],
          stop_premium: 0.04,
          target_premium: 0.2,
          time_stop_et: "16:00",
          runner_fraction: 0.5,
        },
      }),
      vector,
      ecosystem: {
        ticker: "PROF",
        recent_flow: null,
        gex_positioning: { spot: 100, flip: 98.5, gamma_posture: "long", gex_king_strike: 105 },
        arsenal: {
          fundamentals: { days_to_cover: 12.3, as_of: "2026-10-08T00:00:00.000Z" },
        },
        flow_feed_fresh: true,
        vector_full_state: null,
      } as SwingPlayBriefContext["ecosystem"],
      readMs: new Date("2026-10-08T23:54:00.000Z").getTime(),
    }),
    "open",
  );

  assert.ok(section);
  // The reserved Break watch bullet must still cite the real, far-below-spot put wall.
  assert.match(section!.body, /Break watch.*lose \*\*70\.00\*\*/i);
  // ...and that same level must ALSO have its own explanatory bullet in the body, not just a
  // bare price in the one reserved line — pre-fix, this assertion is exactly what failed: the
  // put wall bullet ("dealer support / put wall") was silently dropped by the MAX_BULLETS cap.
  assert.match(
    section!.body,
    /\*\*Put wall 70\.00\*\*.*dealer support \/ put wall/i,
    "the level Break watch depends on must have its own narrated bullet, not just a bare cited price",
  );
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

// Sibling gap to the expiry_risk fix directly above: time_stop is manage.ts's OTHER "thesis intact,
// force-manage anyway" rung (dead-money — stagnant underlying progress over enough sessions,
// thesis-progress.ts), not a DTE cliff and not a broken thesis, but the old bare "time stop hit"
// gave a member no way to tell it apart from a thesis/ladder event. Live repro 2026-09-11: NRG
// (SWING:NRG:34) hit its own time_stop rung while sitting on a real +15.3% premium gain (peak
// +132.7%) — "time stop hit" alone reads as inexplicable when the position is green.
test("tradeManagerNarrativeSection: SELL from time_stop states the dead-money reason, not a bare label", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({ recommendation: "SELL", manageReason: "time_stop", pnlPct: 15.3, peak: 132.7 }),
    }),
    "open",
  );

  assert.ok(section);
  assert.ok(
    section!.body.includes(
      "**Exit now** — time-based: held long enough that the underlying has stalled toward its target (thesis still intact). Flatten per manage engine.",
    ),
  );
  assert.doesNotMatch(section!.body, /^.*time stop hit.*$/m);
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

// GAP FOUND (2026-09-18, Ask Largo standing mandate): manage.ts's `evaluateSwingManagement`
// computes a full, specific prose reason for every verdict (the exact breached level) and
// manage-sync.ts persists it verbatim every tick (event_json.reason) — but until this fix nothing
// between that write and sellReasonClause ever read it back out, so a real structural-stop breach
// always rendered as the generic "thesis broke" above with no level/price, even when the specific
// sentence was sitting right there on the same snapshot. See TerminalPlay.manageReasonDetail.
test("tradeManagerNarrativeSection: SELL from a structural break with a persisted reason detail surfaces the SPECIFIC level, not just 'thesis broke'", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({
        recommendation: "SELL",
        manageReason: "structural_stop",
        manageReasonDetail: "underlying 145.20 ≤ structural stop 148.00 — LONG thesis broken in underlying terms",
        pnlPct: -12,
        peak: 5,
      }),
    }),
    "open",
  );

  assert.ok(section);
  assert.equal(
    section!.body.includes(
      "**Exit now** — underlying 145.20 ≤ structural stop 148.00 — LONG thesis broken in underlying terms. Flatten per manage engine.",
    ),
    true,
  );
  // The generic fallback must NOT also appear — the specific reason replaces it, not appends to it.
  assert.equal(/\*\*Exit now\*\* — thesis broke\./.test(section!.body), false);
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

// BUG FIX (2026-09-17, Ask Largo standing mandate): TRIM had the exact same "generic label
// regardless of the real rung" defect the SELL-side tests above were built to catch (FINDINGS
// 2026-09-10), just unfixed on this branch — "Desk says TRIM — next rail at +X%" fired for EVERY
// TAKE_PARTIAL rung, including the four that have nothing to do with the profit ladder. Live repro,
// 2026-09-17: CRWD SWING:CRWD:39 (manageReason catalyst_shift, peak +39.2%, nowhere near the +100%
// rail) and both AAPL SWING:AAPL:38/:37 (manageReason rel_strength_loss) all rendered the rail-only
// line with no disclosure of the real reason.
test("tradeManagerNarrativeSection: TRIM from catalyst_shift states the real reason, not just the untouched rail", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({
        recommendation: "TRIM",
        manageReason: "catalyst_shift",
        pnlPct: -16.3,
        peak: 39.2,
        exitPolicy: {
          policy: "trim_scale",
          hard_stop_pct: -60,
          target_pct: 100,
          trim_levels: [{ trigger_pct: 100, fraction: 0.5, premium: 17.675, fired: false }],
          runner_fraction: 0.5,
        },
      }),
    }),
    "open",
  );

  assert.ok(section);
  assert.match(section!.body, /\*\*Desk says TRIM\*\* — catalyst shifted against the thesis — next rail at \*\*\+100%\*\*/);
});

test("tradeManagerNarrativeSection: TRIM from rel_strength_loss states the real reason, not just the untouched rail", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({
        recommendation: "TRIM",
        manageReason: "rel_strength_loss",
        pnlPct: -8,
        peak: 8.4,
        exitPolicy: {
          policy: "trim_scale",
          hard_stop_pct: -60,
          target_pct: 100,
          trim_levels: [{ trigger_pct: 100, fraction: 0.5, premium: 6.125, fired: false }],
          runner_fraction: 0.5,
        },
      }),
    }),
    "open",
  );

  assert.ok(section);
  assert.match(section!.body, /\*\*Desk says TRIM\*\* — lost relative strength vs its benchmark — next rail at \*\*\+100%\*\*/);
});

test("tradeManagerNarrativeSection: TRIM from the profit ladder itself keeps the original rail-only line (no redundant reason clause)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({
        recommendation: "TRIM",
        manageReason: "profit_ladder",
        pnlPct: 105,
        peak: 129.7,
        exitPolicy: {
          policy: "trim_scale",
          hard_stop_pct: -60,
          target_pct: 200,
          trim_levels: [{ trigger_pct: 200, fraction: 0.5, premium: 33.3, fired: false }],
          runner_fraction: 0.5,
        },
      }),
    }),
    "open",
  );

  assert.ok(section);
  // Exactly one " — " clause (the rail itself) directly after "Desk says TRIM" — no reasonClause
  // inserted ahead of it for profit_ladder, which the rail text already fully explains.
  assert.match(section!.body, /\*\*Desk says TRIM\*\* — next rail at \*\*\+200%\*\*\./);
});

// BUG FIX (Ask Largo standing mandate, 2026-09-21): the same "generic label swallows the real
// manage.ts rung" defect the SELL-side (2026-09-10) and TRIM-side (2026-09-17) fixes above were
// built to catch has a third, previously-unfixed instance on the BUY side. manage.ts's
// `add_eligible` rung (thesis progressing ≥50% to target AND the option not underwater) maps to
// `SwingManageAction "ADD"`, which `recommendationFromManageAction` (adapters.ts) turns into
// `Recommendation "BUY"` for an already-OPEN position — but `actionNarrative`'s rec-branch only
// special-cased "TRIM" and "SELL"; every other value (including this live "BUY" case for an OPEN
// play) fell through to the generic HOLD branch ("Hold the line ... Let the trade work while
// structure holds"), which silently discards the desk's actual "consider adding" advisory a member
// would otherwise never see anywhere in the brief.
test("tradeManagerNarrativeSection: BUY (add_eligible) on an OPEN play states the add advisory, not generic HOLD", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({
        recommendation: "BUY",
        manageReason: "add_eligible",
        status: "OPEN",
        pnlPct: 22,
        peak: 24,
      }),
    }),
    "open",
  );

  assert.ok(section);
  assert.match(section!.body, /consider adding/i);
  assert.doesNotMatch(section!.body, /Hold the line/i);
});

test("tradeManagerNarrativeSection: never-rolled position gets no roll-history line (Largo C6 omission)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({ recommendation: "HOLD", pnlPct: 5 }),
      rollHistory: null,
    }),
    "open",
  );

  assert.ok(section);
  assert.doesNotMatch(section!.body, /Rolled/);
});

test("tradeManagerNarrativeSection: rolled-once position discloses the roll (open bucket)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({ recommendation: "HOLD", pnlPct: 5 }),
      rollHistory: {
        rollCount: 1,
        legs: [
          { rollSeq: 0, strike: 100, right: "C", expiry: "2026-08-15", committedAt: "2026-08-01T14:00:00.000Z" },
          { rollSeq: 1, strike: 110, right: "C", expiry: "2026-09-19", committedAt: "2026-08-20T15:30:00.000Z" },
        ],
        chainComposite: null,
      },
    }),
    "open",
  );

  assert.ok(section);
  assert.match(
    section!.body,
    /\*\*Rolled once\*\* — most recently from the \$100 call to the \$110 call on 2026-08-20, buying \*\*35d\*\* of extra runway\./,
  );
  assert.doesNotMatch(section!.body, /Full chain result/);
});

test("tradeManagerNarrativeSection: roll date is the ET session date, not the raw UTC calendar day (Largo C1)", () => {
  // Live defect (2026-09-15, Ask Largo standing mandate): rollHistoryLine() sliced
  // committedAt.toISOString() for its raw UTC calendar day instead of using the shared
  // etSessionDate() helper every other ET-date read in this codebase goes through (e.g.
  // siblingPositionsNote's identical field, play-brief.ts). Invisible for an RTH-hours commit
  // (same UTC/ET calendar day), but a commit near or after 8pm ET during EST straddles UTC
  // midnight -- this fixture (2026-01-20T02:00:00.000Z = Jan 19, 9pm EST) would have shown
  // "2026-01-20" pre-fix when the real ET session date is 2026-01-19.
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({ recommendation: "HOLD", pnlPct: 5 }),
      rollHistory: {
        rollCount: 1,
        legs: [
          { rollSeq: 0, strike: 100, right: "C", expiry: "2026-01-16", committedAt: "2026-01-05T14:00:00.000Z" },
          { rollSeq: 1, strike: 110, right: "C", expiry: "2026-02-20", committedAt: "2026-01-20T02:00:00.000Z" },
        ],
        chainComposite: null,
      },
    }),
    "open",
  );

  assert.ok(section);
  assert.match(
    section!.body,
    /on 2026-01-19,/,
    `roll date must be the ET session date (2026-01-19), not the raw UTC calendar day (2026-01-20) — got: ${section!.body}`,
  );
  assert.doesNotMatch(section!.body, /on 2026-01-20/);
});

test("tradeManagerNarrativeSection: rolled-twice position says 'Rolled 2 times' and cites only the LATEST roll (closed bucket)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({ status: "CLOSED", recommendation: "HOLD", pnlPct: 12 }),
      rollHistory: {
        rollCount: 2,
        legs: [
          { rollSeq: 0, strike: 90, right: "P", expiry: "2026-07-18", committedAt: "2026-07-01T14:00:00.000Z" },
          { rollSeq: 1, strike: 95, right: "P", expiry: "2026-08-15", committedAt: "2026-07-20T15:00:00.000Z" },
          { rollSeq: 2, strike: 100, right: "P", expiry: "2026-09-19", committedAt: "2026-08-25T16:00:00.000Z" },
        ],
        chainComposite: null,
      },
    }),
    "closed",
  );

  assert.ok(section);
  assert.match(
    section!.body,
    /\*\*Rolled 2 times\*\* — most recently from the \$95 put to the \$100 put on 2026-08-25, buying \*\*35d\*\* of extra runway\./,
  );
  assert.doesNotMatch(section!.body, /\$90/);
  assert.doesNotMatch(section!.body, /Full chain result/);
});

test("tradeManagerNarrativeSection: rolled-and-resolved chain also cites the REAL chain-composite result, not just the terminal leg (live repro INTC:35, 2026-09-15)", () => {
  // Live shape: terminal leg's own exit P&L (-33.2%, rendered elsewhere in the brief) materially
  // understated the chain's real result (-60.47% compounded, worst leg -40.83%, a loss) — this
  // sentence is the fix: cite the composite as plain text, never blended with the terminal leg's
  // own price/peak/trough numbers (the exact pairing that caused the prior peak/composite bug).
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({ status: "CLOSED", recommendation: "HOLD", pnlPct: -33.2 }),
      rollHistory: {
        rollCount: 1,
        legs: [
          { rollSeq: 0, strike: 91, right: "P", expiry: "2026-08-15", committedAt: "2026-08-01T14:00:00.000Z" },
          { rollSeq: 1, strike: 90, right: "P", expiry: "2026-09-19", committedAt: "2026-08-20T15:30:00.000Z" },
        ],
        chainComposite: {
          rootPositionId: 30,
          legs: 2,
          gradedLegs: 2,
          wins: 0,
          losses: 2,
          allLegsWon: false,
          outcome: "loss",
          chainResolved: true,
          worstLegPnlPct: -40.83,
          sumPnlPct: -74.02,
          compoundedReturnPct: -60.47,
          low_n: true,
        },
      },
    }),
    "closed",
  );

  assert.ok(section);
  assert.match(
    section!.body,
    /\*\*Rolled once\*\* — most recently from the \$91 put to the \$90 put on 2026-08-20, buying \*\*35d\*\* of extra runway\./,
  );
  assert.match(section!.body, /Full chain result: \*\*-60\.5% compounded\*\* \(loss, worst leg -40\.8%\)/);
});

test("tradeManagerNarrativeSection: rolled but still-open chain (chainComposite null) omits the composite sentence, never fabricates one", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({ recommendation: "HOLD", pnlPct: 5 }),
      rollHistory: {
        rollCount: 1,
        legs: [
          { rollSeq: 0, strike: 100, right: "C", expiry: "2026-08-15", committedAt: "2026-08-01T14:00:00.000Z" },
          { rollSeq: 1, strike: 110, right: "C", expiry: "2026-09-19", committedAt: "2026-08-20T15:30:00.000Z" },
        ],
        // chain hasn't actually resolved yet (most recent leg still open) — loadRollHistory only
        // ever populates chainComposite once composite.chainResolved is true, so this is the real
        // shape a still-open rolled position gets, not a contrived edge case.
        chainComposite: null,
      },
    }),
    "open",
  );

  assert.ok(section);
  assert.match(section!.body, /\*\*Rolled once\*\*/);
  assert.doesNotMatch(section!.body, /Full chain result/);
});

// Ask Largo round 18 (2026-09-18): `rollRunwayExtensionDays` — the "a roll buys TIME" gap.
// `SwingRollHistoryLeg.expiry` has been on the type since the roll-history disclosure first
// shipped but was never read by `rollHistoryLine` — the narrative said WHAT strike/right the
// position rolled to but never disclosed the runway gained, despite `roll-plan.ts`'s own module
// header naming that as the entire point of a roll ("A ROLL BUYS TIME... never roll flat/nearer",
// enforced live by `buildRollChild`'s `pick.dte > parentDte + buffer` gate).

test("rollRunwayExtensionDays: computes the calendar-day gap between two YYYY-MM-DD expiries", () => {
  assert.equal(rollRunwayExtensionDays("2026-08-15", "2026-09-19"), 35);
  assert.equal(rollRunwayExtensionDays("2026-07-18", "2026-08-15"), 28);
});

test("rollRunwayExtensionDays: null-honest on missing, unparseable, or non-positive input — never fabricates or claims a backwards roll", () => {
  assert.equal(rollRunwayExtensionDays(null, "2026-09-19"), null);
  assert.equal(rollRunwayExtensionDays("2026-08-15", null), null);
  assert.equal(rollRunwayExtensionDays("not-a-date", "2026-09-19"), null);
  // Same expiry (flat roll) or a nearer one (should never happen live — buildRollChild gates it —
  // but this function must fail closed, not print a claimed "0d" or negative "extra runway").
  assert.equal(rollRunwayExtensionDays("2026-08-15", "2026-08-15"), null);
  assert.equal(rollRunwayExtensionDays("2026-09-19", "2026-08-15"), null);
});

test("tradeManagerNarrativeSection: roll-history line discloses the runway the roll bought, not just the strike/right change", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({ recommendation: "HOLD", pnlPct: 5 }),
      rollHistory: {
        rollCount: 1,
        legs: [
          { rollSeq: 0, strike: 100, right: "C", expiry: "2026-08-15", committedAt: "2026-08-01T14:00:00.000Z" },
          { rollSeq: 1, strike: 110, right: "C", expiry: "2026-09-19", committedAt: "2026-08-20T15:30:00.000Z" },
        ],
        chainComposite: null,
      },
    }),
    "open",
  );

  assert.ok(section);
  assert.match(section!.body, /buying \*\*35d\*\* of extra runway/);
});

test("tradeManagerNarrativeSection: roll-history line omits the runway clause (never a fabricated day count) when a leg's expiry is missing", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({ recommendation: "HOLD", pnlPct: 5 }),
      rollHistory: {
        rollCount: 1,
        legs: [
          { rollSeq: 0, strike: 100, right: "C", expiry: null, committedAt: "2026-08-01T14:00:00.000Z" },
          { rollSeq: 1, strike: 110, right: "C", expiry: "2026-09-19", committedAt: "2026-08-20T15:30:00.000Z" },
        ],
        chainComposite: null,
      },
    }),
    "open",
  );

  assert.ok(section);
  assert.match(section!.body, /\*\*Rolled once\*\* — most recently from the \$100 call to the \$110 call on 2026-08-20\./);
  assert.doesNotMatch(section!.body, /extra runway/);
});

// BUG FIX (Ask Largo standing mandate, #5351 readMs-anchor sweep follow-up): tradeManagerNarrativeSection
// — the brief's MAIN narrative section — sampled a fresh Date.now() for its Vector/GEX staleness
// checks instead of consulting ctx.readMs, even though ctx is a required parameter here. Same
// fixed-clock proof technique as counterThesisLine's own #5351-follow-up test above: vec.asOf
// carries no dataAgeMs, so staleness falls through to the readMs-dependent branch. ctx.readMs is
// set to the SAME instant as vec.asOf (genuinely fresh, 0ms age) while the real wall clock (this
// suite's actual run time) is weeks later — pre-fix, the bare Date.now() call judges vec stale off
// the real clock and drops the dealer-posture line; post-fix, ctx.readMs correctly judges it fresh.
test("tradeManagerNarrativeSection: uses ctx.readMs, not the real wall clock, to judge Vector/GEX freshness", () => {
  const readMs = Date.parse("2026-09-05T20:00:00.000Z");
  const section = tradeManagerNarrativeSection(
    ctx({
      readMs,
      vector: {
        spot: 100,
        gammaFlip: 98,
        regime: { posture: "long", label: "LONG GAMMA" },
        asOf: "2026-09-05T20:00:00.000Z",
      } as SwingPlayBriefContext["vector"],
      ecosystem: null,
    }),
    "open",
  );
  assert.ok(section);
  assert.match(
    section!.body,
    /long gamma/i,
    "ctx.readMs-fresh Vector regime must render dealer posture, not read as stale off the real wall clock",
  );
});

// BUG FIX (Ask Largo standing mandate, 2026-10-07): the "Gave back X% of peak" capture-branch
// giveback line divides the SAME runner-only `play.pnlPct` the round_trip branch above divides
// (both read `mfeCaptureOutcome(play.pnlPct, play.peak, null)`) — but the round_trip branch was
// fixed 2026-09-14 (live CRWD repro, see the test above) to disclose an already-banked trim
// tranche, while this sibling capture branch never got the same treatment. Repro: 50% banked at
// the +100% trim rail, runner pulls back to +20% off a +130% peak — capturePct ≈ 15.4%, firing
// "Gave back 85% of peak" with no qualification, reading as if the WHOLE position gave back 85%
// when the true blended return (50%×100% + 50%×20%) is +60%, a solid win.
test("tradeManagerNarrativeSection: capture-branch giveback line discloses an already-banked trim tranche (not just the round_trip branch)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({
        status: "HOLD",
        recommendation: "HOLD",
        pnlPct: 20,
        peak: 130,
        exitPolicy: {
          policy: "trim_scale",
          hard_stop_pct: -60,
          target_pct: 200,
          trim_levels: [{ trigger_pct: 100, fraction: 0.5, premium: 33.3, fired: true }],
          runner_fraction: 0.5,
        },
      }),
    }),
    "open",
  );
  assert.ok(section);
  assert.match(
    section!.body,
    /Gave back \*\*85%\*\* of the runner since peak.*already banked at a profit/,
    `expected a banked-aware capture giveback bullet, got: ${section!.body}`,
  );
  assert.doesNotMatch(
    section!.body,
    /Gave back \*\*85%\*\* of peak — consider protecting runner\./,
    "the unqualified (nothing-banked) wording must not fire once a trim has been banked",
  );
});

test("tradeManagerNarrativeSection: capture-branch giveback line keeps the unqualified wording when nothing has been banked", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({
        status: "HOLD",
        recommendation: "HOLD",
        pnlPct: 20,
        peak: 130,
        exitPolicy: {
          policy: "trim_scale",
          hard_stop_pct: -60,
          target_pct: 200,
          trim_levels: [{ trigger_pct: 100, fraction: 0.5, premium: 33.3, fired: false }],
          runner_fraction: 0.5,
        },
      }),
    }),
    "open",
  );
  assert.ok(section);
  assert.match(section!.body, /Gave back \*\*85%\*\* of peak — consider protecting runner\./);
  assert.doesNotMatch(section!.body, /already banked at a profit/);
});

// BUG FIX (Ask Largo standing mandate, 2026-10-14, live repro: AMD WATCH brief). narrateWall
// picked its "action" text purely from `near = |distancePct| < 1.5`, never checking which SIDE of
// spot the level actually sits on. A put wall's canonical side is BELOW spot (real support); a
// call wall's is ABOVE (real resistance). Once price has actually traded through the level —
// e.g. a put wall now sits ABOVE spot because price fell below what used to be support — the
// level is on the WRONG side of its canonical relationship, and picking on `near` alone produced
// the exact opposite of reality: "support underfoot — hold while above" when the support had
// already broken. Live AMD repro (2026-10-14, GET /api/market/swing/play-brief?...ticker=AMD):
// spot 558.15, put wall 560.00 (+0.3% from spot, so "near"), direction LONG — this function wrote
// "Put wall 560.00 (+0.3% from spot) — dealer support / put wall. Support underfoot — hold while
// above." in the SAME brief whose own "Vector desk: starred level" bullet, two lines later, read
// "Lost the 560 put wall (0.33% overhead) — support gave way; dealers stop cushioning, watch for
// continuation lower." — two bullets in one section flatly contradicting each other about whether
// the exact same level is currently holding or already broken.
test("tradeManagerNarrativeSection: LONG put wall ABOVE spot reads as broken support, not 'hold while above' (2026-10-14, live AMD repro)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      vector: {
        spot: 558.15,
        gammaFlip: 557.55,
        regime: { posture: "short", label: "SHORT GAMMA" },
        gexWalls: {
          // Put wall now ABOVE spot (+0.3%) -- support already lost, not "near and holding".
          putWalls: [{ strike: 560, gex: 1 }],
          callWalls: [{ strike: 620, gex: 1 }],
        },
      } as SwingPlayBriefContext["vector"],
      ecosystem: {
        ticker: "AMD",
        recent_flow: null,
        gex_positioning: { spot: 558.15, flip: 557.55, gamma_posture: "short", gex_king_strike: 560 },
        arsenal: null,
        flow_feed_fresh: true,
        vector_full_state: null,
      } as SwingPlayBriefContext["ecosystem"],
    }),
    "open",
  );

  assert.ok(section);
  const wallLine = section!.body.split("\n").find((l) => l.includes("**Put wall 560.00**"));
  assert.ok(wallLine, "expected a narrated Put wall 560.00 bullet");
  assert.doesNotMatch(
    wallLine!,
    /support underfoot — hold while above/i,
    "price is BELOW a put wall that is now overhead -- it is not holding anything up",
  );
  assert.match(
    wallLine!,
    /support broken|already broke|no longer holding|now overhead/i,
    "an above-spot put wall on a LONG must read as broken support, not a healthy floor",
  );
});

test("tradeManagerNarrativeSection: LONG call wall BELOW spot reads as cleared resistance, not 'trim if rejected' (2026-10-14)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      vector: {
        spot: 100,
        gammaFlip: 98,
        regime: { posture: "long", label: "LONG GAMMA" },
        gexWalls: {
          // Call wall now BELOW spot (-0.5%) -- resistance already cleared on the way up.
          callWalls: [{ strike: 99.5, gex: 1 }],
          putWalls: [{ strike: 90, gex: 1 }],
        },
      } as SwingPlayBriefContext["vector"],
      ecosystem: {
        ticker: "TEST",
        recent_flow: null,
        gex_positioning: { spot: 100, flip: 98, gamma_posture: "long", gex_king_strike: 99.5 },
        arsenal: null,
        flow_feed_fresh: true,
        vector_full_state: null,
      } as SwingPlayBriefContext["ecosystem"],
    }),
    "open",
  );

  assert.ok(section);
  const wallLine = section!.body.split("\n").find((l) => l.includes("**Call wall 99.50**"));
  assert.ok(wallLine, "expected a narrated Call wall 99.50 bullet");
  assert.doesNotMatch(
    wallLine!,
    /into strength — trim if rejected here/i,
    "a call wall already BELOW spot has been cleared, not approached from below",
  );
  assert.match(
    wallLine!,
    /cleared|reclaimed|already broke/i,
    "a below-spot call wall on a LONG must read as already-cleared resistance",
  );
});

test("tradeManagerNarrativeSection: SHORT call wall BELOW spot reads as reclaimed resistance, not 'rejection zone' (2026-10-14)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({ direction: "SHORT" }),
      vector: {
        spot: 100,
        gammaFlip: 102,
        regime: { posture: "short", label: "SHORT GAMMA" },
        gexWalls: {
          // Call wall now well BELOW spot (-6%) -- the short's own resistance already broke.
          callWalls: [{ strike: 94, gex: 1 }],
          putWalls: [{ strike: 85, gex: 1 }],
        },
      } as SwingPlayBriefContext["vector"],
      ecosystem: {
        ticker: "TEST",
        recent_flow: null,
        gex_positioning: { spot: 100, flip: 102, gamma_posture: "short", gex_king_strike: 94 },
        arsenal: null,
        flow_feed_fresh: true,
        vector_full_state: null,
      } as SwingPlayBriefContext["ecosystem"],
    }),
    "open",
  );

  assert.ok(section);
  const wallLine = section!.body.split("\n").find((l) => l.includes("**Call wall 94.00**"));
  assert.ok(wallLine, "expected a narrated Call wall 94.00 bullet");
  assert.doesNotMatch(
    wallLine!,
    /target zone for shorts/i,
    "a call wall already behind the short (below spot) is not still a target ahead of it",
  );
  assert.match(
    wallLine!,
    /reclaimed|broken|already broke/i,
    "a below-spot call wall on a SHORT must read as already-broken resistance, risk to the thesis",
  );
});

test("tradeManagerNarrativeSection: SHORT put wall ABOVE spot reads as already broken, not 'invalidates weak short' (2026-10-14)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({ direction: "SHORT" }),
      vector: {
        spot: 100,
        gammaFlip: 102,
        regime: { posture: "short", label: "SHORT GAMMA" },
        gexWalls: {
          // Put wall now ABOVE spot (+3%) -- the short already traded through its own downside target.
          putWalls: [{ strike: 103, gex: 1 }],
          callWalls: [{ strike: 110, gex: 1 }],
        },
      } as SwingPlayBriefContext["vector"],
      ecosystem: {
        ticker: "TEST",
        recent_flow: null,
        gex_positioning: { spot: 100, flip: 102, gamma_posture: "short", gex_king_strike: 103 },
        arsenal: null,
        flow_feed_fresh: true,
        vector_full_state: null,
      } as SwingPlayBriefContext["ecosystem"],
    }),
    "open",
  );

  assert.ok(section);
  const wallLine = section!.body.split("\n").find((l) => l.includes("**Put wall 103.00**"));
  assert.ok(wallLine, "expected a narrated Put wall 103.00 bullet");
  assert.doesNotMatch(
    wallLine!,
    /support too close — invalidates weak short/i,
    "a put wall already behind the short (above spot) has already broken, it is not a nearby invalidation risk ahead",
  );
  assert.match(
    wallLine!,
    /already broke|broken|cleared/i,
    "an above-spot put wall on a SHORT must read as already-cleared downside, not a future invalidation risk",
  );
});

// BUG FIX (Ask Largo standing mandate, 2026-10-20): the LONG branch of resolveInvalidationFocalLevel
// treats put_wall, dark_pool, AND king as candidate invalidation levels; the SHORT branch omitted
// dark_pool entirely, breaking this function's own documented guarantee ("every section quoting the
// one structural level that matters routes through here so they can never disagree") for any SHORT
// play whose nearest real structure above spot happens to be a dark-pool print rather than a call
// wall or GEX king.
test("resolveInvalidationFocalLevel: a SHORT candidate now includes a resistance-side dark_pool level, matching the LONG branch's treatment", () => {
  const focal: FocalLevel[] = [
    { price: 106, kind: "dark_pool", label: "Dark pool 106.00", distancePct: 0.8 },
    { price: 112, kind: "call_wall", label: "Call wall 112.00", distancePct: 6.0 },
  ];
  const level = resolveInvalidationFocalLevel(play({ direction: "SHORT" }), focal);
  assert.ok(level, "a resistance-side dark_pool print must be selectable for a SHORT candidate");
  assert.equal(level?.kind, "dark_pool");
  assert.equal(level?.price, 106);
});

test("resolveInvalidationFocalLevel: a SHORT candidate still ignores a dark_pool level on the support side (below spot)", () => {
  const focal: FocalLevel[] = [
    { price: 95, kind: "dark_pool", label: "Dark pool 95.00", distancePct: -5.0 },
    { price: 112, kind: "call_wall", label: "Call wall 112.00", distancePct: 6.0 },
  ];
  const level = resolveInvalidationFocalLevel(play({ direction: "SHORT" }), focal);
  assert.equal(level?.kind, "call_wall", "a below-spot dark_pool print is not a SHORT's invalidation risk");
});

// BUG FIX (2026-10-21, Ask Largo x Night Hawk Swings standing mandate — deferred follow-up to
// #6532, named explicitly in that PR's own staged finding
// docs/audit/findings-staging/2026-10-21-swing-skip-hold-headline-leak.md). #6532 fixed the
// IDENTICAL root cause in play-brief.ts's headline/Verdict copy via the new, exported
// `swingVerdictVerb(play, action)` helper: a RESEARCH/SKIP candidate's `swingActionDisplay`
// deliberately returns null (play-card-lifecycle.ts's own "SKIP deliberately returns null so the
// honest PASSED lifecycle pill shows" comment) and `swingEntryAction` is always null too (never
// enterable), so any fallback chain shaped `action?.label ?? play.recommendation ?? ...` falls
// through to `play.recommendation` — the literal string "HOLD" entry-verdict.ts's RESEARCH branch
// always stamps for a SKIP row, even though nothing was ever entered. This file's own
// `actionNarrative` ("Entry stance" bullet, bucket==="watch") carries the exact same chain shape
// and was never touched by #6532 — confirmed by reading it before writing this test (it still
// read `swingActionDisplay(play)?.label ?? play.swingEntryAction?.toUpperCase() ?? rec`, `rec`
// being `play.recommendation ?? "HOLD"`).
test("tradeManagerNarrativeSection: SKIP/RESEARCH candidate's 'Entry stance' line reads PASSED, not the overloaded HOLD recommendation (2026-10-21, follow-up to #6532)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({
        status: "SKIP",
        recommendation: "HOLD",
        swingEntryAction: undefined,
        recNote: "Desk is passing this setup — no entry recommended.",
      }),
    }),
    "watch",
  );
  assert.ok(section);
  assert.match(
    section!.body,
    /Entry stance\*\* — PASSED\./,
    `expected "Entry stance — PASSED.", got: ${section!.body}`,
  );
  assert.doesNotMatch(
    section!.body,
    /Entry stance\*\* — HOLD/,
    "a declined RESEARCH/SKIP candidate must never read HOLD in the Entry stance bullet — nothing was ever entered, so nothing is being held",
  );
});

// Second call site named by the same #6532 follow-up: `degradedReadLine` ("Live read" bullet),
// which only fires when Vector/GEX spot isn't wired this tick (`tradeManagerNarrativeSection`'s
// `spot == null` branch — the ctx below supplies no vector/ecosystem, so spot stays null and this
// fallback fires in place of dealerPostureLine). Confirmed before writing this test: the function
// read `swingActionDisplay(play)?.label ?? play.recommendation ?? play.swingEntryAction?.toUpperCase()
// ?? "HOLD"` — the identical shape, same bug.
test("tradeManagerNarrativeSection: SKIP/RESEARCH candidate's degraded 'Live read' line reads PASSED, not HOLD (2026-10-21, follow-up to #6532)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({
        status: "SKIP",
        recommendation: "HOLD",
        swingEntryAction: undefined,
      }),
      vector: null,
      ecosystem: null,
    }),
    "watch",
  );
  assert.ok(section);
  assert.match(
    section!.body,
    /Live read\*\* — Vector spot not wired on this tick; desk still says \*\*PASSED\*\*/,
    `expected the Live read bullet to say PASSED, got: ${section!.body}`,
  );
  assert.doesNotMatch(
    section!.body,
    /desk still says \*\*HOLD\*\*/,
    "a declined RESEARCH/SKIP candidate must never read HOLD in the Live read bullet",
  );
});

// Scoping proof for BOTH call sites above: a genuine OPEN/HOLD position (an existing live
// position the desk is actively telling a member to hold — not a declined candidate) must keep
// reading HOLD verbatim, completely unaffected by the SKIP-only special case.
test("tradeManagerNarrativeSection: a genuine OPEN/HOLD position's 'Live read' line still reads HOLD, unaffected by the SKIP fix (2026-10-21)", () => {
  const section = tradeManagerNarrativeSection(
    ctx({
      play: play({
        status: "HOLD",
        recommendation: "HOLD",
        swingEntryAction: undefined,
      }),
      vector: null,
      ecosystem: null,
    }),
    "open",
  );
  assert.ok(section);
  assert.match(
    section!.body,
    /Live read\*\* — Vector spot not wired on this tick; desk still says \*\*HOLD\*\*/,
    `expected the Live read bullet to still say HOLD for a real open position, got: ${section!.body}`,
  );
});
