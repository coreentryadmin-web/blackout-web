import test from "node:test";
import assert from "node:assert/strict";
import { buildVisualBundle } from "./bundle";
import { routeVisual } from "./router";
import { composeCard } from "./compose";
import { detectVisualIntent, questionSubject } from "./intent";
import { sizeSpec } from "./sizes";
import type { VisualSize } from "./types";

/**
 * EDGE-CASE SWEEP — every product, every degenerate state, every surface.
 *
 * The unit tests elsewhere check one rule each. This file asks the question a member actually
 * asks ("create an image of X") against the state the system is actually in, and asserts the
 * INVARIANTS THAT MUST HOLD NO MATTER WHAT:
 *
 *   1. NEVER a card with no evidence. Refusing is always available and always correct.
 *   2. NEVER an overflow. Every composition fits its canvas on every surface.
 *   3. NEVER a silent drop. Anything measured and not drawn is reported.
 *   4. NEVER a fabricated value. A block that cannot be filled is absent, not zeroed.
 *
 * The degenerate states are the point. Every product has a legitimate empty or partial state —
 * pre-open, post-close, recap-only, all-pulled, one-sided, zero-print — and each one is a chance
 * to render a confident card about nothing.
 */

const SIZES: VisualSize[] = ["x_landscape", "x_portrait", "square", "story"];

/** Assert the four invariants for one question against one bundle, on every surface. */
function assertHealthy(q: string, bundle: Parameters<typeof routeVisual>[1], label: string) {
  const route = routeVisual(q, bundle);
  if (!route) return { route: null as string | null };
  for (const size of SIZES) {
    const spec = sizeSpec(size);
    const c = composeCard({ question: questionSubject(q), bundle, spec });
    assert.ok(c.used <= c.budget, `${label} @ ${size}: overflow ${c.used}/${c.budget}`);
    for (const d of c.dropped) assert.ok(d.label, `${label} @ ${size}: unnamed drop`);
    const drawn = new Set(c.blocks.map((b) => b.id));
    for (const d of c.dropped) assert.ok(!drawn.has(d.id), `${label} @ ${size}: ${d.id} drawn AND dropped`);
  }
  return { route: route.template };
}

const base = { systemsQueried: ["THERMAL"] as const, asOf: "2026-08-11T15:42:00Z" };

// ── DEGENERATE STATES: every product has one, and each can render a card about nothing ──────

test("NIGHT HAWK · a recap-only edition publishes NO card", () => {
  // A real, published edition that produced zero plays. `available: true` with a full recap
  // headline — the state that shipped live on 2026-07-31 and gave members "your playbook is here"
  // with nothing in it.
  const b = buildVisualBundle({
    capturedResults: [{ available: true, edition_for: "2026-08-11", plays: [], recap_headline: "Quiet tape", no_plays: true }],
    nowMs: 0,
  });
  assert.equal(b.playbook, null, "no plays is not a playbook");
  assert.equal(routeVisual("create an image of tomorrows plays", b), null, "and nothing else is drawable");
});

test("NIGHT HAWK · an edition where EVERY play was pulled still renders them", () => {
  // The most dangerous truncation in the library. Every play withdrawn is a real state, and the
  // card that matters most is the one saying so.
  const b = buildVisualBundle({
    capturedResults: [
      {
        available: true,
        edition_for: "2026-08-11",
        plays: [1, 2, 3].map((i) => ({
          rank: i,
          ticker: `T${i}`,
          direction: "long",
          entry_range: "$10-11",
          target: "$13",
          stop: "$9",
          pulled: true,
          pulled_reason: "band detached",
        })),
      },
    ],
    nowMs: 0,
  });
  assert.equal(b.playbook?.rows.length, 3, "pulled plays are never hidden");
  assert.ok(b.playbook!.rows.every((r) => r.pulled));
  assertHealthy("image of tomorrows plays", b, "all-pulled");
});

test("NIGHT HAWK · a ONE-play edition is a real, publishable state", () => {
  const b = buildVisualBundle({
    capturedResults: [
      { available: true, edition_for: "2026-08-11", plays: [{ rank: 1, ticker: "NVDA", direction: "long", entry_range: "$217", target: "$224", stop: "$213" }] },
    ],
    nowMs: 0,
  });
  const r = assertHealthy("create an image of tonights playbook", b, "one-play");
  assert.equal(r.route, "PLAYBOOK", "one play is a playbook, not a trade recap");
});

