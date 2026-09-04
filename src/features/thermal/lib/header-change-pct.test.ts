import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveHeaderChangePct } from "./header-change-pct";

const base = {
  matrixChangePct: null,
  pushedLive: false,
  pushedSpot: null,
  matrixSpot: 100,
  pushedChangePct: undefined,
  stockPushLive: false,
  stockPushChangePct: undefined,
  quoteLive: false,
  quoteChangePct: undefined,
  quotePrice: undefined,
} as const;

test("resolveHeaderChangePct returns null when matrix and quote lack change_pct (no fabricated 0%)", () => {
  assert.equal(resolveHeaderChangePct({ ...base }), null);
  assert.equal(
    resolveHeaderChangePct({ ...base, quoteLive: true, quoteChangePct: null }),
    null
  );
});

test("resolveHeaderChangePct preserves a real 0% measurement", () => {
  assert.equal(resolveHeaderChangePct({ ...base, matrixChangePct: 0 }), 0);
  assert.equal(
    resolveHeaderChangePct({ ...base, quoteLive: true, quoteChangePct: 0 }),
    0
  );
});

test("resolveHeaderChangePct prefers quote when live", () => {
  assert.equal(
    resolveHeaderChangePct({ ...base, quoteLive: true, quoteChangePct: 1.25 }),
    1.25
  );
});
