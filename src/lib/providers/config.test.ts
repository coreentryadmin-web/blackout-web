import { test } from "node:test";
import assert from "node:assert/strict";
import { deskPulseStructureCacheTtlMs } from "./config";

// deskPulseStructureCacheTtlMs's own doc comment and default path both say "Default 2s"
// (reduced from 5s, originally 10s — see git log). The invalid-override fallback branch
// must therefore also resolve to 2_000ms, not a stale constant left over from an earlier
// default. Before the fix it unconditionally returned 10_000 on any non-finite/negative
// SPX_PULSE_STRUCTURE_SEC, silently reverting the desk to 5x the intended staleness ceiling
// — exactly the lod/hod lag the 5s->2s change (FINDING 2026-08-24) was fixing.

test("deskPulseStructureCacheTtlMs: unset env var resolves to the documented 2s default", () => {
  delete process.env.SPX_PULSE_STRUCTURE_SEC;
  assert.equal(deskPulseStructureCacheTtlMs(), 2_000);
});

test("deskPulseStructureCacheTtlMs: a non-numeric override falls back to 2s, not 10s", () => {
  process.env.SPX_PULSE_STRUCTURE_SEC = "not-a-number";
  try {
    assert.equal(deskPulseStructureCacheTtlMs(), 2_000);
  } finally {
    delete process.env.SPX_PULSE_STRUCTURE_SEC;
  }
});

test("deskPulseStructureCacheTtlMs: a negative override falls back to 2s, not 10s", () => {
  process.env.SPX_PULSE_STRUCTURE_SEC = "-5";
  try {
    assert.equal(deskPulseStructureCacheTtlMs(), 2_000);
  } finally {
    delete process.env.SPX_PULSE_STRUCTURE_SEC;
  }
});

test("deskPulseStructureCacheTtlMs: a valid override is honored verbatim", () => {
  process.env.SPX_PULSE_STRUCTURE_SEC = "4";
  try {
    assert.equal(deskPulseStructureCacheTtlMs(), 4_000);
  } finally {
    delete process.env.SPX_PULSE_STRUCTURE_SEC;
  }
});
