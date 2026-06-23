import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ONBOARDING_VERSION,
  ONBOARDING_STEPS,
  OPTIONS_GLOSSARY,
  parseStoredVersion,
  isOnboardingComplete,
  completedStorageValue,
  clampStepIndex,
  isFirstStep,
  isLastStep,
} from "./onboarding-content";

// Pure helpers for the onboarding guide. Run: npx tsx --test src/lib/onboarding-content.test.ts

test("content is non-empty and well-formed", () => {
  assert.ok(ONBOARDING_STEPS.length >= 3);
  assert.ok(OPTIONS_GLOSSARY.length >= 4);
  for (const s of ONBOARDING_STEPS) {
    assert.ok(s.id && s.title && s.body, "step missing fields");
  }
});

test("parseStoredVersion handles missing/garbage/valid", () => {
  assert.equal(parseStoredVersion(null), 0);
  assert.equal(parseStoredVersion(""), 0);
  assert.equal(parseStoredVersion("abc"), 0);
  assert.equal(parseStoredVersion("-3"), 0);
  assert.equal(parseStoredVersion("1"), 1);
  assert.equal(parseStoredVersion("2"), 2);
});

test("isOnboardingComplete gates on version", () => {
  assert.equal(isOnboardingComplete(null), false);
  assert.equal(isOnboardingComplete("0"), false);
  assert.equal(isOnboardingComplete(completedStorageValue()), true);
  assert.equal(isOnboardingComplete(String(ONBOARDING_VERSION)), true);
  // A future-version flag still counts as complete for the current version.
  assert.equal(isOnboardingComplete(String(ONBOARDING_VERSION + 1)), true);
  // Bumping the version invalidates an older completion.
  assert.equal(isOnboardingComplete("1", 2), false);
});

test("clampStepIndex bounds into range", () => {
  const total = ONBOARDING_STEPS.length;
  assert.equal(clampStepIndex(-5, total), 0);
  assert.equal(clampStepIndex(0, total), 0);
  assert.equal(clampStepIndex(total + 9, total), total - 1);
  assert.equal(clampStepIndex(1.9, total), 1);
  assert.equal(clampStepIndex(NaN, total), 0);
});

test("first/last step predicates", () => {
  const total = ONBOARDING_STEPS.length;
  assert.equal(isFirstStep(0), true);
  assert.equal(isFirstStep(1), false);
  assert.equal(isLastStep(total - 1, total), true);
  assert.equal(isLastStep(0, total), false);
});
