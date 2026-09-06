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

test("collapseRedundantIntelSections: NEVER drops 'Desk context' — crossDeskCoaching only covers conflict, not NH history/flow anomaly", () => {
  const sections = [section("Trade manager read"), section("Desk context"), section("Why this setup")];
  const out = collapseRedundantIntelSections(sections, { hasNarrative: true, bucket: "open" });
  assert.ok(out.some((s) => s.title === "Desk context"), "Desk context must survive the collapse");
});
