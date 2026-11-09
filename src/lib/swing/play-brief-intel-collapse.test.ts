import test from "node:test";
import assert from "node:assert/strict";
import { collapseRedundantIntelSections } from "./play-brief-intel-collapse";
import type { RichSection } from "@/lib/bie/rich-narrative";

function section(title: string): RichSection {
  return { title, body: "detail", bias: "neutral" };
}

test("collapseRedundantIntelSections: no-op without narrative", () => {
  const sections = [section("Trade manager read"), section("GEX posture"), section("Verdict")];
  const out = collapseRedundantIntelSections(sections, { hasNarrative: false, bucket: "open" });
  assert.equal(out.length, 3);
});

test("collapseRedundantIntelSections: drops covered titles when the predicate proves the narrative covered them", () => {
  const sections = [section("Trade manager read"), section("GEX posture"), section("Why this setup")];
  // "GEX posture" is now a conditionally-covered title too (2026-11-09) — pass gexPostureFolded:
  // true explicitly to prove dealerPostureLine actually carried the VEX/DEX/CHARM content for
  // this test's data, same shape every other conditionally-covered title's "unconditional drop"
  // test below uses.
  const out = collapseRedundantIntelSections(sections, {
    hasNarrative: true,
    bucket: "open",
    gexPostureFolded: true,
  });
  assert.ok(!out.some((s) => s.title === "GEX posture"));
  assert.ok(out.some((s) => s.title === "Why this setup"));
  const narrative = out.find((s) => s.title === "Trade manager read");
  assert.match(narrative!.body, /folded into Trade manager read/i);
});

// Every title in NARRATIVE_COVERED_TITLES is now a conditionally-covered title (Ask Largo
// standing mandate, 2026-11-08/09 — "GEX posture" was the last one, fixed 2026-11-09). See each
// title's own dedicated test block further down this file, and `NARRATIVE_COVERED_TITLES`'s doc
// comment (play-brief-intel-collapse.ts) for why none of their coverage can be assumed from
// static title membership alone.

test("collapseRedundantIntelSections: NEVER drops 'Book context' — no narrative bullet covers it since #4116", () => {
  const sections = [section("Trade manager read"), section("Book context"), section("Why this setup")];
  const out = collapseRedundantIntelSections(sections, { hasNarrative: true, bucket: "open" });
  assert.ok(out.some((s) => s.title === "Book context"), "Book context must survive the collapse");
});

test("collapseRedundantIntelSections: NEVER drops 'Desk context' — crossDeskCoaching does not cover NH outcome history", () => {
  const sections = [section("Trade manager read"), section("Desk context"), section("Why this setup")];
  const out = collapseRedundantIntelSections(sections, { hasNarrative: true, bucket: "open" });
  assert.ok(out.some((s) => s.title === "Desk context"), "Desk context must survive the collapse");
});

test("collapseRedundantIntelSections: keeps Desk context when narrative leads (NH outcome history)", () => {
  const sections = [
    section("Trade manager read"),
    section("Desk context"),
    section("Flow & positioning"),
  ];
  // "Flow & positioning" is now a conditionally-covered title (2026-11-08) — pass
  // flowIntelFolded: true explicitly to prove flowNarrative actually fired for this test's data,
  // same shape every other conditionally-covered title's "unconditional drop" test uses.
  const out = collapseRedundantIntelSections(sections, {
    hasNarrative: true,
    bucket: "open",
    flowIntelFolded: true,
  });
  assert.ok(out.some((s) => s.title === "Desk context"), "NH outcome history is not in Trade manager read");
  assert.ok(!out.some((s) => s.title === "Flow & positioning"));
});

