import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { deskAgeSec, isDeskStale } from "./spx-desk-stale";

const NOW = Date.parse("2026-09-05T14:00:00.000Z");
const STALE_MAX_SEC = 90;

describe("spx-desk-stale", () => {
  test("deskAgeSec: normal past timestamp returns positive age", () => {
    const polledAt = new Date(NOW - 30_000).toISOString();
    assert.equal(deskAgeSec(polledAt, null, NOW), 30);
  });

  test("deskAgeSec: future timestamp beyond tolerance fails closed when staleMaxSec provided", () => {
    const polledAt = new Date(NOW + 120_000).toISOString();
    const age = deskAgeSec(polledAt, null, NOW, STALE_MAX_SEC);
    assert.equal(age, STALE_MAX_SEC + 1);
    assert.equal(isDeskStale(age, STALE_MAX_SEC), true);
  });

  test("deskAgeSec: slight future skew within tolerance still reads live", () => {
    const polledAt = new Date(NOW + 30_000).toISOString();
    const age = deskAgeSec(polledAt, null, NOW, STALE_MAX_SEC);
    assert.ok(age != null && age < 0);
    assert.equal(isDeskStale(age, STALE_MAX_SEC), false);
  });

  test("deskAgeSec: prefers polled_at over as_of", () => {
    const polledAt = new Date(NOW - 10_000).toISOString();
    const asOf = new Date(NOW - 60_000).toISOString();
    assert.equal(deskAgeSec(polledAt, asOf, NOW), 10);
  });
});
