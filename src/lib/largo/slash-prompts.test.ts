import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  filterSlashPrompts,
  slashArgsFromInput,
  slashDefaultQuestion,
  skewChipText,
  sessionSkewChip,
  type SlashPrompt,
} from "./slash-prompt-utils";
import { slashDefaultQuestion } from "./slash-prompts";

const SAMPLE: SlashPrompt[] = [
  { id: "a", label: "NVDA tape leader", question: "Summarize HELIX on NVDA", live: "+$42M net", rank: 10 },
  { id: "b", label: "Session flow skew", question: "Summarize today's tape", rank: 15 },
];

describe("filterSlashPrompts", () => {
  it("returns all when args empty", () => {
    assert.equal(filterSlashPrompts(SAMPLE, "").length, 2);
  });

  it("filters by label and live snippet", () => {
    assert.equal(filterSlashPrompts(SAMPLE, "nvda").length, 1);
    assert.equal(filterSlashPrompts(SAMPLE, "42m").length, 1);
  });
});

describe("slashArgsFromInput", () => {
  it("extracts tail after command", () => {
    assert.equal(slashArgsFromInput("/helix NVDA", "helix"), "NVDA");
    assert.equal(slashArgsFromInput("/helix", "helix"), "");
  });
});

describe("slashDefaultQuestion", () => {
  it("uses first dynamic prompt", () => {
    const q = slashDefaultQuestion(
      { id: "nav-flows", command: "helix", label: "HELIX", description: "", kind: "navigate", aliases: [], rank: 20 },
      SAMPLE
    );
    assert.match(q, /NVDA/i);
  });
});

describe("HELIX skew chips — the all-typeless tape", () => {
  // Coordinator review of #2430: making call_pct nullable in the tool payload activated a
  // `?? 50` in slash-prompts that had been dead code, re-fabricating "50% calls" on a
  // MEMBER-VISIBLE chip — the exact number the PR removed from the payload, one surface over.
  // These sit on the render side; the other tests in this lane all sit on the producer side and
  // none of them could see this.

  it("renders a measured skew", () => {
    assert.equal(skewChipText(62), "62% calls");
    assert.equal(sessionSkewChip(62, 431), "62% calls · 431 prints");
  });

  it("NEVER substitutes 50 when the skew was not measured", () => {
    assert.equal(skewChipText(null), null);
    assert.equal(sessionSkewChip(null, 431), "431 prints · skew not measured");
    assert.ok(!sessionSkewChip(null, 431).includes("50"));
    assert.ok(!sessionSkewChip(null, 431).includes("%"));
  });

  it("never renders the literal string 'null%'", () => {
    // `${null}% calls` interpolates to "null% calls" on a chip a member reads.
    for (const v of [null, undefined, Number.NaN]) {
      const chip = sessionSkewChip(v as number | null, 12);
      assert.ok(!chip.includes("null"), `chip must not contain "null": ${chip}`);
      assert.ok(!chip.includes("NaN"), `chip must not contain "NaN": ${chip}`);
    }
    assert.equal(skewChipText(undefined), null);
    assert.equal(skewChipText(Number.NaN), null);
  });

  it("still reports the print count when the skew is unknown", () => {
    // The prints are a real measurement even when the side breakdown is not — dropping them
    // would hide a busy tape.
    assert.ok(sessionSkewChip(null, 431).includes("431 prints"));
  });

  it("0% calls is a MEASUREMENT and must survive, not be treated as absent", () => {
    // Live 2026-08-20 the 0DTE bucket was 2% calls; an all-put tape reads 0 and is real.
    assert.equal(skewChipText(0), "0% calls");
    assert.equal(sessionSkewChip(0, 17), "0% calls · 17 prints");
  });
});
