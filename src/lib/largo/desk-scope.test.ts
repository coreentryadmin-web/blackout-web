import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deskScopeConfig,
  formatDeskScopeBlock,
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
    assert.deepEqual(parseDeskSlashArgs("gate trace"), { mode: "gate-trace" });
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
    assert.match(block, /get_spx_play/);
  });
});
