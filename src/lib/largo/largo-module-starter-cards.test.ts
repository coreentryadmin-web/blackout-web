import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { largoModuleComposerChips, largoModuleStarterCards } from "./largo-module-starter-cards";

describe("largoModuleStarterCards", () => {
  it("returns desk-scoped submodule cards", () => {
    const cards = largoModuleStarterCards();
    assert.ok(cards.length >= 8);
    assert.ok(cards.some((c) => c.desk === "spx-slayer" && c.submodule === "gex"));
    assert.match(cards[0]?.label ?? "", /·/);
  });

  it("composer chips are a subset", () => {
    assert.ok(largoModuleComposerChips().length <= largoModuleStarterCards().length);
  });
});
