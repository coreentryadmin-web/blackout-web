import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyTrackRecord } from "@/lib/track-record-public";

// Pure sanity tests for the PII-free projection. Run with: npx tsx --test
// src/lib/__tests__/track-record-public.test.ts

test("emptyTrackRecord is safe + contains no per-trade fields", () => {
  const r = emptyTrackRecord();
  assert.equal(r.available, false);
  assert.equal(r.total_closed, 0);
  assert.equal(r.win_rate_pct, 0);
  // must not leak any per-trade/PII keys
  const keys = Object.keys(r);
  for (const banned of ["rows", "headline", "entry_price", "exit_price", "session_date", "opened_at", "id"]) {
    assert.ok(!keys.includes(banned), `unexpected key ${banned}`);
  }
});

test("win_rate_pct is an integer percentage in [0,100]", () => {
  const r = emptyTrackRecord();
  assert.ok(Number.isInteger(r.win_rate_pct));
  assert.ok(r.win_rate_pct >= 0 && r.win_rate_pct <= 100);
});