test("HELIX · ZERO prints must not render as a flow card", () => {
  // "Absence of evidence is not evidence of absence" is a prompt rule with no enforcement below
  // it. A flow block with no prints must not draw — an empty tape card reads as "no institutional
  // conviction", which is a claim about the market rather than about the feed.
  const b = { ...base, headline: "Quiet tape", flow: { windowLabel: "last 60 min", netDisplay: "$0", grossDisplay: "$0", callShare: null, printCount: 0, rows: [] } };
  const c = composeCard({ question: "make a card of the flow", bundle: b, spec: sizeSpec("story") });
  assert.ok(!c.blocks.some((x) => x.id === "flow_tape"), "an empty tape must not draw");
});

test("HELIX · a ONE-SIDED tape is drawn as one-sided, not balanced into a lie", async () => {
  const { balancedBySide } = await import("./templates/composed");
  const allCalls = [1, 2, 3, 4].map((id) => ({ side: "call" as const, id }));
  assert.equal(balancedBySide(allCalls, 3).length, 3, "balance must not pad a genuinely one-sided tape");
});

test("THERMAL · a gamma profile of ALL ZEROES must not draw a bar chart", () => {
  // Every bar would render at the 3% floor — a chart asserting a flat, measured distribution
  // where the real reading is "no exposure anywhere", which is a different claim.
  const b = {
    ...base,
    headline: "No dealer gamma",
    gammaProfile: { source: "THERMAL" as const, flipStrike: null, rows: [7600, 7650, 7700, 7750, 7800].map((k) => ({ strike: k, gamma: 0, display: "$0" })) },
  };
  const c = composeCard({ question: "generate an image of the gamma map", bundle: b, spec: sizeSpec("story") });
  assert.ok(!c.blocks.some((x) => x.id === "gamma_profile"), "an all-zero profile must not draw");
});

test("THERMAL · flip EXACTLY at spot is not an error state", () => {
  const b = {
    ...base,
    headline: "SPX pinned at the flip",
    spot: { value: 7750, display: "7,750.00", source: "THERMAL" as const },
    regime: { label: "AT FLIP", source: "THERMAL" as const },
    levels: [{ label: "Gamma flip", price: 7750, display: "7,750", kind: "pivot" as const, source: "THERMAL" as const }],
    metrics: [{ label: "VIX", value: "14.8", source: "THERMAL" as const }],
  };
  assertHealthy("create an image of the SPX levels", b, "flip-at-spot");
});

test("VECTOR · a screen with TWO names is a comparison, not a market screen", () => {
  const b = {
    ...base,
    headline: "Two names near their flip",
    screen: { preset: "Nearest flip", metricLabel: "Distance", universeSize: 512, updatedAt: null, rows: [
      { ticker: "NVDA", metricValue: 0.4, metricDisplay: "0.4%", regime: "above" as const },
      { ticker: "TSLA", metricValue: 0.9, metricDisplay: "0.9%", regime: "below" as const },
    ] },
  };
  const c = composeCard({ question: "screen the market as an image", bundle: b, spec: sizeSpec("story") });
  assert.ok(!c.blocks.some((x) => x.id === "screen"), "two names must not be presented as a universe screen");
});

test("0DTE · a board with NO graded rows cannot become a leaderboard", () => {
  // Pre-close, every row is open. A leaderboard implies comparability implies results.
  const b = {
    ...base,
    headline: "Board is open",
    leaderboard: { source: "NIGHT HAWK" as const, windowLabel: "today", graded: 0, wins: 0, losses: 0, winRateDisplay: null, rows: [] },
  };
  const c = composeCard({ question: "image of todays top performers", bundle: b, spec: sizeSpec("story") });
  assert.ok(!c.blocks.some((x) => x.id === "leaderboard"), "no graded rows, no leaderboard");
});

