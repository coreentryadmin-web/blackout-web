import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { isLiveQuotesStale, LIVE_QUOTES_STALE_MS } from "./use-vector-pick-live-monitor.ts";

const SRC_PATH = join(import.meta.dirname, "use-vector-pick-live-monitor.ts");

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

  it("treats clock-skewed future success time as stale", () => {
    const now = 10_000;
    const futureSuccess = now + 6_000; // beyond WS_TIMESTAMP_FUTURE_TOLERANCE_MS (5s)
    assert.equal(isLiveQuotesStale(futureSuccess, now), true);
  });

  it("allows modest future skew inside tolerance", () => {
    const now = 10_000;
    const futureSuccess = now + 4_000; // within 5s tolerance, age not exceeded
    assert.equal(isLiveQuotesStale(futureSuccess, now), false);
  });
});

/**
 * Regression coverage for the 2026-10-31 effect-deps fix: `pickKey` (occ|strike|expiry identity)
 * exists specifically so a content-identical 45s pick refetch — `useVectorContractPicks` calls
 * `setPicks(newArray)` on every refresh regardless of whether the identity set changed — does not
 * tear down this hook's running 1s live-quote poll. The live-quote effect's dependency array ALSO
 * listed raw `picks` alongside `pickKey`, which defeats that: a reference-only change on an
 * identity-unchanged refetch still reran the effect, cancelling the in-flight fetch (bumping
 * `genRef`, so its response is dropped on arrival) and rebuilding the `setInterval` — the exact
 * "derived stable key defeated by also depending on the raw value" class fixed in
 * `useVectorContractPicks`'s own fetch effect (see
 * docs/audit/findings-staging/2026-10-31-vector-contract-picks-effect-deps-starvation.md).
 *
 * There's no React rendering harness in this repo (see the staleness tests' own note above), so
 * this asserts the fix directly against the source, matching the established pattern (e.g.
 * VectorScanner.test.ts).
 */
describe("useVectorPickLiveMonitor: live-quote poll effect deps", () => {
  const src = readFileSync(SRC_PATH, "utf8");

  it("does not list raw `picks` in the live-quote poll effect's dependency array", () => {
    // Isolate the SPECIFIC effect that owns poll()/setInterval — the staleness-stale-guard effect
    // above it, and the `useMemo` below it, each have their own, unrelated deps arrays.
    const pollEffect = src.slice(src.indexOf("const poll = ()"), src.indexOf("return useMemo"));
    assert.match(
      pollEffect,
      /\},\s*\[ticker,\s*emit,\s*pickKey,\s*liveSession,\s*paused\]\);/,
      "the poll effect must restart on pickKey (identity), not on a raw `picks` reference change"
    );
    assert.doesNotMatch(
      pollEffect,
      /\[ticker,\s*emit,\s*pickKey,\s*picks,\s*liveSession,\s*paused\]/,
      "raw `picks` must not ALSO sit in the deps array alongside pickKey — that defeats pickKey's" +
        " whole purpose of tolerating a content-identical refetch"
    );
  });

  it("poll() reads the current picks through a ref, not the closed-over `picks` param", () => {
    // Required once `picks` is dropped from the effect's deps: poll() must stay able to see a
    // LATER refetch's fresh premium/confidence/rank fields even when pickKey didn't change and the
    // effect therefore never reran (poll() itself was defined once, at the last effect run).
    assert.match(src, /const picksRef = useRef\(picks\);/);
    assert.match(src, /picksRef\.current = picks;/);
    assert.match(src, /picksRef\.current\.filter\(/, "poll() must source occPicks from picksRef, not the stale closed-over `picks`");
  });
});
