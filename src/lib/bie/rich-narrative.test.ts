import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildRichEnvelope } from "@/lib/bie/rich-narrative";

// Largo C10 (historical context) follow-up — `BieSection.table` (answer-envelope.ts) has been part
// of the envelope contract and its markdown renderer since they shipped, but `buildRichEnvelope`
// (the ONE shared constructor every deterministic rich composer routes through — concept answers,
// the swing play brief, etc.) never had a way to receive one from a `RichSection` and never
// forwarded it to the `BieSection` it builds. Same shape of gap as the `unavailableSources`
// forwarding bug this same file's header comment documents (the field existed on the contract and
// in the UI, just never wired through this one shared layer) — this is the missing wire for
// `table`, not a new envelope concept.
describe("buildRichEnvelope: table forwarding", () => {
  test("forwards a RichSection's table onto the resulting BieSection", () => {
    const env = buildRichEnvelope({
      headline: "Test headline",
      sections: [
        {
          title: "Track record",
          body: "Some prose citing the same numbers.",
          table: { headers: ["Scope", "Record"], rows: [["Breakout", "45W / 15L"]] },
        },
      ],
    });
    assert.equal(env.sections.length, 1);
    assert.deepEqual(env.sections[0].table, {
      headers: ["Scope", "Record"],
      rows: [["Breakout", "45W / 15L"]],
    });
  });

  test("a section with no table carries none on the built BieSection (no fabricated empty table)", () => {
    const env = buildRichEnvelope({
      headline: "Test headline",
      sections: [{ title: "Verdict", body: "Some prose." }],
    });
    assert.equal(env.sections[0].table, undefined);
  });

  test("the table is rendered into the derived markdown, same as any other section field", () => {
    const env = buildRichEnvelope({
      headline: "Test headline",
      sections: [
        {
          title: "Track record",
          body: "Prose.",
          table: { headers: ["Scope", "Record"], rows: [["Breakout", "45W / 15L"]] },
        },
      ],
    });
    assert.match(env.markdown, /\| Scope \| Record \|/);
    assert.match(env.markdown, /\| Breakout \| 45W \/ 15L \|/);
  });

  test("a blank-body section is still dropped entirely even when it carries a table (body is the drop gate, unchanged)", () => {
    const env = buildRichEnvelope({
      headline: "Test headline",
      sections: [
        { title: "Empty", body: "   ", table: { headers: ["A"], rows: [["x"]] } },
        { title: "Real", body: "content" },
      ],
    });
    assert.equal(env.sections.length, 1);
    assert.equal(env.sections[0].title, "Real");
  });
});