test("0DTE · a leaderboard of PURE LOSERS renders at full weight", () => {
  // The card must be as willing to draw a bad day as a good one. #1911 was the same failure from
  // the other direction — a two-losing-trades screenshot under alt text promising wins.
  const b = {
    ...base,
    headline: "Four red, none green",
    leaderboard: { source: "NIGHT HAWK" as const, windowLabel: "today", graded: 4, wins: 0, losses: 4, winRateDisplay: "0.0%", rows: [
      { ticker: "A", returnValue: -50, returnDisplay: "−50.0%" },
      { ticker: "B", returnValue: -50, returnDisplay: "−50.0%" },
      { ticker: "C", returnValue: -32, returnDisplay: "−32.0%" },
      { ticker: "D", returnValue: -18, returnDisplay: "−18.0%" },
    ] },
    metrics: [{ label: "Board size", value: "4", source: "NIGHT HAWK" as const }],
  };
  const r = assertHealthy("create an image of todays 0dte results", b, "all-losers");
  assert.equal(r.route, "TRADE_LEADERBOARD", "a losing day is still a leaderboard");
});

// ── ADVERSARIAL: the request is explicit, the evidence is not there ──────────────────────────

test("an EXPLICIT image request over an EMPTY bundle refuses", () => {
  // The single most important invariant. A member asking for a card does not make one honest.
  for (const q of [
    "create an image for tomorrow NH plays",
    "generate a graphic of TSLA",
    "make me a card for instagram",
  ]) {
    assert.equal(detectVisualIntent(q).wanted, true, `"${q}" must be read as a request`);
    assert.equal(routeVisual(q, { ...base }), null, `"${q}" must still refuse with no evidence`);
  }
});

test("a request over a HEADLINE-ONLY bundle refuses", () => {
  // A conclusion with nothing behind it is the most confident possible card and the emptiest.
  assert.equal(routeVisual("create an image", { ...base, headline: "SPX is bid" }), null);
});

test("EVERY block present at once still fits every surface", () => {
  // The packer's worst case. With enough evidence to overflow several times over, nothing may
  // spill — the block that falls off a canvas is the one CardShell cannot protect.
  const everything = {
    ...base,
    ticker: "SPX",
    headline: "Dealers flipped short gamma into the close and the tape followed",
    summary: "Flow, structure and price all turned within the same twenty minutes.",
    spot: { value: 7757.58, display: "7,757.58", source: "THERMAL" as const },
    regime: { label: "SHORT GAMMA", detail: "spot below flip", source: "THERMAL" as const },
    systemReads: [
      { system: "HELIX" as const, stance: "bullish" as const, detail: "+$41M" },
      { system: "THERMAL" as const, stance: "regime" as const, detail: "short gamma" },
      { system: "VECTOR" as const, stance: "bearish" as const, detail: "below OR" },
      { system: "NIGHT HAWK" as const, stance: "neutral" as const, detail: "no play" },
    ],
    levels: [7800, 7775, 7750, 7725, 7700, 7675].map((p, i) => ({
      label: `Level ${i}`, price: p, display: String(p), kind: "level" as const, source: "THERMAL" as const,
    })),
    metrics: [1, 2, 3, 4].map((i) => ({ label: `M${i}`, value: `${i}`, source: "THERMAL" as const })),
    gexShifts: [7750, 7775, 7800].map((s) => ({ strike: s, change: 1e9, display: "+$1B", direction: "stronger" as const })),
    gammaProfile: { source: "THERMAL" as const, flipStrike: 7750, rows: [7650, 7700, 7750, 7800, 7850, 7900].map((k, i) => ({ strike: k, gamma: (i - 2) * 1e9, display: `$${i}B` })) },
    flow: { windowLabel: "60m", netDisplay: "+$41.2M", grossDisplay: "$182M", callShare: 0.6, printCount: 40, rows: [
      { ticker: "SPX", side: "call" as const, premiumDisplay: "$18M" },
      { ticker: "SPY", side: "put" as const, premiumDisplay: "$12M" },
      { ticker: "QQQ", side: "call" as const, premiumDisplay: "$9M" },
    ] },
    timeline: [1, 2, 3, 4].map((i) => ({ label: `Step ${i}`, time: `10:0${i}` })),
    session: { openDisplay: "7,700", highDisplay: "7,810", lowDisplay: "7,690", closeDisplay: "7,757" },
  };
  const r = assertHealthy("what happened today", everything, "everything");
  assert.ok(r.route, "a full bundle must be drawable");
});