// BUG FIX (Ask Largo standing mandate, 2026-11-08, live repro SWING:MRVL:70, OPEN/SHORT): "Lane
// rank" is the one title in NARRATIVE_COVERED_TITLES whose coverage is CONDITIONAL —
// `laneRankCoaching` (play-brief-narrative-coaching.ts) deliberately stays silent for a
// comfortably-good-but-not-top-3 position (rank 5, +15.1 vs median — see that function's own
// regression test for the exact fixture). Before this fix, this function dropped "Lane rank"
// purely off static title membership and always claimed it was "folded into Trade manager read"
// — false for that band, since the real rank/score/median/leader never reached the narrative.
// `laneRankFolded` is the caller's own recomputation of laneRankCoaching's predicate for this
// specific play; omitted/false must be the SAFE outcome (never drop, never falsely claim).
test("collapseRedundantIntelSections: keeps 'Lane rank' and omits the fold-in claim when laneRankFolded is false (laneRankCoaching stayed silent)", () => {
  const sections = [
    section("Trade manager read"),
    section("GEX posture"),
    section("Lane rank"),
    section("Why this setup"),
  ];
  const out = collapseRedundantIntelSections(sections, {
    hasNarrative: true,
    bucket: "open",
    laneRankFolded: false,
    gexPostureFolded: true,
  });
  assert.ok(out.some((s) => s.title === "Lane rank"), "Lane rank must survive — nothing in the narrative covers it for this play");
  // GEX posture's own predicate proves it covered here — this fix must not weaken the existing
  // behavior for every OTHER title in the set.
  assert.ok(!out.some((s) => s.title === "GEX posture"));
  const narrative = out.find((s) => s.title === "Trade manager read");
  assert.match(narrative!.body, /folded into Trade manager read/i, "GEX posture alone still earns the note");
  // The note's own count must reflect ONLY the sections actually dropped (1: GEX posture), never
  // silently counting Lane rank as folded when it was kept.
  assert.match(narrative!.body, /for 1 section folded/i);
});

test("collapseRedundantIntelSections: keeps 'Lane rank' and never claims a fold-in note at all when it's the ONLY covered title present and laneRankFolded is false", () => {
  const sections = [section("Trade manager read"), section("Lane rank"), section("Why this setup")];
  const out = collapseRedundantIntelSections(sections, { hasNarrative: true, bucket: "open", laneRankFolded: false });
  assert.equal(out.length, 3, "nothing should be dropped, so no note should be appended either");
  assert.ok(out.some((s) => s.title === "Lane rank"));
  const narrative = out.find((s) => s.title === "Trade manager read");
  assert.ok(!narrative!.body.includes("folded into Trade manager read"), "no section was actually dropped — the claim would be false");
});

test("collapseRedundantIntelSections: omitting laneRankFolded entirely defaults to the SAFE outcome (keep, no false claim) — same as explicit false", () => {
  const sections = [section("Trade manager read"), section("Lane rank"), section("Why this setup")];
  const out = collapseRedundantIntelSections(sections, { hasNarrative: true, bucket: "open" });
  assert.ok(out.some((s) => s.title === "Lane rank"), "a caller that forgets to pass laneRankFolded must never lose this section");
});

test("collapseRedundantIntelSections: still drops 'Lane rank' and claims the fold-in note when laneRankFolded is true (laneRankCoaching actually fired)", () => {
  const sections = [section("Trade manager read"), section("Lane rank"), section("Why this setup")];
  const out = collapseRedundantIntelSections(sections, { hasNarrative: true, bucket: "open", laneRankFolded: true });
  assert.ok(!out.some((s) => s.title === "Lane rank"), "laneRankCoaching really did fold this in — collapse it as usual");
  const narrative = out.find((s) => s.title === "Trade manager read");
  assert.match(narrative!.body, /folded into Trade manager read/i);
});

