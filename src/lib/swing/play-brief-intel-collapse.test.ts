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
  // #4116 removed bookContextCoaching (the narrative bullet this collapse list used to assume
  // covered book concentration). If "Book context" is ever re-added to NARRATIVE_COVERED_TITLES,
  // a member with a theme-overlapping book gets ZERO concentration warning anywhere on the brief.
  const sections = [section("Trade manager read"), section("Book context"), section("Why this setup")];
  const out = collapseRedundantIntelSections(sections, { hasNarrative: true, bucket: "open" });
  assert.ok(out.some((s) => s.title === "Book context"), "Book context must survive the collapse");
});

test("collapseRedundantIntelSections: NEVER drops 'Desk context' — crossDeskCoaching only covers conflict, not NH history/flow anomaly", () => {
  // #4111 renamed "Desk consensus" to "Desk context" and moved ONLY the direction-conflict content
  // into crossDeskCoaching; NH outcome-history and flow-anomaly coaching stayed supplementary and
  // unique to this section. Collapsing it would silently delete that content.
  const sections = [section("Trade manager read"), section("Desk context"), section("Why this setup")];
  const out = collapseRedundantIntelSections(sections, { hasNarrative: true, bucket: "open" });
  assert.ok(out.some((s) => s.title === "Desk context"), "Desk context must survive the collapse");
});
