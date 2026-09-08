import test from "node:test";
import assert from "node:assert/strict";
import { extractRegime } from "./adaptive-response-orchestrator";

test("extractRegime: never fabricates a bullish/bearish market regime from dealer gamma posture", () => {
  // Regression pin for a real bug: `get_positioning`'s dealer gamma posture is not a directional
  // market regime (short gamma amplifies a move in EITHER direction, long gamma dampens a move in
  // EITHER direction), so this must never invent "bullish"/"bearish" off it — doing so gated real
  // PLAY/WAIT/NO_TRADE decisions in `desk-read-decision.ts` on a fabricated signal. It also used to
  // read the wrong field entirely (`gamma_flip`, a numeric price level, compared against the
  // strings "positive"/"negative" — the real posture field is `gamma_posture: "long"|"short"|null`).
  assert.equal(extractRegime({ get_positioning: { gamma_posture: "long" } }), undefined);
  assert.equal(extractRegime({ get_positioning: { gamma_posture: "short" } }), undefined);
  // The old (bogus) field/value shape must not accidentally revive the bug either.
  assert.equal(extractRegime({ get_positioning: { gamma_flip: "positive" } }), undefined);
  assert.equal(extractRegime({ get_positioning: { gamma_flip: "negative" } }), undefined);
});

test("extractRegime: an explicit get_market_regime tool result is still honored", () => {
  assert.equal(extractRegime({ get_market_regime: { regime: "bullish" } }), "bullish");
  assert.equal(extractRegime({ get_market_regime: { name: "risk_off" } }), "risk_off");
  assert.equal(extractRegime({}), undefined);
});