// BUG FIX (Ask Largo standing mandate, 2026-11-08): sibling of the "Lane rank" fix above, for
// the other two conditionally-covered titles disclosed but not yet fixed by #7580.
test("collapseRedundantIntelSections: keeps 'Wall dynamics' and omits the fold-in claim when wallDynamicsFolded is false (wallDynamicsCoaching stayed silent, e.g. only 1 real event)", () => {
  const sections = [
    section("Trade manager read"),
    section("GEX posture"),
    section("Wall dynamics"),
    section("Why this setup"),
  ];
  const out = collapseRedundantIntelSections(sections, {
    hasNarrative: true,
    bucket: "open",
    wallDynamicsFolded: false,
    gexPostureFolded: true,
  });
  assert.ok(
    out.some((s) => s.title === "Wall dynamics"),
    "Wall dynamics must survive — the narrative never mentioned it for this play",
  );
  assert.ok(!out.some((s) => s.title === "GEX posture"));
  const narrative = out.find((s) => s.title === "Trade manager read");
  assert.match(narrative!.body, /for 1 section folded/i, "only GEX posture was actually dropped");
});

test("collapseRedundantIntelSections: omitting wallDynamicsFolded entirely defaults to the SAFE outcome (keep, no false claim) — same as explicit false", () => {
  const sections = [section("Trade manager read"), section("Wall dynamics"), section("Why this setup")];
  const out = collapseRedundantIntelSections(sections, { hasNarrative: true, bucket: "open" });
  assert.ok(out.some((s) => s.title === "Wall dynamics"), "a caller that forgets to pass wallDynamicsFolded must never lose this section");
});

test("collapseRedundantIntelSections: still drops 'Wall dynamics' and claims the fold-in note when wallDynamicsFolded is true (wallDynamicsCoaching actually fired)", () => {
  const sections = [section("Trade manager read"), section("Wall dynamics"), section("Why this setup")];
  const out = collapseRedundantIntelSections(sections, {
    hasNarrative: true,
    bucket: "open",
    wallDynamicsFolded: true,
  });
  assert.ok(!out.some((s) => s.title === "Wall dynamics"), "wallDynamicsCoaching really did fold this in — collapse it as usual");
  const narrative = out.find((s) => s.title === "Trade manager read");
  assert.match(narrative!.body, /folded into Trade manager read/i);
});

test("collapseRedundantIntelSections: keeps 'Vector desk' and omits the fold-in claim when vectorDeskFolded is false (vectorPlayCoaching stayed silent, e.g. stale snapshot)", () => {
  const sections = [
    section("Trade manager read"),
    section("GEX posture"),
    section("Vector desk"),
    section("Why this setup"),
  ];
  const out = collapseRedundantIntelSections(sections, {
    hasNarrative: true,
    bucket: "open",
    vectorDeskFolded: false,
    gexPostureFolded: true,
  });
  assert.ok(
    out.some((s) => s.title === "Vector desk"),
    "Vector desk must survive — the narrative never mentioned it for this play",
  );
  assert.ok(!out.some((s) => s.title === "GEX posture"));
  const narrative = out.find((s) => s.title === "Trade manager read");
  assert.match(narrative!.body, /for 1 section folded/i, "only GEX posture was actually dropped");
});

test("collapseRedundantIntelSections: omitting vectorDeskFolded entirely defaults to the SAFE outcome (keep, no false claim) — same as explicit false", () => {
  const sections = [section("Trade manager read"), section("Vector desk"), section("Why this setup")];
  const out = collapseRedundantIntelSections(sections, { hasNarrative: true, bucket: "open" });
  assert.ok(out.some((s) => s.title === "Vector desk"), "a caller that forgets to pass vectorDeskFolded must never lose this section");
});

test("collapseRedundantIntelSections: still drops 'Vector desk' and claims the fold-in note when vectorDeskFolded is true (vectorPlayCoaching actually fired)", () => {
  const sections = [section("Trade manager read"), section("Vector desk"), section("Why this setup")];
  const out = collapseRedundantIntelSections(sections, {
    hasNarrative: true,
    bucket: "open",
    vectorDeskFolded: true,
  });
  assert.ok(!out.some((s) => s.title === "Vector desk"), "vectorPlayCoaching really did fire — collapse it as usual");
  const narrative = out.find((s) => s.title === "Trade manager read");
  assert.match(narrative!.body, /folded into Trade manager read/i);
});

