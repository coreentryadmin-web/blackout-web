import { describe, test } from "node:test";
import assert from "node:assert/strict";

// Placed under src/ deliberately: scripts/run-tests.mjs walks src/ ONLY, so a test living beside
// the audit lib it covers would never gate CI. Same reason meridian-earnings-cohort.test.ts is here.
import {
  FASTEST_POLL_MS,
  expectedMaxFetches,
  isPollingUrl,
  splitOverFetches,
} from "../scripts/audit/lib/expected-poll-count.mjs";

const EVENT = "https://blackouttrades.com/api/market/meridian/event?id=earnings%3ABEKE%3A2026-08-21";
const TIMELINE = "https://blackouttrades.com/api/market/meridian/timeline?days=21";
const OTHER = "https://blackouttrades.com/api/market/gex?ticker=SPX";

describe("a fetch count is not a defect without the time it accumulated in", () => {
  test("the exact live false positive no longer fires", () => {
    // Measured on prod 2026-08-21: 4x the event detail over a ~60s run, reported as a duplicate
    // fetch. BEKE printed that morning, so MeridianDesk was polling at 15s by design.
    const { over, explained } = splitOverFetches([[EVENT, 4]], 60_000);
    assert.deepEqual(over, [], "polling within cadence must not be reported as a defect");
    assert.equal(explained.length, 1, "but it must still be REPORTED as explained, not silently dropped");
    assert.equal(explained[0]!.count, 4);
    assert.equal(explained[0]!.max, 8);
  });

  test("a real storm still fires — the check is narrowed, not disabled", () => {
    // 4 fetches in 3 seconds cannot be polling at any cadence the product uses.
    const { over } = splitOverFetches([[EVENT, 4]], 3_000);
    assert.equal(over.length, 1);
    assert.equal(over[0]!.max, 3);
    // And a genuinely excessive count over a long run fires too.
    assert.equal(splitOverFetches([[EVENT, 40]], 60_000).over.length, 1);
  });

  test("non-polling endpoints keep the strict allowance of 2", () => {
    // Widening the rule for everything would have been the lazy fix and would hide real dupes.
    assert.equal(expectedMaxFetches(OTHER, 600_000), 2);
    assert.equal(splitOverFetches([[OTHER, 3]], 600_000).over.length, 1);
    assert.equal(splitOverFetches([[OTHER, 2]], 600_000).over.length, 0);
  });

  test("both polling surfaces are recognised, and nothing else is", () => {
    assert.equal(isPollingUrl(EVENT), true);
    assert.equal(isPollingUrl(TIMELINE), true);
    assert.equal(isPollingUrl(OTHER), false);
    assert.equal(isPollingUrl(""), false);
    assert.equal(isPollingUrl(null), false);
  });

  test("the allowance tracks the FASTEST cadence, so it is permissive by construction", () => {
    // The harness cannot know which refresh lane an event landed in (10s / 15s / 45s / 300s), so
    // it assumes the fastest. That makes this check fire only when polling cannot explain a count
    // AT ALL — which is the only claim it can honestly make.
    assert.equal(FASTEST_POLL_MS, 10_000);
    assert.equal(expectedMaxFetches(EVENT, 10_000), 3);
    assert.equal(expectedMaxFetches(EVENT, 100_000), 12);
  });

  test("a zero or nonsense elapsed time falls back to strict, it does not allow everything", () => {
    // If the harness ever fails to record when the page opened, the check must get STRICTER, not
    // silently permit an unbounded count.
    for (const bad of [0, -1, NaN, undefined, null, "soon"]) {
      assert.equal(expectedMaxFetches(EVENT, bad as never), 2, `elapsed=${String(bad)}`);
    }
  });

  test("an endpoint fetched twice is never mentioned at all", () => {
    const { over, explained } = splitOverFetches([[EVENT, 2], [OTHER, 1]], 60_000);
    assert.deepEqual(over, []);
    assert.deepEqual(explained, [], "ordinary load+revalidate is not worth a line of output");
  });
});
