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

test("collapseRedundantIntelSections: folds Book context overlap into Trade manager read", () => {
  const sections = [
    { title: "Trade manager read", body: "• **Live read** — hold.", bias: "neutral" as const },
    {
      title: "Book context",
      body:
        '**Concentration** — already holding 2 same-direction positions in theme "semis": AMD LONG, SMH LONG.',
      bias: "neutral" as const,
    },
    { title: "Why this setup", body: "setup", bias: "neutral" as const },
  ];
  const out = collapseRedundantIntelSections(sections, { hasNarrative: true, bucket: "open" });
  assert.ok(!out.some((s) => s.title === "Book context"));
  const narrative = out.find((s) => s.title === "Trade manager read");
  assert.match(narrative!.body, /Concentration/i);
  assert.equal(out.filter((s) => /concentration/i.test(s.body)).length, 1);
});