// BUG FIX (Ask Largo standing mandate, 2026-11-08): sibling of the "Lane rank"/"Wall dynamics"/
// "Vector desk" fixes above, for the four remaining conditionally-covered titles disclosed but
// not yet fixed by #7580/#7587.
test("collapseRedundantIntelSections: keeps 'Levels on chart' and omits the fold-in claim when levelsOnChartFolded is false (king/max-pain/dark-pool content unproven covered)", () => {
  const sections = [
    section("Trade manager read"),
    section("GEX posture"),
    section("Levels on chart"),
    section("Why this setup"),
  ];
  const out = collapseRedundantIntelSections(sections, {
    hasNarrative: true,
    bucket: "open",
    levelsOnChartFolded: false,
    gexPostureFolded: true,
  });
  assert.ok(
    out.some((s) => s.title === "Levels on chart"),
    "Levels on chart must survive — the narrative's focal-levels loop may have starved out before reaching it",
  );
  assert.ok(!out.some((s) => s.title === "GEX posture"));
  const narrative = out.find((s) => s.title === "Trade manager read");
  assert.match(narrative!.body, /for 1 section folded/i, "only GEX posture was actually dropped");
});

test("collapseRedundantIntelSections: omitting levelsOnChartFolded entirely defaults to the SAFE outcome (keep, no false claim) — same as explicit false", () => {
  const sections = [section("Trade manager read"), section("Levels on chart"), section("Why this setup")];
  const out = collapseRedundantIntelSections(sections, { hasNarrative: true, bucket: "open" });
  assert.ok(out.some((s) => s.title === "Levels on chart"), "a caller that forgets to pass levelsOnChartFolded must never lose this section");
});

test("collapseRedundantIntelSections: still drops 'Levels on chart' and claims the fold-in note when levelsOnChartFolded is true (no king/max-pain/dark-pool data to starve)", () => {
  const sections = [section("Trade manager read"), section("Levels on chart"), section("Why this setup")];
  const out = collapseRedundantIntelSections(sections, {
    hasNarrative: true,
    bucket: "open",
    levelsOnChartFolded: true,
  });
  assert.ok(!out.some((s) => s.title === "Levels on chart"), "nothing at-risk existed for this ticker — collapse it as usual");
  const narrative = out.find((s) => s.title === "Trade manager read");
  assert.match(narrative!.body, /folded into Trade manager read/i);
});

test("collapseRedundantIntelSections: keeps 'Flow & positioning' and omits the fold-in claim when flowIntelFolded is false (e.g. a sold 0DTE condor, or anomalies stranded behind a quiet 6h tape)", () => {
  const sections = [
    section("Trade manager read"),
    section("GEX posture"),
    section("Flow & positioning"),
    section("Why this setup"),
  ];
  const out = collapseRedundantIntelSections(sections, {
    hasNarrative: true,
    bucket: "open",
    flowIntelFolded: false,
    gexPostureFolded: true,
  });
  assert.ok(out.some((s) => s.title === "Flow & positioning"), "Flow & positioning must survive — nothing in the narrative covers it for this play");
  assert.ok(!out.some((s) => s.title === "GEX posture"));
  const narrative = out.find((s) => s.title === "Trade manager read");
  assert.match(narrative!.body, /for 1 section folded/i, "only GEX posture was actually dropped");
});

test("collapseRedundantIntelSections: omitting flowIntelFolded entirely defaults to the SAFE outcome (keep, no false claim) — same as explicit false", () => {
  const sections = [section("Trade manager read"), section("Flow & positioning"), section("Why this setup")];
  const out = collapseRedundantIntelSections(sections, { hasNarrative: true, bucket: "open" });
  assert.ok(out.some((s) => s.title === "Flow & positioning"), "a caller that forgets to pass flowIntelFolded must never lose this section");
});

test("collapseRedundantIntelSections: still drops 'Flow & positioning' and claims the fold-in note when flowIntelFolded is true (flowNarrative actually fired, no condor/stranded-anomaly gap)", () => {
  const sections = [section("Trade manager read"), section("Flow & positioning"), section("Why this setup")];
  const out = collapseRedundantIntelSections(sections, {
    hasNarrative: true,
    bucket: "open",
    flowIntelFolded: true,
  });
  assert.ok(!out.some((s) => s.title === "Flow & positioning"), "flowNarrative really did fire — collapse it as usual");
  const narrative = out.find((s) => s.title === "Trade manager read");
  assert.match(narrative!.body, /folded into Trade manager read/i);
});

