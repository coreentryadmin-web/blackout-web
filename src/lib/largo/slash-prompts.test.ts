import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  filterSlashPrompts,
  slashArgsFromInput,
  slashDefaultQuestion,
  type SlashPrompt,
} from "./slash-prompts";

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
