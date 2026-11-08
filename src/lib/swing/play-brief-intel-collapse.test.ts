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

test("collapseRedundantIntelSections: drops covered titles when narrative leads", () => {
  const sections = [
    section("Trade manager read"),
    section("GEX posture"),
    section("Levels on chart"),
    section("Why this setup"),
    section("Hold plan"),
  ];
  const out = collapseRedundantIntelSections(sections, { hasNarrative: true, bucket: "open" });
  assert.ok(!out.some((s) => s.title === "GEX posture"));
  assert.ok(!out.some((s) => s.title === "Levels on chart"));
  assert.ok(!out.some((s) => s.title === "Hold plan"));
  assert.ok(out.some((s) => s.title === "Why this setup"));
  const narrative = out.find((s) => s.title === "Trade manager read");
  assert.match(narrative!.body, /folded into Trade manager read/i);
});

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
  const out = collapseRedundantIntelSections(sections, { hasNarrative: true, bucket: "open" });
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
  });
  assert.ok(out.some((s) => s.title === "Lane rank"), "Lane rank must survive — nothing in the narrative covers it for this play");
  // GEX posture is unconditionally covered (post-#5998/#5994) and must still collapse normally —
  // this fix must not weaken the existing behavior for every OTHER title in the set.
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