test("collapseRedundantIntelSections: keeps 'Macro tape' and omits the fold-in claim when macroTapeFolded is false (e.g. a bare CPI print macroTapeCoaching never reads)", () => {
  const sections = [
    section("Trade manager read"),
    section("GEX posture"),
    section("Macro tape"),
    section("Why this setup"),
  ];
  const out = collapseRedundantIntelSections(sections, {
    hasNarrative: true,
    bucket: "open",
    macroTapeFolded: false,
    gexPostureFolded: true,
  });
  assert.ok(out.some((s) => s.title === "Macro tape"), "Macro tape must survive — macroTapeCoaching stayed silent for this play");
  assert.ok(!out.some((s) => s.title === "GEX posture"));
  const narrative = out.find((s) => s.title === "Trade manager read");
  assert.match(narrative!.body, /for 1 section folded/i, "only GEX posture was actually dropped");
});

test("collapseRedundantIntelSections: omitting macroTapeFolded entirely defaults to the SAFE outcome (keep, no false claim) — same as explicit false", () => {
  const sections = [section("Trade manager read"), section("Macro tape"), section("Why this setup")];
  const out = collapseRedundantIntelSections(sections, { hasNarrative: true, bucket: "open" });
  assert.ok(out.some((s) => s.title === "Macro tape"), "a caller that forgets to pass macroTapeFolded must never lose this section");
});

test("collapseRedundantIntelSections: still drops 'Macro tape' and claims the fold-in note when macroTapeFolded is true (macroTapeCoaching actually fired)", () => {
  const sections = [section("Trade manager read"), section("Macro tape"), section("Why this setup")];
  const out = collapseRedundantIntelSections(sections, {
    hasNarrative: true,
    bucket: "open",
    macroTapeFolded: true,
  });
  assert.ok(!out.some((s) => s.title === "Macro tape"), "macroTapeCoaching really did fire — collapse it as usual");
  const narrative = out.find((s) => s.title === "Trade manager read");
  assert.match(narrative!.body, /folded into Trade manager read/i);
});

test("collapseRedundantIntelSections: keeps 'Hold plan' and omits the fold-in claim when holdPlanFolded is false (e.g. a healthy, stable thesis thesisPillarCoaching stays silent on)", () => {
  const sections = [
    section("Trade manager read"),
    section("GEX posture"),
    section("Hold plan"),
    section("Why this setup"),
  ];
  const out = collapseRedundantIntelSections(sections, {
    hasNarrative: true,
    bucket: "open",
    holdPlanFolded: false,
    gexPostureFolded: true,
  });
  assert.ok(out.some((s) => s.title === "Hold plan"), "Hold plan must survive — nothing in the narrative covers it for this play");
  assert.ok(!out.some((s) => s.title === "GEX posture"));
  const narrative = out.find((s) => s.title === "Trade manager read");
  assert.match(narrative!.body, /for 1 section folded/i, "only GEX posture was actually dropped");
});

test("collapseRedundantIntelSections: omitting holdPlanFolded entirely defaults to the SAFE outcome (keep, no false claim) — same as explicit false", () => {
  const sections = [section("Trade manager read"), section("Hold plan"), section("Why this setup")];
  const out = collapseRedundantIntelSections(sections, { hasNarrative: true, bucket: "open" });
  assert.ok(out.some((s) => s.title === "Hold plan"), "a caller that forgets to pass holdPlanFolded must never lose this section");
});