test("a VERY LONG headline does not push evidence off the canvas", () => {
  const b = {
    ...base,
    headline: "Dealers flipped short gamma into the close as the tape followed through the 7,750 flip and the call wall gave way on rising volume across every major index".repeat(1),
    spot: { value: 7757.58, display: "7,757.58", source: "THERMAL" as const },
    metrics: [{ label: "VIX", value: "14.8", source: "THERMAL" as const }],
    levels: [{ label: "Call wall", price: 7800, display: "7,800", kind: "resistance" as const, source: "THERMAL" as const }],
  };
  assertHealthy("create an image of what happened", b, "long-headline");
});

// ── EVERY PRODUCT, THE NORMAL ASK ────────────────────────────────────────────────────────────

test("the shape of question a member actually types is always answerable or honestly refused", () => {
  const rich = {
    ...base,
    ticker: "NVDA",
    headline: "NVDA is bid under the 220 call wall",
    spot: { value: 217.4, display: "217.40", source: "THERMAL" as const },
    regime: { label: "SHORT GAMMA", source: "THERMAL" as const },
    systemReads: [
      { system: "HELIX" as const, stance: "bullish" as const, detail: "+$18M" },
      { system: "THERMAL" as const, stance: "regime" as const, detail: "short gamma" },
      { system: "VECTOR" as const, stance: "bullish" as const, detail: "above OR" },
    ],
    levels: [
      { label: "Call wall", price: 220, display: "220.00", kind: "resistance" as const, source: "THERMAL" as const },
      { label: "Put wall", price: 205, display: "205.00", kind: "support" as const, source: "THERMAL" as const },
    ],
    flow: { windowLabel: "60m", netDisplay: "+$18.4M", grossDisplay: "$44M", callShare: 0.7, printCount: 30, rows: [
      { ticker: "NVDA", side: "call" as const, premiumDisplay: "$8M" },
      { ticker: "NVDA", side: "put" as const, premiumDisplay: "$3M" },
    ] },
    metrics: [{ label: "IV rank", value: "38", source: "THERMAL" as const }],
  };

  const asks = [
    "Generate how NVDA looks today",
    "create an image of NVDA for X",
    "make a card showing NVDA flow and levels",
    "how does NVDA look — post this on my story",
    "generate a picture of where NVDA dealers are positioned",
    "image of the NVDA call wall",
    "give me a graphic of NVDA for instagram",
  ];
  for (const q of asks) {
    const r = assertHealthy(q, rich, q);
    assert.ok(r.route, `"${q}" produced no card from a rich bundle`);
  }
});

test("every phrasing that asks for an artefact is READ as one", () => {
  const asks = [
    "Create a image for tomorrow NH plays",
    "Create a image for todays top 5 performing 0dte board plays",
    "Generate a image how TSLA looks like",
    "Generate how NVDA looks today — as an image",
    "make me an infographic of the SPX levels",
    "render a card for the gamma map",
    "export a png of todays results",
    "draw me a visual of the flow",
    "build a graphic for LinkedIn",
    "something i can post on twitter about NVDA",
  ];
  for (const q of asks) {
    assert.equal(detectVisualIntent(q).wanted, true, `MISSED an image request: "${q}"`);
  }
});

test("a question ABOUT an image is not a request FOR one", () => {
  // The verb is what separates asking for a card from talking about one.
  for (const q of [
    "what does the image show",
    "the card said SPX was bid — is that still true",
    "explain the graphic you made",
    "why is the chart showing short gamma",
  ]) {
    assert.equal(detectVisualIntent(q).wanted, false, `FALSE POSITIVE: "${q}"`);
  }
});

// ── ROUND TWO: the states that produce a card that is TRUE and MISLEADING ────────────────────

test("a STALE edition is never presented as tonight's", () => {
  // The latest-fallback path serves an OLDER session's edition when tonight's is unpublished. A
  // card headed with tomorrow's date over last week's plays is the worst kind of wrong: every
  // level real, the date a lie.
  const b = buildVisualBundle({
    capturedResults: [{
      available: true, edition_for: "2026-08-05", served_for: "2026-08-05", stale: true,
      plays: [{ rank: 1, ticker: "NVDA", direction: "long", entry_range: "$210", target: "$218", stop: "$206" }],
    }],
    nowMs: 0,
  });
  assert.equal(b.playbook?.stale, true, "staleness must reach the card");
  assert.equal(b.playbook?.editionFor, "2026-08-05", "the served date, not the requested one");
});

