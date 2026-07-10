import test from "node:test";
import assert from "node:assert/strict";

import {
  ANTHROPIC_BREAKER_COOLDOWN_MS,
  anthropicBreakerOpenUntil,
  anthropicBreakerReason,
  isHardAnthropicAccountFailure,
  resetAnthropicBreakerForTests,
  tripAnthropicBreaker,
} from "@/lib/providers/anthropic-breaker";

test("isHardAnthropicAccountFailure: 401/403 always hard", () => {
  assert.equal(isHardAnthropicAccountFailure(401, "invalid x-api-key"), true);
  assert.equal(isHardAnthropicAccountFailure(403, "forbidden"), true);
});

test("isHardAnthropicAccountFailure: 400 only when it is the billing error", () => {
  assert.equal(
    isHardAnthropicAccountFailure(
      400,
      'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.'
    ),
    true
  );
  // Plain request-shape 400s must NOT trip the breaker — they are fixable per-call.
  assert.equal(isHardAnthropicAccountFailure(400, "temperature is not supported"), false);
});

test("isHardAnthropicAccountFailure: transient statuses never hard", () => {
  assert.equal(isHardAnthropicAccountFailure(429, "rate limited"), false);
  assert.equal(isHardAnthropicAccountFailure(500, "overloaded"), false);
  assert.equal(isHardAnthropicAccountFailure(null, "network error"), false);
  assert.equal(isHardAnthropicAccountFailure(undefined, "timeout"), false);
});

test("breaker: closed by default, opens on trip for the cooldown, then closes", () => {
  resetAnthropicBreakerForTests();
  const t0 = 1_000_000;

  assert.equal(anthropicBreakerOpenUntil(t0), null);

  tripAnthropicBreaker("credit balance is too low", t0);
  assert.equal(anthropicBreakerOpenUntil(t0), t0 + ANTHROPIC_BREAKER_COOLDOWN_MS);
  assert.equal(
    anthropicBreakerOpenUntil(t0 + ANTHROPIC_BREAKER_COOLDOWN_MS - 1),
    t0 + ANTHROPIC_BREAKER_COOLDOWN_MS
  );
  assert.match(anthropicBreakerReason(), /credit balance/i);

  // Cooldown elapsed — the next call probes Anthropic again.
  assert.equal(anthropicBreakerOpenUntil(t0 + ANTHROPIC_BREAKER_COOLDOWN_MS), null);

  resetAnthropicBreakerForTests();
  assert.equal(anthropicBreakerOpenUntil(t0), null);
});

test("breaker: re-trip extends the window from the new failure time", () => {
  resetAnthropicBreakerForTests();
  const t0 = 5_000_000;
  tripAnthropicBreaker("first", t0);
  const t1 = t0 + ANTHROPIC_BREAKER_COOLDOWN_MS; // breaker just closed; probe fails again
  tripAnthropicBreaker("second", t1);
  assert.equal(anthropicBreakerOpenUntil(t1), t1 + ANTHROPIC_BREAKER_COOLDOWN_MS);
  resetAnthropicBreakerForTests();
});
