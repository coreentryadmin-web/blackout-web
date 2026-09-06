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

test("collapseRedundantIntelSections: keeps Book context when narrative leads", () => {
  const sections = [
    section("Trade manager read"),
    section("Book context"),
    section("GEX posture"),
  ];
  const out = collapseRedundantIntelSections(sections, { hasNarrative: true, bucket: "open" });
  assert.ok(out.some((s) => s.title === "Book context"), "Book context is the sole concentration source post-#4116");
  assert.ok(!out.some((s) => s.title === "GEX posture"));
});

test("collapseRedundantIntelSections: keeps Desk context when narrative leads — crossDeskCoaching only covers conflict, not NH history/flow anomaly", () => {
  // #4111 renamed "Desk consensus" to "Desk context" and moved ONLY the direction-conflict content
  // into crossDeskCoaching; NH outcome-history and flow-anomaly coaching stayed supplementary and
  // unique to this section (deskConsensusSection, play-brief-intel.ts). A stale "Desk consensus"
  // string in the collapse set never matched the real title and was accidentally safe — but a
  // naive rename to "Desk context" (e.g. a dead-code/stale-reference cleanup) would silently delete
  // that supplementary content, repeating the exact bug #4116/#4123 fixed for Book context.
  const sections = [
    section("Trade manager read"),
    section("Desk context"),
    section("GEX posture"),
  ];
  const out = collapseRedundantIntelSections(sections, { hasNarrative: true, bucket: "open" });
  assert.ok(out.some((s) => s.title === "Desk context"), "Desk context carries NH history/flow anomaly not covered by crossDeskCoaching");
  assert.ok(!out.some((s) => s.title === "GEX posture"));
});
