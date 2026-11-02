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
import { DESK_NAV_LINKS } from "./desk-nav-links";

// Pure helpers for the onboarding guide. Run: npx tsx --test src/lib/onboarding-content.test.ts

test("content is non-empty and well-formed", () => {
  assert.ok(ONBOARDING_STEPS.length >= 3);
  assert.ok(OPTIONS_GLOSSARY.length >= 4);
  for (const s of ONBOARDING_STEPS) {
    assert.ok(s.id && s.title && s.body, "step missing fields");
  }
});

// Regression (round 347 DISCOVERY sweep): ONBOARDING_STEPS' own top-of-array comment says
// "keep aligned with Nav FEATURE_LINKS" (FEATURE_LINKS === DESK_NAV_LINKS, the canonical 7-desk
// list — see desk-nav-links.ts), but nothing actually enforced that. The guided first-run tour
// (OnboardingGuide.tsx, auto-opened for every new signed-in member) stopped at Night Hawk/Evening
// Edition and never introduced Vector or Meridian at all — two of the platform's seven live desks
// were completely absent from the new-member walkthrough, the same
// hand-maintained-map-drifts-from-source-of-truth bug class as #7370 (ga4-events.ts's
// DESK_PATH_PREFIXES missing Meridian). A brand-new member who completes onboarding never once
// sees the words "Vector" or "Meridian" from the product's own introduction flow. This asserts
// every canonical desk href has a corresponding onboarding step, so a future 8th desk (or a
// renamed route) can't silently go unintroduced the same way.
test("every canonical desk has a guided-tour step (ONBOARDING_STEPS does not drift from DESK_NAV_LINKS)", () => {
  const stepHrefs = new Set(ONBOARDING_STEPS.map((s) => s.href).filter(Boolean));
  const missing = DESK_NAV_LINKS.filter((l) => !stepHrefs.has(l.href)).map((l) => l.label);
  assert.deepEqual(missing, [], `desks missing from the guided tour: ${missing.join(", ")}`);
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
