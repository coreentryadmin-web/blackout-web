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
import { buildSlashPromptsForDesk, slashDefaultQuestion } from "./slash-prompts";
import { etSessionDate } from "@/lib/largo/temporal/bar-session-date";

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

describe("buildSlashPromptsForDesk — ET session anchor (Largo contract C1)", () => {
  // `as_of` is a UTC ISO instant; after ~20:00 ET its calendar date is already tomorrow, so a
  // model resolving "today's session" from `as_of` alone is a full day ahead (the defect class
  // fixed in #2418/#2420/#2422). This payload is the slash-command chip menu served to Largo's
  // `/helix`, `/thermal`, etc. — it stamped `as_of` with no anchor at all until this fix.
  it("stamps session_date alongside as_of, anchored to the SAME instant, for a plain prompt command", async () => {
    const payload = await buildSlashPromptsForDesk("track-record", {
      id: "tr-ask",
      command: "track-record",
      label: "Track record",
      description: "",
      kind: "prompt",
      question: "Summarize the public track record.",
      aliases: [],
      rank: 10,
    });
    assert.ok(payload.session_date, "session_date must be present, not omitted");
    assert.match(payload.session_date!, /^\d{4}-\d{2}-\d{2}$/);
    // Independently re-derive the ET session date from the SAME as_of instant this call
    // returned — proves session_date isn't a stale/second `Date.now()` call that could drift
    // across a session boundary from the one `as_of` stamped.
    assert.equal(payload.session_date, etSessionDate(Date.parse(payload.as_of)));
  });

  it("stamps session_date on the default (non-prompt) desk branch too", async () => {
    const payload = await buildSlashPromptsForDesk("unknown-desk-xyz");
    assert.ok(payload.session_date);
    assert.equal(payload.session_date, etSessionDate(Date.parse(payload.as_of)));
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
