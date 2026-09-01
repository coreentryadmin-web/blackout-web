import { test } from "node:test";
import assert from "node:assert/strict";
import { partitionPickEvidence } from "./vector-pick-evidence-rails";

test("partitionPickEvidence splits option vs desk sections", () => {
  const sections = [
    { id: "strike" as const, title: "Why", items: [] },
    { id: "flow" as const, title: "Flow", items: [] },
    { id: "gex" as const, title: "GEX", items: [] },
    { id: "liquidity" as const, title: "Liq", items: [] },
  ];
  const { optionPlay, deskData } = partitionPickEvidence(sections);
  assert.deepEqual(optionPlay.map((s) => s.id), ["strike", "liquidity"]);
  assert.deepEqual(deskData.map((s) => s.id), ["flow", "gex"]);
});
