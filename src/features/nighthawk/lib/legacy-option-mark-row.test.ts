import assert from "node:assert/strict";
import { test } from "node:test";
import { buildLegacyOptionMarkRow } from "./legacy-option-mark-row.ts";

const NOW = Date.parse("2026-09-02T19:30:00.000Z");

test("buildLegacyOptionMarkRow: REST snapshot mark is fresh when WS is absent", () => {
  const row = buildLegacyOptionMarkRow(
    "MRNA260904C00155000",
    null,
    {
      ticker: "O:MRNA260904C00155000",
      mark: 4.85,
      bid: 4.8,
      ask: 4.9,
      last: null,
      dayClose: null,
      delta: null,
      gamma: null,
      theta: null,
      vega: null,
      iv: null,
      openInterest: null,
      bidSize: null,
      askSize: null,
      dayVolume: null,
      underlyingPrice: null,
      strike: 155,
      optionType: "call",
      expiry: "2026-09-04",
      sharesPerContract: 100,
      quoteUpdatedMs: null,
      observedAtMs: NOW - 5_000,
    },
    NOW
  );
  assert.equal(row.mark, 4.85);
  assert.equal(row.stale, false);
  assert.ok(row.asof);
});

test("buildLegacyOptionMarkRow: no mark anywhere → stale", () => {
  const row = buildLegacyOptionMarkRow("MRNA260904C00155000", null, null, NOW);
  assert.equal(row.mark, null);
  assert.equal(row.stale, true);
});
