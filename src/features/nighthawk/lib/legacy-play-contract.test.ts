import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveLegacyPlayOcc } from "./legacy-play-contract";

test("resolveLegacyPlayOcc: parses formatOptionsPlay output to OCC", () => {
  const occ = resolveLegacyPlayOcc("NVDA", "NVDA $500 CALL @ $3.33 — Aug 10");
  assert.ok(occ);
  assert.match(occ!, /^NVDA\d{6}C\d{8}$/);
});

test("resolveLegacyPlayOcc: returns null for unparseable strings", () => {
  assert.equal(resolveLegacyPlayOcc("NVDA", "NVDA — no options data available"), null);
  assert.equal(resolveLegacyPlayOcc("NVDA", null), null);
});
