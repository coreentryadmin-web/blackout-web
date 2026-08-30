import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isLiveQuotesStale, LIVE_QUOTES_STALE_MS } from "./use-vector-pick-live-monitor.ts";

/**
 * Regression coverage for the live-quote staleness fix (2026-08-27): the poll's on-failure
 * fallback ("keep last good live read") is correct, but on repeated failure nothing previously
 * distinguished a live bid/ask/actionStatus from one frozen at its last successful read — a stale
 * value presented with no indication it stopped updating. `isLiveQuotesStale` is the pure decision
 * this component now surfaces as a `STALE` badge.
 */
describe("isLiveQuotesStale", () => {
  it("is never stale before any successful read has happened", () => {
    assert.equal(isLiveQuotesStale(null, 1_000_000), false);
  });

  it("is not stale inside the threshold", () => {
    assert.equal(isLiveQuotesStale(1_000, 1_000 + LIVE_QUOTES_STALE_MS - 1), false);
  });

  it("is not stale exactly AT the threshold (boundary is exclusive)", () => {
    assert.equal(isLiveQuotesStale(1_000, 1_000 + LIVE_QUOTES_STALE_MS), false);
  });

  it("becomes stale once the threshold is exceeded", () => {
    assert.equal(isLiveQuotesStale(1_000, 1_000 + LIVE_QUOTES_STALE_MS + 1), true);
  });

  it("a single missed tick (well under threshold) is not stale — matches the 10x-poll-cadence rationale", () => {
    const lastSuccess = 1_000;
    const oneMissedPollLater = lastSuccess + 1_000 * 2; // one poll cycle missed, at 1s cadence
    assert.equal(isLiveQuotesStale(lastSuccess, oneMissedPollLater), false);
  });

  it("respects a custom staleAfterMs override", () => {
    assert.equal(isLiveQuotesStale(1_000, 1_500, 2_000), false);
    assert.equal(isLiveQuotesStale(1_000, 3_500, 2_000), true);
  });
});
