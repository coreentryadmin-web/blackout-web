import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deskScopeConfig,
  formatDeskScopeBlock,
  formatScopedAnswerContract,
  parseDeskSlashArgs,
} from "./desk-scope";

describe("deskScopeConfig", () => {
  it("resolves spx-slayer", () => {
    assert.equal(deskScopeConfig("spx-slayer")?.label, "SPX Slayer");
  });
});

describe("parseDeskSlashArgs", () => {
  it("parses ticker", () => {
    assert.deepEqual(parseDeskSlashArgs("NVDA"), { ticker: "NVDA" });
  });
  it("parses compare mag7", () => {
    assert.deepEqual(parseDeskSlashArgs("compare mag7"), { mode: "compare-mag7" });
  });
  it("parses gate trace", () => {
    assert.deepEqual(parseDeskSlashArgs("gate trace", "spx-slayer"), {
      mode: "gate-trace",
      submodule: "gates",
    });
  });
  it("parses watch tickers", () => {
    assert.deepEqual(parseDeskSlashArgs("watch NVDA SPY"), {
      mode: "watch",
      watchTickers: ["NVDA", "SPY"],
    });
  });
});

describe("formatDeskScopeBlock", () => {
  it("includes SPX Slayer focus", () => {
    const block = formatDeskScopeBlock("spx-slayer");
    assert.match(block, /SPX Slayer/);
    assert.match(block, /Macro\/events/);
    assert.match(block, /3DTE\/7DTE/);
    assert.match(block, /get_spx_play/);
  });

  it("includes scoped answer contract with submodule lens", () => {
    const block = formatDeskScopeBlock("spx-slayer", { submodule: "gex" });
    assert.match(block, /Scoped answer contract/);
    assert.match(block, /one-line verdict/);
    assert.match(block, /gex/);
  });
});

describe("formatScopedAnswerContract", () => {
  it("names submodule as lens when set", () => {
    const contract = formatScopedAnswerContract({ submodule: "gex" });
    assert.match(contract, /Submodule \*\*gex\*\*/);
    assert.match(contract, /one-line verdict/);
  });

  it("allows desk-only scope without submodule dump", () => {
    const contract = formatScopedAnswerContract({});
    assert.match(contract, /exact words/);
    assert.match(contract, /do not auto-survey all submodules/);
  });
});