test("a DEGRADED-source edition carries its provenance", () => {
  const b = buildVisualBundle({
    capturedResults: [{ available: true, edition_for: "2026-08-11", degraded: true,
      plays: [{ rank: 1, ticker: "X", direction: "long", entry_range: "$1", target: "$2", stop: "$0.5" }] }],
    nowMs: 0,
  });
  assert.equal(b.playbook?.degraded, true);
});

test("an UNGRADED position never renders as a booked result", () => {
  // The marketing-surface application of the record-honesty finding: today's closed-but-ungraded
  // rows are exactly the ones a recap most wants to claim.
  const b = buildVisualBundle({
    capturedResults: [{ rows: [{ ticker: "NVDA", direction: "long", entry_premium: 4.2, last_mark: 8.9, live_pnl_pct: 111.9, status: "OPEN" }] }],
    nowMs: 0,
  });
  assert.equal(b.trade?.graded, false, "not graded");
  assert.equal(b.trade?.outcome, null, "and therefore carries NO outcome label");
});

test("a leaderboard whose DENOMINATOR is broken is refused", () => {
  // `graded` smaller than the rows shown would print "5 of 2 graded trades".
  const b = { ...base, headline: "Results",
    leaderboard: { source: "NIGHT HAWK" as const, windowLabel: "today", graded: 2, wins: 2, losses: 0, winRateDisplay: "100%",
      rows: [1,2,3,4,5].map((i) => ({ ticker: `T${i}`, returnValue: 10 * i, returnDisplay: `+${10*i}.0%` })) } };
  assert.notEqual(routeVisual("image of the leaderboard", b)?.template, "TRADE_LEADERBOARD");
});

test("wins + losses may never exceed the graded population", () => {
  const b = { ...base, headline: "Results",
    leaderboard: { source: "NIGHT HAWK" as const, windowLabel: "today", graded: 4, wins: 3, losses: 3, winRateDisplay: "75%",
      rows: [{ ticker: "A", returnValue: 10, returnDisplay: "+10.0%" }, { ticker: "B", returnValue: -10, returnDisplay: "−10.0%" }] } };
  assert.notEqual(routeVisual("image of the leaderboard", b)?.template, "TRADE_LEADERBOARD");
});

test("a counterfactual with only the AVOIDED side is refused", () => {
  // A guard that never costs anything is a guard that never fires. Losers-avoided without
  // winners-forgone is a highlight reel of a rules engine.
  const b = { ...base, headline: "The firewall paid",
    counterfactual: { sessionLabel: "today", guardLabel: "publish gates", source: "NIGHT HAWK" as const,
      heldCount: 5, gradedCount: 5, losersAvoided: { count: 5 }, winnersForgone: null as never,
      netValue: null, netDisplay: null, unfilledCount: null, rows: [] } };
  assert.notEqual(routeVisual("what did the firewall hold — as an image", b)?.template, "COUNTERFACTUAL");
});

test("a counterfactual grading MORE plays than it held is refused", () => {
  const b = { ...base, headline: "Firewall",
    counterfactual: { sessionLabel: "today", guardLabel: "gates", source: "NIGHT HAWK" as const,
      heldCount: 2, gradedCount: 7, losersAvoided: { count: 4 }, winnersForgone: { count: 3 },
      netValue: null, netDisplay: null, unfilledCount: null, rows: [] } };
  assert.notEqual(routeVisual("firewall image", b)?.template, "COUNTERFACTUAL");
});

test("a rejection row with NO gate named is refused", () => {
  // "We passed" with no rule behind it is a claim about judgement; this card exists to show a RULE.
  const b = { ...base, headline: "Held",
    rejections: { total: 4, windowLabel: "1h", rows: [
      { ticker: "A", gateFailed: "band_detached" }, { ticker: "B", gateFailed: "" },
    ] } };
  assert.notEqual(routeVisual("image of what we passed on", b)?.template, "REJECTION");
});

test("EM cone with no realised path is refused — it would imply a result", () => {
  const b = { ...base, headline: "Expected move",
    cone: { upper: 7800, lower: 7700, upperDisplay: "7,800", lowerDisplay: "7,700", path: [], source: "THERMAL" as const } };
  assert.notEqual(routeVisual("expected move cone as an image", b)?.template, "EM_CONE");
});

