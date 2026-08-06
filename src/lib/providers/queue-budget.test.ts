import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_QUEUE_MAX_WAIT_MS,
  QueueBudget,
  RateLimiterQueueTimeoutError,
  isQueueTimeout,
  resolveQueueBudgetMs,
} from "./queue-budget";

test("env parsing falls back rather than ever disabling the bound", () => {
  // An unbounded queue is the bug this module removes, so no env value may
  // produce one -- not empty, not zero, not negative, not garbage.
  assert.equal(resolveQueueBudgetMs(undefined), DEFAULT_QUEUE_MAX_WAIT_MS);
  assert.equal(resolveQueueBudgetMs(""), DEFAULT_QUEUE_MAX_WAIT_MS);
  assert.equal(resolveQueueBudgetMs("   "), DEFAULT_QUEUE_MAX_WAIT_MS);
  assert.equal(resolveQueueBudgetMs("nope"), DEFAULT_QUEUE_MAX_WAIT_MS);
  assert.equal(resolveQueueBudgetMs("0"), DEFAULT_QUEUE_MAX_WAIT_MS);
  assert.equal(resolveQueueBudgetMs("-1"), DEFAULT_QUEUE_MAX_WAIT_MS);
  assert.equal(resolveQueueBudgetMs("NaN"), DEFAULT_QUEUE_MAX_WAIT_MS);
});

test("env parsing accepts a valid override and floors it", () => {
  assert.equal(resolveQueueBudgetMs("5000"), 5_000);
  assert.equal(resolveQueueBudgetMs(" 7500 "), 7_500);
  assert.equal(resolveQueueBudgetMs("1234.9"), 1_234);
});

test("an explicit fallback is respected", () => {
  assert.equal(resolveQueueBudgetMs(undefined, 3_000), 3_000);
  assert.equal(resolveQueueBudgetMs("bad", 3_000), 3_000);
});

test("the default sits far below the ALB idle timeout", () => {
  // If the queue budget ever exceeded 120s the limiter would stop being the
  // tighter bound and the ALB would go back to producing the 504s.
  assert.ok(DEFAULT_QUEUE_MAX_WAIT_MS < 120_000);
});

function fakeClock(start = 1_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

test("a fresh budget is not expired and reports the full remainder", () => {
  const clock = fakeClock();
  const b = new QueueBudget("polygon", 20_000, clock.now);
  assert.equal(b.expired(), false);
  assert.equal(b.waitedMs(), 0);
  assert.equal(b.remainingMs(), 20_000);
  b.assertWithinBudget("local_slot"); // must not throw
});

test("the budget spans the whole admission sequence, not each stage", () => {
  const clock = fakeClock();
  const b = new QueueBudget("polygon", 20_000, clock.now);

  // Three stages, each individually short, but cumulatively over budget. A
  // per-stage budget would let this caller starve indefinitely.
  clock.advance(9_000);
  b.assertWithinBudget("circuit");
  clock.advance(9_000);
  b.assertWithinBudget("global_rps");
  clock.advance(9_000);

  assert.equal(b.expired(), true);
  assert.throws(() => b.assertWithinBudget("local_slot"), RateLimiterQueueTimeoutError);
});

test("the timeout error carries the provider, stage and timings for triage", () => {
  const clock = fakeClock();
  const b = new QueueBudget("unusual_whales", 20_000, clock.now);
  clock.advance(25_000);

  try {
    b.assertWithinBudget("global_concurrency");
    assert.fail("expected a queue timeout");
  } catch (err) {
    assert.ok(isQueueTimeout(err));
    assert.equal(err.provider, "unusual_whales");
    assert.equal(err.stage, "global_concurrency");
    assert.equal(err.waitedMs, 25_000);
    assert.equal(err.budgetMs, 20_000);
    assert.equal(err.name, "RateLimiterQueueTimeoutError");
    assert.match(err.message, /queue budget exceeded at global_concurrency/);
  }
});

test("expiry is inclusive at exactly the budget", () => {
  const clock = fakeClock();
  const b = new QueueBudget("polygon", 20_000, clock.now);
  clock.advance(19_999);
  assert.equal(b.expired(), false);
  clock.advance(1);
  assert.equal(b.expired(), true);
});

test("sleeps are clamped so a spin loop cannot overshoot the budget", () => {
  const clock = fakeClock();
  const b = new QueueBudget("polygon", 20_000, clock.now);

  assert.equal(b.clampSleepMs(40), 40, "well inside budget → unchanged");

  clock.advance(19_980);
  // 20ms of budget left: a naive 500ms breaker sleep would blow past it.
  assert.equal(b.clampSleepMs(500), 20);
});

test("clampSleepMs always yields at least 1ms so the loop stays async", () => {
  const clock = fakeClock();
  const b = new QueueBudget("polygon", 20_000, clock.now);
  clock.advance(30_000);
  // Budget is fully spent; a 0ms sleep would busy-spin the event loop until the
  // next assertWithinBudget throws.
  assert.equal(b.clampSleepMs(500), 1);
});

test("isQueueTimeout does not mistake other errors for a queue timeout", () => {
  assert.equal(isQueueTimeout(new Error("nope")), false);
  assert.equal(isQueueTimeout(null), false);
  assert.equal(isQueueTimeout("RateLimiterQueueTimeoutError"), false);
});
