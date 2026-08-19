import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  largoDeskStarterCards,
  largoModuleStarterCards,
  largoSubmoduleCardsForDesk,
} from "./largo-module-starter-cards";

describe("largoDeskStarterCards", () => {
  it("returns product desks for step one", () => {
    const desks = largoDeskStarterCards();
    assert.ok(desks.length >= 7);
    assert.ok(desks.some((d) => d.id === "spx-slayer"));
    assert.ok(desks.every((d) => d.moduleCount > 0));
  });
});

describe("largoSubmoduleCardsForDesk", () => {
  it("returns all SPX Slayer modules for step two", () => {
    const mods = largoSubmoduleCardsForDesk("spx-slayer");
    assert.ok(mods.length >= 6);
    assert.ok(mods.some((m) => m.submodule === "gex"));
    assert.ok(mods.some((m) => m.submodule === "play"));
  });
});

describe("largoModuleStarterCards", () => {
  it("flattens all desk modules", () => {
    assert.ok(largoModuleStarterCards().length >= 30);
  });
});
