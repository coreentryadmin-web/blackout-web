import assert from "node:assert/strict";
import test from "node:test";

import { isSpxDeskSmokeBody, spxDeskSmokeVerdict } from "./spx-desk-smoke-eval.mjs";

const shell = {
  available: false,
  as_of: "2026-11-08T12:00:00.000Z",
  source: "none",
  price: 0,
  market_open: false,
};

test("spxDeskSmokeVerdict: live price passes", () => {
  const v = spxDeskSmokeVerdict(200, { ...shell, available: true, price: 6789.12, source: "polygon+uw-flow" });
  assert.equal(v.outcome, "pass");
});

test("spxDeskSmokeVerdict: weekend shell with price 0 warns, does not fail", () => {
  const v = spxDeskSmokeVerdict(200, shell);
  assert.equal(v.outcome, "warn");
  assert.match(v.message, /price=0/);
});

test("spxDeskSmokeVerdict: market_open true with price 0 fails", () => {
  const v = spxDeskSmokeVerdict(200, { ...shell, market_open: true, price: 0 });
  assert.equal(v.outcome, "fail");
});

test("spxDeskSmokeVerdict: secret drift is warn", () => {
  assert.equal(spxDeskSmokeVerdict(401, {}).outcome, "warn");
});

test("isSpxDeskSmokeBody rejects non-desk JSON", () => {
  assert.equal(isSpxDeskSmokeBody({ ok: true }), false);
  assert.equal(isSpxDeskSmokeBody(shell), true);
});
