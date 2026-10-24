import test from "node:test";
import assert from "node:assert/strict";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import {
  archetypeTrackRecordSection,
  bookContextSection,
  buildIntelSections,
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
  macroTapeSection,
  meridianCatalystSection,
  meridianPeerSection,
  tickerTrackRecordSection,
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
import { BANGER_LEDGER_REGIME_LABEL } from "./banger-lane-merge";

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

// BUG FIX (Ask Largo standing mandate, 2026-10-20, live repro TSLA 385P SHORT candidate against a
// real TSLA 352.5C LONG already held): a literal same-ticker opposed position used to flatten into
// the same generic "theme X has an opposed position" sentence as a genuinely different name in the
// same theme — distinguishable only by a parenthetical among several names. Now gets its own
// sharper "same underlying" sentence.
test("bookContextSection: a same-TICKER opposed position gets a sharper 'same underlying' sentence, distinct from a same-theme/different-ticker one", () => {
  const book: PortfolioPosition[] = [
    { ticker: "TSLA", direction: "LONG", positionId: 60 },
    { ticker: "TSLL", direction: "LONG" },
  ];
  const section = bookContextSection(fixturePlay({ ticker: "TSLA", direction: "SHORT" }), book);
  assert.ok(section);
  assert.match(
    section?.body ?? "",
    /Internal conflict — same underlying.*already holding TSLA LONG \(separate position #60\) on TSLA itself/,
    `expected a distinct same-underlying sentence, got: ${section?.body}`,
  );
  assert.match(
    section?.body ?? "",
    /Internal conflict\*\* — theme "ev-auto" already has an OPPOSED position: TSLL LONG/,
    `expected the different-ticker (TSLL) conflict to keep the generic theme sentence, got: ${section?.body}`,
  );
});

test("bookContextSection: a same-theme but DIFFERENT-ticker opposed position keeps the generic theme sentence (no same-underlying framing)", () => {
  const book: PortfolioPosition[] = [{ ticker: "TSLL", direction: "LONG" }];
  const section = bookContextSection(fixturePlay({ ticker: "TSLA", direction: "SHORT" }), book);
  assert.ok(section);
  assert.doesNotMatch(section?.body ?? "", /same underlying/);
  assert.match(section?.body ?? "", /Internal conflict\*\* — theme "ev-auto" already has an OPPOSED position: TSLL LONG/);
});

// BUG FIX (2026-10-17, Ask Largo standing mandate, live repro ALAB): a LONG inverse-leverage ETF
// (SQQQ, economically SHORT semis) classified correctly as an OPPOSED position against a LONG NVDA
// — but rendered as bare "SQQQ LONG", so the "Internal conflict" sentence read as self-contradictory
// (two "LONG" names split into a same-direction bucket and an opposed bucket with no visible reason
// why). Must now annotate the real economic bet.
test("bookContextSection: a LONG inverse-leverage ETF (SQQQ) in the OPPOSED bucket is annotated with its real economic direction, not rendered as a bare 'LONG'", () => {
  const book: PortfolioPosition[] = [{ ticker: "SQQQ", direction: "LONG" }];
  const section = bookContextSection(fixturePlay({ ticker: "NVDA", direction: "LONG" }), book);
  assert.ok(section);
  assert.match(section?.body ?? "", /Internal conflict/i);
  assert.match(
    section?.body ?? "",
    /SQQQ LONG \(inverse ETF — economically SHORT\)/,
    `expected an annotated label explaining the opposed classification, got: ${section?.body}`,
  );
});

// Note: this must be an ALREADY-COMMITTED play (status != WATCH) to exercise the intended
// self-exclusion fallback. It used to run against the default WATCH status and pass with `null`
// -- which, per the 2026-09-21 fix below, was itself the exact bug this row now guards against
// (a WATCH candidate is an UNCOMMITTED dossier, so a matching row is a genuine distinct position,
// never "self" -- see that fix's comment for the live repro and the corrected assertion).
test("bookContextSection: a duplicate/rolled row on the SAME ticker+direction is not reported as overlap (committed play, unresolved positionId)", () => {
  const book: PortfolioPosition[] = [{ ticker: "NVDA", direction: "LONG" }];
  assert.equal(
    bookContextSection(fixturePlay({ ticker: "NVDA", direction: "LONG", status: "OPEN" }), book),
    null,
  );
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

// BUG FIX (2026-09-18, Ask Largo standing mandate): live repro on CRWD:39's own brief today --
// TWO real, independently-committed Banger CRWD LONG positions both rendered the IDENTICAL bare
// "CRWD LONG (separate, cross-engine position)" text (no positionId on either, per loadOpenBook's
// deliberate collision-avoidance), reading exactly like the duplicate-counting defect the
// 2026-09-15 fix above was written to prevent, even though the underlying count was honest.
// `bangerId` (display-only, never touching checkPortfolioOverlap's exclude/match logic) now
// disambiguates multiple cross-engine siblings on the same ticker from each other.
test("bookContextSection: two distinct cross-engine siblings on the same ticker are told apart via bangerId, not rendered identically (2026-09-18 gap fix)", () => {
  const book: PortfolioPosition[] = [
    { ticker: "CRWD", direction: "LONG", bangerId: 1123 },
    { ticker: "CRWD", direction: "LONG", bangerId: 1187 },
  ];
  const section = bookContextSection(
    fixturePlay({ id: "SWING:CRWD:39", ticker: "CRWD", direction: "LONG", status: "OPEN" }),
    book,
  );
  assert.ok(section);
  assert.match(section!.body, /CRWD LONG \(separate, cross-engine position #1123\)/);
  assert.match(section!.body, /CRWD LONG \(separate, cross-engine position #1187\)/);
  assert.doesNotMatch(
    section!.body,
    /cross-engine position\)/,
    "must not fall back to the bare, indistinguishable label when a real bangerId is known",
  );
});

// BUG FIX (2026-10-20, Ask Largo standing mandate, live repro LABD #1955/#1761 and RNG #1966/
// #1902): a null positionId on the SIBLING means that sibling is Banger-origin, but the old code
// treated that alone as sufficient for "cross-engine" -- it never checked whether the REVIEWED
// play is ALSO Banger-origin. When both sides are Banger (same engine, same ticker, twice), the
// "cross-engine" claim is false. 21 of 26 live committed Swing positions the day this was found
// were Banger-origin, so this is common, not an edge case.
test("bookContextSection: a same-ticker sibling is NOT labeled cross-engine when the REVIEWED play is itself Banger-origin (2026-10-20 fix, live repro LABD/RNG)", () => {
  const book: PortfolioPosition[] = [{ ticker: "CRWD", direction: "LONG", bangerId: 1761 }];
  const section = bookContextSection(
    fixturePlay({
      id: "SWING:CRWD:1955",
      ticker: "CRWD",
      direction: "LONG",
      status: "OPEN",
      regime: BANGER_LEDGER_REGIME_LABEL,
    }),
    book,
  );
  assert.ok(section);
  assert.match(
    section!.body,
    /CRWD LONG \(separate position #1761\)/,
    `a Banger-origin reviewed play's Banger sibling must read as a same-engine "separate position", not "cross-engine", got: ${section!.body}`,
  );
  assert.doesNotMatch(
    section!.body,
    /cross-engine/,
    "must not claim a cross-engine relationship when both sides are the same (Banger) engine",
  );
});

// Sibling guard: the cross-engine label must still fire when the reviewed play is swing-native
// (not Banger) and the sibling is Banger-origin -- the fix above is scoped to the reviewed play's
// own origin, not a removal of the cross-engine label generally.
test("bookContextSection: cross-engine label still fires for a swing-native reviewed play with a Banger sibling (no regression)", () => {
  const book: PortfolioPosition[] = [{ ticker: "CRWD", direction: "LONG", bangerId: 1123 }];
  const section = bookContextSection(
    fixturePlay({ id: "SWING:CRWD:39", ticker: "CRWD", direction: "LONG", status: "OPEN" }),
    book,
  );
  assert.ok(section);
  assert.match(section!.body, /CRWD LONG \(separate, cross-engine position #1123\)/);
});

// Live repro (2026-09-18, Ask Largo standing mandate): BYND is unmapped in sector-map.ts, so
// resolveTheme() gives it the internal own-cluster sentinel "NAME:BYND" rather than a real theme
// (theme-cluster.ts's OWN_CLUSTER_PREFIX). Before the fix, bookContextSection interpolated
// overlap.theme raw into the narrative, so a member holding two concurrent BYND positions saw
// literal internal-key text: `theme "NAME:BYND"`. Confirmed live via GET /api/market/swing/play-brief
// (envelope.evidence carried the identical leak) before this test was written.
// BUG FIX (2026-10-21, Ask Largo standing mandate): this assertion originally expected
// `describeThemeOverlap`'s own-cluster-sentinel resolution ("the same name (BYND)") since that was
// the only mechanism translating a same-ticker overlap into readable text at the time. The
// 2026-10-21 same-ticker/other-ticker split fix now detects the same-ticker case BEFORE ever
// calling `describeThemeOverlap`, rendering the sharper "Concentration — same underlying" sentence
// directly — the NAME: leak this test guards against is now structurally impossible via this path
// (the same-ticker branch never touches `overlap.theme` at all), a stronger guarantee than before.
test("bookContextSection: an own-cluster (unmapped-ticker) overlap reads as a name, never the raw NAME: sentinel", () => {
  const book: PortfolioPosition[] = [{ ticker: "BYND", direction: "LONG", positionId: 1148 }];
  const section = bookContextSection(
    fixturePlay({ id: "SWING:BYND:9999", ticker: "BYND", direction: "LONG", status: "OPEN" }),
    book,
  );
  assert.ok(section);
  assert.match(section!.body, /already holding BYND LONG \(separate position #1148\) on BYND itself/);
  assert.doesNotMatch(section!.body, /NAME:/, "must never leak the internal own-cluster sentinel into narrative copy");
});

// BUG FIX (2026-10-21, Ask Largo standing mandate): the reviewed play (CRWD LONG) and its sole
// book overlap (CRWD LONG, no positionId) are the identical ticker+direction, so the 2026-10-21
// same-ticker split fix now routes this through the sharper "Concentration — same underlying"
// sentence rather than the old generic one — the trailing period this assertion used to require
// immediately after the label no longer applies (the label is now mid-sentence, not sentence-
// final). The thing this test actually guards — the bare cross-engine fallback label itself, with
// no fabricated bangerId — is unaffected; only the surrounding sentence changed.
test("bookContextSection: a cross-engine sibling with no bangerId still falls back to the bare label (never fabricated)", () => {
  const book: PortfolioPosition[] = [{ ticker: "CRWD", direction: "LONG" }];
  const section = bookContextSection(
    fixturePlay({ id: "SWING:CRWD:39", ticker: "CRWD", direction: "LONG", status: "OPEN" }),
    book,
  );
  assert.ok(section);
  assert.match(section!.body, /CRWD LONG \(separate, cross-engine position\)/);
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

// BUG FIX (2026-09-21, Ask Largo standing mandate): a WATCH candidate never carries a ledger
// positionId (play.id is only ever stamped with one once committed -- banger-lane-merge.ts's own
// comment), so this call used to fall through to `checkPortfolioOverlap`'s DEFAULT
// `excludeSelfMatch: true` -- meant for an ALREADY-COMMITTED play excluding its own row, not an
// uncommitted WATCH dossier. A trader looking at a WATCH signal on a ticker they ALREADY hold in
// the SAME direction saw the pre-existing position silently treated as "self" and got NO
// concentration warning at all -- exactly the "about to double an identical wager" case this
// section exists to flag. Live repro reduced to a fixture: WATCH NVDA LONG candidate, book already
// holds a bare NVDA LONG row (no positionId, the shape a WATCH candidate's book always sees since
// it has none of its own).
test("bookContextSection: a WATCH candidate matching an existing held position's own ticker+direction is flagged as concentration, not silently treated as self", () => {
  const book: PortfolioPosition[] = [{ ticker: "NVDA", direction: "LONG" }];
  const section = bookContextSection(
    fixturePlay({ id: "SWING:NVDA", ticker: "NVDA", direction: "LONG", status: "WATCH" }),
    book,
  );
  assert.ok(section, "expected a Concentration warning, not null");
  assert.match(section!.body, /Concentration/i);
  assert.match(section!.body, /NVDA LONG/);
  assert.match(section!.body, /Adding NVDA stacks/i);
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

// GAP FOUND (2026-09-20, Ask Largo standing mandate, live repro RIOT's own book-context): the
// 2026-09-15/09-18 fixes above only disambiguate the REVIEWED play's own ticker duplicating in its
// own overlap list. A DIFFERENT ticker duplicating in the SAME list -- reviewing RIOT and seeing
// MSTX appear twice in RIOT's own concentration line, because two genuinely separate MSTX
// positions (a swing-native row plus a distinct cross-engine sibling) both overlap RIOT's theme --
// hit the same "reads like a duplicate-counting defect" symptom the earlier fixes were written to
// prevent, but for a ticker other than the one being reviewed, so neither prior fix caught it.
test("bookContextSection: a different ticker (not the reviewed one) appearing twice is disambiguated, not rendered identically", () => {
  const book: PortfolioPosition[] = [
    { ticker: "MSTX", direction: "LONG", positionId: 1209 },
    { ticker: "MSTX", direction: "LONG", bangerId: 4471 },
    { ticker: "MARA", direction: "LONG" },
  ];
  const section = bookContextSection(
    fixturePlay({ id: "SWING:RIOT:1203", ticker: "RIOT", direction: "LONG", status: "OPEN" }),
    book,
  );
  assert.ok(section);
  assert.match(section!.body, /MSTX LONG \(separate position #1209\)/);
  assert.match(section!.body, /MSTX LONG \(separate, cross-engine position #4471\)/);
  assert.doesNotMatch(
    section!.body,
    /MSTX LONG,/,
    "must never render the duplicated ticker as a bare, indistinguishable label",
  );
  // A ticker that appears only ONCE in the same list is unaffected -- disambiguation is scoped to
  // the genuine duplicate, not applied blanket to every name in the list.
  assert.match(section!.body, /MARA LONG(?!\s*\()/);
});

// BUG FIX (Ask Largo standing mandate, 2026-10-20): the test above happens to have the reviewed
// play (RIOT) be swing-native while the MSTX duplicate group is genuinely mixed-origin, so the old
// `reviewedIsBangerOrigin`-based check got the right answer there BY COINCIDENCE. It answers the
// wrong question in general: whether a duplicate-OTHER-ticker pair is cross-engine depends on
// whether THOSE rows mix origins with EACH OTHER, not on the REVIEWED ticker's own origin. Two
// Banger-origin MSTX rows, reviewed from a swing-native RIOT play, used to be falsely labeled
// "cross-engine" solely because RIOT itself is swing-native.
test("bookContextSection: two Banger-origin rows of a duplicate OTHER ticker are same-engine, not falsely cross-engine, regardless of the reviewed play's own origin", () => {
  const book: PortfolioPosition[] = [
    { ticker: "MSTX", direction: "LONG", bangerId: 501 },
    { ticker: "MSTX", direction: "LONG", bangerId: 502 },
  ];
  const section = bookContextSection(
    fixturePlay({ id: "SWING:RIOT:1203", ticker: "RIOT", direction: "LONG", status: "OPEN" }),
    book,
  );
  assert.ok(section);
  assert.match(section!.body, /MSTX LONG \(separate position #501\)/);
  assert.match(section!.body, /MSTX LONG \(separate position #502\)/);
  assert.doesNotMatch(
    section!.body,
    /cross-engine/,
    `two same-engine (Banger) MSTX rows must not be labeled cross-engine just because RIOT is swing-native, got: ${section!.body}`,
  );
});

// Inverse of the test above: the REVIEWED play is ITSELF Banger-origin, while the duplicate OTHER
// ticker's group genuinely mixes a native swing row with a Banger row — the old code would have
// silently dropped the real cross-engine distinction here solely because the reviewed play happens
// to be Banger-origin.
test("bookContextSection: a genuinely mixed-origin duplicate OTHER ticker is still labeled cross-engine even when the reviewed play is itself Banger-origin", () => {
  const book: PortfolioPosition[] = [
    { ticker: "MSTX", direction: "LONG", positionId: 1209 },
    { ticker: "MSTX", direction: "LONG", bangerId: 4471 },
  ];
  const section = bookContextSection(
    fixturePlay({ id: "SWING:RIOT:1203", ticker: "RIOT", direction: "LONG", status: "OPEN", regime: BANGER_LEDGER_REGIME_LABEL }),
    book,
  );
  assert.ok(section);
  assert.match(section!.body, /MSTX LONG \(separate position #1209\)/);
  assert.match(
    section!.body,
    /MSTX LONG \(separate, cross-engine position #4471\)/,
    `a genuinely mixed-origin MSTX duplicate must stay cross-engine even when RIOT itself is Banger-origin, got: ${section!.body}`,
  );
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

// ── structured `table` (Largo C10 follow-up — same numbers as the prose above, but joinable) ──
test("archetypeTrackRecordSection: attaches a structured table carrying the same wins/losses/n/winRate/Wilson-LB/edge as the prose", () => {
  const snap = trackRecordSnapshot({
    BREAKOUT: trackRecordEntry({ wins: 45, losses: 15, n: 60, winRatePct: 75, wilsonLbPct: 63.2, pointDeltaPts: 22.4 }),
  });
  const section = archetypeTrackRecordSection(fixturePlay({ archetype: "BREAKOUT" }), snap);
  assert.ok(section?.table);
  assert.deepEqual(section?.table?.headers, ["Scope", "Record", "N", "Win rate", "Wilson LB", "Edge"]);
  assert.equal(section?.table?.rows.length, 1);
  assert.deepEqual(section?.table?.rows[0], ["Breakout continuation", "45W / 15L", "60", "75%", "63%", "+22 pts"]);
});

test("archetypeTrackRecordSection: table carries a row for EACH graduated dimension (archetype + sub-lane), matching the two prose blocks", () => {
  const snap = snapshotWithSubLanes(
    { BREAKOUT: trackRecordEntry({ wins: 45, losses: 15, n: 60 }) },
    { TACTICAL: trackRecordEntry({ wins: 1, losses: 4, n: 5, winRatePct: 20, wilsonLbPct: 5.7 }) },
  );
  const play = fixturePlay({ archetype: "BREAKOUT", subLane: "TACTICAL" });
  const section = archetypeTrackRecordSection(play, snap);
  assert.equal(section?.table?.rows.length, 2);
  assert.equal(section?.table?.rows[0]?.[0], "Breakout continuation");
  assert.equal(section?.table?.rows[1]?.[0], "Tactical (5–7d) sub-lane");
});

test("archetypeTrackRecordSection: table's point-Δ cell reads '—' when pointDeltaPts is null, same honest-omission as the prose", () => {
  const snap = trackRecordSnapshot({ BREAKOUT: trackRecordEntry({ pointDeltaPts: null }) });
  const section = archetypeTrackRecordSection(fixturePlay({ archetype: "BREAKOUT" }), snap);
  assert.equal(section?.table?.rows[0]?.[5], "—");
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

// BUG FIX (Ask Largo standing mandate, 2026-10-15): `snapshot.gradedPlays` (the whole-lane
// graded-play count, documented on the type as existing to give context for how broad the
// evidence base is overall, independent of any one bucket's own n) was computed and threaded all
// the way here but never read directly — a member reading "60 graded plays" on a bucket had no
// way to tell whether that was most of the lane's evidence or a small slice of it.
test("archetypeTrackRecordSection: states the lane-wide graded-play count for context (Largo historical-context breadth)", () => {
  const snap = trackRecordSnapshot({ BREAKOUT: trackRecordEntry({ n: 60 }) });
  const body = archetypeTrackRecordSection(fixturePlay({ archetype: "BREAKOUT" }), snap)?.body ?? "";
  assert.match(body, /across 70 lane-wide graded plays/i);
});

// BUG FIX (Ask Largo standing mandate, 2026-10-20): this section rendered the win-rate/Wilson-LB
// numbers with ZERO age disclosure, unlike every sibling section in this file (Vector, GEX,
// Meridian, dark-pool, option mark all render an explicit "last synced"/staleness line) — even
// though `snapshot.asOf` (documented on the type as "Largo C1/C2 provenance") was available the
// whole time, and the evidence[] entry for this SAME fact could (pre-2026-10-20 fix) disagree with
// this section's silence about whether the data was fresh at all.
test("archetypeTrackRecordSection: discloses an honest 'as of' sync time for an on-schedule snapshot", () => {
  const snap = trackRecordSnapshot({ BREAKOUT: trackRecordEntry({ n: 60 }) }); // asOf 2026-09-10T15:00:00.000Z
  const readMs = Date.parse("2026-09-10T15:11:00.000Z"); // 11 minutes later — on-schedule, not stale
  const body = archetypeTrackRecordSection(fixturePlay({ archetype: "BREAKOUT" }), snap, readMs)?.body ?? "";
  assert.match(body, /Track record data as of/);
  assert.doesNotMatch(body, /\*\*stale\*\*/);
});

test("archetypeTrackRecordSection: discloses genuine staleness past the documented TTL, never silently", () => {
  const snap = trackRecordSnapshot({ BREAKOUT: trackRecordEntry({ n: 60 }) }); // asOf 2026-09-10T15:00:00.000Z
  const readMs = Date.parse("2026-09-20T15:00:00.000Z"); // 10 days later — well past the 120h TTL
  const body = archetypeTrackRecordSection(fixturePlay({ archetype: "BREAKOUT" }), snap, readMs)?.body ?? "";
  assert.match(body, /Track record data \*\*stale\*\* — last synced/);
});

// ── sub-lane citation (graduatedSubLaneEntry — previously wired write-side/tested but never read
// from a brief section; see this file's header comment on why it now ships as an additive line
// alongside the archetype citation rather than replacing it) ──────────────────────────────────────
function snapshotWithSubLanes(
  archetypes: SwingArchetypeTrackRecordSnapshot["archetypes"] = {},
  subLanes: SwingArchetypeTrackRecordSnapshot["subLanes"] = {},
): SwingArchetypeTrackRecordSnapshot {
  return { asOf: "2026-09-10T15:00:00.000Z", gradedPlays: 70, archetypes, subLanes };
}

test("archetypeTrackRecordSection: cites the sub-lane too when its own bucket has independently graduated", () => {
  const snap = snapshotWithSubLanes(
    { BREAKOUT: trackRecordEntry({ wins: 45, losses: 15, n: 60 }) },
    { TACTICAL: trackRecordEntry({ wins: 1, losses: 4, n: 5, winRatePct: 20, wilsonLbPct: 5.7 }) },
  );
  const play = fixturePlay({ archetype: "BREAKOUT", subLane: "TACTICAL" });
  const body = archetypeTrackRecordSection(play, snap)?.body ?? "";
  assert.match(body, /45W \/ 15L/, "archetype line still present");
  assert.match(body, /Tactical.*sub-lane/i, "sub-lane line present");
  assert.match(body, /1W \/ 4L/, "sub-lane's own wins\\/losses cited, not the archetype's");
});

test("archetypeTrackRecordSection: renders the sub-lane citation ALONE when only the sub-lane has graduated (archetype ungraduated/absent)", () => {
  const snap = snapshotWithSubLanes(
    {},
    { STANDARD: trackRecordEntry({ wins: 10, losses: 5, n: 15 }) },
  );
  const play = fixturePlay({ archetype: null, subLane: "STANDARD" });
  const section = archetypeTrackRecordSection(play, snap);
  assert.ok(section);
  assert.match(section?.body ?? "", /Standard.*sub-lane/i);
});

test("archetypeTrackRecordSection: null when neither dimension has graduated", () => {
  const snap = snapshotWithSubLanes(
    { BREAKOUT: trackRecordEntry({ graduated: false }) },
    { TACTICAL: trackRecordEntry({ graduated: false }) },
  );
  const play = fixturePlay({ archetype: "BREAKOUT", subLane: "TACTICAL" });
  assert.equal(archetypeTrackRecordSection(play, snap), null);
});

test("archetypeTrackRecordSection: an unrecognized subLane string is treated as absent, never fabricated", () => {
  const snap = snapshotWithSubLanes({}, { TACTICAL: trackRecordEntry() });
  const play = fixturePlay({ archetype: null, subLane: "NOT_A_REAL_SUB_LANE" });
  assert.equal(archetypeTrackRecordSection(play, snap), null);
});

// ── tickerTrackRecordSection (Largo C10 historical context, TICKER-scoped — Ask Largo mandate
// round 19, 2026-09-18) — sibling of archetypeTrackRecordSection above, scoped to the ticker
// instead of the archetype. Unlike the archetype section this has no graduation gate: it's a
// plain factual count, not a calibrated score. ───────────────────────────────────────────────

test("tickerTrackRecordSection: null on a cold/missing read (undefined or null) — never throws", () => {
  const play = fixturePlay();
  assert.equal(tickerTrackRecordSection(play, undefined), null);
  assert.equal(tickerTrackRecordSection(play, null), null);
});

test("tickerTrackRecordSection: null when there are zero prior resolved trades on this ticker", () => {
  const play = fixturePlay();
  assert.equal(
    tickerTrackRecordSection(play, { ticker: "NVDA", priorClosedTrades: 0, wins: 0, losses: 0 }),
    null,
  );
});

test("tickerTrackRecordSection: renders a 'Ticker track record' section citing the ticker, N, and W/L", () => {
  const play = fixturePlay();
  const section = tickerTrackRecordSection(play, {
    ticker: "NVDA",
    priorClosedTrades: 3,
    wins: 2,
    losses: 1,
  });
  assert.ok(section);
  assert.equal(section?.title, "Ticker track record");
  assert.match(section?.body ?? "", /NVDA/);
  assert.match(section?.body ?? "", /\*\*3\*\* times/);
  assert.match(section?.body ?? "", /2W \/ 1L/);
  assert.match(section?.body ?? "", /67% win rate/, "win rate rounded and cited");
});

test("tickerTrackRecordSection: singular 'time' when exactly one prior trade", () => {
  const play = fixturePlay();
  const body =
    tickerTrackRecordSection(play, { ticker: "NVDA", priorClosedTrades: 1, wins: 0, losses: 1 })
      ?.body ?? "";
  assert.match(body, /\*\*1\*\* time before/);
  assert.doesNotMatch(body, /1 times/);
});

test("tickerTrackRecordSection: attaches a structured table carrying the ticker/record/n/winRate, joinable without parsing the prose", () => {
  const play = fixturePlay();
  const section = tickerTrackRecordSection(play, { ticker: "NVDA", priorClosedTrades: 3, wins: 2, losses: 1 });
  assert.ok(section?.table);
  assert.deepEqual(section?.table?.headers, ["Ticker", "Record", "N", "Win rate"]);
  assert.deepEqual(section?.table?.rows, [["NVDA", "2W / 1L", "3", "67%"]]);
});

// BUG FIX (Ask Largo standing mandate, 2026-10-15): `record.directions` lets a caller tell whether
// the cited record actually shares today's play direction before implying a directly comparable
// verdict (same precision gap tickerHistoryCoaching already guards against for its own mention of
// this record) — this dedicated section never read it at all.
test("tickerTrackRecordSection: discloses an opposite-direction record instead of implying direct comparability (Largo C9)", () => {
  const play = fixturePlay({ direction: "LONG" });
  const body =
    tickerTrackRecordSection(play, {
      ticker: "NVDA",
      priorClosedTrades: 2,
      wins: 0,
      losses: 2,
      directions: ["short", "short"],
    })?.body ?? "";
  assert.match(body, /all short/);
  assert.match(body, /not all directly comparable to today's LONG setup/);
});

test("tickerTrackRecordSection: discloses a mixed-direction record", () => {
  const play = fixturePlay({ direction: "LONG" });
  const body =
    tickerTrackRecordSection(play, {
      ticker: "NVDA",
      priorClosedTrades: 2,
      wins: 1,
      losses: 1,
      directions: ["short", "long"],
    })?.body ?? "";
  assert.match(body, /mixed long\/short/);
});

test("tickerTrackRecordSection: no direction note when every prior trade shares today's direction", () => {
  const play = fixturePlay({ direction: "LONG" });
  const body =
    tickerTrackRecordSection(play, {
      ticker: "NVDA",
      priorClosedTrades: 2,
      wins: 2,
      losses: 0,
      directions: ["long", "long"],
    })?.body ?? "";
  assert.doesNotMatch(body, /not all directly comparable/);
});

test("tickerTrackRecordSection: no direction note at all when directions is omitted (older fixture/call site)", () => {
  const play = fixturePlay({ direction: "LONG" });
  const body =
    tickerTrackRecordSection(play, { ticker: "NVDA", priorClosedTrades: 3, wins: 2, losses: 1 })?.body ?? "";
  assert.doesNotMatch(body, /not all directly comparable/);
  assert.doesNotMatch(body, /mixed long\/short/);
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

// BUG FIX (Ask Largo standing mandate, 2026-10-15): `v.absent` (Largo C3 absence principle — which
// sources couldn't answer this turn) was computed and pinned on every verdict this section reads,
// but never surfaced — unlike every other CortexVerdict-to-prose renderer in the codebase
// (bie/cortex-read.ts always states an absent-source count in its headline). A real, measured
// production shape: ~19% of graded 0DTE commits carry a real CortexSourceTimeout via the same
// shared fetchVectorFullState fan-out swing's own sources use.
test("cortexReadSection: states the absent-source count in the header when sources were absent (Largo C3)", () => {
  const view = opposedCortexView();
  const withAbsent: PaneCortexView = {
    ...view,
    verdict: { ...view.verdict, absent: ["darkpool-confluence", "catalyst-news"] },
  };
  const body = cortexReadSection(fixturePlay({ cortex: withAbsent }))?.body ?? "";
  assert.match(body, /2 sources absent/);
});

test("cortexReadSection: no absent-source clause at all when nothing was absent", () => {
  const body = cortexReadSection(fixturePlay({ cortex: opposedCortexView() }))?.body ?? "";
  assert.doesNotMatch(body, /source.*absent/i);
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

// PR #4076 comment 6107462205 (Ask Largo standing mandate, 2026-10-11): "Why this setup" read as a
// flat key:value dump next to "Trade manager read"'s narrated voice. Fix (additive only — see
// synthesizedSetupLede's own doc comment): a synthesized opening sentence for the simple, common
// case, with the original flat lines ALWAYS surviving as a fallback for every edge case.
test("whyThisSetupSection: synthesizes a lede sentence for the common case, replacing (not duplicating) Signals/Archetype/Sub-lane", () => {
  const play = fixturePlay({
    discoveryOrigin: ["NIGHT HAWK"],
    archetype: "PULLBACK_CONTINUATION",
    subLane: "STANDARD",
    setupState: "FORMING",
    score: 51,
  });
  const section = whyThisSetupSection(play);
  assert.match(
    section.body,
    /NIGHT HAWK flagged this as a forming pullback continuation setup \(Standard \(8.15d\)\), scoring 51\./,
  );
  // the lede subsumes these — they must not ALSO appear as separate flat lines
  assert.doesNotMatch(section.body, /\*\*Signals fired:\*\*/);
  assert.doesNotMatch(section.body, /\*\*Archetype:\*\*/);
  assert.doesNotMatch(section.body, /\*\*Sub-lane:\*\*/);
});

// BUG FIX (2026-10-21, Ask Largo round-3 deep-dive, live repro TSLA WATCH): the lede above already
// subsumes Signals/Archetype/Sub-lane, but setupState ALSO got restated a second time via the
// trailing "Setup maturity" flat line in the SAME section — the identical "lede subsumes, never
// duplicates" bug the test above already guards for the other three fields, just missed for this one.
test("whyThisSetupSection: lede subsumes 'Setup maturity' too — setupState must not restate a second time in the same section", () => {
  const play = fixturePlay({
    discoveryOrigin: ["NIGHT HAWK"],
    archetype: "PULLBACK_CONTINUATION",
    subLane: "STANDARD",
    setupState: "FORMING",
    servingSection: "WATCH",
    score: 51,
  });
  const section = whyThisSetupSection(play);
  assert.match(section.body, /flagged this as a forming pullback continuation setup/);
  const occurrences = (section.body.match(/forming/gi) ?? []).length;
  assert.equal(occurrences, 1, `expected setupState to appear exactly once, got ${occurrences} in: ${section.body}`);
  // Desk section (servingSection) is a DIFFERENT fact from setupState and the lede never folds it
  // in — it must still render here for a non-WATCH bucket (no bucket passed = legacy/non-watch call).
  assert.match(section.body, /Desk section: \*\*WATCH\*\*/);
});

// BUG FIX (2026-10-21, Ask Largo round-3 deep-dive, live repro TSLA WATCH): for the WATCH bucket,
// watchEntrySection (play-brief.ts, the Entry section composeSwingPlayBrief always places
// immediately before this one for a WATCH play) already renders the identical servingSection/
// setupState facts as "Serving section"/"Setup" — so this section must omit both entirely for
// bucket==="watch", not just dedupe within itself.
test("whyThisSetupSection: omits Desk section/Setup maturity entirely for the WATCH bucket — watchEntrySection already states both", () => {
  const play = fixturePlay({
    discoveryOrigin: ["CATALYST", "FLOW"],
    archetype: "BREAKOUT",
    subLane: "TACTICAL",
    setupState: "TRIGGERED",
    servingSection: "WATCH",
    score: 31,
  });
  const section = whyThisSetupSection(play, "watch");
  assert.match(section.body, /flagged this as a triggered/);
  assert.doesNotMatch(section.body, /Desk section:/);
  assert.doesNotMatch(section.body, /Setup maturity:/);
});

// FIX (Ask Largo standing mandate, 2026-10-14, live AMD repro): setupState EXTENDED (a vowel-
// starting enum member) used to render "flagged this as a extended pullback continuation setup" --
// a grammar bug in otherwise-polished trade-manager prose.
test("whyThisSetupSection: uses 'an' (not 'a') before a vowel-starting setupState", () => {
  const play = fixturePlay({
    discoveryOrigin: ["NIGHT HAWK"],
    archetype: "PULLBACK_CONTINUATION",
    subLane: "STANDARD",
    setupState: "EXTENDED",
    score: 56,
  });
  const section = whyThisSetupSection(play);
  assert.match(section.body, /flagged this as an extended pullback continuation setup/);
  assert.doesNotMatch(section.body, /flagged this as a extended/);
});

test("whyThisSetupSection: 'Today's regime read' always stays its own separate line, even when the lede fires — pinned archetype vs fresh regime can diverge and that must stay visible", () => {
  const play = fixturePlay({
    discoveryOrigin: ["FLOW"],
    archetype: "BREAKOUT",
    regime: "Event-driven directional · regime 0.6",
  });
  const section = whyThisSetupSection(play);
  assert.match(section.body, /flagged this as a breakout continuation setup/);
  assert.match(section.body, /\*\*Today's regime read:\*\* Event-driven directional · regime 0\.6/);
});

// BUG FIX (2026-10-24, Ask Largo standing mandate, live repro BMNR): defense-in-depth guard — see
// the comment above the `if (play.regime...)` line in play-brief-intel.ts for the full root cause
// (the same BANGER_LEDGER_REGIME_LABEL sentinel the Command Deck's TerminalPlay.regime leak was
// fixed for). The live production fix point is the shared adapter (terminalPlayFromHorizon,
// adapters.ts), which the play-brief pipeline always routes through — but this test constructs the
// fixture directly (bypassing the adapter) to prove this section ALSO never renders the sentinel,
// independent of whether an upstream caller remembered to scrub it first.
test("whyThisSetupSection: never renders 'Today's regime read' when regime carries the Banger-ledger sentinel, even if the caller bypassed the adapter's own guard", () => {
  const play = fixturePlay({
    discoveryOrigin: ["BANGER"],
    archetype: "BREAKOUT",
    regime: BANGER_LEDGER_REGIME_LABEL,
  });
  const section = whyThisSetupSection(play);
  assert.doesNotMatch(section.body, /Today's regime read/, "the internal sentinel must never surface as a displayed regime read");
});

test("whyThisSetupSection: lede stands down (falls back to flat lines) on a near-tie classification — that disclosure must not be smoothed over", () => {
  const play = fixturePlay({
    discoveryOrigin: ["FLOW"],
    archetype: "BREAKOUT",
    archetypeNearTie: { secondaryLabel: "Pullback continuation", marginPct: 3 },
  });
  const section = whyThisSetupSection(play);
  assert.doesNotMatch(section.body, /flagged this as a/);
  assert.match(section.body, /\*\*Signals fired:\*\* FLOW/);
  assert.match(section.body, /\*\*Archetype:\*\* Breakout continuation/);
  assert.match(section.body, /near-tie at entry/);
});

test("whyThisSetupSection: lede stands down on a thin-evidence entry — that disclosure must not be smoothed over", () => {
  const play = fixturePlay({
    discoveryOrigin: ["FLOW"],
    archetype: "BREAKOUT",
    entryPresentPillars: 3,
  });
  const section = whyThisSetupSection(play);
  assert.doesNotMatch(section.body, /flagged this as a/);
  assert.match(section.body, /\*\*Signals fired:\*\* FLOW/);
  assert.match(section.body, /thin read — \*\*3\/7\*\* pillars grounded/);
});

test("whyThisSetupSection: lede stands down when the score was withheld — never quotes a withheld score as real", () => {
  const play = fixturePlay({
    discoveryOrigin: ["FLOW"],
    archetype: "BREAKOUT",
    scoreWithheld: true,
  });
  const section = whyThisSetupSection(play);
  assert.doesNotMatch(section.body, /flagged this as a/);
  assert.match(section.body, /\*\*Signals fired:\*\* FLOW/);
});

test("whyThisSetupSection: lede stands down when there's no discoveryOrigin or no recognized archetype — never fabricates signals/archetype that aren't there", () => {
  const noSignals = whyThisSetupSection(fixturePlay({ archetype: "BREAKOUT" }));
  assert.doesNotMatch(noSignals.body, /flagged this as a/);
  const noArchetype = whyThisSetupSection(fixturePlay({ discoveryOrigin: ["FLOW"], archetype: null }));
  assert.doesNotMatch(noArchetype.body, /flagged this as a/);
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

// BUG FIX (Ask Largo standing mandate, 2026-10-07): `giveback.capturePct` divides RUNNER-only
// `play.pnlPct` against `play.peak` — honest while nothing has been banked, but once a trim has
// already fired this capture branch's "Gave back X% from peak — consider trim into strength"
// wording is doubly wrong: the percentage describes only the still-open runner (not the whole
// position's blended outcome), and "consider trim into strength" implies the protective trim
// hasn't happened yet, when it already has. Mirrors the round_trip branch's own anyTrimBanked
// disclosure a few lines above in play-brief-intel.ts (and the sibling fix in
// play-brief-narrative.ts's actionNarrative capture branch, same root cause, same day).
test("holdPlanSection: capture giveback note discloses an already-banked trim tranche and drops the stale 'trim into strength' clause", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({
      status: "HOLD",
      recommendation: "HOLD",
      contract: "110C · 12DTE",
      peak: 130,
      pnlPct: 20,
      // The giveback computation this test targets lives inside holdPlanSection's
      // `if (play.thesisHealth)` block (it also narrates health%/tighten-risk) — any truthy
      // thesisHealth object enters that block; `uncalibrated: true` keeps this test focused on
      // the giveback bullet alone, same shape as the NRG repro fixture above.
      thesisHealth: {
        health: 46,
        entryIndex: 60,
        currentIndex: 46,
        delta: -14,
        rung: "degraded",
        rungLabel: "Degraded",
        pillars: [],
        moves: [],
        committedAtEt: null,
        computedAtEt: "10:00 ET",
        advisory: "Thesis fading — tighten risk or trim into strength.",
        thesisBreakLevel: "warn",
      },
      exitPolicy: {
        policy: "trim_scale",
        hard_stop_pct: -60,
        target_pct: 200,
        trim_levels: [{ trigger_pct: 100, fraction: 0.5, premium: 33.3, fired: true }],
        runner_fraction: 0.5,
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
    /Gave back \*\*85%\*\* of the runner since peak.*already banked at a profit/,
    `expected a banked-aware capture giveback bullet, got: ${section!.body}`,
  );
  assert.doesNotMatch(section!.body, /consider trim into strength/);
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

// BUG FIX (2026-09-21, Ask Largo standing mandate — third instance of #5362's duplication class,
// live repro SWING:BLSH:1179): the expandIntel=1 expanded view renders "Hold plan" as its own
// standalone section alongside "Trade manager read" (the default collapsed view folds it away
// instead), and actionNarrative (play-brief-narrative.ts) already renders the identical round_trip
// fact into "Trade manager read" unconditionally whenever giveback.kind==="round_trip" — so this
// bullet duplicated it on every expanded-view read. Same guard shape as lessonsSection's own
// roundTripAlreadyNoted for the closed-play sibling.
test("holdPlanSection: round-trip note suppressed when narrative already stated it (narrativeAlreadyNoted.roundTrip)", () => {
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
  const withoutSuppression = holdPlanSection(ctx);
  assert.match(withoutSuppression!.body, /Round-tripped past breakeven/);

  const suppressed = holdPlanSection(ctx, { roundTrip: true });
  assert.ok(suppressed, "contract runway line still renders regardless of the round-trip note");
  assert.doesNotMatch(suppressed!.body, /Round-tripped past breakeven/);
});

// Same shape, capture branch: live BLSH:1179 repro had capturePct ~52.5% (well under this
// section's own <70 floor, which is itself a strict subset of actionNarrative's <75 floor), so
// actionNarrative's "Gave back **47%** of peak" ALWAYS fires before this section's "Gave back
// **47%** from peak" can, guaranteeing the duplicate whenever this branch is reachable.
test("holdPlanSection: capture giveback note suppressed when narrative already stated it (narrativeAlreadyNoted.capture)", () => {
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
  const withoutSuppression = holdPlanSection(ctx);
  assert.match(withoutSuppression!.body, /Gave back \*\*70%\*\* from peak/);

  const suppressed = holdPlanSection(ctx, { capture: true });
  assert.ok(suppressed, "contract runway line still renders regardless of the capture note");
  assert.doesNotMatch(suppressed!.body, /Gave back/i);
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

test("lessonsSection: omits the round-trip sentence AND its coupled advice when the Trade manager read section already stated it, but keeps everything else independent", () => {
  // CORRECTED 2026-09-18 (Ask Largo standing mandate, live repro AAPL:38): this test used to
  // assert "gave back the move" survives when only roundTripAlreadyNoted=true — that was never
  // actually achievable in production. `closedCoaching`'s round_trip branch (the only emitter of
  // "Round-tripped past breakeven" for bucket==="closed" — play-brief-narrative.ts's own
  // OPEN-flavored version explicitly `return`s null for bucket==="closed") always renders the
  // round-trip fact and its advice clause (whichever of its two phrasings) as ONE atomic sentence,
  // never independently. So if roundTripAlreadyNoted is true, the advice was necessarily already
  // stated too, whichever phrasing it used — see the `!adviceAlreadyNoted && !roundTripAlreadyNoted`
  // fix in this section's own body for the live repro this correction is paired with.
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
  assert.match(withoutSuppression!.body, /gave back the move/i);

  const suppressed = lessonsSection(play, true);
  assert.ok(suppressed);
  assert.doesNotMatch(suppressed!.body, /round-tripped past breakeven/i);
  assert.doesNotMatch(suppressed!.body, /gave back the move/i);
  // The rest of the post-mortem (peak/exit line, exit reason, archetype tag) is independent
  // evidence and must survive the suppression.
  assert.match(suppressed!.body, /Peak was/i);
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

test("lessonsSection: omits the round-trip advice line when roundTripAlreadyNoted is true, even for a peak<=20% round-trip whose Trade-manager-read advice used the 'wouldn't have helped' phrasing instead of 'tighten at first trim rail next time'", () => {
  // Live repro 2026-09-18 (AAPL:38, CLOSED/stopped, real production play-brief): closedCoaching's
  // round_trip branch (play-brief-narrative-coaching.ts) has TWO advice phrasings depending on
  // outcome.peakPct -- "tighten at first trim rail next time" when peakPct > 20, or "a trim rail
  // wouldn't have helped here; review entry timing or thesis strength instead" when peakPct <= 20
  // -- always in the SAME sentence as "Round-tripped past breakeven". AAPL:38's peak was only
  // +10.2%, so "Trade manager read" rendered the SECOND phrasing: "...a trim rail wouldn't have
  // helped here; review entry timing or thesis strength instead." "Lessons" then independently
  // rendered "**Gave back the move** — next time tighten at first trim rail or thesis fade." --
  // directly CONTRADICTING advice on the same trade (one section says trimming wouldn't have
  // helped, the next says the lesson is to trim earlier), not just a restatement. The prior
  // adviceAlreadyNoted call-site derivation only matched the first phrasing, so it never
  // suppressed this one. Since closedCoaching always emits the round-trip fact and its advice
  // (whichever phrasing) as one atomic sentence, roundTripAlreadyNoted=true alone must be enough
  // to suppress the advice line too.
  const play = fixturePlay({
    status: "CLOSED",
    peak: 10.2,
    exitPnlPct: -33.2,
    mfeCapturePct: null,
    closedReason: "stopped",
    archetype: "EVENT_DRIVEN",
  });

  const withoutSuppression = lessonsSection(play, false, false, false);
  assert.ok(withoutSuppression);
  assert.match(withoutSuppression!.body, /gave back the move/i);

  // roundTripAlreadyNoted=true, adviceAlreadyNoted=false (simulating the "wouldn't have helped"
  // phrasing, which the call site's string match does not recognize) -- the advice line must
  // still be suppressed, since it was already covered by whichever phrasing appeared alongside
  // the round-trip fact.
  const suppressed = lessonsSection(play, true, false, false);
  assert.ok(suppressed);
  assert.doesNotMatch(suppressed!.body, /gave back the move/i);
  assert.doesNotMatch(suppressed!.body, /round-tripped past breakeven/i);
  // Independent evidence must survive.
  assert.match(suppressed!.body, /Peak was/i);
  assert.match(suppressed!.body, /event-driven/i);
});

test("lessonsSection: omits the 'Strong exit discipline' capture verdict when Trade manager read already stated the identical capture>=75 fact", () => {
  // Live repro 2026-09-18 (CRWD:19, CLOSED/target, real production play-brief): "Trade manager
  // read" (closedCoaching, play-brief-narrative-coaching.ts capture>=75 branch) rendered
  // "**Strong discipline** — captured **85.7%** of peak; replicate trim timing." — "Lessons"
  // (this function) then independently restated the SAME fact one section later: "MFE capture:
  // 85.7% of peak move" + "**Strong exit discipline** — banked most of the move; replicate trim
  // ladder timing." Today's roundTripAlreadyNoted/adviceAlreadyNoted/stopAdviceAlreadyNoted fixes
  // only covered the round_trip kind (and the capture<35 "gave back" branch, which already reuses
  // adviceAlreadyNoted's exact string) — this capture>=75 "Strong discipline" branch, arguably the
  // MOST common closed-play outcome (any well-managed winner), was never gated at all.
  const play = fixturePlay({
    status: "CLOSED",
    peak: 161.3,
    exitPnlPct: 138.3,
    mfeCapturePct: 85.7,
    closedReason: "target",
    archetype: "SECTOR_ROTATION",
  });

  const withoutSuppression = lessonsSection(play, false, false, false, false);
  assert.ok(withoutSuppression);
  assert.match(withoutSuppression!.body, /strong exit discipline/i);
  assert.match(withoutSuppression!.body, /MFE capture/i);

  const suppressed = lessonsSection(play, false, false, false, true);
  assert.ok(suppressed);
  assert.doesNotMatch(suppressed!.body, /strong exit discipline/i);
  // Independent evidence must survive: peak/exit line, the raw MFE-capture percentage, exit
  // reason, and archetype tag — only the restated verdict sentence is suppressed.
  assert.match(suppressed!.body, /Peak was/i);
  assert.match(suppressed!.body, /MFE capture/i);
  assert.match(suppressed!.body, /mechanical exit fired as designed/i);
  assert.match(suppressed!.body, /sector rotation leadership/i);
});

test("lessonsSection: omits the bare 'Exit: **{reason}**' restatement when Trade manager read already stated the same reason, but keeps it for thesis/stopped whose Trade-manager phrasing is a paraphrase, not a duplicate", () => {
  // Live repro (2026-10-18, Ask Largo × Night Hawk Swings mandate, real production play-briefs):
  // BE/MSFT (closedReason=target) and PYPL (closedReason=flat) all rendered BOTH "Trade manager
  // read" — "Exit reason: **target**" (closedCoaching's generic fallback, play-brief-
  // narrative-coaching.ts:1624, which fires for every closedReason outside its "thesis"/"stopped"/
  // "stop" special cases) — AND, one section later in the same response, "Lessons" (this function)
  // independently restating "Exit: **target**" — the identical word twice, two sections apart.
  const targetPlay = fixturePlay({
    status: "CLOSED",
    peak: 40,
    exitPnlPct: 36,
    mfeCapturePct: 90,
    closedReason: "target",
  });
  const withoutSuppression = lessonsSection(targetPlay, false, false, false, false, false);
  assert.ok(withoutSuppression);
  assert.match(withoutSuppression!.body, /Exit: \*\*target\*\*/);

  const suppressed = lessonsSection(targetPlay, false, false, false, false, true);
  assert.ok(suppressed);
  assert.doesNotMatch(suppressed!.body, /Exit: \*\*target\*\*/);
  // Independent evidence must survive — only the restated reason line is suppressed.
  assert.match(suppressed!.body, /Peak was/i);
  assert.match(suppressed!.body, /mechanical exit fired as designed/i);

  // thesis/stopped keep their own distinctly-worded phrasing in "Trade manager read" (a paraphrase,
  // not an exact duplicate), so the Lessons line must still render even when the flag is true.
  const thesisPlay = fixturePlay({ status: "CLOSED", closedReason: "thesis" });
  const thesisSection = lessonsSection(thesisPlay, false, false, false, false, true);
  assert.ok(thesisSection);
  assert.match(thesisSection!.body, /Exit: \*\*thesis\*\*/);

  const stoppedPlay = fixturePlay({ status: "CLOSED", peak: 5, exitPnlPct: -50, closedReason: "stopped" });
  const stoppedSection = lessonsSection(stoppedPlay, false, false, false, false, true);
  assert.ok(stoppedSection);
  assert.match(stoppedSection!.body, /Exit: \*\*stopped\*\*/);
});

test("lessonsSection: never renders the 'Executable vs mid exit' slippage bullet for a CLOSED play — pins the intentional removal of dead code (SWING-SYSTEM-CTO-AUDIT-2026-09-06.md item #52)", () => {
  // REMOVED (2026-10-18, Ask Largo × Night Hawk Swings mandate): the bullet's gate —
  // `play.execPnlPct != null && play.exitPnlPct != null && |delta| > 5` — could never clear for a
  // real CLOSED swing play because terminalPlayFromHorizon (adapters.ts) unconditionally forces
  // execPnlPct to null whenever status === "CLOSED", and SwingClosedDeckSource never supplies an
  // alternate value. This pins the intentional omission directly at the fixture level (supplying a
  // non-null execPnlPct that diverges from exitPnlPct by well over 5, which — were the dead branch
  // still present — would have fired it) so a future refactor can't silently resurrect it.
  const execPnlPlay = fixturePlay({
    status: "CLOSED",
    peak: 40,
    exitPnlPct: 36,
    mfeCapturePct: 90,
    closedReason: "target",
    execPnlPct: 20, // diverges from exitPnlPct(36) by 16 — would have fired the old gate (>5)
  });
  const execPnlSection = lessonsSection(execPnlPlay, false, false, false, false);
  assert.ok(execPnlSection);
  assert.doesNotMatch(execPnlSection!.body, /executable vs mid exit/i);
  assert.doesNotMatch(execPnlSection!.body, /slippage on the tape/i);
});

test("buildIntelSections: Lessons omits the bare exit-reason restatement when Trade manager read already stated it via the generic fallback", () => {
  const play = fixturePlay({
    status: "CLOSED",
    peak: 40,
    exitPnlPct: 36,
    mfeCapturePct: 90,
    closedReason: "flat",
    archetype: "PULLBACK_CONTINUATION",
  });
  const ctx: SwingPlayBriefContext = {
    play,
    asOf: "2026-10-18T16:00:00.000Z",
    sessionDate: "2026-10-18",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
  };

  const sections = buildIntelSections(ctx, "closed");
  const narrative = sections.find((s) => s.title === "Trade manager read");
  const lessons = sections.find((s) => s.title === "Lessons");

  assert.ok(narrative, "Trade manager read must render");
  assert.match(narrative!.body, /Exit reason: \*\*flat\*\*/);

  assert.ok(lessons, "Lessons must still render (independent evidence survives)");
  assert.doesNotMatch(
    lessons!.body,
    /Exit: \*\*flat\*\*/,
    "Lessons must not restate the exact exit-reason fact Trade manager read already gave",
  );
  assert.match(lessons!.body, /Peak was/i);
  assert.match(lessons!.body, /pullback continuation/i);
});

test("buildIntelSections: Lessons omits the generic invalidation-check ask when Trade manager read already answered it with the computed cushion", () => {
  // GAP FOUND (2026-09-29, Ask Largo standing mandate, live repro HUT:43 CLOSED/stopped, real
  // production play-brief): closedCoaching's 2026-09-28 fix (play-brief-narrative-coaching.ts)
  // replaced its generic "check if entry was extended past invalidation" ask with a computed
  // cushion answer ("entry X vs invalidation Y, a Z% cushion at commit...") whenever
  // entryTriggerUnderlyingPx/invalidationUnderlyingPx are both pinned — but the call site's
  // stopAdviceAlreadyNoted dedup flag (buildIntelSections, this file) still only string-matched
  // the OLD generic phrasing, which the new cushion answer no longer contains. Live response
  // rendered BOTH: "Trade manager read" — "**Stop fired** (stopped) — entry 100.97 vs
  // invalidation 94.01, a +6.9% cushion at commit..." — and, one section below in the same
  // response, "Lessons" — "Stop loss — check if invalidation level was respected or entry was
  // extended." — independently re-asking the exact question just answered.
  const play = fixturePlay({
    status: "CLOSED",
    peak: 8.5,
    exitPnlPct: -50.9,
    closedReason: "stopped",
    archetype: "PULLBACK_CONTINUATION",
    entryTriggerUnderlyingPx: 100.97,
    invalidationUnderlyingPx: 94.01,
  });
  const ctx: SwingPlayBriefContext = {
    play,
    asOf: "2026-09-28T16:00:00.000Z",
    sessionDate: "2026-09-28",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
  };

  const sections = buildIntelSections(ctx, "closed");
  const narrative = sections.find((s) => s.title === "Trade manager read");
  const lessons = sections.find((s) => s.title === "Lessons");

  assert.ok(narrative, "Trade manager read must render");
  assert.match(narrative!.body, /cushion at commit/i);

  assert.ok(lessons, "Lessons must still render (independent evidence survives)");
  assert.doesNotMatch(
    lessons!.body,
    /check if invalidation level was respected or entry was extended/i,
    "Lessons must not re-ask a question Trade manager read already answered with the real cushion",
  );
  // Independent evidence must survive — only the answered-question line is suppressed.
  assert.match(lessons!.body, /Peak was/i);
  assert.match(lessons!.body, /pullback continuation/i);
});

test("lessonsSection: a small peak (<=20%) with weak capture (<35%) still gets a verdict line, not just the bare fact", () => {
  // FINDINGS 2026-09-20 (Ask Largo × Night Hawk Swings mandate): the capture<35 branch only had a
  // verdict line when `play.peak > 20` ("Gave back the move ... tighten at first trim rail") — for
  // `play.peak <= 20` the if/else chain fell all the way through with nothing pushed beyond the
  // bare "MFE capture: X% of peak move" fact, unlike every other capture band (>=75%, 35-75%, and
  // the round-trip kind's own peak<=20 exception) which all render some verdict. No live closed
  // position has hit this exact combination yet (checked via GET /api/market/swing/record — every
  // low-peak trade to date either round-tripped to a loss or nearly fully captured its small peak),
  // so this is a code-read gap, not a live repro — caught by comparing this if/else chain against
  // the sibling `closedCoaching` (play-brief-narrative-coaching.ts), which is exhaustive here via a
  // plain catch-all `else`.
  const play = fixturePlay({
    status: "CLOSED",
    peak: 12,
    exitPnlPct: 3,
    mfeCapturePct: null,
    closedReason: "time_stop",
    archetype: "PULLBACK_CONTINUATION",
  });

  const section = lessonsSection(play, false, false, false, false);
  assert.ok(section);
  assert.match(section!.body, /MFE capture: \*\*\+25\.0%\*\* of peak move/);
  // The gap: previously nothing rendered here at all for this exact peak/capture combination.
  assert.match(section!.body, /small move, weakly captured/i);
  assert.match(section!.body, /trim rail/i);
  // Must not collide with the sibling peak>20 branch's distinct wording.
  assert.doesNotMatch(section!.body, /gave back the move/i);
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

// Live repro 2026-09-21 (KKR closed play, real production play-brief, Ask Largo × Night Hawk
// Swings mandate): "Lessons" unconditionally rendered "Mechanical exit fired as designed —
// thesis or ladder did its job." for ANY closedReason of "target"/"ratchet", with no regard for
// how the trade actually played out. Real numbers: peak +203.8%, exit +50.5%, MFE capture 24.8%
// — a genuinely bad outcome (gave back three-quarters of the peak move) — and the SAME section
// rendered "MFE capture: 24.8% of peak move" immediately followed by the unqualified "did its
// job" praise, directly contradicting the capture-quality read two lines above it (and, when not
// deduped into "Trade manager read", the "Gave back the move — tighten at first trim rail" line
// right next to it). A mechanically-correct exit is not the same claim as "this was a good
// outcome"; the line must not praise a giveback.
test("lessonsSection: does not claim 'did its job' for a target/ratchet exit that gave back most of its peak", () => {
  const weakCapturePlay = fixturePlay({
    status: "CLOSED",
    peak: 203.8,
    exitPnlPct: 50.5,
    mfeCapturePct: 24.8,
    closedReason: "target",
    archetype: "SECTOR_ROTATION",
  });
  const section = lessonsSection(weakCapturePlay, false, false, false, false);
  assert.ok(section);
  assert.doesNotMatch(section!.body, /did its job/i);
  assert.match(section!.body, /ladder banked little of the peak/i);

  // A genuinely strong capture on the same closedReason must still get the "did its job" praise —
  // the fix narrows the unqualified line, it doesn't remove it.
  const strongCapturePlay = fixturePlay({
    status: "CLOSED",
    peak: 60,
    exitPnlPct: 55,
    mfeCapturePct: 91.7,
    closedReason: "target",
    archetype: "SECTOR_ROTATION",
  });
  const strongSection = lessonsSection(strongCapturePlay, false, false, false, false);
  assert.ok(strongSection);
  assert.match(strongSection!.body, /did its job/i);
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

test("macroTapeSection: CPI and 10Y each disclose their OWN print date, not a single combined vintage (Ask Largo standing mandate, live repro 2026-10-13)", () => {
  // Live-verified the day this test was written: Polygon's own /fed/v1/treasury-yields returned
  // date 2026-10-08 (5 days old) while /fed/v1/inflation returned date 2026-08-01 (73 days old) —
  // same read. The old render showed neither date, so a member had no way to tell the CPI figure
  // was ~2.5 months older than the rates line sitting right next to it.
  const section = macroTapeSection({
    ticker: "SPX",
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
      scope: "index",
      earnings: null,
      fundamentals: null,
      related: null,
      news: null,
      macro: {
        yield_10_year: 5.22,
        curve_10y_1y_spread: 0.78,
        cpi: 334.1,
        as_of: "2026-10-08",
        treasury_as_of: "2026-10-08",
        cpi_as_of: "2026-08-01",
      },
      breadth: null,
      unavailable_sources: [],
    },
  } as import("@/lib/bie/ecosystem-context").EcosystemContext);
  assert.ok(section);
  assert.match(section!.body, /10Y \*\*5\.22%\*\* \(2026-10-08\)/);
  assert.match(section!.body, /CPI \*\*334\.1\*\* \(2026-08-01 print\)/);
});

test("macroTapeSection: missing per-series dates render the figures with no false date (back-compat with fixtures predating treasury_as_of/cpi_as_of)", () => {
  const section = macroTapeSection({
    ticker: "SPX",
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
      scope: "index",
      earnings: null,
      fundamentals: null,
      related: null,
      news: null,
      macro: {
        yield_10_year: 5.22,
        curve_10y_1y_spread: 0.78,
        cpi: 334.1,
        as_of: "2026-10-08",
        treasury_as_of: null,
        cpi_as_of: null,
      },
      breadth: null,
      unavailable_sources: [],
    },
  } as import("@/lib/bie/ecosystem-context").EcosystemContext);
  assert.ok(section);
  assert.match(section!.body, /10Y \*\*5\.22%\*\*(?!\s*\()/);
  assert.match(section!.body, /CPI \*\*334\.1\*\*(?!\s*\()/);
});

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

test("catalystsSection: a genuinely lagging short-interest read carries a staleness disclosure (#4076 comment 5747893411's secondary point)", () => {
  // Beyond FUNDAMENTALS_RECENT_CEILING_MS (15d) but well under FUNDAMENTALS_ANCIENT_CEILING_MS
  // (60d) — the exact "lagging but not omitted" band the fundamentalsFreshnessTag fix carved out.
  // Mirrors the headlines block's own staleLead test just below.
  const laggingAsOf = new Date(Date.now() - 25 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
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
      fundamentals: { days_to_cover: 2.2, short_volume_ratio: 0.6, price_target: null, as_of: laggingAsOf },
      related: null,
      news: null,
      macro: null,
      breadth: null,
      unavailable_sources: [],
    },
  } as import("@/lib/bie/ecosystem-context").EcosystemContext);
  assert.ok(section);
  assert.match(section!.body, /\*\*Last settlement\*\*.*old.*short-interest may lag/s);
});

test("catalystsSection: a normal few-days-old short-interest read carries NO staleness disclosure", () => {
  const recentAsOf = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
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
      fundamentals: { days_to_cover: 2.2, short_volume_ratio: 0.6, price_target: null, as_of: recentAsOf },
      related: null,
      news: null,
      macro: null,
      breadth: null,
      unavailable_sources: [],
    },
  } as import("@/lib/bie/ecosystem-context").EcosystemContext);
  assert.ok(section);
  assert.doesNotMatch(section!.body, /Last settlement/);
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

// ENHANCEMENT (Ask Largo standing mandate, AGGRESSIVE MODE, 2026-10-18, #4076 comment
// 6243951905, live TSLA repro): earnings imminent + headlines present used to render as two
// unrelated blocks with a blank line between them — no sentence ever connected an earnings
// print to the headlines plausibly driving the move into it. Locks in the new bridging sentence
// when earnings is within the ~2-week window, and locks in its ABSENCE when earnings is too far
// out or missing, so the enhancement never fires on an unrelated or distant print.
test("catalystsSection: imminent earnings + headlines get a connecting sentence (live TSLA shape)", () => {
  const freshAsOf = new Date(Date.now() - 5_000).toISOString();
  const section = catalystsSection({
    ticker: "TSLA",
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
      earnings: { earnings_date: "2026-10-22", days_until: 4, report_time: "afterhours", is_confirmed: true },
      fundamentals: null,
      related: null,
      news: {
        count: 4,
        newest: freshAsOf,
        headlines: [
          "Tesla teases new Roadster reveal",
          "Tesla Roadster: what we know so far",
          "Analysts weigh in on the Roadster timeline",
          "Tesla stock ticks up on Roadster buzz",
        ],
        as_of: freshAsOf,
      },
      macro: null,
      breadth: null,
      unavailable_sources: [],
    },
  } as import("@/lib/bie/ecosystem-context").EcosystemContext);
  assert.ok(section);
  assert.match(section!.body, /Earnings: \*\*2026-10-22\*\* in \*\*4 days\*\*/);
  assert.match(
    section!.body,
    /That earnings date keeps IV\/positioning sensitive — the headlines below look like the likely driver into it\./,
  );
  assert.match(section!.body, /Tesla teases new Roadster reveal/);
});

test("catalystsSection: NO connecting sentence when earnings is well outside the window", () => {
  const freshAsOf = new Date(Date.now() - 5_000).toISOString();
  const section = catalystsSection({
    ticker: "TSLA",
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
      earnings: { earnings_date: "2027-01-20", days_until: 60, report_time: "afterhours", is_confirmed: true },
      fundamentals: null,
      related: null,
      news: { count: 1, newest: freshAsOf, headlines: ["Tesla teases new Roadster reveal"], as_of: freshAsOf },
      macro: null,
      breadth: null,
      unavailable_sources: [],
    },
  } as import("@/lib/bie/ecosystem-context").EcosystemContext);
  assert.ok(section);
  assert.doesNotMatch(section!.body, /keeps IV\/positioning sensitive/);
  assert.match(section!.body, /Tesla teases new Roadster reveal/);
});

test("catalystsSection: NO connecting sentence when there is no earnings date at all (regression guard)", () => {
  const freshAsOf = new Date(Date.now() - 5_000).toISOString();
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
  assert.doesNotMatch(section!.body, /keeps IV\/positioning sensitive/);
  assert.match(section!.body, /CrowdStrike stock moves higher/);
});

function ecosystemWithEarnings(
  earnings: { earnings_date: string; days_until: number; report_time: string },
): import("@/lib/bie/ecosystem-context").EcosystemContext {
  return {
    ticker: "PLAY",
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
      earnings,
      fundamentals: null,
      related: null,
      news: null,
      macro: null,
      breadth: null,
      unavailable_sources: [],
    },
  } as import("@/lib/bie/ecosystem-context").EcosystemContext;
}

// Live gap (2026-10-21, Ask Largo standing mandate): days_until<=0 collapsed to a bare "today"
// with no landed-vs-pending disclosure, the same ambiguity catalystCoaching
// (play-brief-narrative-coaching.ts) already solves for the identical arsenal.earnings field via
// printAlreadyLandedThresholdMs -- mirrors that function's own regression fixtures (real
// production asOf shape, "YYYY-MM-DD HH:mm ET", not an ISO literal -- Date.parse returns NaN on
// that shape, so a fixture using ISO would pass without proving the real parse path works).
test("catalystsSection: same-day AFTERHOURS print already landed (past 16:00 ET) reads as already printed, not a bare 'today'", () => {
  const section = catalystsSection(
    ecosystemWithEarnings({ earnings_date: "2026-09-14", days_until: 0, report_time: "afterhours" }),
    { asOf: "2026-09-14 19:07 ET" } as SwingPlayBriefContext,
  );
  assert.ok(section);
  assert.match(section!.body, /Earnings: \*\*2026-09-14\*\* \*\*already printed\*\* \(afterhours\)/);
});

test("catalystsSection: same-day AFTERHOURS print NOT yet landed (before 16:00 ET) still reads as 'today', not already printed", () => {
  const section = catalystsSection(
    ecosystemWithEarnings({ earnings_date: "2026-09-14", days_until: 0, report_time: "afterhours" }),
    { asOf: "2026-09-14 14:00 ET" } as SwingPlayBriefContext,
  );
  assert.ok(section);
  assert.match(section!.body, /Earnings: \*\*2026-09-14\*\* \*\*today\*\* \(afterhours\)/);
  assert.doesNotMatch(section!.body, /already printed/i);
});

test("catalystsSection: same-day PREMARKET print already landed (past 09:30 ET) reads as already printed", () => {
  const section = catalystsSection(
    ecosystemWithEarnings({ earnings_date: "2026-09-14", days_until: 0, report_time: "premarket" }),
    { asOf: "2026-09-14 11:00 ET" } as SwingPlayBriefContext,
  );
  assert.ok(section);
  assert.match(section!.body, /Earnings: \*\*2026-09-14\*\* \*\*already printed\*\* \(premarket\)/);
});

test("catalystsSection: no ctx at all keeps the pre-existing bare 'today' behavior (never fabricates a landed/pending verdict without a real clock)", () => {
  const section = catalystsSection(
    ecosystemWithEarnings({ earnings_date: "2026-09-14", days_until: 0, report_time: "afterhours" }),
  );
  assert.ok(section);
  assert.match(section!.body, /Earnings: \*\*2026-09-14\*\* \*\*today\*\* \(afterhours\)/);
  assert.doesNotMatch(section!.body, /already printed/i);
});

test("catalystsSection: a future earnings date (days_until > 0) is unaffected by the landed check", () => {
  const section = catalystsSection(
    ecosystemWithEarnings({ earnings_date: "2026-09-18", days_until: 4, report_time: "afterhours" }),
    { asOf: "2026-09-14 19:07 ET" } as SwingPlayBriefContext,
  );
  assert.ok(section);
  assert.match(section!.body, /Earnings: \*\*2026-09-18\*\* in \*\*4 days\*\* \(afterhours\)/);
  assert.doesNotMatch(section!.body, /already printed/i);
});

// FINDING (Ask Largo standing mandate, 2026-10-21): same defect class as chartLevelsSection/
// gexPostureSection/flowIntelSection's own CLOSED-bucket fixes above -- this section rendered
// READ-TIME-current earnings/headlines for a CLOSED play with no framing, unlike every sibling
// "live read" section, which all unshift a "not what this trade traded under" disclaimer. Live
// repro: a CLOSED TSLA play (exited 5 days earlier) rendered "Earnings: 2026-10-21 today" with
// nothing distinguishing that from the live market context the trade actually traded under.
test("catalystsSection: CLOSED bucket prefixes a current-not-as-traded disclosure", () => {
  const eco = ecosystemWithEarnings({ earnings_date: "2026-10-21", days_until: 0, report_time: "afterhours" });
  const closedSection = catalystsSection(eco, {
    play: fixturePlay({ status: "CLOSED" }),
    asOf: "2026-10-21 11:00 ET",
  } as SwingPlayBriefContext);
  assert.ok(closedSection);
  assert.match(closedSection!.body, /Current catalysts — not what this trade traded under/);

  const openSection = catalystsSection(eco, {
    play: fixturePlay({ status: "OPEN" }),
    asOf: "2026-10-21 11:00 ET",
  } as SwingPlayBriefContext);
  assert.ok(openSection);
  assert.doesNotMatch(openSection!.body, /not what this trade traded under/);
});

// GAP FOUND (2026-09-28, Ask Largo standing mandate): live repro U/WATCH — arsenal.news.headlines
// carried the SAME headline text twice ("10 Information Technology Stocks Whale Activity In
// Today's Session" at both index 0 and 2), burning one of only 4 shown slots on a repeat.
test("catalystsSection: duplicate headline text is deduped, never burning one of the 4 shown slots", () => {
  const freshAsOf = new Date(Date.now() - 5_000).toISOString();
  const section = catalystsSection({
    ticker: "U",
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
      news: {
        count: 5,
        newest: freshAsOf,
        headlines: [
          "10 Information Technology Stocks Whale Activity In Today's Session",
          "10 Information Technology Stocks With Whale Alerts In Today's Session",
          "10 Information Technology Stocks Whale Activity In Today's Session",
          "Is Fortnite Down? Here's Why Servers Are Offline",
          "A genuinely distinct fifth headline",
        ],
        as_of: freshAsOf,
      },
      macro: null,
      breadth: null,
      unavailable_sources: [],
    },
  } as import("@/lib/bie/ecosystem-context").EcosystemContext);
  assert.ok(section);
  const bulletLines = section!.body.split("\n").filter((l) => l.startsWith("• "));
  assert.equal(bulletLines.length, 4, "still shows 4 headlines, not 3");
  const occurrences = bulletLines.filter(
    (l) => l === "• 10 Information Technology Stocks Whale Activity In Today's Session",
  );
  assert.equal(occurrences.length, 1, "the duplicate headline appears only once");
  assert.match(
    section!.body,
    /A genuinely distinct fifth headline/,
    "dedup happens BEFORE the top-4 slice, so the real 4th distinct headline still makes the cut",
  );
});

// Ask Largo standing mandate, same #5351/#5392-class readMs-anchor sweep — catalystsSection was
// NOT among the 9 sites #5392 fixed (confirmed against #5392's own diff, which never touched this
// function) even though it reads TWO freshness-bearing fields (fundamentals.as_of, news.as_of) and
// sampled a fresh Date.now() at each. A real request runs sections sequentially with real I/O in
// between, so each bare Date.now() sample can land on a different real instant and disagree with a
// sibling section about whether the SAME arsenal read is stale.
test("catalystsSection: uses ctx.readMs as the staleness anchor for fundamentals, not the real wall clock", () => {
  const anchorFarFuture = Date.now() + 365 * 24 * 60 * 60_000; // 1 year past real now
  const freshAsOf = new Date(Date.now() - 60_000).toISOString(); // fresh vs real now, ancient vs anchor
  const ecosystem = {
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
      fundamentals: { days_to_cover: 12.4, short_volume_ratio: 0.41, price_target: null, as_of: freshAsOf },
      related: null,
      news: null,
      macro: null,
      breadth: null,
      unavailable_sources: [],
    },
  } as unknown as EcosystemContext;

  // No ctx (or a real-clock ctx): fundamentals is fresh, so the section renders it.
  const liveSection = catalystsSection(ecosystem);
  assert.ok(liveSection);
  assert.match(liveSection!.body, /short DTC/);

  // ctx.readMs anchored a year in the future: the SAME fundamentals read must now be treated as
  // ancient and omitted — same as fundamentalsAncient's own ancient-omission contract (Largo C3).
  const ctx = { readMs: anchorFarFuture } as SwingPlayBriefContext;
  const anchoredSection = catalystsSection(ecosystem, ctx);
  assert.equal(
    anchoredSection,
    null,
    "must read fundamentals as ancient under ctx.readMs even though it is fresh under the real wall clock",
  );
});

test("catalystsSection: uses ctx.readMs as the staleness anchor for news headlines, not the real wall clock", () => {
  const anchorFarFuture = Date.now() + 365 * 24 * 60 * 60_000; // 1 year past real now
  const freshAsOf = new Date(Date.now() - 5_000).toISOString(); // fresh vs real now, stale vs anchor
  const ecosystem = {
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
  } as unknown as EcosystemContext;

  // No ctx: news is fresh under the real wall clock, so no staleness disclosure.
  const liveSection = catalystsSection(ecosystem);
  assert.ok(liveSection);
  assert.doesNotMatch(liveSection!.body, /Last snapshot/);

  // ctx.readMs anchored a year in the future: the SAME news read must now render the staleness
  // disclosure this section already has logic for (Largo C2) — the bug was that it never consulted
  // the anchor to decide.
  const ctx = { readMs: anchorFarFuture } as SwingPlayBriefContext;
  const anchoredSection = catalystsSection(ecosystem, ctx);
  assert.ok(anchoredSection);
  assert.match(
    anchoredSection!.body,
    /\*\*Last snapshot\*\*.*old.*headlines may lag/s,
    "must read the news headlines as stale under ctx.readMs even though they are fresh under the real wall clock",
  );
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

// BUG FIX (Ask Largo standing mandate, 2026-10-20): `displaySpot != null && displaySpot >= t.vwap
// ? "above" : "below"` folds "spot unknown" into the FALSE branch via the `&&` short-circuit, so a
// null displaySpot rendered "price below session VWAP" -- a fabricated directional claim with no
// supporting data, not an honest absence. This function's own entry guard deliberately continues
// when technicals exists even though vec.spot is null (otherwise it would just check `!technicals`).
test("chartTechnicalsSection: VWAP line omits the side clause (never defaults to 'below') when spot is unknown", () => {
  const vec = fixtureVec({
    spot: null,
    technicals: {
      vwap: 150.0,
      emaStack: "9>21>50",
      rsi: null,
      macd: null,
      goldenPocket: null,
      structure: null,
    },
  });
  const section = chartTechnicalsSection(vec);
  assert.ok(section);
  assert.match(section!.body, /VWAP \*\*150\.00\*\*/);
  assert.doesNotMatch(
    section!.body,
    /VWAP.*price (above|below) session VWAP/,
    `must not fabricate a side when spot is unknown, got: ${section!.body}`,
  );
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

test("chartTechnicalsSection: CLOSED bucket also surfaces Vector's market_session_note (Largo C2, 2026-10-17 fix)", () => {
  const vec = fixtureVec({
    spot: 95,
    dataAgeMs: 0,
    freshness: "live",
    market_session_note: "VECTOR_CLOSED_MARKET_NOTE_MARKER",
    technicals: { vwap: 94.7, emaStack: "up", rsi: 67, macd: "bull", goldenPocket: null, structure: null },
  });
  const closedSection = chartTechnicalsSection(vec, null, "closed");
  assert.ok(closedSection);
  assert.match(closedSection!.body, /VECTOR_CLOSED_MARKET_NOTE_MARKER/);
});

// BUG FIX (Ask Largo standing mandate, 2026-10-17, live repro SWING:GOOGL:58 CLOSED brief):
// the unconditional `if (vectorStale) return null` made this section vanish entirely on every
// CLOSED brief once Vector's snapshot went stale — the common case, not a rare edge, since Vector
// is almost always stale by the time a position closes. Live-confirmed: GOOGL:58 rendered a full
// "Chart technicals" block once, then lost it on three immediate re-fetches once Vector went
// stale, undisclosed in unavailableSources/confidence. Bucket-gating the stale return (mirroring
// vectorDeskSection's own 2026-10-17 fix) restores this for CLOSED while leaving OPEN/WATCH's
// documented 2026-10-13 omission untouched (see the stale-returns-null tests below, which still
// use the default/open bucket and still pass).
test("chartTechnicalsSection: CLOSED bucket renders technicals even when Vector snapshot is stale (Largo C3, 2026-10-17 fix, live repro SWING:GOOGL:58)", () => {
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
  const closedSection = chartTechnicalsSection(vec, null, "closed");
  assert.ok(closedSection, "a CLOSED brief must still show the last-known chart read, not vanish silently");
  assert.match(closedSection!.body, /Current chart read — not the technicals this trade closed under/);
  assert.match(closedSection!.body, /EMA 9\/21\/50 stack: \*\*up\*\*/);
  assert.match(closedSection!.body, /RSI: \*\*67\*\*/);

  // Open/watch buckets are unaffected — same stale snapshot, same documented 2026-10-13 omission.
  assert.equal(chartTechnicalsSection(vec, null, "open"), null);
  assert.equal(chartTechnicalsSection(vec), null, "default bucket (open) behavior unchanged");
});

// BUG FIX (Ask Largo standing mandate, 2026-10-21, live repro NVDA:62/CRWV:61 CLOSED briefs): the
// 2026-10-17 fix above restored this section for CLOSED briefs, but the "Vector desk grade: X"
// push a few lines later was never re-gated alongside it, so the grade fact rendered here AND in
// vectorDeskSection's own CLOSED branch ("Current Vector read: grade X · conviction Y (since this
// play closed)") — the exact duplicate the 2026-10-13 test below (and fix) eliminated for
// OPEN/WATCH, reopened for CLOSED only. This is the CLOSED-bucket counterpart of that test.
test("chartTechnicalsSection + vectorDeskSection: CLOSED bucket never renders the same grade fact under both titles (Largo C2, live repro NVDA:62/CRWV:61)", () => {
  const vec = fixtureVec({
    spot: 95,
    play: { grade: "C", conviction: 42 },
    technicals: {
      vwap: 94.7,
      emaStack: "up",
      rsi: 67,
      macd: "bull",
      goldenPocket: null,
      structure: { type: "CHOCH", direction: "up", level: 94 },
    },
  } as Partial<VectorFullState>);

  const chart = chartTechnicalsSection(vec, null, "closed");
  const desk = vectorDeskSection(vec, null, "closed");

  assert.ok(chart, "chart technicals still shows EMA/RSI/structure for CLOSED");
  assert.doesNotMatch(chart!.body, /Vector desk grade/, "grade belongs to vectorDeskSection alone for CLOSED briefs");
  assert.ok(desk, "Vector desk remains the one place that reports the CLOSED-bucket grade");
  assert.match(desk!.body, /Current Vector read: grade \*\*C\*\*/);
});

// BUG FIX (Ask Largo standing mandate, 2026-10-20, live repro SWING:TSLA:57 CLOSED brief): with a
// stale Vector snapshot, this section still rendered the raw, stale `vec.spot` unconditionally,
// while `gexPostureSection`'s "Nearest wall ... from spot" line (same envelope, via
// `preferredGexWalls`) already falls back to the GEX matrix's own spot in that exact case — two
// different "current" spot numbers in one brief, neither flagging the other. Live TSLA:57 numbers
// reproduced here: Vector's stale spot 368.95 vs the GEX matrix's fresher spot 367.43.
test("chartTechnicalsSection: CLOSED bucket with a stale Vector snapshot shows the SAME preferred spot as gexPostureSection, not Vector's own stale spot (Largo C2, live repro TSLA:57)", () => {
  const ctx = {
    play: fixturePlay({ status: "CLOSED" }),
    asOf: "2026-10-20 08:00 ET",
    sessionDate: "2026-10-20",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: {
      gex_positioning: {
        spot: 367.43,
        gamma_posture: "long",
        net_gex: 5_000_000,
        call_wall: 375,
        put_wall: 360,
        matrix_age_sec: 10,
        freshness: "live",
      },
    } as EcosystemContext,
    vector: fixtureVec({
      spot: 368.95,
      dataAgeMs: 10 * 60_000, // well past the staleness threshold
      technicals: { vwap: 368, emaStack: "down", rsi: 40, macd: "bear", goldenPocket: null, structure: null },
    }),
  } as unknown as SwingPlayBriefContext;

  const technicals = chartTechnicalsSection(ctx.vector as VectorFullState, ctx.sessionDate, "closed", ctx);
  const gex = gexPostureSection(ctx);

  assert.ok(technicals);
  assert.ok(gex);
  // Chart technicals must show the SAME GEX-matrix-fallback spot the GEX posture section shows —
  // never Vector's own stale 368.95.
  assert.match(technicals!.body, /Spot: \*\*367\.43\*\*/);
  assert.doesNotMatch(technicals!.body, /368\.95/, "must not show Vector's stale spot once a fresher fallback exists");
  assert.match(gex!.body, /spot \*\*367\.43\*\*/);

  // The VWAP above/below call must agree with the displayed spot (367.43 < vwap 368 => below),
  // not with Vector's stale 368.95 (which would read "above").
  assert.match(technicals!.body, /VWAP \*\*368\.00\*\* — price below session VWAP/);
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

test("wallDynamicsSection: CLOSED bucket also surfaces Vector's market_session_note (Largo C2, 2026-10-17 fix)", () => {
  const vec = fixtureVec({
    dataAgeMs: 0,
    freshness: "live",
    market_session_note: "VECTOR_CLOSED_MARKET_NOTE_MARKER",
    wallEvents: [{ kind: "call_wall_building", strike: 105, message: "Call wall building at 105" }],
  });
  const closedSection = wallDynamicsSection(vec, null, "closed");
  assert.ok(closedSection);
  assert.match(closedSection!.body, /VECTOR_CLOSED_MARKET_NOTE_MARKER/);
});

// BUG FIX (Ask Largo standing mandate, 2026-10-17, live repro SWING:GOOGL:58 CLOSED brief): same
// defect class as chartTechnicalsSection above — an unconditional stale-return made wall-event
// history vanish on every CLOSED brief once Vector's snapshot aged out (the common case for a
// closed position), with the closed-bucket disclosure code below the return left unreachable.
test("wallDynamicsSection: CLOSED bucket renders wall events even when Vector snapshot is stale (Largo C3, 2026-10-17 fix, live repro SWING:GOOGL:58)", () => {
  const vec = fixtureVec({
    dataAgeMs: 200_000,
    wallEvents: [{ kind: "call_wall_building", strike: 105, message: "Call wall building at 105" }],
  });
  const closedSection = wallDynamicsSection(vec, null, "closed");
  assert.ok(closedSection, "a CLOSED brief must still show the last-known wall activity, not vanish silently");
  assert.match(closedSection!.body, /Current wall activity — not what this trade traded under/);
  assert.match(closedSection!.body, /Call wall building at 105/);

  // Open/watch buckets are unaffected — same stale snapshot, same pre-existing omission.
  assert.equal(wallDynamicsSection(vec, null, "open"), null);
  assert.equal(wallDynamicsSection(vec), null, "default bucket (open) behavior unchanged");
});

// BUG FIX (Ask Largo standing mandate, 2026-10-20): `vec.wallEvents` is chronologically ASCENDING
// (oldest-first, per eventsFromWallHistory's forward iteration) -- every sibling reader of this
// same field (wallDynamicsCoaching's `.slice(-2)`, tradeManagerNarrativeSection's
// `walls[walls.length - 1]`) takes from the END to get the most recent activity. This section's
// `.slice(0, 5)` took the FIRST 5 (oldest) instead, so a session with more than 5 events showed
// stale, superseded wall activity from hours earlier while never showing the newest shift at all.
test("wallDynamicsSection: shows the 5 MOST RECENT wall events, not the 5 oldest", () => {
  const vec = fixtureVec({
    dataAgeMs: 1_000,
    wallEvents: [
      { kind: "call_wall_building", strike: 100, message: "e0 oldest — premarket noise" },
      { kind: "call_wall_building", strike: 101, message: "e1" },
      { kind: "call_wall_building", strike: 102, message: "e2" },
      { kind: "call_wall_building", strike: 103, message: "e3" },
      { kind: "call_wall_building", strike: 104, message: "e4" },
      { kind: "call_wall_building", strike: 105, message: "e5" },
      { kind: "call_wall_building", strike: 106, message: "e6" },
      { kind: "put_wall_fading", strike: 107, message: "e7 newest — 10 minutes ago" },
    ],
  });
  const section = wallDynamicsSection(vec, null, "open");
  assert.ok(section);
  assert.match(section!.body, /e7 newest/, "must show the newest event");
  assert.match(section!.body, /e3/, "the 5 most recent span e3..e7");
  assert.doesNotMatch(section!.body, /e0 oldest/, "must not show the oldest, superseded events");
  assert.doesNotMatch(section!.body, /\be1\b/);
  assert.doesNotMatch(section!.body, /\be2\b/);
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

// Ask Largo standing mandate, same #5351/#5392/#5393-class readMs-anchor sweep — wallDynamicsSection
// and vectorDeskSection were the last two swing play-brief sections still sampling the real wall
// clock (`Date.now()`) instead of the brief's single stamped `ctx.readMs`, so a request straddling
// a staleness boundary while composing could disagree with every other section in the same brief
// about "now". Both take a NEW trailing optional `ctx` param (backward-compatible: every
// pre-existing call/test above that omits it keeps behaving identically off a fresh `Date.now()`).
test("wallDynamicsSection: uses ctx.readMs as the staleness anchor, not the real wall clock", () => {
  const anchorFarFuture = Date.now() + 365 * 24 * 60 * 60_000; // 1 year past real now
  // No dataAgeMs/freshness set — vectorAgeStale falls back to `readMs - Date.parse(vec.asOf)`,
  // the exact readMs-dependent branch this bug hits (same shape as gexPostureSection's own test).
  const vec = fixtureVec({
    asOf: new Date(Date.now() - 60_000).toISOString(), // fresh vs real now, ancient vs the far-future anchor
    wallEvents: [{ kind: "call_wall_building", strike: 105, message: "Call wall building at 105" }],
  } as Partial<VectorFullState>);
  const ctx = { readMs: anchorFarFuture } as SwingPlayBriefContext;

  // Under the real wall clock this same vec is fresh, so the section must render.
  const liveSection = wallDynamicsSection(vec, null, "open");
  assert.ok(liveSection, "fresh vs the real wall clock must render");

  // Under ctx.readMs (anchored a year out) the identical vec must read stale and suppress.
  const anchoredSection = wallDynamicsSection(vec, null, "open", ctx);
  assert.equal(
    anchoredSection,
    null,
    "must read the Vector snapshot as stale under ctx.readMs even though it is fresh under the real wall clock",
  );
});

test("vectorDeskSection: uses ctx.readMs as the staleness anchor, not the real wall clock", () => {
  const anchorFarFuture = Date.now() + 365 * 24 * 60 * 60_000; // 1 year past real now
  const vec = fixtureVec({
    asOf: new Date(Date.now() - 60_000).toISOString(), // fresh vs real now, ancient vs the far-future anchor
    play: {
      bias: "long",
      headline: "Ride momentum",
      grade: "A",
      conviction: "high",
      targets: [],
      starred: [],
    },
  } as Partial<VectorFullState>);
  const ctx = { readMs: anchorFarFuture } as SwingPlayBriefContext;

  const liveSection = vectorDeskSection(vec, null, "open");
  assert.ok(liveSection);
  assert.doesNotMatch(liveSection!.body, /Last snapshot/i, "fresh vs the real wall clock must render live");

  const anchoredSection = vectorDeskSection(vec, null, "open", ctx);
  assert.ok(anchoredSection);
  assert.match(
    anchoredSection!.body,
    /Last snapshot/i,
    "must read the Vector snapshot as stale under ctx.readMs even though it is fresh under the real wall clock",
  );
});

test("vectorDeskSection: stale Vector with no play.grade still renders the section, not null", () => {
  // FINDINGS 2026-09-20: the stale branch used to end with `if (!lines.length) return null` --
  // dead code, since the "Last snapshot ... may lag spot" line just above it is always pushed in
  // this branch, so `lines.length` can never be 0 there. This is the one combination (stale +
  // no grade) that would have exercised that dead check if it were ever reachable; asserting the
  // section still renders here locks in the real (and only ever possible) behavior.
  const vec = fixtureVec({
    freshness: "stale",
    play: {
      bias: "long",
      headline: "Ride momentum",
      grade: null,
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
  assert.match(section!.body, /Last snapshot/i);
  assert.doesNotMatch(section!.body, /Vector desk grade/i);
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

// BUG FIX (Ask Largo standing mandate, 2026-10-20, fresh-angle technicals audit): a genuinely
// dead WATCH play (EXTENDED_CHASE etc., per deadPlayReason) still reached this section's live
// directive block, directly contradicting the brief's own Verdict ("Extended past the valid
// entry window — do not chase; wait for a reset."). Mirrors watchForSection's own
// deadPlayReason guard (fixed the same day, PR #6337).
test("vectorDeskSection: suppresses entry/targets/invalidation/watch-now directives for a genuinely dead (extended-chase) WATCH play", () => {
  const vec = fixtureVec({
    freshness: "live",
    play: {
      bias: "long",
      headline: "POSITION · pivot at the 119.71 gamma flip",
      grade: "B",
      conviction: 60,
      thesis: "Pullback continuation into the flip.",
      entryZone: "118-120",
      targets: ["125", "130"],
      invalidation: "below 115",
      starred: ["POSITION · pivot at the 119.71 gamma flip", "Flip cross imminent — watch 119.71"],
    },
  } as Partial<VectorFullState>);
  const ctx = {
    play: fixturePlay({ status: "WATCH", entryStatus: "EXTENDED_CHASE" }),
  } as SwingPlayBriefContext;

  const section = vectorDeskSection(vec, null, "watch", ctx);
  assert.ok(section);
  assert.match(section!.body, /POSITION · pivot at the 119\.71 gamma flip/, "headline/grade/conviction stay — informational, not a live call");
  assert.match(section!.body, /Pullback continuation into the flip\./, "thesis stays — informational");
  assert.doesNotMatch(section!.body, /Entry zone/, "a dead play must not render a live entry-zone directive");
  assert.doesNotMatch(section!.body, /Targets:/, "a dead play must not render live targets");
  assert.doesNotMatch(section!.body, /Invalidation:/, "a dead play must not render a live invalidation level");
  assert.doesNotMatch(section!.body, /Watch now/, "a dead play must not render actionable 'Watch now' bullets");
  assert.equal(section!.bias, "neutral", "a dead play's directive must not badge bullish/bearish");
});

test("vectorDeskSection: a live (not dead) WATCH play keeps the full directive block — no regression", () => {
  const vec = fixtureVec({
    freshness: "live",
    play: {
      bias: "long",
      headline: "POSITION · pivot at the 119.71 gamma flip",
      grade: "B",
      conviction: 60,
      thesis: "Pullback continuation into the flip.",
      entryZone: "118-120",
      targets: ["125", "130"],
      invalidation: "below 115",
      starred: ["POSITION · pivot at the 119.71 gamma flip", "Flip cross imminent — watch 119.71"],
    },
  } as Partial<VectorFullState>);
  const ctx = {
    play: fixturePlay({ status: "WATCH", entryStatus: "VALID" }),
  } as SwingPlayBriefContext;

  const section = vectorDeskSection(vec, null, "watch", ctx);
  assert.ok(section);
  assert.match(section!.body, /Entry zone: \*\*118-120\*\*/);
  assert.match(section!.body, /Targets: \*\*125\*\* · \*\*130\*\*/);
  assert.match(section!.body, /Invalidation: \*\*below 115\*\*/);
  assert.match(section!.body, /\*\*Watch now:\*\*/);
  assert.equal(section!.bias, "bullish");
});

test("vectorDeskSection: no ctx.play supplied (caller omitted it) keeps the full directive block — safe default, no regression for existing no-ctx callers", () => {
  const section = vectorDeskSection(
    fixtureVec({
      freshness: "live",
      play: {
        bias: "long",
        headline: "Ride momentum",
        grade: "A",
        conviction: "high",
        thesis: "",
        entryZone: "100-102",
        targets: ["110"],
        invalidation: "below 98",
        starred: ["Ride momentum", "watch 105"],
      },
    } as Partial<VectorFullState>),
    null,
    "watch",
  );
  assert.ok(section);
  assert.match(section!.body, /Entry zone: \*\*100-102\*\*/);
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

test("vectorDeskSection: CLOSED bucket also surfaces Vector's market_session_note (Largo C2, 2026-10-17 fix)", () => {
  const vec = fixtureVec({
    freshness: "live",
    dataAgeMs: 0,
    market_session_note: "VECTOR_CLOSED_MARKET_NOTE_MARKER",
    play: {
      bias: "long",
      headline: "POSITION",
      grade: "B",
      conviction: 68,
      thesis: "thesis",
      entryZone: "zone",
      targets: ["t1"],
      invalidation: "inv",
      starred: ["POSITION"],
    },
  } as Partial<VectorFullState>);
  const closed = vectorDeskSection(vec, null, "closed");
  assert.ok(closed);
  assert.match(closed!.body, /VECTOR_CLOSED_MARKET_NOTE_MARKER/);
});

test("vectorDeskSection: CLOSED bucket reaches the closed-market disclosure even when Vector itself is stale (2026-10-17 fix, live repro SWING:TSLA:57/GOOGL:58)", () => {
  // The realistic production case PR #6115's own test above never exercised: a real CLOSED-bucket
  // read almost always has a Vector snapshot older than VECTOR_STALE_MS (the position's data is
  // from whenever it closed; Vector's live feed stops updating once the market shuts). Before this
  // fix, vectorStale=true made the function return from its generic "Last snapshot ... may lag
  // spot" branch BEFORE ever reaching the bucket==="closed" branch/closedMarketSessionNote() —
  // live-confirmed on SWING:TSLA:57 and SWING:GOOGL:58 2026-10-17.
  const readMs = Date.parse("2026-09-20T14:00:00.000Z"); // Sun 10:00 ET -- CLOSED
  const vec = fixtureVec({
    freshness: "live",
    dataAgeMs: 999_000, // far past VECTOR_STALE_MS (120_000) -- Vector itself is stale
    market_session_note: null,
    play: {
      bias: "long",
      headline: "POSITION",
      grade: "C",
      conviction: 55,
      thesis: "thesis",
      entryZone: "zone",
      targets: ["t1"],
      invalidation: "inv",
      starred: ["POSITION"],
    },
  } as Partial<VectorFullState>);
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({ status: "CLOSED" }),
    asOf: "2026-09-20 10:00 ET",
    sessionDate: "2026-09-20",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    readMs,
    ecosystem: {
      gex_positioning: {
        spot: 100,
        gamma_posture: "long",
        net_gex: 5_000_000,
        asof: new Date(readMs).toISOString(),
        freshness: "live",
      },
    } as EcosystemContext,
    vector: null,
  };
  const closed = vectorDeskSection(vec, null, "closed", ctx);
  assert.ok(closed);
  assert.match(closed!.body, /since this play closed/i);
  assert.match(
    closed!.body,
    /market is CLOSED/i,
    "GEX-fallback closed-market disclosure must still reach vectorDeskSection when Vector itself is stale",
  );
  assert.doesNotMatch(
    closed!.body,
    /may lag spot/i,
    "closed bucket must take its own framing, not the generic stale-Vector early return",
  );
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

// BUG FIX (2026-10-21, Ask Largo 5-engine cycle, live repro TSLA WATCH brief): this section (the
// one literally titled "Data freshness") checked option-mark/scan/Vector/GEX/HELIX staleness but
// never halt/LULD feed staleness, even though a stale halt feed is a live, gate-evaluated reason
// entry is blocked that the SAME envelope's "Trade manager read" section already cites.
test("dataFreshnessSection: stale halt/LULD feed (g_s12_halt_feed_stale gate) is disclosed", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({
      status: "WATCH",
      gateBlocks: [
        { code: "g_s12_halt_feed_stale", reason: "Trading-halt feed unavailable — desk will not open until halt/LULD data recovers." },
      ],
    }),
    asOf: "2026-10-21 02:30 ET",
    sessionDate: "2026-10-21",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
  };
  const section = dataFreshnessSection(ctx);
  assert.match(section!.body, /Trading-halt feed: \*\*unavailable\*\* — halt\/LULD data has not refreshed/);
});

test("dataFreshnessSection: no halt gate present does not fabricate the halt-feed line", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({ status: "WATCH", markAsOf: "2026-10-21T02:00:00.000Z" }),
    asOf: "2026-10-21 02:30 ET",
    sessionDate: "2026-10-21",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
  };
  const section = dataFreshnessSection(ctx);
  assert.ok(!section || !/Trading-halt feed/.test(section.body));
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

// BUG FIX (2026-10-21, Ask Largo standing mandate, live repros PONY/TDOC/SBET): the test above
// ("bias is never directional") happens to use a fixture with no `pnlPct` override (undefined,
// `== null`) — the genuinely-unknown-P&L case — but only ever asserted on `bias`, never on the
// wording itself. These two tests pin the wording distinction directly.
test("dataFreshnessSection: when P&L is genuinely unknown (no live tick yet, pnlPct null), does NOT tell the reader to 'treat P&L as indicative' (live repro PONY/TDOC/SBET)", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({ status: "OPEN", direction: "LONG", markIsSync: true, markAsOf: null, pnlPct: null }),
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
  assert.ok(section);
  assert.match(section!.body, /Mark age unknown/);
  assert.doesNotMatch(
    section!.body,
    /treat P&L as indicative/,
    `no P&L figure exists to be "indicative" of anything when pnlPct is null, got: ${section!.body}`,
  );
});

test("dataFreshnessSection: when a real (if untimestamped) P&L exists, keeps the existing 'treat P&L as indicative' wording (no regression)", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({ status: "OPEN", direction: "LONG", markIsSync: true, markAsOf: null, pnlPct: 12.3 }),
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
  assert.ok(section);
  assert.match(section!.body, /treat P&L as indicative/);
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

// BUG (Ask Largo standing mandate, 2026-10-07, live repro: NTAP). A dead-but-not-closed WATCH play
// (entryStatus EXTENDED_CHASE, i.e. `deadPlayReason` non-null) is exactly the case
// `collectBriefUnavailableSources` (play-brief-absence.ts) was widened on 2026-09-19 to suppress
// staleness noise for — but this section only ever checked `status === "CLOSED"`, so it kept
// rendering "HELIX flow: pipeline stale" for a play whose SAME envelope's unavailableSources[] and
// confidence prose both correctly said every live source resolved cleanly. Proves the suppression
// now matches collectBriefUnavailableSources's own isNotLive gate via the shared
// isSwingPlayStaleCheckExempt predicate.
test("dataFreshnessSection: suppresses HELIX-stale prose for a dead (extended-chase) WATCH play, matching collectBriefUnavailableSources's isNotLive gate (Ask Largo 2026-10-07, live repro NTAP)", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({ status: "WATCH", entryStatus: "EXTENDED_CHASE" }),
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
  if (section) {
    assert.doesNotMatch(
      section.body,
      /HELIX flow: \*\*pipeline stale\*\*/,
      "a dead WATCH play's narrative must not assert HELIX staleness when the structured unavailableSources[]/confidence for the same brief say every live source resolved cleanly",
    );
  }
});

// Ask Largo standing mandate follow-up to #5351: dataFreshnessSection independently sampled the
// real wall clock (Date.now()) for its option-mark/Vector/GEX staleness checks instead of
// consulting ctx.readMs, the one canonical "now" composeSwingPlayBrief stamps before any section
// builds. Because compose does real sequential I/O between sections, this section's own
// Date.now() sample can land on the opposite side of a staleness cutoff from a sibling section
// (watchForSection, already fixed in #5351) reasoning about the SAME underlying field — the exact
// "same fact, two answers within one envelope" defect #5351 fixed for a different pair of sections.
// This test anchors ctx.readMs far in the future (well past every staleness window) while the
// real wall clock (Date.now()) at test-run time is NOT stale — proving the section must consult
// ctx.readMs rather than silently falling back to the real clock.
test("dataFreshnessSection: uses ctx.readMs as the staleness anchor, not the real wall clock (Ask Largo standing mandate, #5351 follow-up)", () => {
  const anchorFarFuture = Date.now() + 365 * 24 * 60 * 60_000; // 1 year past real now
  const freshMarkAsOf = new Date(Date.now() - 5 * 60_000).toISOString(); // fresh vs real now
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
    readMs: anchorFarFuture,
  };
  const section = dataFreshnessSection(ctx);
  assert.match(
    section!.body,
    /Option mark \*\*stale\*\*/,
    "must read the mark as stale under ctx.readMs even though it is fresh under the real wall clock",
  );
});

// Ask Largo standing mandate, same #5351-class readMs-anchor sweep — this time on
// meridianCatalystSection, chartLevelsSection, gexPostureSection, and preferredGexWalls, which all
// take a required `ctx: SwingPlayBriefContext` (so ctx.readMs was always in scope) but each still
// sampled a fresh Date.now() instead of consulting it. A real request runs these sections
// sequentially with real I/O in between, so each bare Date.now() sample can land on a different
// real instant and disagree with a sibling section (or with `dataFreshnessSection` above, already
// fixed) about whether the SAME underlying GEX/Meridian read is stale.
test("meridianCatalystSection: uses ctx.readMs as the staleness anchor, not the real wall clock", () => {
  const anchorFarFuture = Date.now() + 365 * 24 * 60 * 60_000; // 1 year past real now
  const freshAsOf = new Date(Date.now() - 60_000).toISOString(); // fresh vs real now, ancient vs anchor
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay(),
    asOf: "2026-09-21 10:00 ET",
    sessionDate: "2026-09-21",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: { as_of: freshAsOf, items: [], total_matched: 0 },
    ecosystem: null,
    vector: null,
    readMs: anchorFarFuture,
  };
  const section = meridianCatalystSection(ctx);
  assert.ok(section);
  assert.match(
    section!.body,
    /Last snapshot/i,
    "must read the Meridian catalyst slice as stale under ctx.readMs even though it is fresh under the real wall clock",
  );
});

test("gexPostureSection: uses ctx.readMs as the staleness anchor, not the real wall clock", () => {
  const anchorFarFuture = Date.now() + 365 * 24 * 60 * 60_000; // 1 year past real now
  const freshAsof = new Date(Date.now() - 60_000).toISOString(); // fresh vs real now, ancient vs anchor
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay(),
    asOf: "2026-09-21 10:00 ET",
    sessionDate: "2026-09-21",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    // No matrix_age_sec so gexMatrixAgeMs falls back to readMs - Date.parse(gex.asof) — the
    // readMs-dependent branch this bug actually hits.
    ecosystem: {
      gex_positioning: { spot: 100, gamma_posture: "long", net_gex: 5_000_000, asof: freshAsof },
    } as EcosystemContext,
    vector: null,
    readMs: anchorFarFuture,
  };
  const section = gexPostureSection(ctx);
  assert.ok(section);
  assert.match(
    section!.body,
    /Last snapshot/i,
    "must read the GEX matrix as stale under ctx.readMs even though it is fresh under the real wall clock",
  );
  assert.doesNotMatch(section!.body, /long gamma/i, "stale-under-ctx.readMs posture must not render as live");
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

// BUG FIX (2026-09-18, Ask Largo standing mandate): the same false-zero precision defect fixed
// in play-brief.ts's tradeManagerNarrativeSection (PR #5227, live ABTC $10.15 repro) also existed
// here — gexPostureSection independently computes net_gex/1e6 and rendered it via a bare
// toFixed(1), so a real, signed net GEX under ~$50k (common on lower-priced/small-cap tickers)
// collapsed to "0.0M", reading as "no dealer exposure" when a real signed value exists.
test("gexPostureSection: a small nonzero net GEX never renders as a false '0.0M' zero", () => {
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
        spot: 10.15,
        gamma_posture: "long",
        net_gex: 40_000,
        matrix_age_sec: 30,
        freshness: "live",
      },
    } as EcosystemContext,
    vector: null,
  });
  assert.ok(section);
  assert.match(section!.body, /Net GEX: \*\*0\.04M\*\*/, "a real $40k net GEX must widen precision, never collapse to a false 0.0M");
  assert.doesNotMatch(section!.body, /Net GEX: \*\*-?0\.0M\*\*/, "must never render the false-zero '0.0M'/'-0.0M' shape");
});

// FINDING (Ask Largo monitor cycle, 2026-10-14): VEX/DEX/CHARM are computed into the same
// gex_positioning object every swing brief already loads (Thermal reads the identical fields for
// its own desk), but gexPostureSection never surfaced them — dead-wired data, not an absence.
test("gexPostureSection: renders VEX/DEX/CHARM with their regime-read text when present", () => {
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
        net_vex: 2_000_000,
        vanna_regime_read: "vanna tailwind on rallies",
        net_dex: -1_500_000,
        dex_regime_read: "dealers net short delta",
        net_charm: 800_000,
        charm_regime_read: "charm supports pinning into expiry",
        matrix_age_sec: 30,
        freshness: "live",
      },
    } as EcosystemContext,
    vector: null,
  });
  assert.ok(section);
  assert.match(section!.body, /Net VEX \(vanna\): \*\*2\.0M\*\* — vanna tailwind on rallies/);
  assert.match(section!.body, /Net DEX \(delta\): \*\*-1\.5M\*\* — dealers net short delta/);
  assert.match(section!.body, /Net CHARM \(pinning\): \*\*0\.8M\*\* — charm supports pinning into expiry/);
});

test("gexPostureSection: omits VEX/DEX/CHARM cleanly when null, never fabricates a zero (Largo C3 omission discipline)", () => {
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
        net_vex: null,
        vanna_regime_read: null,
        net_dex: null,
        dex_regime_read: null,
        net_charm: null,
        charm_regime_read: null,
        matrix_age_sec: 30,
        freshness: "live",
      },
    } as EcosystemContext,
    vector: null,
  });
  assert.ok(section);
  assert.doesNotMatch(section!.body, /Net VEX/);
  assert.doesNotMatch(section!.body, /Net DEX/);
  assert.doesNotMatch(section!.body, /Net CHARM/);
});

test("gexPostureSection: VEX/DEX/CHARM are suppressed while the matrix is stale, same as gamma posture/net GEX (Largo C2)", () => {
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
        net_vex: 2_000_000,
        vanna_regime_read: "vanna tailwind on rallies",
        net_dex: -1_500_000,
        dex_regime_read: "dealers net short delta",
        net_charm: 800_000,
        charm_regime_read: "charm supports pinning into expiry",
        matrix_age_sec: 200,
        freshness: "cached",
      },
    } as EcosystemContext,
    vector: null,
  });
  assert.ok(section);
  assert.doesNotMatch(section!.body, /Net VEX/, "stale matrix numeric fields must not render as live");
  assert.doesNotMatch(section!.body, /Net DEX/);
  assert.doesNotMatch(section!.body, /Net CHARM/);
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

// BUG FIX (Ask Largo standing mandate, 2026-10-20, fresh-angle technicals audit, adversarially
// verified): gexPostureSection's "Nearest wall" line never considered the gamma flip as a
// candidate, while chartLevelsSection's own "Nearest wall" line (via vec.proximity) DOES — so the
// two could disagree in the same envelope whenever the flip genuinely sat closer to spot than
// either wall. Live repro shape: spot 7550, call wall 7650 (1.3% away), put wall 7400 (2.0% away),
// gamma flip 7560 (0.13% away) — the flip is clearly nearest, but the old wall-only logic could
// only ever report a wall.
test("gexPostureSection: 'Nearest wall' cites the gamma flip when it is genuinely closer to spot than either wall", () => {
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
        spot: 7550,
        gamma_posture: "short",
        net_gex: 17_800_000,
        call_wall: 7650,
        put_wall: 7400,
        flip: 7560,
        nearest_wall: { strike: 7650, kind: "resistance", distance_pts: 100 },
        matrix_age_sec: 30,
        freshness: "live",
      },
    } as EcosystemContext,
    vector: null,
  });
  assert.ok(section);
  assert.match(
    section!.body,
    /Nearest wall: \*\*7560\.00\*\* \(gamma flip, 10\.0 pts from spot \*\*7550\.00\*\*\)/,
    `expected the flip to win as the genuinely nearest level, got: ${section!.body}`,
  );
  assert.doesNotMatch(section!.body, /7650\.00/, "must not cite the farther-away call wall as nearest");
});

test("gexPostureSection: 'Nearest wall' keeps citing the wall (not the flip) when the wall is genuinely nearer — no regression", () => {
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
        spot: 7550,
        gamma_posture: "short",
        net_gex: 17_800_000,
        call_wall: 7560,
        put_wall: 7400,
        flip: 7000, // far away — must not win
        nearest_wall: { strike: 7560, kind: "resistance", distance_pts: 10 },
        matrix_age_sec: 30,
        freshness: "live",
      },
    } as EcosystemContext,
    vector: null,
  });
  assert.ok(section);
  assert.match(
    section!.body,
    /Nearest wall: \*\*7560\.00\*\* \(resistance, 10\.0 pts from spot \*\*7550\.00\*\*\)/,
  );
  assert.doesNotMatch(section!.body, /gamma flip/i);
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

test("gexPostureSection: CLOSED bucket also surfaces GEX's own market_session_note when Vector gives none (Largo C2, 2026-10-17 fix)", () => {
  const readMs = Date.parse("2026-09-20T14:00:00.000Z"); // Sun 10:00 ET -- CLOSED
  const closedSection = gexPostureSection({
    play: fixturePlay({ status: "CLOSED" }),
    asOf: "2026-09-20 10:00 ET",
    sessionDate: "2026-09-20",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    readMs,
    ecosystem: {
      gex_positioning: {
        spot: 100,
        gamma_posture: "long",
        net_gex: 5_000_000,
        asof: new Date(readMs).toISOString(),
        freshness: "live",
      },
    } as EcosystemContext,
    vector: null,
  });
  assert.ok(closedSection);
  assert.match(closedSection!.body, /market is CLOSED/i);
});

// FIX (Ask Largo standing mandate, 2026-10-13, live repro ASTS:53 CLOSED brief): this stale branch
// used to render "Last snapshot ... chart read may lag spot" + "Vector desk grade: X (from prior
// snapshot)" — but `vectorDeskSection`'s OWN stale branch (below in this file) independently
// renders the exact same "Last snapshot ... Vector desk read may lag spot" + "Vector desk grade: X
// (from prior snapshot)" pair under its own title. The two sections evolved these near-identical
// "honest degrade" fallbacks on different dates (this one 2026-09-06ish, vectorDeskSection's
// 2026-09-20) with neither referencing the other, so a brief where BOTH sections render standalone
// (not folded into "Trade manager read" — true for every CLOSED brief and any OPEN/WATCH brief that
// isn't desk-detail-folded) showed the identical fact twice under two different section titles —
// live-confirmed on ASTS:53 (CLOSED, Vector stale ~1426s): "Chart technicals" and "Vector desk"
// both read "Vector desk grade: C (from prior snapshot)". `grade` is not "chart technicals" data in
// the first place (it's the play engine's own field, whose canonical home is vectorDeskSection) —
// when stale there is no fresh EMA/VWAP/RSI/MACD/structure to show, so this section now has
// nothing left to say that isn't already said by vectorDeskSection (the grade) or
// dataFreshnessSection (the staleness itself) and returns null instead, the same "no real content"
// path this function already takes elsewhere (see the CLOSED-bucket-no-content test above).
test("chartTechnicalsSection: stale Vector snapshot returns null — grade belongs to vectorDeskSection, not duplicated here (Largo C2, 2026-10-13)", () => {
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
  assert.equal(chartTechnicalsSection(vec), null, "stale + no fresh technicals must omit, not duplicate vectorDeskSection's grade line");
});

test("chartTechnicalsSection: future-skewed Vector dataAgeMs (Infinity) also returns null, not a clock-skewed stub (Largo C2, 2026-10-13)", () => {
  const vec = fixtureVec({
    spot: 95,
    dataAgeMs: Number.POSITIVE_INFINITY,
    play: { grade: "A" },
  });
  assert.equal(chartTechnicalsSection(vec), null);
});

test("chartTechnicalsSection + vectorDeskSection: stale Vector never renders the same grade fact under both titles (Largo C2, live repro ASTS:53)", () => {
  const vec = fixtureVec({
    spot: 95,
    dataAgeMs: 1_426_000,
    play: {
      bias: "long",
      headline: "Ride momentum",
      grade: "C",
      conviction: "high",
      thesis: "Breakout continuation",
      entryZone: "100-102",
      targets: ["110"],
      invalidation: "below 98",
      starred: ["watch 105"],
    },
    technicals: {
      vwap: 94.7,
      emaStack: "up",
      rsi: 67,
      macd: "bull",
      goldenPocket: null,
      structure: { type: "CHOCH", direction: "up", level: 94 },
    },
  } as Partial<VectorFullState>);

  const chart = chartTechnicalsSection(vec);
  const desk = vectorDeskSection(vec);

  assert.equal(chart, null, "Chart technicals has nothing left to say once stale — grade lives in Vector desk only");
  assert.ok(desk, "Vector desk remains the one place that reports the stale grade");
  assert.match(desk!.body, /Vector desk grade: \*\*C\*\* \(from prior snapshot\)/);
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

// BUG FIX (2026-09-21, Ask Largo standing mandate — sweep of the play-brief-narrative.ts
// toFixed-vs-roundFloats rounding-mismatch fix (#5380) into this file's own price-level lines).
// Same live-repro shape as fmt-money.test.ts's fmtPriceLevel suite: 152.035's raw IEEE-754 storage
// rounds DOWN with plain toFixed(2) ("152.03") but UP with roundFloats' own Math.round(n*100)/100
// algorithm ("152.04") — and the SAME raw max-pain level is also exposed as a plain number in
// envelope.levels (the response's roundFloats()'d "max pain" entry), so a line built with plain
// toFixed(2) could silently disagree with the rest of the response.
test("chartLevelsSection: max pain matches roundFloats' rounding, not plain toFixed(2), at a half-cent boundary", () => {
  const section = chartLevelsSection({
    play: fixturePlay(),
    asOf: "2026-09-06 10:00 ET",
    sessionDate: "2026-09-06",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: fixtureVec({ spot: 100, maxPain: 152.035 }),
  });
  assert.ok(section);
  assert.match(section!.body, /Max pain: \*\*152\.04\*\*/, "must round like roundFloats (152.04), not plain toFixed(2) (152.03)");
  assert.doesNotMatch(section!.body, /152\.03/);
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

// BUG FIX (Ask Largo standing mandate, 2026-10-08, live repro SWING:NVDA:42 CLOSED brief):
// when a closed play's GEX matrix exists but is stale (above GEX_MATRIX_STALE_MS), this
// section's own numeric lines (flip/wall) are correctly suppressed — but the fallback text it
// falls back to, "No gamma flip / GEX wall read available for this name since the play
// closed," claims an outright ABSENCE. That is false: `gexPostureSection` (same ctx, same
// request) reads the identical `ctx.ecosystem.gex_positioning` object and renders "**Last
// snapshot** (~163s old) — dealer posture may lag spot" — i.e. a read DOES exist, it is just
// withheld here for freshness. Two sections of the SAME envelope disagreeing about whether
// a read exists for this ticker is exactly the Largo C2/C3 class this file exists to prevent:
// "no data" and "intentionally withheld because stale" are different claims, and this message
// collapsed them to the former. Must distinguish genuine absence (no gex_positioning object at
// all) from stale-and-withheld (object present, past the freshness cutoff).
test("watchForSection: closed-bucket fallback distinguishes stale-and-withheld GEX from genuine absence (Largo C2/C3)", () => {
  const staleButPresent = watchForSection(
    {
      play: fixturePlay({ status: "CLOSED", direction: "LONG" }),
      asOf: "2026-10-08 18:10 ET",
      sessionDate: "2026-10-08",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: {
        gex_positioning: {
          spot: 100,
          flip: 99,
          put_wall: 98,
          matrix_age_sec: 163,
          freshness: "cached",
        },
      } as EcosystemContext,
      vector: null,
    },
    "closed",
  );
  // Must not claim outright absence when a (stale) read genuinely exists.
  assert.doesNotMatch(staleButPresent.body, /No gamma flip \/ GEX wall read available/i);
  assert.match(staleButPresent.body, /stale/i);
  assert.match(staleButPresent.body, /163s/);

  const genuinelyAbsent = watchForSection(
    {
      play: fixturePlay({ status: "CLOSED", direction: "LONG" }),
      asOf: "2026-10-08 18:10 ET",
      sessionDate: "2026-10-08",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: {} as EcosystemContext,
      vector: null,
    },
    "closed",
  );
  // Genuine absence (no gex_positioning object at all) keeps the original "no read" framing.
  assert.match(genuinelyAbsent.body, /No gamma flip \/ GEX wall read available/i);
});

// GAP FOUND (Ask Largo standing mandate, 2026-10-13): "Since it closed" told a member where
// spot sits vs the gamma flip and vs a live structural level, but never the one question that
// actually matters after a stop — did the underlying keep moving in the stop's direction
// (confirming the exit) or reverse back through it (the exit may have been early)?
// `play.invalidationUnderlyingPx` is the exact stop level the position closed under — pinned at
// commit, static, already valid post-close (the same field closedCoaching's "Stop fired... a X%
// cushion at commit" line already reads) — comparing it to the spot this section already
// resolves answers it directly.
test("watchForSection: closed+stopped LONG reports spot has reclaimed the stop level since close", () => {
  const section = watchForSection(
    {
      play: fixturePlay({
        status: "CLOSED",
        direction: "LONG",
        closedReason: "stopped",
        invalidationUnderlyingPx: 90,
      }),
      asOf: "2026-10-13 10:00 ET",
      sessionDate: "2026-10-13",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: { gex_positioning: { spot: 95 } } as EcosystemContext,
      vector: null,
    },
    "closed",
  );
  assert.match(section.body, /reclaimed the stop level/i);
  assert.match(section.body, /\*\*90\.00\*\*/);
  assert.match(section.body, /\*\*95\.00\*\*/);
  assert.match(section.body, /exit may have been early/i);
});

// BUG FIX (2026-10-17, Ask Largo standing mandate): the "% back through it" figure divided by the
// stop level (inval) instead of spot — the same wrong-denominator shape independently found in
// play-brief-narrative.ts's committedStructuralStopLine. Uses a wide gap (spot 120 vs inval 100)
// so the buggy formula (|120-100|/100 = 20.0%) and the correct one (|120-100|/120 = 16.7%) produce
// visibly different displayed values, rather than rounding to the same figure.
test("watchForSection: 'reclaimed the stop level' percentage is computed as % of spot, not % of the stop level itself", () => {
  const section = watchForSection(
    {
      play: fixturePlay({
        status: "CLOSED",
        direction: "LONG",
        closedReason: "stopped",
        invalidationUnderlyingPx: 100,
      }),
      asOf: "2026-10-13 10:00 ET",
      sessionDate: "2026-10-13",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: { gex_positioning: { spot: 120 } } as EcosystemContext,
      vector: null,
    },
    "closed",
  );
  assert.match(
    section.body,
    /16\.7% back through it/i,
    `expected the spot-denominator 16.7%, got: ${section.body}`,
  );
});

test("watchForSection: closed+stopped SHORT reports spot remains through the stop level, confirming the exit", () => {
  const section = watchForSection(
    {
      play: fixturePlay({
        status: "CLOSED",
        direction: "SHORT",
        closedReason: "stopped",
        invalidationUnderlyingPx: 110,
      }),
      asOf: "2026-10-13 10:00 ET",
      sessionDate: "2026-10-13",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: { gex_positioning: { spot: 118 } } as EcosystemContext,
      vector: null,
    },
    "closed",
  );
  assert.match(section.body, /remains through the stop level/i);
  assert.match(section.body, /confirming the exit/i);
});

test("watchForSection: reclaim framing omitted when the play closed for a reason other than a stop", () => {
  const section = watchForSection(
    {
      play: fixturePlay({
        status: "CLOSED",
        direction: "LONG",
        closedReason: "target",
        invalidationUnderlyingPx: 90,
      }),
      asOf: "2026-10-13 10:00 ET",
      sessionDate: "2026-10-13",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: { gex_positioning: { spot: 95 } } as EcosystemContext,
      vector: null,
    },
    "closed",
  );
  assert.doesNotMatch(section.body, /stop level/i);
});

// FINDING, THEN SUPERSEDED (Ask Largo standing mandate): on 2026-10-16 (live repro SWING:GOOGL:58)
// this exact "Structural stop (committed)" bullet was added HERE in `watchForSection` AND,
// independently and on the same date/repro, in `tradeManagerNarrativeSection`
// (play-brief-narrative.ts) — two parallel fixes neither aware of the other, each only tested in
// isolation (this file's own suite vs. play-brief-narrative.test.ts's), so nobody ever composed
// both into one envelope to notice the live result was the IDENTICAL sentence rendered twice,
// in two different sections, every single time (the gating on both sides is the same
// `bucket === "open"` plus the same `invalidationUnderlyingPx`/spot inputs — never one without
// the other). Found live 2026-10-18 re-auditing TSLA's real OPEN brief. De-duplicated 2026-10-18:
// `tradeManagerNarrativeSection` keeps sole ownership (it already sits right next to the GEX-
// heuristic "Break watch" bullet this fact complements) — `watchForSection` no longer renders it,
// but keeps its own, different "Structural support/resistance node" (GEX heuristic) line
// untouched. See the cross-section dedup test a few lines below for the regression proof.
test("watchForSection: OPEN bucket no longer duplicates the committed structural stop — that's tradeManagerNarrativeSection's bullet now", () => {
  const section = watchForSection(
    {
      play: fixturePlay({
        status: "OPEN",
        direction: "LONG",
        invalidationUnderlyingPx: 345.33,
      }),
      asOf: "2026-10-15 10:00 ET",
      sessionDate: "2026-10-15",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: { gex_positioning: { spot: 349.63, put_wall: 330 } } as EcosystemContext,
      vector: null,
    },
    "open",
  );

  // GEX heuristic line untouched — this section's own, distinct fact.
  assert.match(section.body, /Structural support node.*330\.00/i);
  // The committed-stop bullet is no longer this section's job.
  assert.doesNotMatch(section.body, /Structural stop \(committed\)/i);
});

test("watchForSection: committed structural stop stays absent even when no GEX level is resolvable at all (dedup, not a regression)", () => {
  const section = watchForSection(
    {
      play: fixturePlay({
        status: "OPEN",
        direction: "LONG",
        invalidationUnderlyingPx: 345.33,
      }),
      asOf: "2026-10-15 10:00 ET",
      sessionDate: "2026-10-15",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      // No put_wall/dark pool/king at all — the GEX heuristic has nothing to cite either way.
      ecosystem: { gex_positioning: { spot: 349.63 } } as EcosystemContext,
      vector: null,
    },
    "open",
  );

  assert.doesNotMatch(section.body, /Structural support node/i);
  assert.doesNotMatch(section.body, /Structural stop \(committed\)/i);
});

// REGRESSION PROOF for the 2026-10-18 dedup fix above: compose BOTH sections from the identical
// context a real envelope would, and assert the committed-stop sentence appears in EXACTLY ONE of
// them (tradeManagerNarrativeSection), never both — this is the check that would have caught the
// original duplication on 2026-10-16 had it existed then.
test("watchForSection + tradeManagerNarrativeSection: committed structural stop renders in exactly one section, never both", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({ status: "OPEN", direction: "LONG", invalidationUnderlyingPx: 345.33 }),
    asOf: "2026-10-15 10:00 ET",
    sessionDate: "2026-10-15",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: { gex_positioning: { spot: 349.63, put_wall: 330 } } as EcosystemContext,
    vector: null,
  };

  const watch = watchForSection(ctx, "open");
  const narrative = tradeManagerNarrativeSection(ctx, "open");

  const inWatch = /Structural stop \(committed\)/i.test(watch.body);
  const inNarrative = /Structural stop \(committed\)/i.test(narrative!.body);
  assert.equal(inWatch, false, "watchForSection must not render it — that's narrative's job now");
  assert.equal(inNarrative, true, "tradeManagerNarrativeSection must still render it");
});

test("watchForSection: committed structural stop line omitted (no regression) when the real level is absent", () => {
  const section = watchForSection(
    {
      play: fixturePlay({ status: "OPEN", direction: "LONG" }), // invalidationUnderlyingPx absent
      asOf: "2026-10-15 10:00 ET",
      sessionDate: "2026-10-15",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: { gex_positioning: { spot: 349.63, put_wall: 330 } } as EcosystemContext,
      vector: null,
    },
    "open",
  );

  assert.match(section.body, /Structural support node.*330\.00/i);
  assert.doesNotMatch(section.body, /Structural stop \(committed\)/i);
});

test("watchForSection: committed structural stop line never fires for a WATCH-bucket candidate", () => {
  const section = watchForSection(
    {
      play: fixturePlay({
        status: "WATCH",
        direction: "LONG",
        invalidationUnderlyingPx: 345.33,
      }),
      asOf: "2026-10-15 10:00 ET",
      sessionDate: "2026-10-15",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: { gex_positioning: { spot: 349.63, put_wall: 330 } } as EcosystemContext,
      vector: null,
    },
    "watch",
  );

  assert.doesNotMatch(section.body, /Structural stop \(committed\)/i);
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

// BUG FIX (Ask Largo standing mandate, 2026-10-20): `trackPct` (the board card's "Since flag" %,
// only ever populated for WATCH/SKIP status) used to be rendered ONLY by `pnlSection`
// (play-brief.ts), which `composeSwingPlayBrief` only calls for `bucket === "open"` — a bucket
// where `trackPct` is always null. So the number was dead on arrival for the bucket that had it.
// Pins the fix: a WATCH play with a real `trackPct` must show it here, beside the flag anchor.
test("watchForSection: 'Since flag' underlying move is shown for a WATCH play (was dead-wired to the open-only Position section)", () => {
  const section = watchForSection(
    {
      play: fixturePlay({ direction: "SHORT", flagUnderlyingPx: 374.5, trackPct: -1.42 }),
      asOf: "2026-10-20 17:14 ET",
      sessionDate: "2026-10-20",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: null,
      vector: null,
    },
    "watch",
  );
  assert.match(section.body, /Flag anchor: \*\*374\.50\*\*/);
  assert.match(section.body, /Since flag: \*\*-1\.4%\*\*/);
});

// BUG FIX (2026-10-21, Ask Largo standing mandate, live repro SHOP WATCH brief): `play.trackPct`
// (adapters.ts's `watchUnderlyingTrackPct`) is computed off `src.liveSpot`, which traces to the
// cron-cached `SwingServingSnapshot.spotsByTicker` map — written by `swing-discovery`'s one
// pre-market scan and refreshed intraday only by `swing-active-refresh` (RTH-only). This section
// independently resolves a FRESH current spot (`spot`, a few lines above, vector-then-GEX
// fallback, the SAME value this section already prints elsewhere, e.g. "Now trades X vs gamma
// flip") — so before the RTH refresh has run, "Since flag" and the rest of the brief can disagree
// about what spot even is. Live repro: SHOP's brief printed "Flag anchor 177.70" and "Spot 173.72"
// (both Watch levels and Chart technicals sections) but "Since flag -2.4%" — recomputing
// (173.72-177.70)/177.70 gives -2.2%, not -2.4%; the stale cron-cached liveSpot was ~0.28 off the
// fresh one. Fixed by recomputing "Since flag" from this section's own fresh `spot` + the pinned
// flag anchor whenever a fresh spot is actually available, falling back to the cron-cached
// `play.trackPct` only when it is not (preserves the prior dead-code fix's behavior off-hours).
test("watchForSection: 'Since flag' reconciles with THIS section's own fresh spot, not the cron-cached liveSpot play.trackPct was computed from", () => {
  const section = watchForSection(
    {
      play: fixturePlay({ direction: "LONG", flagUnderlyingPx: 177.7, trackPct: -2.4 }),
      asOf: "2026-10-21 07:15 ET",
      sessionDate: "2026-10-21",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: {
        gex_positioning: { spot: 173.72 },
      } as EcosystemContext,
      vector: null,
    },
    "watch",
  );
  assert.match(section.body, /Flag anchor: \*\*177\.70\*\*/);
  assert.match(section.body, /Since flag: \*\*-2\.2%\*\*/);
  assert.doesNotMatch(section.body, /Since flag: \*\*-2\.4%\*\*/);
});

test("watchForSection: 'Since flag' falls back to the cron-cached play.trackPct when no fresh spot is available at all", () => {
  const section = watchForSection(
    {
      play: fixturePlay({ direction: "SHORT", flagUnderlyingPx: 374.5, trackPct: -1.42 }),
      asOf: "2026-10-20 17:14 ET",
      sessionDate: "2026-10-20",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: null,
      vector: null,
    },
    "watch",
  );
  assert.match(section.body, /Since flag: \*\*-1\.4%\*\*/);
});

test("watchForSection: 'Since flag' is omitted when trackPct is null (e.g. an open play, where it is never populated)", () => {
  const section = watchForSection(
    {
      play: fixturePlay({ direction: "LONG", flagUnderlyingPx: 175.87, trackPct: null }),
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
  assert.doesNotMatch(section.body, /Since flag/);
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

// GAP FOUND (Ask Largo standing mandate, 2026-10-24, static audit of the Largo deep-dive): every
// OTHER price level this brief narrates (GEX walls, gamma flip, committed structural stop) states
// its distance from spot as "(X% away)" — this entry trigger line, arguably the single most
// actionable number in a WATCH brief, never did. Pins the fix: once spot is known and still on the
// not-yet-triggered side, the line now quantifies how close the setup actually is.
test("watchForSection: entry trigger states how far spot is from firing it, when spot is known and still approaching", () => {
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
      ecosystem: { gex_positioning: { spot: 180.0 } } as EcosystemContext,
      vector: null,
    },
    "watch",
  );
  // (180 - 182.5) / 180 = -1.389% -> 1.4% away.
  assert.match(
    section.body,
    /Entry trigger: \*\*182\.50\*\* \(1\.4% away\) — Break\/reclaim above this is what actually fires the setup/,
  );
});

test("watchForSection: entry trigger distance is omitted (never guessed) once spot has already moved through it in the entry direction", () => {
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
      ecosystem: { gex_positioning: { spot: 185.0 } } as EcosystemContext,
      vector: null,
    },
    "watch",
  );
  assert.match(section.body, /Entry trigger: \*\*182\.50\*\* — Break\/reclaim above this is what actually fires the setup/);
  assert.doesNotMatch(section.body, /% away/);
});

// GAP FOUND (Ask Largo standing mandate, 2026-10-18): entryTriggerDeadReason() used to call only
// the narrow deadPlayReason (4 cases: INVALIDATED/expired-window/contract-expired/EXTENDED), which
// returns null for a TRIGGERED/AT_TRIGGER play that is merely below the lane score floor — so this
// bullet rendered the unqualified "this is what actually fires the setup" claim even while the
// SAME brief's Verdict section (composeSwingPlayBrief) correctly said the real blocker was the
// score floor. Live repro TSM, 2026-10-18: score 54.9 vs scoreFloor 60 (aboveFloor:false),
// setupState TRIGGERED, entryStatus AT_TRIGGER, no gate tag at all. Widened to gateFramingMootReason
// (same-day sibling fix already applied to watchEntrySection/watchGateCoaching) to match.
//
// BUG FIX (Ask Largo standing mandate, 2026-10-19): that same-day widening over-corrected — a
// below-floor play is NOT dead, just not-yet-enterable (gateFramingMootReason's own doc comment:
// "very much still live"), so claiming "this level no longer fires the setup" is itself false.
// Assertions below updated to the corrected text (reason disclosed, no false-permanence claim).
test("watchForSection: entry trigger claim is corrected when the play is below the lane score floor, even though TRIGGERED/AT_TRIGGER", () => {
  const section = watchForSection(
    {
      play: fixturePlay({
        direction: "LONG",
        entryTriggerUnderlyingPx: 412.61,
        setupState: "TRIGGERED",
        entryStatus: "AT_TRIGGER",
        aboveFloor: false,
      }),
      asOf: "2026-10-18 10:00 ET",
      sessionDate: "2026-10-18",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: null,
      vector: null,
    },
    "watch",
  );
  assert.match(section.body, /Entry trigger: \*\*412\.61\*\*/);
  assert.doesNotMatch(section.body, /this is what actually fires the setup/);
  assert.match(section.body, /below the lane score floor/);
  assert.doesNotMatch(
    section.body,
    /this level no longer fires the setup/,
    `below-floor is not dead, just not-yet-enterable — must not claim the level "no longer fires", got: ${section.body}`,
  );
});

// Sibling case: a play still FORMING (not yet at trigger at all) must get the same correction.
//
// BUG FIX (Ask Largo standing mandate, 2026-10-19, live repro EWY WATCH brief): FORMING is the
// other non-dead gateFramingMootReason case, same over-correction as below-floor above — a
// still-forming play's Entry section says the window is open with days left, so this line must
// not simultaneously claim the trigger "no longer fires."
test("watchForSection: entry trigger claim is corrected when the play is still FORMING", () => {
  const section = watchForSection(
    {
      play: fixturePlay({
        direction: "LONG",
        entryTriggerUnderlyingPx: 100.0,
        setupState: "FORMING",
      }),
      asOf: "2026-10-18 10:00 ET",
      sessionDate: "2026-10-18",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: null,
      vector: null,
    },
    "watch",
  );
  assert.doesNotMatch(section.body, /this is what actually fires the setup/);
  assert.match(section.body, /thesis still forming — not yet at trigger/);
  assert.doesNotMatch(
    section.body,
    /this level no longer fires the setup/,
    `FORMING is not dead, just not-yet-at-trigger — must not claim the level "no longer fires", got: ${section.body}`,
  );
});

// GAP FOUND (Ask Largo standing mandate, 2026-10-08, live repro SWING:CRI:1510 at -59.1% P&L and
// SWING:GLW:1479 at -56.1% P&L): `horizonPlayFromBangerPosition` (banger-lane-merge.ts) stamps
// `thesisLevel: "intact"` as a fixed literal on every Banger-origin row regardless of price action
// — there is no real per-position thesis dossier for this lane, the same gap
// `thesisHealthUncalibrated()`/`BANGER_LEDGER_REGIME_LABEL` already exist to catch for the
// aggregate Thesis-health panel. Left unguarded, this section rendered "Thesis **intact** — below
// the 2× partial and above the hard stop" for a position 2% from stopping out — overclaiming a
// calibrated judgment the lane cannot produce, and purely restating the honest "Premium stop
// rail"/"Premium target rail" lines two lines below it. Must suppress regardless of bucket
// (watch/open) and regardless of whether thesisBreak carries a note.
test("watchForSection: Banger-origin thesis line is suppressed, not fabricated (Largo C6, live repro CRI/GLW)", () => {
  const section = watchForSection(
    {
      play: fixturePlay({
        direction: "LONG",
        regime: BANGER_LEDGER_REGIME_LABEL,
        thesisBreak: { level: "intact", note: "below the 2× partial and above the hard stop" },
      }),
      asOf: "2026-10-08 08:30 ET",
      sessionDate: "2026-10-08",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: null,
      vector: null,
    },
    "open",
  );
  assert.doesNotMatch(section.body, /Thesis \*\*/);
  assert.doesNotMatch(section.body, /below the 2× partial/);
});

// Sibling guard: a NATIVE swing position's real, live-derived thesisBreak must still render —
// the suppression above is scoped to the Banger-ledger sentinel, not to "intact" generally.
test("watchForSection: a NATIVE position's thesis line still renders (suppression is Banger-scoped only)", () => {
  const section = watchForSection(
    {
      play: fixturePlay({
        direction: "LONG",
        regime: "Pullback continuation · regime 1.00",
        thesisBreak: { level: "intact", note: "structure holding" },
      }),
      asOf: "2026-10-08 08:30 ET",
      sessionDate: "2026-10-08",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: null,
      vector: null,
    },
    "open",
  );
  assert.match(section.body, /Thesis \*\*intact\*\* — structure holding/);
});

// BUG FIX (Ask Largo standing mandate, 2026-10-20): the section's `bias` field used to badge
// "bearish" whenever `thesisBreak.level === "break"`, with no reference to `play.direction` —
// `thesisBreak.level` is a direction-agnostic "has this setup's own edge invalidated" verdict, not
// a market-direction read. For a SHORT play, a thesis break typically coincides with the underlying
// breaking UPWARD (the move that invalidates a short) — the opposite of what the old code badged.
// Same defect class already fixed at a sibling call site (thesisHealthSection, play-brief.ts,
// Largo C5, 2026-09-15) by dropping the bias mapping for a non-directional signal entirely.
test("watchForSection: bias is never badged bearish off a direction-agnostic thesis break (SHORT play, live repro shape)", () => {
  const section = watchForSection(
    {
      play: fixturePlay({
        direction: "SHORT",
        regime: "Breakdown continuation · regime 1.00",
        thesisBreak: { level: "break", note: "persistence lost" },
      }),
      asOf: "2026-10-20 08:30 ET",
      sessionDate: "2026-10-20",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: null,
      vector: null,
    },
    "open",
  );
  assert.equal(section.bias, "neutral", "a direction-agnostic thesis break must not badge a market-direction bias");
});

test("watchForSection: bias stays neutral on a LONG play's thesis break too (same fix, not direction-specific)", () => {
  const section = watchForSection(
    {
      play: fixturePlay({
        direction: "LONG",
        regime: "Pullback continuation · regime 1.00",
        thesisBreak: { level: "break", note: "persistence lost" },
      }),
      asOf: "2026-10-20 08:30 ET",
      sessionDate: "2026-10-20",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: null,
      vector: null,
    },
    "open",
  );
  assert.equal(section.bias, "neutral");
});

// BUG FIX (Ask Largo standing mandate, 2026-10-20, live repro UNH and MU WATCH briefs, same
// cycle): the thesis-intact line above had no `deadPlayReason(play)` guard, so it rendered
// unconditionally for a genuinely dead (EXTENDED/EXTENDED_CHASE) WATCH play — directly
// contradicting this SAME section's own `entryTriggerDeadReason`-driven "this level no longer
// fires the setup" line (which DOES gate on deadPlayReason, a few lines above) and the Verdict
// section's "Extended past the valid entry window — do not chase; wait for a reset."
test("watchForSection: thesis-intact line suppressed for a genuinely dead (extended-chase) WATCH play — must not contradict the entry-trigger line's own 'no longer fires the setup' (Largo, live repro UNH/MU)", () => {
  const section = watchForSection(
    {
      play: fixturePlay({
        direction: "LONG",
        status: "WATCH",
        entryStatus: "EXTENDED_CHASE",
        regime: "Pullback continuation · regime 1.00",
        entryTriggerUnderlyingPx: 399.15,
        thesisBreak: { level: "intact", note: "structure holding" },
      }),
      asOf: "2026-10-20 07:51 ET",
      sessionDate: "2026-10-20",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: null,
      vector: null,
    },
    "watch",
  );
  assert.doesNotMatch(
    section.body,
    /Thesis \*\*/,
    `a dead (EXTENDED_CHASE) WATCH play must not claim "Thesis intact" beside its own "no longer fires the setup" line, got: ${section.body}`,
  );
  assert.match(section.body, /this level no longer fires the setup/);
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

// BUG FIX (Ask Largo standing mandate, 2026-10-06): `entryTriggerUnderlyingPx` for a Legacy-
// morning-confirm-promoted play (`legacy-confirm-promote.ts`'s `buildLegacySwingArtifacts`) is
// stamped ONCE, at promotion, from `deriveSwingPlanLevels(direction, groundedSpotAtPromotion, atr)`
// — and that dossier/plan is never rebuilt again (there is no recurring re-dossier pass for
// Legacy-promoted rows, unlike organic FLOW/STRUCTURE/etc. discovery, which rebuilds its dossier —
// and therefore its plan's `entryUnderlyingPx` — on every scan cadence). Because
// `deriveSwingPlanLevels` always sets `entryUnderlyingPx = price` (the spot at build time), a
// Legacy-promoted row's `entryTriggerUnderlyingPx` is IDENTICAL to its `flagUnderlyingPx` forever,
// even days later — confirmed live 2026-10-06 (`GET /api/market/nighthawk/horizons?view=swings`):
// every Legacy-promoted row (NKE/USO/NTAP, `discoveryOrigin: ["NIGHT HAWK"]`) carried
// `flagUnderlyingPx === entryTriggerUnderlyingPx` exactly, including USO (4 days stale), while
// every organically-discovered WATCH row in the same payload (INTC/AVGO/ORCL/COPX/MU/NVDA/GE/
// EWZ/PLTR) had the two values genuinely diverge. The "Entry trigger" bullet's own claim —
// "this is what actually fires the setup" — is false for these rows: the number is the promotion-
// day price, not a live, continuously-refreshed trigger level, so a member reading it days later
// is seeing a stale level dressed as a live one. Fix: when the play's `discoveryOrigin` is the
// Legacy-exempt signature AND the two values are byte-identical, disclose that the level is
// pinned at promotion and has not refreshed since — same "correct the claim, keep the number"
// shape as the INVALIDATED/EXPIRED fixes above, not a new mechanism.
test("watchForSection: entry trigger claim is corrected for a Legacy-promoted play whose trigger never refreshed", () => {
  const section = watchForSection(
    {
      play: fixturePlay({
        direction: "LONG",
        flagUnderlyingPx: 143.47,
        entryTriggerUnderlyingPx: 143.47,
        discoveryOrigin: ["NIGHT HAWK"],
      }),
      asOf: "2026-10-06 10:00 ET",
      sessionDate: "2026-10-06",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: null,
      vector: null,
    },
    "watch",
  );
  assert.match(section.body, /Entry trigger: \*\*143\.47\*\*/);
  assert.doesNotMatch(section.body, /this is what actually fires the setup/);
  assert.match(
    section.body,
    /pinned at Legacy promotion, not refreshed since — this level no longer fires the setup/,
  );
});

// BUG FIX (Ask Largo standing mandate, 2026-10-18, third instance): the same-day widening of
// `entryTriggerDeadReason()` to check `gateFramingMootReason()` FIRST (see that function's own
// doc comment above) accidentally SHADOWED this older, more specific 2026-10-06 Legacy-pinned-
// price staleness check for the exact population it exists for — every Legacy-promoted WATCH
// play unconditionally carries a `legacy_exempt`-only `gateBlocks` entry, which
// `gateFramingMootReason` now matches and early-returns on before the staleness check below it is
// ever reached. Live repro UNH, 2026-10-18: TRIGGERED/AT_TRIGGER/above-floor,
// `discoveryOrigin: ["NIGHT HAWK"]`, `flagUnderlyingPx === entryTriggerUnderlyingPx === 399.15`
// (firstSeenAt 3 days earlier), `commitGateBlockedBy: ["legacy:exempt"]` — both the gate-moot
// framing and the pinned-price staleness disclosure are independently true and both matter (the
// gate is moot AND the price is stale), but the brief rendered only the first, dropping the
// staleness disclosure entirely for every Legacy-promoted play. Must compose both facts, not pick
// one.
test("watchForSection: entry trigger claim for a Legacy-promoted TRIGGERED/above-floor play composes BOTH the gate-moot framing AND the pinned-price staleness disclosure (live repro UNH)", () => {
  const section = watchForSection(
    {
      play: fixturePlay({
        direction: "LONG",
        discoveryOrigin: ["NIGHT HAWK"],
        flagUnderlyingPx: 399.15,
        entryTriggerUnderlyingPx: 399.15,
        setupState: "TRIGGERED",
        entryStatus: "AT_TRIGGER",
        aboveFloor: true,
        gateBlocks: [
          {
            code: "legacy_exempt",
            reason:
              "Legacy morning-confirm promotion — Swing V2 confluence/Cortex gates were not evaluated on this path.",
          },
        ],
      }),
      asOf: "2026-10-18 10:00 ET",
      sessionDate: "2026-10-18",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: null,
      vector: null,
    },
    "watch",
  );
  assert.match(section.body, /Entry trigger: \*\*399\.15\*\*/);
  assert.doesNotMatch(section.body, /this is what actually fires the setup/);
  assert.match(
    section.body,
    /Legacy-promoted — commit gates were never evaluated on this path, not a live gate to clear/,
    `expected the gate-moot framing to still be present, got: ${section.body}`,
  );
  assert.match(
    section.body,
    /pinned at Legacy promotion, not refreshed since/,
    `expected the pinned-price staleness disclosure to ALSO be present (not shadowed), got: ${section.body}`,
  );
});

// An organic (non-Legacy) WATCH row whose trigger happens to equal its flag anchor (e.g. the
// very first scan tick after being flagged, before any price movement) must NOT be mislabeled
// stale — only the Legacy-exempt signature changes the claim, never a coincidental equal value.
test("watchForSection: a coincidentally-equal trigger/flag on an organic (non-Legacy) play keeps the live claim", () => {
  const section = watchForSection(
    {
      play: fixturePlay({
        direction: "LONG",
        flagUnderlyingPx: 182.5,
        entryTriggerUnderlyingPx: 182.5,
        discoveryOrigin: ["FLOW"],
      }),
      asOf: "2026-10-06 10:00 ET",
      sessionDate: "2026-10-06",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: null,
      vector: null,
    },
    "watch",
  );
  assert.match(
    section.body,
    /Entry trigger: \*\*182\.50\*\* — Break\/reclaim above this is what actually fires the setup/,
  );
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
  // REPOINTED (Ask Largo standing mandate, 2026-10-08): "Entry section above" was never actually
  // the sole full-text home this test's own comment assumed — "Trade manager read" independently
  // rendered the same codes+reasons too (see play-brief.ts's `watchEntrySection` 2026-10-08
  // comment). Repointed at "Trade manager read", the real one true home now.
  assert.match(section.body, /\*\*Before entry, clear:\*\* 2 gates — see Trade manager read above\./);
  // The full reason text must NOT be duplicated here — its one home is Trade manager read.
  assert.doesNotMatch(section.body, /Broad-market regime degraded/);
  assert.doesNotMatch(section.body, /Cortex preflight vetoed/);
});

// BUG FIX (2026-10-21, Ask Largo 5-engine cycle, live repro TSLA WATCH brief): the "Before entry,
// clear: N gates" bullet above is a 4th renderer of `play.gateBlocks`, phrased as an imperative
// instruction, with no `gateFramingMootReason` check — unlike three sibling renderers of the
// identical gate list (`watchEntrySection` play-brief.ts, `watchGateCoaching`
// play-brief-narrative-coaching.ts, `entryTriggerDeadReason` a few lines above in this file), all
// of which correctly prefix the list with "(moot — ...)" whenever clearing the named gates would
// NOT actually reopen entry. Live repro: TSLA WATCH read "Before entry, clear: 4 gates" while the
// SAME envelope's Trade manager read said clearing them is moot (score below the lane floor) — a
// reader following just this section would wrongly conclude clearing the gates suffices.
test("watchForSection: gate-block bullet is framed as moot (not an imperative 'clear N gates') when clearing them would not actually reopen entry (live TSLA repro, score below lane floor)", () => {
  const section = watchForSection(
    {
      play: fixturePlay({
        direction: "SHORT",
        aboveFloor: false,
        gateBlocks: [
          { code: "g_s3_earnings", reason: "Earnings print imminent — desk will not open new swings." },
          { code: "g_s12_halt_feed_stale", reason: "Trading-halt feed unavailable — desk will not open until halt/LULD data recovers." },
          { code: "g_s4_regime", reason: "Broad-market regime degraded — desk will not open new swings (WATCH only)." },
          { code: "g_s14_cortex", reason: "Cortex preflight vetoed this setup — desk will not open." },
        ],
      }),
      asOf: "2026-10-21 02:30 ET",
      sessionDate: "2026-10-21",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: null,
      vector: null,
    },
    "watch",
  );
  assert.match(
    section.body,
    /\*\*Also gate-blocked\*\* \(moot — below the lane score floor\) — see Trade manager read above\./,
  );
  assert.doesNotMatch(section.body, /\*\*Before entry, clear:\*\*/);
});

// A genuinely live, not-yet-cleared gate list (nothing moot) must still render the imperative
// count + pointer — the fix above must not suppress or reframe a real "clear these to enter" case.
test("watchForSection: gate-block bullet stays an imperative 'clear N gates' when the gates are genuinely live (no regression)", () => {
  const section = watchForSection(
    {
      play: fixturePlay({
        direction: "LONG",
        gateBlocks: [
          { code: "g_s4_regime", reason: "Broad-market regime degraded — desk will not open new swings (WATCH only)." },
        ],
      }),
      asOf: "2026-10-21 02:30 ET",
      sessionDate: "2026-10-21",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: null,
      vector: null,
    },
    "watch",
  );
  assert.match(section.body, /\*\*Before entry, clear:\*\* 1 gate — see Trade manager read above\./);
  assert.doesNotMatch(section.body, /\*\*Also gate-blocked\*\*/);
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

// GAP FOUND (Ask Largo standing mandate, 2026-10-17): the "Current levels" disclosure above says
// a closed play's GEX/Vector levels are "not what this trade traded under" but never says whether
// the market is even OPEN right now — a post-close/weekend self-warm computes a genuinely fresh
// Vector/GEX read off the LAST session's tape, which this generic disclosure alone does not
// disclose (Largo C2). Mirrors dataHonestyCoaching's own already-fixed market_session_note wiring
// (#5306), ported here because collectCoachingBullets never reaches dataHonestyCoaching for the
// closed bucket.
test("chartLevelsSection: CLOSED bucket also surfaces Vector's market_session_note (Largo C2, 2026-10-17 fix)", () => {
  const closedSection = chartLevelsSection({
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
        call_wall: 105,
        put_wall: 95,
        matrix_age_sec: 10,
        freshness: "live",
      },
    } as EcosystemContext,
    vector: {
      dataAgeMs: 0,
      freshness: "live",
      market_session_note: "VECTOR_CLOSED_MARKET_NOTE_MARKER",
    } as SwingPlayBriefContext["vector"],
  });
  assert.ok(closedSection);
  assert.match(closedSection!.body, /VECTOR_CLOSED_MARKET_NOTE_MARKER/);
});

test("chartLevelsSection: CLOSED bucket falls back to GEX's own market_session_note when Vector gives none", () => {
  const readMs = Date.parse("2026-09-20T14:00:00.000Z"); // Sun 10:00 ET -- CLOSED
  const closedSection = chartLevelsSection({
    play: fixturePlay({ status: "CLOSED" }),
    asOf: "2026-09-20 10:00 ET",
    sessionDate: "2026-09-20",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    readMs,
    ecosystem: {
      gex_positioning: {
        spot: 100,
        call_wall: 105,
        put_wall: 95,
        asof: new Date(readMs).toISOString(),
        freshness: "live",
      },
    } as EcosystemContext,
    vector: null,
  });
  assert.ok(closedSection);
  assert.match(closedSection!.body, /market is CLOSED/i);
});

// FINDING (Ask Largo standing mandate, 2026-09-18): the gamma magnet is a structural Vector level
// (envelope.levels/"Key levels" carries it for EVERY bucket — play-brief.ts's own comment says it
// was added there specifically because "the gamma magnet is narrated prominently in the 'Trade
// manager read' section (magnetCoaching)... but was never added to the structured envelope.levels
// array"). That comment is only true for OPEN/WATCH plays: magnetCoaching is called from
// collectCoachingBullets, which for `bucket === "closed"` returns ONLY `closedCoaching(play)` (an
// early return — play-brief-narrative-coaching.ts) and never reaches magnetCoaching at all. So a
// CLOSED play's magnet level exists in the structured levels array/"Key levels" bullet list but is
// narrated in NO prose section anywhere — confirmed live on two independent CLOSED plays (NRG #34,
// CG #25, both 2026-09-18 audit cycles). "Levels on chart" (chartLevelsSection) already narrates
// every OTHER Vector-derived level (max pain, confluence nodes, dark pool) regardless of bucket, so
// the magnet's absence there specifically is the gap, not an intentional superset-feed design.
// Fix: chartLevelsSection now adds a "Gamma magnet" line for the CLOSED bucket only (OPEN/WATCH
// already get it, with actionable framing, from magnetCoaching — adding it here too would just
// duplicate that line, the exact class of bug this file's own dedup comments warn about above).
test("chartLevelsSection: CLOSED bucket narrates the gamma magnet in 'Levels on chart' (magnetCoaching never fires for closed plays)", () => {
  const closedSection = chartLevelsSection({
    play: fixturePlay({ status: "CLOSED" }),
    asOf: "2026-09-18 10:00 ET",
    sessionDate: "2026-09-18",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: fixtureVec({ spot: 40.17, magnet: { strike: 40.63, distancePct: 1.1, pull: "up" } }),
  });
  assert.ok(closedSection);
  assert.match(
    closedSection!.body,
    /Gamma magnet.*40\.63/,
    "the gamma magnet level must be narrated in prose for a CLOSED play, not only in the structured levels array",
  );

  // OPEN bucket must NOT gain a duplicate line here — magnetCoaching (Trade manager read) already
  // narrates it there with actionable framing; this section adding the same fact again would be the
  // exact duplication class play-brief-narrative-coaching.ts's own comments warn against.
  // maxPain is included alongside the magnet so the section renders non-null on the OPEN bucket
  // too (a magnet-only vector fixture legitimately produces no section at all for OPEN, since this
  // fix scopes the magnet line to CLOSED only — that emptiness would otherwise make this half of
  // the test vacuous rather than a real duplication check).
  const openSection = chartLevelsSection({
    play: fixturePlay({ status: "OPEN" }),
    asOf: "2026-09-18 10:00 ET",
    sessionDate: "2026-09-18",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: fixtureVec({
      spot: 40.17,
      maxPain: 45,
      magnet: { strike: 40.63, distancePct: 1.1, pull: "up" },
    }),
  });
  assert.ok(openSection);
  assert.doesNotMatch(
    openSection!.body,
    /Gamma magnet/,
    "OPEN/WATCH buckets already narrate the magnet via magnetCoaching in Trade manager read — chartLevelsSection must not duplicate it",
  );
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

// BUG FIX (Ask Largo standing mandate, 2026-10-20, fresh-angle technicals audit, adversarially
// verified): when vec.proximity resolves to the gamma flip (side === "flip"), its callout restates
// the EXACT value the "Gamma flip:" line (a few lines above, same section) already rendered — a
// same-section self-duplicate. Live repro shape: spot 7550, gamma flip 7560 (0.13% away, closest
// level) — "Gamma flip: 7560.00 — +0.1% ($10.00 from spot)" immediately followed by "Nearest wall:
// 7560.00 gamma flip overhead (0.13% away) — a cross flips the regime...".
test("chartLevelsSection: 'Nearest wall' line is suppressed when it would only restate the 'Gamma flip' line above it (self-duplicate)", () => {
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
      spot: 7550,
      gammaFlip: 7560,
      proximity: {
        strike: 7560,
        side: "flip",
        distancePct: 0.13,
        nearness: "at",
        callout: "7560.00 gamma flip overhead (0.13% away) — a cross flips the regime.",
      },
    } as unknown as VectorFullState,
  });
  assert.ok(section);
  assert.match(section!.body, /\*\*Gamma flip:\*\* 7560\.00/, "the Gamma flip line itself must still render");
  assert.doesNotMatch(
    section!.body,
    /Nearest wall:/,
    `must not restate the identical flip value under a second heading, got: ${section!.body}`,
  );
});

test("chartLevelsSection: 'Nearest wall' line still renders when proximity resolves to a real wall, not the flip — no regression", () => {
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
      spot: 7550,
      gammaFlip: 7000, // present, but proximity resolved to a wall, not this
      proximity: {
        strike: 7560,
        side: "call",
        distancePct: 0.13,
        nearness: "at",
        callout: "Testing 7560.00 call wall (0.13% away) — dealers sell strength; resistance unless it breaks.",
      },
    } as unknown as VectorFullState,
  });
  assert.ok(section);
  assert.match(section!.body, /Nearest wall: Testing 7560\.00 call wall/);
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

// FINDING (Ask Largo standing mandate, 2026-10-24): same defect class as catalystsSection/
// chartLevelsSection/gexPostureSection/wallDynamicsSection/flowIntelSection's own CLOSED-bucket
// disclosure fixes -- this was the one sibling market-context section left giving live
// position-management advice ("size down or hedge vol unless thesis is the print") on an
// already-closed, settled play with no disclosure that the earnings/peer read is CURRENT, not
// what the trade traded under. Live repro: SWING:GOOGL:58, CLOSED/STOPPED 2026-10-16, GOOGL
// earnings 4 days out at read time.
test("meridianPeerSection: CLOSED bucket prefixes a current-not-as-traded disclosure", () => {
  const meridian = {
    as_of: "2026-10-24 09:00 ET",
    items: [
      {
        id: "earnings:GOOGL:2026-10-28",
        kind: "earnings" as const,
        title: "GOOGL earnings",
        subtitle: null,
        date: "2026-10-28",
        time: null,
        impact: "high" as const,
        days_until: 4,
        ticker: "GOOGL",
        date_status: null,
        importance: 3,
        is_printed: false,
        expected_move_pct: 6.5,
        sector_label: "Tech",
      },
    ],
    total_matched: 1,
  };
  const meridianPeer = {
    available: true as const,
    id: "earnings:GOOGL:2026-10-28",
    subject_ticker: "GOOGL",
    position_summary: null,
    members: [
      {
        ticker: "META",
        report_date: "2026-10-27",
        expected_move_pct: 7,
        avg_reaction_pct: -1.5,
        reaction_sample_n: 4,
        beat_rate: 0.75,
        beat_rate_n: 4,
        is_subject: false,
      },
    ],
    interpretation: "",
    sector_label: "Tech",
    major_group: "50",
    distribution: null,
    insufficient_reason: null,
  };

  const closedSection = meridianPeerSection({
    play: fixturePlay({ ticker: "GOOGL", status: "CLOSED" }),
    asOf: "2026-10-24 09:00 ET",
    sessionDate: "2026-10-24",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian,
    meridianPeer,
    ecosystem: null,
    vector: null,
  });
  assert.ok(closedSection);
  assert.match(closedSection!.body, /Current earnings peer lens — not what this trade traded under/);

  const openSection = meridianPeerSection({
    play: fixturePlay({ ticker: "GOOGL", status: "OPEN" }),
    asOf: "2026-10-24 09:00 ET",
    sessionDate: "2026-10-24",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian,
    meridianPeer,
    ecosystem: null,
    vector: null,
  });
  assert.ok(openSection);
  assert.doesNotMatch(openSection!.body, /not what this trade traded under/);
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
    fixturePlay({ archetype: "BREAKOUT", subLane: "TACTICAL" }),
  );
  assert.match(section.body, /\*\*Archetype:\*\* Breakout continuation/);
  assert.match(section.body, /\*\*Sub-lane:\*\* Tactical \(5.7d\)/);
});

// BUG FOUND (Ask Largo standing mandate, 2026-10-08): `whyThisSetupSection` used to render
// `play.subLane.replace(/_/g, " ")` — a no-op on every real `SwingSubLane` value, since none of
// TACTICAL/STANDARD/EXTENDED contain an underscore — so a real committed play's sub-lane rendered
// as the shouty raw enum ("Sub-lane: TACTICAL") instead of the human label
// (`SWING_SUB_LANES[...].label`, "Tactical (5–7d)") that `archetypeTrackRecordSection` further down
// this SAME brief and the live command-deck UI (`terminal-display.ts`'s `swingStatusDisplay`) both
// already use for the identical field. The previous test above (then using a fictional snake_case
// fixture value, "earnings_lead", which is not a member of `SwingSubLane` and can never occur on a
// real play) could not catch this because `.replace` only does something on a value that never
// actually ships. This test exercises every real value and asserts the raw enum form never leaks
// into the brief.
test("whyThisSetupSection: never renders the raw SwingSubLane enum verbatim for a real sub-lane", () => {
  for (const [subLane, expectedLabel] of [
    ["TACTICAL", "Tactical (5–7d)"],
    ["STANDARD", "Standard (8–15d)"],
    ["EXTENDED", "Extended (22–30d)"],
  ] as const) {
    const section = whyThisSetupSection(fixturePlay({ archetype: null, subLane }));
    assert.match(
      section.body,
      new RegExp(`\\*\\*Sub-lane:\\*\\* ${expectedLabel.replace(/[()–]/g, (c) => `\\${c}`)}`),
      `${subLane} must render as its human label, not the raw enum`,
    );
    assert.doesNotMatch(
      section.body,
      new RegExp(`\\*\\*Sub-lane:\\*\\* ${subLane}\\b`),
      `${subLane} must never render as the shouty raw enum verbatim`,
    );
  }
});

// Unrecognized/foreign sub-lane values stay silent — same honest-absence discipline
// `archetypeLabelFromRaw`'s callers already rely on, never a fabricated label.
test("whyThisSetupSection: an unrecognized subLane string renders no Sub-lane line at all", () => {
  const section = whyThisSetupSection(
    fixturePlay({ archetype: "BREAKOUT", subLane: "NOT_A_REAL_SUB_LANE" }),
  );
  assert.doesNotMatch(section.body, /\*\*Sub-lane:\*\*/);
});

// BUG FOUND (Ask Largo standing mandate, 2026-09-22, follow-up to #5446): sectorLeadershipFacts is
// frozen into the dossier at commit/discovery time and never re-derived — a position committed BEFORE
// #5446 shipped can still carry a pre-fix benchmark for a theme #5446 now excludes entirely (a
// crypto-equity name mechanically benchmarked against a SIC/label-derived sector ETF, e.g. HUT vs
// Financials/XLF). Live-repro'd on HUT:41 ~40min after #5446 merged: the brief still read "leading
// Financials (XLF) by 10.7%". Caveat only the exact bug signature (theme now excluded from
// benchmarking + frozen facts still carry one) rather than rewriting the frozen evidence.
test("whyThisSetupSection: caveats stale pre-fix industry-read evidence for a now-excluded theme (HUT/crypto-equity)", () => {
  const section = whyThisSetupSection(
    fixturePlay({
      ticker: "HUT",
      sectorLeadershipFacts: {
        benchmarkEtf: "XLF",
        benchmarkLabel: "Financials",
        kind: "sector",
        nameReturnPct: 6.5,
        groupReturnPct: -4.2,
        deltaPct: 10.7,
      },
    }),
  );
  assert.doesNotMatch(section.body, /Financials/);
  assert.doesNotMatch(section.body, /XLF/);
  assert.match(
    section.body,
    /\*\*Industry read:\*\* sector benchmark evidence recorded before a classification fix — historical score unaffected\./,
  );
});

test("whyThisSetupSection: still surfaces a live, legitimate industry read (non-crypto-equity name, unaffected)", () => {
  const section = whyThisSetupSection(
    fixturePlay({
      ticker: "NVDA",
      sectorLeadershipFacts: {
        benchmarkEtf: "SMH",
        benchmarkLabel: "Semiconductors",
        kind: "industry",
        nameReturnPct: 1.6,
        groupReturnPct: 5.6,
        deltaPct: -4.0,
      },
    }),
  );
  assert.match(section.body, /\*\*Industry read:\*\* lagging \*\*Semiconductors\*\* \(SMH\) by 4\.0% over 10 sessions \(\+1\.6% vs \+5\.6%\)\./);
});

// BUG FOUND (Ask Largo standing mandate, 2026-10-09, live AAPL WATCH brief): `deltaPct` is
// nameReturnPct − groupReturnPct computed on RAW, unrounded returns (industry-group-rs.ts), then
// this section rounded it to 1dp INDEPENDENTLY of the already-1dp-rounded `fmtPct` display of the
// two operands beside it — so the stated "by X%" lag/lead magnitude could silently disagree with
// the subtraction a reader does themselves from the two percentages right next to it. Real example
// (live production, same numbers reproduced here): raw nameReturnPct=1.34/groupReturnPct=1.55 (a
// real pair that independently round to the DIFFERENT display values "+1.3%"/"+1.6%", a 0.3 spread)
// used to render "by 0.2%" (1.34−1.55=−0.21, rounded alone) instead of the "0.3%" that actually
// subtracts from what's displayed — a Largo-contract C9 precision violation.
test("whyThisSetupSection: industry-read lag/lead magnitude always equals the displayed name/group delta, even when raw and rounded deltas disagree", () => {
  const section = whyThisSetupSection(
    fixturePlay({
      ticker: "AAPL",
      sectorLeadershipFacts: {
        benchmarkEtf: "XLK",
        benchmarkLabel: "Technology",
        kind: "sector",
        nameReturnPct: 1.34,
        groupReturnPct: 1.55,
        deltaPct: 1.34 - 1.55, // raw, unrounded — exactly what industry-group-rs.ts produces
      },
    }),
  );
  // Must read "0.3%" (1.6 − 1.3), never "0.2%" (the raw delta rounded in isolation).
  assert.match(section.body, /\*\*Industry read:\*\* lagging \*\*Technology\*\* \(XLK\) by 0\.3% over 10 sessions \(\+1\.3% vs \+1\.6%\)\./);
  assert.doesNotMatch(section.body, /by 0\.2%/);
});

// GAP FOUND (Ask Largo standing mandate, 2026-09-18, fresh angle: `dossier.ts`'s commit-time
// dataQuality.presentPillars/degraded read, pinned into `feature_vector.present_pillars`/
// `dq_degraded` at commit — feature-vector.ts, commit.ts — but never read back out anywhere in the
// serving/brief layer for an already-committed OPEN/CLOSED position). A pre-entry WATCH candidate's
// identical read already surfaces as a "thin read -- N/7 pillars grounded" thesis-health note the
// moment it degrades (serving-ingest.ts's swingServingMetaFromDossier) -- but that note is computed
// from the LIVE dossier, which the WATCH->COMMIT transition does not carry forward. A member
// reviewing an OPEN/CLOSED position never learned it was entered off a thin read. Wired via
// `entryPresentPillarsFromFeatureVector` (live-plays.ts) through `livePlayFromSwingPosition` (OPEN)
// and `closedDeckSourceFromRow` (CLOSED) into TerminalPlay.entryPresentPillars.
test("whyThisSetupSection: surfaces a thin entry-evidence read for an already-committed position", () => {
  const section = whyThisSetupSection(fixturePlay({ entryPresentPillars: 2 }));
  assert.match(section.body, /\*\*Evidence at entry:\*\* thin read — \*\*2\/7\*\* pillars grounded/);
});

test("whyThisSetupSection: omits the thin-entry-evidence line when the entry was well-grounded (never fabricated)", () => {
  const section = whyThisSetupSection(fixturePlay({ entryPresentPillars: null }));
  assert.doesNotMatch(section.body, /Evidence at entry/);
});

// GAP FOUND (Ask Largo standing mandate, 2026-09-18): archetype.ts's classification decisiveness
// (topFit - secondFit) is pinned at commit (feature_vector.classification_margin/.secondary) but was
// never read back out for an already-committed OPEN/CLOSED position — scoring/gating/calibration all
// partition on the single pinned `archetype` label (feature-vector.ts's own header), so a razor-thin
// classification call between two archetypes is a real, disclosed uncertainty a member never saw.
// Wired via `archetypeNearTieFromFeatureVector` (live-plays.ts) through `livePlayFromSwingPosition`
// (OPEN) and `closedDeckSourceFromRow` (CLOSED) into TerminalPlay.archetypeNearTie.
test("whyThisSetupSection: surfaces the archetype near-tie when the entry classification was a razor-thin call", () => {
  const section = whyThisSetupSection(
    fixturePlay({
      archetype: "BREAKOUT",
      archetypeNearTie: { secondaryLabel: "Pullback continuation", marginPct: 2 },
    }),
  );
  assert.match(
    section.body,
    /\*\*Classification:\*\* near-tie at entry — \*\*Breakout continuation\*\* beat \*\*Pullback continuation\*\* by only 2 pts\./,
  );
});

test("whyThisSetupSection: omits the archetype-near-tie line when the entry classification was decisive (never fabricated)", () => {
  const section = whyThisSetupSection(fixturePlay({ archetype: "BREAKOUT", archetypeNearTie: null }));
  assert.doesNotMatch(section.body, /Classification:/);
});

// BUG FOUND (Ask Largo standing mandate, 2026-09-18, live repro CRWD OPEN brief): marginPct is
// Math.round(margin * 100) (live-plays.ts) and can legitimately round to exactly 0 — an exact
// classifier tie, still inside ARCHETYPE_NEAR_TIE_MARGIN. The old wording ("beat X by only 0 pts")
// is self-contradictory at that value: a 0-point margin means no beat occurred.
test("whyThisSetupSection: an exact classifier tie (marginPct 0) reads as 'tied with', never 'beat by only 0 pts'", () => {
  const section = whyThisSetupSection(
    fixturePlay({
      archetype: "BREAKOUT",
      archetypeNearTie: { secondaryLabel: "Pullback continuation", marginPct: 0 },
    }),
  );
  assert.match(
    section.body,
    /\*\*Classification:\*\* near-tie at entry — \*\*Breakout continuation\*\* tied with \*\*Pullback continuation\*\*; priority order broke the tie\./,
  );
  assert.doesNotMatch(section.body, /by only 0 pts/);
});

// BUG FOUND (Ask Largo standing mandate, 2026-09-18, live repro NN:32 CLOSED brief — a real
// thin-evidence position whose row carries `archetype: null`): the render used to fall back to
// "**the winning archetype**" when `play.archetype` was null, fabricating a decisive-winner claim
// with no preceding "Archetype:" line to anchor it, for a position the classifier explicitly never
// classified. `archetypeNearTieFromFeatureVector` is now hardened against ever producing a
// near-tie in that case (its own test suite), but this proves the render layer independently
// refuses to fabricate the line even if `archetypeNearTie` somehow arrives anyway.
test("whyThisSetupSection: never fabricates the near-tie line when the entry itself was unclassified (archetype null), even if archetypeNearTie is somehow set", () => {
  const section = whyThisSetupSection(
    fixturePlay({
      archetype: null,
      archetypeNearTie: { secondaryLabel: "Pullback continuation", marginPct: 2 },
    }),
  );
  assert.doesNotMatch(section.body, /Classification:/);
  assert.doesNotMatch(section.body, /the winning archetype/);
});

// GAP FOUND (Ask Largo standing mandate, 2026-09-18): the entry-time contract pick's provenance
// against the multi-day accumulation flow's own magnet strike (top_flow_strike, pinned at commit)
// was computed by contract-ranker.ts's rankSwingContracts but never read back out for an
// already-committed OPEN/CLOSED position. Wired via `topFlowProvenanceFromRow` (live-plays.ts)
// through `livePlayFromSwingPosition` (OPEN) and `closedDeckSourceFromRow` (CLOSED) into
// TerminalPlay.topFlowProvenance. Both directions are informative, so both render.
test("whyThisSetupSection: surfaces corroboration when the pick matches the flow's magnet strike", () => {
  const section = whyThisSetupSection(
    fixturePlay({ topFlowProvenance: { topFlowStrike: 180, matchedPick: true } }),
  );
  assert.match(
    section.body,
    /\*\*Strike vs flow:\*\* this contract's strike \(\*\*\$180\*\*\) matches the accumulation flow's own magnet strike — corroborating\./,
  );
});

test("whyThisSetupSection: surfaces a real divergence when the pick landed on a different strike than the flow magnet", () => {
  const section = whyThisSetupSection(
    fixturePlay({ topFlowProvenance: { topFlowStrike: 175, matchedPick: false } }),
  );
  assert.match(
    section.body,
    /\*\*Strike vs flow:\*\* the accumulation flow's magnet strike was \*\*\$175\*\*; this pick landed at a different strike/,
  );
});

// GAP FOUND (Ask Largo standing mandate, 2026-10-20, live NVDA repro): the mismatch branch above
// named only the flow's magnet strike, never the pick's OWN strike -- a reader had to cross-
// reference the Verdict section's separate `play.contract` label to see how far apart the two
// actually were. `play.occ` (parsed via the shared `parseOccSymbol`) now resolves the pick's real
// strike so the comparison is self-contained in this one line.
test("whyThisSetupSection: the mismatch line names the pick's OWN strike too, when occ resolves it", () => {
  const section = whyThisSetupSection(
    fixturePlay({
      occ: "NVDA261121C00212500",
      topFlowProvenance: { topFlowStrike: 225, matchedPick: false },
    }),
  );
  assert.match(
    section.body,
    /\*\*Strike vs flow:\*\* the accumulation flow's magnet strike was \*\*\$225\*\*; this pick used \*\*\$212\.5\*\* instead/,
  );
});

test("whyThisSetupSection: mismatch line falls back to the generic wording when occ can't be parsed (never fabricated)", () => {
  const section = whyThisSetupSection(
    fixturePlay({ occ: null, topFlowProvenance: { topFlowStrike: 175, matchedPick: false } }),
  );
  assert.match(
    section.body,
    /\*\*Strike vs flow:\*\* the accumulation flow's magnet strike was \*\*\$175\*\*; this pick landed at a different strike \(chosen independently on tradability\/fit\)\.$/m,
  );
  assert.doesNotMatch(section.body, /this pick used/);
});

test("whyThisSetupSection: omits the strike-vs-flow line when no flow strike was ever resolved (never fabricated)", () => {
  const section = whyThisSetupSection(fixturePlay({ topFlowProvenance: null }));
  assert.doesNotMatch(section.body, /Strike vs flow/);
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

// FIX (Ask Largo standing mandate, 2026-10-14, live ASTS repro): `${z.conviction ?? "—"}
// conviction` printed a raw em-dash placeholder inline ("— conviction") whenever conviction was
// null, instead of omitting the clause entirely -- a flat placeholder the narrative-quality bar
// discourages elsewhere in this file.
test("flowIntelSection: omits the conviction clause entirely (never '— conviction') when conviction is null, non-condor row", () => {
  const eco = {
    ticker: "ASTS",
    flow_feed_fresh: true,
    recent_flow: null,
    zerodte_today: {
      session_date: "2026-09-11",
      direction: "short",
      score: 78,
      conviction: null,
      status: "committed",
      first_flagged_at: "2026-09-11T14:00:00Z",
      is_condor: false,
    },
  } as EcosystemContext;

  const section = flowIntelSection(eco, fixturePlay({ direction: "LONG" }), "2026-09-11");
  assert.ok(section);
  assert.match(section!.body, /0DTE desk: \*\*short\*\* · \*\*conflict\*\* with swing direction/);
  assert.doesNotMatch(section!.body, /— conviction/);
  assert.doesNotMatch(section!.body, /conviction/);
});

test("flowIntelSection: omits the conviction clause entirely when conviction is null, condor row", () => {
  const eco = {
    ticker: "SPY",
    flow_feed_fresh: true,
    recent_flow: null,
    zerodte_today: {
      session_date: "2026-09-11",
      direction: "long",
      score: 78,
      conviction: null,
      status: "committed",
      first_flagged_at: "2026-09-11T14:00:00Z",
      is_condor: true,
    },
  } as EcosystemContext;

  const section = flowIntelSection(eco, fixturePlay({ direction: "LONG" }), "2026-09-11");
  assert.ok(section);
  assert.match(section!.body, /sold iron condor\*\* \(structure-neutral, not a directional call\)/);
  assert.doesNotMatch(section!.body, /— conviction/);
  assert.doesNotMatch(section!.body, /conviction/);
});

// Live gap (2026-10-21, Ask Largo standing mandate): the 0DTE desk line was the one sibling in
// "Flow & positioning" with zero freshness/status disclosure — the HELIX tape line states its own
// window and Flow anomalies/Notable prints attach a per-item relativeAgeLabel bracket, but this
// line never surfaced z.first_flagged_at (a real provenance timestamp) or z.status (a real
// lifecycle column, same OPEN/HOLD/TRIM/CLOSED idiom as swing_positions) even though both are
// fetched in the same query. A setup flagged minutes ago and one that already stopped out hours
// earlier in the same session rendered identically.
test("flowIntelSection: 0DTE desk line discloses the setup's own age and a closed/resolved status", () => {
  const eco = {
    ticker: "NRG",
    flow_feed_fresh: true,
    recent_flow: null,
    zerodte_today: {
      session_date: "2026-09-11",
      direction: "long",
      score: 78,
      conviction: "high",
      status: "CLOSED",
      first_flagged_at: new Date(Date.now() - 3 * 60 * 60_000).toISOString(), // 3h ago
      is_condor: false,
    },
  } as EcosystemContext;

  const section = flowIntelSection(eco, fixturePlay({ direction: "LONG" }), "2026-09-11");
  assert.ok(section);
  assert.match(section!.body, /0DTE desk: \*\*long\*\*.*\[3h ago\].*already closed/, `got: ${section!.body}`);
});

test("flowIntelSection: 0DTE desk line carries no closed-status caveat for a still-live (non-CLOSED) setup", () => {
  const eco = {
    ticker: "NRG",
    flow_feed_fresh: true,
    recent_flow: null,
    zerodte_today: {
      session_date: "2026-09-11",
      direction: "short",
      score: 78,
      conviction: "high",
      status: "committed",
      first_flagged_at: new Date(Date.now() - 5 * 60_000).toISOString(), // 5m ago
      is_condor: false,
    },
  } as EcosystemContext;

  const section = flowIntelSection(eco, fixturePlay({ direction: "LONG" }), "2026-09-11");
  assert.ok(section);
  assert.match(section!.body, /0DTE desk: \*\*short\*\*.*\[5m ago\]/, `got: ${section!.body}`);
  assert.doesNotMatch(section!.body, /already closed/);
});

test("flowIntelSection: a closed CONDOR row also carries the closed-status caveat", () => {
  const eco = {
    ticker: "SPY",
    flow_feed_fresh: true,
    recent_flow: null,
    zerodte_today: {
      session_date: "2026-09-11",
      direction: "long",
      score: 78,
      conviction: "high",
      status: "CLOSED",
      first_flagged_at: new Date(Date.now() - 2 * 60 * 60_000).toISOString(), // 2h ago
      is_condor: true,
    },
  } as EcosystemContext;

  const section = flowIntelSection(eco, fixturePlay({ direction: "LONG" }), "2026-09-11");
  assert.ok(section);
  assert.match(section!.body, /sold iron condor.*\[2h ago\].*already closed/, `got: ${section!.body}`);
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

test("flowIntelSection: the print list is labeled honestly (48h/premium-sorted) and carries each print's own age, not 'Recent prints'", () => {
  // Live reproduction (AAPL #37, 2026-09-18): `eco.flow_full_state.recent` comes from
  // fetchFlowFullState() -> getFlowTapeSummary({ ticker, limit }) with no since_hours/order, which
  // defaults to db.ts's 48h window sorted BIGGEST-PREMIUM-FIRST (see the fix's own comment in
  // play-brief-intel.ts) — NOT the same 6h window as the "HELIX tape (Xh)" aggregate line directly
  // above it, and not recency-ordered. The header used to read "Recent prints" while showing a
  // $3.43M print alongside a 6h aggregate claiming only $263K of call premium total — a real,
  // internally-contradictory read. The header must now disclose the true window/order, and every
  // print must carry its own age so a reader can see it may fall outside the aggregate's window.
  const now = Date.now();
  const oldIso = new Date(now - 40 * 3_600_000).toISOString(); // 40h ago — outside the 6h aggregate
  const eco = {
    ticker: "AAPL",
    flow_feed_fresh: true,
    recent_flow: { window_hours: 6, print_count: 4, call_premium: 263_000, put_premium: 1_300_000, unknown_premium: 0 },
    recent_anomalies: [],
    flow_full_state: {
      count: 40,
      total_premium: 9_000_000,
      top_tickers: [],
      recent: [{ option_type: "CALL", strike: 350, premium: 3_430_000, alerted_at: oldIso }],
    },
    zerodte_today: null,
    gex_positioning: null,
    arsenal: null,
    vector_full_state: null,
  } as unknown as EcosystemContext;

  const section = flowIntelSection(eco, fixturePlay());
  assert.ok(section);
  assert.doesNotMatch(section!.body, /\*\*Recent prints:\*\*/, "must not claim these are 'recent' — they are premium-sorted over 48h");
  assert.match(section!.body, /\*\*Notable prints \(48h, largest premium first\):\*\*/);
  // BUG FIX (Ask Largo standing mandate, 2026-10-20): premium now renders via the K/M-scaled
  // fmtPremium formatter (matching the HELIX tape aggregate one line above), not the raw
  // per-contract-price fmtUsd formatter this used to carry ("$3430000.00").
  assert.match(section!.body, /CALL 350\.00 \$3\.4M \[40h ago\]/, "each print must disclose its own age so a reader can see it falls outside the 6h aggregate window");
});

test("flowIntelSection: notable-print strikes render to 2dp like every other strike in the brief (C9 precision)", () => {
  // FIX (2026-09-20): this was the ONE strike in the whole file rendered raw instead of
  // `.toFixed(2)` — a fractional-strike contract (e.g. 232.5, a real weekly-options strike)
  // rendered as "232.5" here while every sibling level (GEX king strike, dark-pool levels,
  // nearest wall, gamma magnet) renders "232.50" two lines above/below it in the same brief.
  const now = Date.now();
  const recentIso = new Date(now - 3_600_000).toISOString();
  const eco = {
    ticker: "TEST",
    flow_feed_fresh: true,
    recent_flow: null,
    recent_anomalies: [],
    flow_full_state: {
      count: 1,
      total_premium: 500_000,
      top_tickers: [],
      recent: [{ option_type: "PUT", strike: 232.5, premium: 500_000, alerted_at: recentIso }],
    },
    zerodte_today: null,
    gex_positioning: null,
    arsenal: null,
    vector_full_state: null,
  } as unknown as EcosystemContext;

  const section = flowIntelSection(eco, fixturePlay());
  assert.ok(section);
  // BUG FIX (Ask Largo standing mandate, 2026-10-20): premium now renders via fmtPremium ("$500K"),
  // not the raw per-contract-price fmtUsd formatter this used to carry ("$500000.00").
  assert.match(section!.body, /PUT 232\.50 \$500K/, "strike must round to 2dp, not render the raw float");
});

// BUG FIX (Ask Largo standing mandate, 2026-10-20, live repro CRWV #63/#61): notable prints used
// `fmtUsd` (fmtOptionUsd, documented for per-contract PRICES in the $0.01-$999.99 range) on raw
// HELIX flow-print premiums — hundreds of thousands of dollars — producing unreadable output
// ("$715000.00") one line below this same section's HELIX tape aggregate, which correctly renders
// "$204K" via the K/M-scaled `fmtPremium`. Two incompatible dollar-magnitude styles for the same
// kind of fact (flow premium) in one section.
test("flowIntelSection: notable-print premium renders K/M-scaled like the HELIX tape aggregate, not a raw per-contract price", () => {
  const recentIso = new Date(Date.now() - 1_800_000).toISOString();
  const eco = {
    ticker: "CRWV",
    flow_feed_fresh: true,
    recent_flow: { window_hours: 6, print_count: 2, call_premium: 204_000, put_premium: 0, unknown_premium: 0 },
    recent_anomalies: [],
    flow_full_state: {
      count: 1,
      total_premium: 715_000,
      top_tickers: [],
      recent: [{ option_type: "PUT", strike: 43, premium: 715_000, alerted_at: recentIso }],
    },
    zerodte_today: null,
    gex_positioning: null,
    arsenal: null,
    vector_full_state: null,
  } as unknown as EcosystemContext;

  const section = flowIntelSection(eco, fixturePlay());
  assert.ok(section);
  assert.match(section!.body, /calls \$204K/, "HELIX tape aggregate uses the K/M-scaled formatter");
  assert.match(section!.body, /PUT 43\.00 \$715K/, "notable print must use the same K/M-scaled formatter, not fmtUsd's raw $715000.00");
  assert.doesNotMatch(section!.body, /\$715000\.00/, "must never render the raw per-contract-price format for a flow premium");
});

// FINDING (Ask Largo standing mandate, 2026-09-22, live repro MSTR:33): chartTechnicalsSection,
// chartLevelsSection, gexPostureSection and wallDynamicsSection all unshift a "_Current X — not
// what this trade traded under._" disclosure on a CLOSED play (see each section's own fix — the
// chart-technicals one cites live AAPL:36 evidence for the exact same failure mode: today's data
// rendered "with no framing whatsoever, reading as if it described the trade's own conditions").
// flowIntelSection carries the IDENTICAL risk — its HELIX tape/anomalies/notable-prints/0DTE-desk
// content is always CURRENT (as-of-request-time), yet was the one sibling section never given the
// same disclosure. Live MSTR:33 (closed 2026-09-03) rendered "HELIX tape (6h): call-heavy...",
// several dated "[Nh ago]" anomalies/prints, and a 0DTE desk alignment line with zero indication
// any of it postdates the trade by weeks — a member could easily read it as the flow context the
// trade was actually taken under.
test("flowIntelSection: CLOSED bucket gets the same 'not what this trade traded under' disclosure as its sibling sections", () => {
  const eco = {
    ticker: "MSTR",
    flow_feed_fresh: true,
    recent_flow: { window_hours: 6, print_count: 4, call_premium: 4_600_000, put_premium: 1_900_000, unknown_premium: 0 },
    recent_anomalies: [],
    flow_full_state: { count: 1, total_premium: 5_200_000, top_tickers: [], recent: [] },
    zerodte_today: null,
    gex_positioning: null,
    arsenal: null,
    vector_full_state: null,
  } as unknown as EcosystemContext;

  const closedSection = flowIntelSection(eco, fixturePlay({ status: "CLOSED" }));
  assert.ok(closedSection);
  assert.match(closedSection!.body, /Current flow — not what this trade traded under/);

  const openSection = flowIntelSection(eco, fixturePlay({ status: "OPEN" }));
  assert.ok(openSection);
  assert.doesNotMatch(openSection!.body, /Current flow/, "open/watch buckets are unchanged");
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

// BUG FIX (2026-10-21, Ask Largo 5-engine cycle, live repro MRNA 237.5C 2DTE/positionId 1958):
// once a trim tranche has fired, the exit engine's own live state machine
// (deriveScaleOutAction/computeScaleOutTriggerInfo, scale-out.ts) permanently disables this
// pre-scale hard stop — gated `if (!scaledAlready)`, and post-scale the engine returns
// `hard_stop_price: null` ("the hard stop no longer applies"). This line used to render the
// cushion unconditionally, stating "thesis breaks if mark closes below" for a trigger that can
// no longer fire, with the real governing floor (the runner's trailing stop off its peak) never
// disclosed. Live repro numbers: entry $6.49, peak +103.4%.
test("watchForSection: Premium stop rail is annotated (not a live cushion claim) once a trim has fired, surfacing the real runner-trail floor (live MRNA repro)", () => {
  const section = watchForSection(
    {
      play: fixturePlay({
        status: "TRIM",
        direction: "LONG",
        entry: 6.49,
        mark: 10,
        peak: 103.4,
        execMark: null,
        exitPolicy: {
          policy: "trim_scale",
          hard_stop_pct: -60,
          target_pct: 100,
          trim_levels: [{ trigger_pct: 100, fraction: 0.5, premium: 12.98, fired: true }],
          runner_fraction: 0.5,
          stop_premium: 2.6,
          target_premium: 12.98,
        },
      }),
      asOf: "2026-10-20 20:00 ET",
      sessionDate: "2026-10-20",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: null,
      vector: null,
    },
    "open",
  );
  assert.match(
    section.body,
    /Premium stop rail: \*\*\$2\.60\*\* _\(no longer applies — already scaled\)_ — the runner's real floor now is \*\*\$6\.60\*\* \(trailing stop off peak\)/,
  );
  assert.doesNotMatch(section.body, /thesis breaks if mark closes below/);
});

// GAP FOUND (Ask Largo standing mandate, 2026-09-18, live repro CRWD:39 OPEN brief): the stop rail
// above gets a fully-gated room% (mark/execMark-preferring, staleness-aware, never fabricated) —
// `exitPolicy.target_premium` never got the symmetric treatment anywhere in the narrative layer,
// only ever appearing as a bare dollar figure elsewhere ("Rails: stop X · target Y"). Mirrors the
// stop-cushion tests immediately above.
test("watchForSection: Premium target rail shows the live room percentage to the target, not just the dollar level", () => {
  const section = watchForSection(
    {
      play: fixturePlay({
        status: "HOLD",
        direction: "LONG",
        mark: 14.65,
        execMark: null,
        exitPolicy: {
          policy: "trim_scale",
          hard_stop_pct: -60,
          target_pct: 100,
          trim_levels: [],
          runner_fraction: 0.5,
          stop_premium: 5.08,
          target_premium: 25.4,
        },
      }),
      asOf: "2026-09-18 01:18 ET",
      sessionDate: "2026-09-18",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: null,
      vector: null,
    },
    "open",
  );
  // (25.40 - 14.65) / 14.65 * 100 = 73.38% -> 73%
  assert.match(
    section.body,
    /Premium target rail: \*\*\$25\.40\*\* — \*\*73%\*\* move still needed from current mark to reach target/,
  );
});

test("watchForSection: Premium target rail omits the room note when mark is unavailable (never fabricated)", () => {
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
          stop_premium: 5.08,
          target_premium: 25.4,
        },
      }),
      asOf: "2026-09-18 01:18 ET",
      sessionDate: "2026-09-18",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: null,
      vector: null,
    },
    "open",
  );
  assert.doesNotMatch(section.body, /Premium target rail/);
});

test("watchForSection: Premium target rail uses the executable (bid) basis, not the more optimistic mid, when they diverge", () => {
  const section = watchForSection(
    {
      play: fixturePlay({
        status: "HOLD",
        direction: "LONG",
        mark: 14.65,
        execMark: 13.0,
        exitPolicy: {
          policy: "trim_scale",
          hard_stop_pct: -60,
          target_pct: 100,
          trim_levels: [],
          runner_fraction: 0.5,
          stop_premium: 5.08,
          target_premium: 25.4,
        },
      }),
      asOf: "2026-09-18 01:18 ET",
      sessionDate: "2026-09-18",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: null,
      vector: null,
    },
    "open",
  );
  // (25.40 - 13.00) / 13.00 * 100 = 95.38% -> 95%, using execMark (bid), not the more optimistic mid.
  assert.match(
    section.body,
    /Premium target rail: \*\*\$25\.40\*\* — \*\*95%\*\* move still needed from current bid to reach target/,
  );
});

test("watchForSection: Premium target rail omits the room note once the basis has already reached or passed the target (never a negative/zero fabrication)", () => {
  const section = watchForSection(
    {
      play: fixturePlay({
        status: "HOLD",
        direction: "LONG",
        mark: 26.0,
        exitPolicy: {
          policy: "trim_scale",
          hard_stop_pct: -60,
          target_pct: 100,
          trim_levels: [],
          runner_fraction: 0.5,
          stop_premium: 5.08,
          target_premium: 25.4,
        },
      }),
      asOf: "2026-09-18 01:18 ET",
      sessionDate: "2026-09-18",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: null,
      vector: null,
    },
    "open",
  );
  assert.doesNotMatch(section.body, /Premium target rail/);
});

// BUG FIX (Ask Largo standing mandate, 2026-09-22, live repro MUU TRIM brief): unlike the test
// above (mark itself already past target -> omitted), this covers the position that reached
// target, TRIMMED there, and has since pulled back BELOW it -- `target > targetBasis` is true
// again, so the old code rendered "Premium target rail: $2.40 -- 19% move still needed to reach
// target" a few lines below "Trim ladder: +100% checkmark" in the SAME document, directly
// contradicting itself. Swing's own exit policy prices target_pct identically to its one trim
// rung's trigger_pct, so this is the common post-trim-pullback shape, not a rare edge case.
test("watchForSection: Premium target rail is omitted once its own trim tranche already fired, even after the mark pulls back below it again", () => {
  const section = watchForSection(
    {
      play: fixturePlay({
        status: "TRIM",
        direction: "LONG",
        mark: 2.025, // pulled back from peak 2.85, still below the 2.40 target level again
        execMark: null,
        exitPolicy: {
          policy: "trim_scale",
          hard_stop_pct: -60,
          target_pct: 100,
          trim_levels: [{ trigger_pct: 100, fraction: 0.5, premium: 2.4, fired: true }],
          runner_fraction: 0.5,
          stop_premium: 0.48,
          target_premium: 2.4,
        },
      }),
      asOf: "2026-09-22 01:32 ET",
      sessionDate: "2026-09-21",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: null,
      vector: null,
    },
    "open",
  );
  assert.doesNotMatch(section.body, /Premium target rail/);
});

test("watchForSection: Premium target rail still shows the room% for a target no trim tranche has reached yet", () => {
  const section = watchForSection(
    {
      play: fixturePlay({
        status: "HOLD",
        direction: "LONG",
        mark: 2.025,
        execMark: null,
        exitPolicy: {
          policy: "trim_scale",
          hard_stop_pct: -60,
          target_pct: 100,
          // A rung below target that HAS fired must not suppress the room% for a HIGHER,
          // not-yet-reached target -- only a fired tranche at/above the target level should.
          trim_levels: [{ trigger_pct: 25, fraction: 0.33, premium: 1.5, fired: true }],
          runner_fraction: 0.5,
          stop_premium: 0.48,
          target_premium: 2.4,
        },
      }),
      asOf: "2026-09-22 01:32 ET",
      sessionDate: "2026-09-21",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: null,
      vector: null,
    },
    "open",
  );
  // (2.40 - 2.025) / 2.025 * 100 = 18.5% -> 19%
  assert.match(
    section.body,
    /Premium target rail: \*\*\$2\.40\*\* — \*\*19%\*\* move still needed from current mark to reach target/,
  );
});

// Live repro (2026-10-21, Ask Largo standing mandate): MRNA (TRIM) and CRWV (HOLD) both showed
// the Position section flag Mark/Greeks/Spread "stale" (same mark, ~5h16m past
// SWING_OPTION_MARK_STALE_MS=18min) while the SAME envelope's "What to watch" rendered confident,
// unqualified "Premium stop rail: 79% cushion from current bid" / "Premium target rail: 133% move
// still needed" two sections later off that identical stale quote — directly contradicting
// "Trade manager read"'s own "Data caveat ... Treat levels as indicative until refresh" line.
// play-brief.ts's pnlSection already attaches this exact caveat to Greeks/Spread for the identical
// field; watchForSection's rails never did.
test("watchForSection: Premium stop/target rails carry the same 'stale — same quote Mark flagged above' caveat as the Position section's Greeks/Spread, for the identical stale mark (2026-10-21)", () => {
  const stalePlay = fixturePlay({
    status: "HOLD",
    direction: "LONG",
    mark: 12.53,
    execMark: 12.25,
    markAsOf: "2026-10-20T20:00:00.000Z", // ~5h16m before readMs below -- well past the 18-min window
    exitPolicy: {
      policy: "trim_scale",
      hard_stop_pct: -60,
      target_pct: 100,
      trim_levels: [],
      runner_fraction: 0.5,
      stop_premium: 2.6,
      target_premium: 25.0,
    },
  });
  const staleSection = watchForSection(
    {
      play: stalePlay,
      asOf: "2026-10-21T01:16:00.000Z",
      sessionDate: "2026-10-20",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: null,
      vector: null,
      readMs: Date.parse("2026-10-21T01:16:00.000Z"),
    } as SwingPlayBriefContext,
    "open",
  );
  assert.match(
    staleSection.body,
    /Premium stop rail:.*stale — same quote Mark flagged above/,
    `got: ${staleSection.body}`,
  );
  assert.match(
    staleSection.body,
    /Premium target rail:.*stale — same quote Mark flagged above/,
    `got: ${staleSection.body}`,
  );

  // Fresh mark (well within the staleness window) must carry no caveat at all -- no false disclosure.
  const freshPlay = fixturePlay({
    status: "HOLD",
    direction: "LONG",
    mark: 12.53,
    execMark: 12.25,
    markAsOf: "2026-10-21T01:10:00.000Z", // 6 minutes before readMs -- well inside the window
    exitPolicy: {
      policy: "trim_scale",
      hard_stop_pct: -60,
      target_pct: 100,
      trim_levels: [],
      runner_fraction: 0.5,
      stop_premium: 2.6,
      target_premium: 25.0,
    },
  });
  const freshSection = watchForSection(
    {
      play: freshPlay,
      asOf: "2026-10-21T01:16:00.000Z",
      sessionDate: "2026-10-20",
      scanAsOf: null,
      scanSessionDay: null,
      laneRows: [],
      meridian: null,
      ecosystem: null,
      vector: null,
      readMs: Date.parse("2026-10-21T01:16:00.000Z"),
    } as SwingPlayBriefContext,
    "open",
  );
  assert.doesNotMatch(freshSection.body, /stale — same quote Mark flagged above/, `got: ${freshSection.body}`);
  assert.match(freshSection.body, /Premium stop rail/);
  assert.match(freshSection.body, /Premium target rail/);
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

// BUG FOUND (Ask Largo standing mandate, 2026-09-20): buildIntelSections called every section
// builder bare — no try/catch anywhere in this function or in composeSwingPlayBrief. `factors` is
// typed as a required array on TerminalPlay, but nothing defended against a degraded/malformed
// upstream row actually carrying something else at runtime — whyThisSetupSection's unconditional
// `play.factors.slice(0, 10)` (first section pushed, always unconditional) throws a real TypeError
// on that shape. Pre-fix, that throw propagated straight out of buildIntelSections (and from there
// through composeSwingPlayBrief to the API route's top-level catch, turning ONE bad section into a
// 503 for the entire brief — Verdict/Position/Management included, even though every other section
// would have built fine). Post-fix (safeSection wrapping every call), the broken section is silently
// omitted — exactly like a section that legitimately decided it had nothing to say — and every other
// section still renders.
test("buildIntelSections: a single section throwing does not take down the whole brief (error boundary)", () => {
  const play = fixturePlay({
    status: "WATCH",
    // Realistic malformed-upstream-row shape: TerminalPlay.factors is typed as a required array,
    // but this simulates a degraded read that didn't honor that contract at runtime.
    factors: undefined as unknown as TerminalPlay["factors"],
  });
  const ctx: SwingPlayBriefContext = {
    play,
    asOf: "2026-09-20T14:00:00.000Z",
    sessionDate: "2026-09-20",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
  };

  // Prove the malformed shape genuinely throws inside the unwrapped builder (the RED half of
  // RED->GREEN) — this is not a hypothetical, it's the exact call buildIntelSections makes first.
  assert.throws(() => whyThisSetupSection(play));

  // The composed call must not throw, and every OTHER section must still be present — only the
  // one broken section is missing.
  let sections: ReturnType<typeof buildIntelSections> = [];
  assert.doesNotThrow(() => {
    sections = buildIntelSections(ctx, "watch");
  });
  assert.ok(!sections.some((s) => s.title === "Why this setup"), "broken section omitted, not fabricated");
  assert.ok(sections.some((s) => s.title === "Trade manager read"), "other sections still render");
  assert.ok(sections.some((s) => s.title === "Watch levels"), "other sections still render");
});

// BUG FOUND (Ask Largo standing mandate, 2026-10-10): the test above proves the error BOUNDARY
// works (one throw doesn't take down the whole brief) but not that the failure is DISCLOSED —
// pre-fix, `safeSection` had no `onFailure` hook at all, so a thrown section vanished with zero
// record anywhere the model-facing envelope reads (not `unavailableSources`, not `confidence`),
// identical to the gap the 2026-10-07 `safeCompose`/`onFailure` fix closed for evidence/levels but
// explicitly deferred extending to this function's own 20 `safeSection` calls. Reuses the exact
// same malformed-`factors` repro as the test above.
test("buildIntelSections: a thrown section is reported via onFailure, not silently indistinguishable from a real absence", () => {
  const play = fixturePlay({
    status: "WATCH",
    factors: undefined as unknown as TerminalPlay["factors"],
  });
  const ctx: SwingPlayBriefContext = {
    play,
    asOf: "2026-09-20T14:00:00.000Z",
    sessionDate: "2026-09-20",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
  };

  const failures: string[] = [];
  const sections = buildIntelSections(ctx, "watch", { onFailure: (label) => failures.push(label) });

  assert.ok(!sections.some((s) => s.title === "Why this setup"), "broken section still omitted, not fabricated");
  assert.deepEqual(failures, ["Why this setup"], "the broken section's own label is reported exactly once");

  // Omitting `onFailure` entirely (every pre-existing call site in this file) must stay a no-op —
  // the hook is additive, never required.
  assert.doesNotThrow(() => buildIntelSections(ctx, "watch"));
});

// BUG FOUND (2026-09-21, Ask Largo standing mandate — 4th instance of the #5362/#4261 duplication
// class, live repro pattern: any OPEN play with a HOLD recommendation and a calibrated thesis
// health below 45). actionNarrative's HOLD branch (play-brief-narrative.ts, feeds "Trade manager
// read") renders "**Hold the line** — thesis health **X%**. Health fading — tighten stop or trim
// into any bounce." whenever `rec !== "TRIM" && rec !== "SELL"` and health < 45. holdPlanSection
// (this file) independently renders "Thesis health **X%** (rung). **Tighten risk** — thesis
// fading; don't add size" for the SAME health < 45 condition in "Hold plan", which renders
// together with "Trade manager read" for every live OPEN play (buildIntelSections pushes
// `narrative` unconditionally and `hold` for bucket === "open"). Both are the identical underlying
// advice — thesis health has degraded, tighten/reduce risk — restated in different prose across
// two sections a member reads back to back. The dedup guards this file already carries for
// round_trip/capture (narrativeAlreadyNoted) never covered this HOLD-branch advisory text because
// the call site only ever derived roundTrip/capture flags, not a tighten/health-fading one.
test("buildIntelSections: does not restate the low-thesis-health tighten-risk advisory twice for an OPEN HOLD play", () => {
  const play = fixturePlay({
    status: "HOLD",
    recommendation: "HOLD",
    contract: "110C · 12DTE",
    thesisHealth: {
      health: 30,
      entryIndex: 70,
      currentIndex: 30,
      delta: -40,
      rung: "MAJOR",
      rungLabel: "Major fade",
      pillars: [
        {
          id: "structure",
          label: "Persistence",
          weight: 0.28,
          commitScore: 0.9,
          currentScore: 0.2,
          commitLabel: "triggered",
          currentLabel: "broken",
          status: "faded",
          contributionPts: 6,
          deltaPts: -19,
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
      ],
      moves: [],
      committedAtEt: null,
      computedAtEt: "10:00 ET",
      advisory: "Thesis fading — tighten risk or trim into strength.",
      thesisBreakLevel: "warn",
    },
  });
  const ctx: SwingPlayBriefContext = {
    play,
    asOf: "2026-09-21T20:00:00.000Z",
    sessionDate: "2026-09-21",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
  };

  // collapseIntel: false — the expanded-view shape (expandIntel=1), where "Hold plan" is an
  // independently visible section rather than folded into "Trade manager read"'s collapsed
  // summary. Same expansion the BUG FIX note above describes as the condition under which this
  // duplication is member-visible at all.
  const sections = buildIntelSections(ctx, "open", { collapseIntel: false });
  const narrative = sections.find((s) => s.title === "Trade manager read");
  const hold = sections.find((s) => s.title === "Hold plan");
  assert.ok(narrative, "Trade manager read renders");
  assert.match(narrative!.body, /Health fading — tighten stop or trim into any bounce\./);
  assert.ok(hold, "Hold plan renders");
  // The raw health%/rung number is a compact fact, not prose — it stays independently (same
  // discipline as the thesis-health advisory-sentence fix above). Only the restated ADVICE
  // sentence must be suppressed once "Trade manager read" already carries the equivalent one.
  assert.match(hold!.body, /Thesis health \*\*30%\*\* \(Major fade\)/);
  assert.doesNotMatch(hold!.body, /\*\*Tighten risk\*\* — thesis fading; don't add size/);
});

// BUG FIX (Ask Largo standing mandate, 2026-10-22, same gap one layer deeper than the dedup fix
// just above): the compact "Thesis health X% (rung)" line, and the "Tighten risk" line beneath it,
// both fired off health<45 alone, with no check for whether anything had actually moved since
// commit — the identical false-decay gap already fixed at play-brief.ts's own "Thesis health"
// section (2026-10-07). A position that has sat in a low health band since commit (no pillar
// faded, moves at its "unchanged" fallback) must not have "Tighten risk — thesis fading; don't add
// size" asserted against it, and the compact line should say so.
test("buildIntelSections: Hold plan's compact thesis-health line reads 'unchanged since commit' and suppresses Tighten risk when nothing actually moved", () => {
  const play = fixturePlay({
    status: "HOLD",
    recommendation: "HOLD",
    contract: "110C · 12DTE",
    thesisHealth: {
      health: 30,
      entryIndex: 30,
      currentIndex: 30,
      delta: 0,
      rung: "MAJOR",
      rungLabel: "Major fade",
      pillars: [
        {
          id: "structure",
          label: "Persistence",
          weight: 0.28,
          commitScore: 0.5,
          currentScore: 0.5,
          commitLabel: "triggered",
          currentLabel: "triggered",
          status: "intact",
          contributionPts: 14,
          deltaPts: 0,
        },
      ],
      moves: ["All swing pillars unchanged since commit."],
      committedAtEt: null,
      computedAtEt: "10:00 ET",
      advisory: "Thesis fading — tighten risk or trim into strength.",
      thesisBreakLevel: "intact",
    },
  });
  const ctx: SwingPlayBriefContext = {
    play,
    asOf: "2026-09-21T20:00:00.000Z",
    sessionDate: "2026-09-21",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
  };
  const sections = buildIntelSections(ctx, "open", { collapseIntel: false });
  const hold = sections.find((s) => s.title === "Hold plan");
  assert.ok(hold, "Hold plan renders");
  assert.match(hold!.body, /Thesis health \*\*30%\*\* \(Major fade\) — unchanged since commit/);
  assert.doesNotMatch(
    hold!.body,
    /\*\*Tighten risk\*\* — thesis fading; don't add size/,
    "must not assert decay advice for a position whose health has been unchanged since commit",
  );
});

// GAP FOUND (2026-09-20, Ask Largo standing mandate, live repro BKKT: 28 same-theme overlaps
// rendered as one uncapped comma-separated wall of tickers). A crowded book must still read as
// trader-manager prose, not a raw name dump — see the doc comment on MAX_OVERLAP_NAMES/
// joinOverlapNames in play-brief-intel.ts for the full live evidence.
test("bookContextSection: a large same-theme overlap caps the rendered name list, does not dump every ticker", () => {
  const crypto = ["COIN", "MSTU", "MARA", "RIOT", "CLSK", "HUT", "IREN", "BITX", "MSTR", "GBTC"];
  const book: PortfolioPosition[] = crypto.map((ticker) => ({ ticker, direction: "LONG" }));
  const section = bookContextSection(
    fixturePlay({ id: "SWING:BKKT:1", ticker: "BKKT", direction: "LONG", status: "OPEN" }),
    book,
  );
  assert.ok(section);
  // The true count in the lead sentence stays honest — nothing is hidden, only the namewall trims.
  assert.match(section!.body, /already holding 10 same-direction/);
  // Exactly MAX_OVERLAP_NAMES (8) ticker names are rendered, not all 10.
  const renderedNames = crypto.filter((t) => section!.body.includes(`${t} LONG`));
  assert.equal(renderedNames.length, 8, "must cap the rendered names, not list every overlap");
  assert.match(section!.body, /\+ 2 more/, "the remainder must be folded into an honest count");
});

// Live repro (2026-10-21, Ask Largo standing mandate): MRNA TRIM (positionId 1958) — the ENTIRE
// same-direction "theme overlap" was a second, independently-committed MRNA position (not a
// different healthcare name) but rendered as generic sector concentration. Mirrors the
// same-ticker/other-ticker split already shipped for the OPPOSED-direction branch (2026-10-20).
test("bookContextSection: a same-ticker/same-direction duplicate renders the sharper 'same underlying' sentence, not generic sector-theme framing (2026-10-21, live MRNA repro)", () => {
  const book: PortfolioPosition[] = [{ ticker: "MRNA", direction: "LONG", positionId: 1969 }];
  const section = bookContextSection(
    fixturePlay({ id: "SWING:MRNA:1958", ticker: "MRNA", direction: "LONG", status: "TRIM" }),
    book,
  );
  assert.ok(section);
  assert.match(
    section!.body,
    /\*\*Concentration — same underlying\*\* — already holding MRNA LONG \(separate position #1969\) on MRNA itself/,
    `got: ${section!.body}`,
  );
  assert.match(section!.body, /This is the identical name, not just the same sector/);
  assert.doesNotMatch(section!.body, /theme "/i, "must not fall back to generic theme framing for a pure same-ticker duplicate");
});

// Live repro (2026-10-21, Ask Largo standing mandate): CRWV HOLD (positionId 63) — a SAME-TICKER
// row (another CRWV position) sat alongside two genuinely DIFFERENT names (ON, NBIS) in the same
// theme. Both the sharper same-ticker sentence AND the generic cross-ticker sentence must render,
// each carrying only its own rows — the same-ticker sentence must never also claim the other,
// genuinely different names, and the generic sentence's count must drop to just the others.
test("bookContextSection: a mixed same-ticker + different-ticker same-direction overlap renders BOTH sentences, each scoped to its own rows (2026-10-21, live CRWV repro)", () => {
  const book: PortfolioPosition[] = [
    { ticker: "ON", direction: "LONG" },
    { ticker: "NBIS", direction: "LONG" },
    { ticker: "CRWV", direction: "LONG", positionId: 1968 },
  ];
  const section = bookContextSection(
    fixturePlay({ id: "SWING:CRWV:63", ticker: "CRWV", direction: "LONG", status: "HOLD" }),
    book,
  );
  assert.ok(section);
  assert.match(
    section!.body,
    /\*\*Concentration — same underlying\*\* — already holding CRWV LONG \(separate position #1968\) on CRWV itself/,
    `got: ${section!.body}`,
  );
  assert.match(
    section!.body,
    /\*\*Concentration\*\* — already holding 2 same-direction positions? in .* ON LONG, NBIS LONG/,
    `got: ${section!.body}`,
  );
  // The same-ticker sentence must not also fold in the other, genuinely different names.
  const sameUnderlyingSentence = section!.body.split("**Concentration — same underlying**")[1]?.split("**Concentration**")[0] ?? "";
  assert.doesNotMatch(sameUnderlyingSentence, /ON LONG|NBIS LONG/);
});

// GAP FOUND (Ask Largo standing mandate, 2026-10-24, live repro PANW's own book context): a
// ticker with two separate OTHER (non-reviewed) positions rendered scattered across the generic
// theme sentence -- "ZS LONG (separate position #2106), SNOW LONG, NET LONG, CRWD LONG, ZS LONG
// (separate position #2028)" -- reading like an accidental duplicate rather than a deliberate
// second position, because SNOW/NET/CRWD sat between the two ZS mentions. Each instance was
// already correctly disambiguated with its own position id (#5167); this only asserts they're
// also grouped adjacently.
test("bookContextSection: a duplicate OTHER ticker in a multi-name theme overlap is clustered adjacently, not scattered (2026-10-24, live PANW repro)", () => {
  const book: PortfolioPosition[] = [
    { ticker: "ZS", direction: "LONG", positionId: 2106 },
    { ticker: "SNOW", direction: "LONG", positionId: 2105 },
    { ticker: "NET", direction: "LONG", positionId: 2104 },
    { ticker: "CRWD", direction: "LONG", positionId: 2102 },
    { ticker: "ZS", direction: "LONG", positionId: 2028 },
  ];
  const section = bookContextSection(
    fixturePlay({ id: "SWING:PANW:67", ticker: "PANW", direction: "LONG", status: "OPEN" }),
    book,
  );
  assert.ok(section);
  assert.match(
    section!.body,
    /ZS LONG \(separate position #2106\), ZS LONG \(separate position #2028\), SNOW LONG, NET LONG, CRWD LONG/,
    `both ZS instances must be adjacent, preceding the other, unrelated tickers in first-occurrence order, got: ${section!.body}`,
  );
});

// BUG FOUND (Ask Largo standing mandate, 2026-10-08 :40 cycle, live repro SWING:TNGX:1611):
// breakTrigger (play-brief-narrative.ts), the narrative's authoritative "Break watch" bullet AND
// the headline `envelope.invalidation` field, was fixed on 2026-09-15 to pick whichever real
// support level — put wall, dark pool, or GEX king — is actually NEAREST spot (see
// resolveInvalidationFocalLevel's own doc comment: "the king sat 8x nearer than the put wall" on
// a live CRWD repro). `watchForSection`'s own "Structural support node"/"Structural resistance
// node" line was never updated to match — it still hardcodes put wall (LONG) / call wall (SHORT)
// unconditionally, with no awareness that a nearer GEX king (or dark-pool print) exists. Live
// TNGX repro (spot 22.57, GEX king 22.00, put wall 20.00): `envelope.invalidation` correctly read
// "Break watch — lose 22.00" (the nearer, real risk) while "What to watch" in the SAME envelope
// said "Structural support node: put wall 20.00" — two different numbers for what both sections
// present as THE structural level that matters for this play, with no indication to the member
// that they're reading two different concepts. Reproduced here with the identical shape (king
// nearer than put wall for a LONG).
test("watchForSection: Structural support node matches breakTrigger's nearest-level selection, not a hardcoded put wall (Largo identity/precision)", () => {
  const ctx: SwingPlayBriefContext = {
    play: fixturePlay({ direction: "LONG", status: "OPEN" }),
    asOf: "2026-10-08 20:44 ET",
    sessionDate: "2026-10-08",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: {
      gex_positioning: {
        spot: 100,
        gex_king_strike: 102,
        put_wall: 90,
        matrix_age_sec: 30,
        freshness: "live",
      },
    } as EcosystemContext,
    vector: {
      spot: 100,
      dataAgeMs: 1_000,
      freshness: "live",
      gexWalls: { putWalls: [{ strike: 90 }], callWalls: [] },
      ladder: { rows: [{ strike: 97, isKing: true }] },
    } as unknown as VectorFullState,
  };

  const watch = watchForSection(ctx, "open");
  const narrative = tradeManagerNarrativeSection(ctx, "open");

  assert.ok(narrative);
  // The narrative's authoritative Break watch bullet picks the nearer king (97), not the put wall.
  assert.match(narrative!.body, /\*\*Break watch\*\* — lose \*\*97\.00\*\*/);

  // "What to watch" must cite the SAME level the authoritative Break watch bullet names — never a
  // second, independently-selected number for what both sections call "the" structural support.
  assert.match(watch.body, /Structural support node: GEX king \*\*97\.00\*\*/);
  assert.doesNotMatch(watch.body, /put wall \*\*90\.00\*\*/);
});
