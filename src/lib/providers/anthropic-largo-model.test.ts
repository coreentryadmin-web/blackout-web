import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LARGO_ESCALATION_MODEL, LARGO_MODEL } from "./anthropic";

describe("Largo model defaults", () => {
  it("LARGO_MODEL is Haiku for cost-efficient desk replies", () => {
    assert.equal(LARGO_MODEL, "claude-haiku-4-5");
  });

  it("LARGO_ESCALATION_MODEL stays Sonnet for optional deep turns", () => {
    assert.equal(LARGO_ESCALATION_MODEL, "claude-sonnet-4-6");
  });

  // This constant was DECLARED and asserted-on above for months while having ZERO call sites —
  // the assertion passed the whole time, because a constant's value is true whether or not
  // anything reads it. Largo ran every turn on Haiku regardless. Assert the WIRING, not just the
  // value: both runLargoQuery and runLargoQueryStream must pass it as `escalateModel`, so
  // deleting the wiring fails here instead of silently reverting Largo to single-model.
  it("is actually wired into BOTH Largo tool-loop call sites (not a dead constant)", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(
      new URL("../largo-terminal.ts", import.meta.url),
      "utf8"
    );
    assert.match(src, /LARGO_ESCALATION_MODEL/, "largo-terminal must import the escalation model");
    const wired = src.match(/escalateModel:\s*LARGO_ESCALATION_MODEL/g) ?? [];
    assert.equal(
      wired.length,
      2,
      `expected escalateModel wired at both the blocking and streaming call sites, found ${wired.length}`
    );
  });
});
