import test from "node:test";
import assert from "node:assert/strict";
import { parseSwingPlayId, resolveBriefTicker } from "./play-brief-resolve-pure";

test("resolveBriefTicker: empty string falls back to playId-embedded ticker", () => {
  const parsed = parseSwingPlayId("SWING:NVDA");
  assert.equal(resolveBriefTicker("", parsed), "NVDA");
  assert.equal(resolveBriefTicker("   ", parsed), "NVDA");
  assert.equal(resolveBriefTicker(undefined, parsed), "NVDA");
  assert.equal(resolveBriefTicker("nrg", parsed), "NRG");
});