test("a session missing ANY of open/high/low/close is refused", () => {
  // The card's geometry IS the relationship between the four.
  const b = { ...base, headline: "Session", session: { openDisplay: "7,700", highDisplay: "7,810", lowDisplay: null, closeDisplay: "7,757" } };
  assert.notEqual(routeVisual("session recap image", b)?.template, "SESSION_RECAP");
});

test("TWO systems is a pair, not a consensus", () => {
  // The verdict vocabulary ("DIVIDED", "AGREEMENT") overstates what two reads establish.
  const b = { ...base, headline: "Do they agree",
    systemReads: [{ system: "HELIX" as const, stance: "bullish" as const }, { system: "THERMAL" as const, stance: "bearish" as const }] };
  assert.notEqual(routeVisual("do the systems agree — image", b)?.template, "SYSTEM_COMPARISON");
});

// ── NUMERIC HOSTILITY ────────────────────────────────────────────────────────────────────────

test("NaN and Infinity never reach a card", () => {
  const b = buildVisualBundle({
    capturedResults: [{ rows: [{ ticker: "X", direction: "long", entry_premium: NaN, last_mark: Infinity, live_pnl_pct: -Infinity, status: "OPEN" }] }],
    nowMs: 0,
  });
  // No entry means no trade. A NaN premium must not become "$NaN" on a shareable asset.
  assert.equal(b.trade, null);
});

test("a zero-magnitude ranked set does not divide by zero", () => {
  const b = { ...base, headline: "Flat",
    leaderboard: { source: "NIGHT HAWK" as const, windowLabel: "today", graded: 3, wins: 0, losses: 0, winRateDisplay: "0.0%",
      rows: [1,2,3].map((i) => ({ ticker: `T${i}`, returnValue: 0, returnDisplay: "0.0%" })) },
    metrics: [{ label: "Graded", value: "3", source: "NIGHT HAWK" as const }] };
  assertHealthy("image of todays results", b, "all-zero-returns");
});

test("an enormous headline and an enormous level set together still fit", () => {
  const b = { ...base,
    headline: "X".repeat(400),
    spot: { value: 7757.58, display: "7,757.58", source: "THERMAL" as const },
    levels: Array.from({ length: 40 }, (_, i) => ({
      label: `Level ${i}`, price: 7700 + i * 5, display: String(7700 + i * 5), kind: "level" as const, source: "THERMAL" as const,
    })),
    metrics: [{ label: "VIX", value: "14.8", source: "THERMAL" as const }] };
  assertHealthy("create an image of every level", b, "40-levels");
});

// ── THE COHERENCE GAP, NAMED ─────────────────────────────────────────────────────────────────

test("the card is built from the TURN'S OWN results, never a fresh query", () => {
  // The one-snapshot rule, asserted structurally rather than trusted. If bundle.ts ever grew a
  // fetch, the card could quote a different number from the answer beside it — permanently, on a
  // surface nobody can check.
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const src = readFileSync("src/lib/largo/visual/bundle.ts", "utf8");
  for (const forbidden of ["fetch(", "await fetch", "axios", "XMLHttpRequest"]) {
    assert.ok(!src.includes(forbidden), `bundle.ts must make no network call, found: ${forbidden}`);
  }
});

test("an ALL-PULLED book never renders in bull green", async () => {
  // FOUND BY RENDERING, not by a unit test. Skew counts exclude pulled plays, so a book where
  // every play was withdrawn produced "0 LONG · 0 SHORT" — and because `shorts === 0` it rendered
  // in BULL GREEN. Green reads "all clear" on the one card whose entire message is "do not trade
  // this". The colour was derived from an ABSENCE of shorts rather than a PRESENCE of longs,
  // which is true and useless when there is nothing on either side.
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const src = readFileSync("src/lib/largo/visual/templates/playbook.tsx", "utf8");
  assert.match(src, /const actionable = longs \+ shorts/, "the zero-actionable case must be named");
  assert.match(src, /actionable === 0\s*\n?\s*\? "NOTHING ACTIONABLE"/, "and say so in words");
  assert.match(src, /actionable === 0 \? C\.warn/, "and never resolve to bull green");
});