test("collapseRedundantIntelSections: still drops 'Hold plan' and claims the fold-in note when holdPlanFolded is true (thesisPillarCoaching actually fired, no runner-fraction gap)", () => {
  const sections = [section("Trade manager read"), section("Hold plan"), section("Why this setup")];
  const out = collapseRedundantIntelSections(sections, {
    hasNarrative: true,
    bucket: "open",
    holdPlanFolded: true,
  });
  assert.ok(!out.some((s) => s.title === "Hold plan"), "thesisPillarCoaching really did fire — collapse it as usual");
  const narrative = out.find((s) => s.title === "Trade manager read");
  assert.match(narrative!.body, /folded into Trade manager read/i);
});

// BUG FIX (Ask Largo standing mandate, 2026-11-09): sibling of the "Lane rank"/"Wall dynamics"/
// "Vector desk"/"Levels on chart"/"Flow & positioning"/"Macro tape"/"Hold plan" fixes above —
// "GEX posture" was the 8th title in NARRATIVE_COVERED_TITLES left with no opt-in flag.
// `gexPostureSection` renders Net VEX/DEX/CHARM dollar figures whenever the matrix isn't stale,
// but `dealerPostureLine` (the only narrative counterpart) deliberately keeps VEX/DEX/CHARM as
// qualitative regime-read TEXT only — never a dollar figure.
test("collapseRedundantIntelSections: keeps 'GEX posture' and omits the fold-in claim when gexPostureFolded is false (dealerPostureLine never carries the VEX/DEX/CHARM dollar figures)", () => {
  const sections = [
    section("Trade manager read"),
    section("GEX posture"),
    section("Wall dynamics"),
    section("Why this setup"),
  ];
  const out = collapseRedundantIntelSections(sections, {
    hasNarrative: true,
    bucket: "open",
    gexPostureFolded: false,
    wallDynamicsFolded: true,
  });
  assert.ok(
    out.some((s) => s.title === "GEX posture"),
    "GEX posture must survive — its Net VEX/DEX/CHARM dollar figures have no narrative counterpart",
  );
  assert.ok(!out.some((s) => s.title === "Wall dynamics"));
  const narrative = out.find((s) => s.title === "Trade manager read");
  assert.match(narrative!.body, /for 1 section folded/i, "only Wall dynamics was actually dropped");
});

test("collapseRedundantIntelSections: omitting gexPostureFolded entirely defaults to the SAFE outcome (keep, no false claim) — same as explicit false", () => {
  const sections = [section("Trade manager read"), section("GEX posture"), section("Why this setup")];
  const out = collapseRedundantIntelSections(sections, { hasNarrative: true, bucket: "open" });
  assert.ok(out.some((s) => s.title === "GEX posture"), "a caller that forgets to pass gexPostureFolded must never lose this section");
});

test("collapseRedundantIntelSections: still drops 'GEX posture' and claims the fold-in note when gexPostureFolded is true (no VEX/DEX/CHARM content to omit)", () => {
  const sections = [section("Trade manager read"), section("GEX posture"), section("Why this setup")];
  const out = collapseRedundantIntelSections(sections, {
    hasNarrative: true,
    bucket: "open",
    gexPostureFolded: true,
  });
  assert.ok(!out.some((s) => s.title === "GEX posture"), "no real VEX/DEX/CHARM content existed to lose — collapse it as usual");
  const narrative = out.find((s) => s.title === "Trade manager read");
  assert.match(narrative!.body, /folded into Trade manager read/i);
});

test("collapseRedundantIntelSections: closed bucket keeps GEX/flow sections — post-mortem does not cover them", () => {
  const sections = [
    section("Trade manager read"),
    section("GEX posture"),
    section("Wall dynamics"),
    section("Flow & positioning"),
    section("Lessons"),
  ];
  const out = collapseRedundantIntelSections(sections, { hasNarrative: true, bucket: "closed" });
  assert.equal(out.length, 5);
  assert.ok(out.some((s) => s.title === "GEX posture"));
  assert.ok(out.some((s) => s.title === "Wall dynamics"));
  assert.ok(out.some((s) => s.title === "Flow & positioning"));
  const narrative = out.find((s) => s.title === "Trade manager read");
  assert.ok(!narrative!.body.includes("folded into Trade manager read"));
});
