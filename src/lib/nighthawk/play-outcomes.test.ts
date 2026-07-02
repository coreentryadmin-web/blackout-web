import assert from "node:assert/strict";
import test from "node:test";
import { outcomeSessionDate, parsePlayLevels, resolveOutcome } from "./play-outcomes";
import type { NighthawkPlayOutcomeRow } from "@/lib/db";
import type { PlaybookPlay } from "./types";

test("outcomeSessionDate resolves the edition date itself, not the next trading day", () => {
  assert.equal(outcomeSessionDate({ edition_for: "2026-06-30" }), "2026-06-30");
});

test("parsePlayLevels extracts entry range, target, and stop", () => {
  const play = {
    entry_range: "$198 - $202",
    target: "$215",
    stop: "$190",
  } as PlaybookPlay;

  assert.deepEqual(parsePlayLevels(play), {
    entry_range_low: 198,
    entry_range_high: 202,
    target: 215,
    stop: 190,
  });
});

test("resolveOutcome marks long target hit using session high", () => {
  const row = {
    direction: "LONG",
    entry_range_low: 198,
    entry_range_high: 202,
    target: 215,
    stop: 190,
    next_day_open: 201,
    next_day_close: 211,
    session_high: 216,
    session_low: 199,
  } as NighthawkPlayOutcomeRow;

  const outcome = resolveOutcome(row);

  assert.equal(outcome.outcome, "target");
  assert.equal(outcome.hit_target, true);
  assert.equal(outcome.hit_stop, false);
});

// ── fillability (grading-honesty, 2026-07-02 audit) ─────────────────────────────

test("LONG that gapped ABOVE its entry band and ran grades 'unfilled', not a win", () => {
  const row = {
    direction: "LONG",
    entry_range_low: 198,
    entry_range_high: 202,
    target: 215,
    stop: 190,
    next_day_open: 208, // gapped over the band
    next_day_close: 216,
    session_high: 217,
    session_low: 206, // never traded back into reach of the band
  } as NighthawkPlayOutcomeRow;

  const outcome = resolveOutcome(row);
  assert.equal(outcome.outcome, "unfilled");
  assert.equal(outcome.hit_target, false);
});

test("SHORT that gapped BELOW its entry band grades 'unfilled' (mirror)", () => {
  const row = {
    direction: "SHORT",
    entry_range_low: 198,
    entry_range_high: 202,
    target: 185,
    stop: 210,
    next_day_open: 192,
    next_day_close: 184,
    session_high: 193, // never back up into the band
    session_low: 183,
  } as NighthawkPlayOutcomeRow;

  assert.equal(resolveOutcome(row).outcome, "unfilled");
});

test("a gap-open that RETRACES into the band still grades normally", () => {
  const row = {
    direction: "LONG",
    entry_range_low: 198,
    entry_range_high: 202,
    target: 215,
    stop: 190,
    next_day_open: 208,
    next_day_close: 216,
    session_high: 217,
    session_low: 201, // dipped back into the band — fillable
  } as NighthawkPlayOutcomeRow;

  assert.equal(resolveOutcome(row).outcome, "target");
});

test("rows without an entry band skip the fillability gate", () => {
  const row = {
    direction: "LONG",
    entry_range_low: null,
    entry_range_high: null,
    target: 215,
    stop: 190,
    next_day_open: 208,
    next_day_close: 216,
    session_high: 217,
    session_low: 206,
  } as NighthawkPlayOutcomeRow;

  assert.equal(resolveOutcome(row).outcome, "target");
});
