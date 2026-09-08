import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deskScopeConfig,
  formatDeskScopeBlock,
  formatDiffBlock,
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
    assert.match(block, /get_spx_desk_convergence/);
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

const BASE = {
  as_of: "2026-08-20 20:29 ET",
  ticker: "SPX",
  desk_scope: null,
  spot: 7641.16,
  flip: null,
  call_wall: 7900,
  put_wall: 7640,
  net_premium: 1_200_000,
};

describe("formatDiffBlock — a shared matrix is not a change", () => {
  it("does not ask for a change narrative when both turns read the SAME matrix", () => {
    // Two turns 90s apart against one cached matrix: the positioning is identical BY
    // CONSTRUCTION, but the block announced a real interval and said "Describe what CHANGED".
    // Asked to describe a change that does not exist, a model invents one.
    const prev = { ...BASE, matrix_asof: "2026-08-21T00:24:56.192Z" };
    const now = { ...BASE, matrix_asof: "2026-08-21T00:24:56.192Z" };
    const out = formatDiffBlock(prev, now);
    assert.doesNotMatch(out, /Describe what CHANGED/);
    assert.match(out, /SAME dealer-positioning matrix/);
    assert.match(out, /CANNOT have changed/);
  });

  it("still asks for the diff when the matrix genuinely advanced", () => {
    const prev = { ...BASE, matrix_asof: "2026-08-21T00:24:56.192Z" };
    const now = { ...BASE, spot: 7650, matrix_asof: "2026-08-21T00:29:56.192Z" };
    const out = formatDiffBlock(prev, now);
    assert.match(out, /Describe what CHANGED/);
    assert.doesNotMatch(out, /SAME dealer-positioning matrix/);
  });

  it("falls back to the diff instruction when either matrix time is unknown", () => {
    // Never claim "unchanged" from missing evidence — that is the same fabrication in reverse.
    const prev = { ...BASE, matrix_asof: null };
    const now = { ...BASE, matrix_asof: "2026-08-21T00:24:56.192Z" };
    assert.match(formatDiffBlock(prev, now), /Describe what CHANGED/);
    assert.match(formatDiffBlock({ ...BASE }, { ...BASE }), /Describe what CHANGED/);
  });

  it("still reports no-prior-snapshot as its own state", () => {
    assert.match(formatDiffBlock(null, { ...BASE }), /No prior snapshot/);
  });
});
