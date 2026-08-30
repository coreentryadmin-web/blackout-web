import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mobileStickyBlockedByContent,
  rectsOverlap,
  shouldShowMobileStickyCta,
} from "./mobile-sticky-cta";

test("rectsOverlap: detects the measured FAQ item 3 vs sticky bar overlap", () => {
  const sticky = { top: 879, right: 430, bottom: 932, left: 0 };
  const faq3 = { top: 875, right: 430, bottom: 962, left: 0 };
  assert.equal(rectsOverlap(sticky, faq3), true);
});

test("rectsOverlap: no overlap when FAQ sits well above sticky bar", () => {
  const sticky = { top: 879, right: 430, bottom: 932, left: 0 };
  const faq3 = { top: 422, right: 430, bottom: 510, left: 0 };
  assert.equal(rectsOverlap(sticky, faq3), false);
});

test("mobileStickyBlockedByContent: blocks when any FAQ item intersects sticky", () => {
  const sticky = { top: 879, right: 430, bottom: 932, left: 0 };
  const blocked = mobileStickyBlockedByContent(
    sticky,
    [
      { top: 200, right: 430, bottom: 280, left: 0 },
      { top: 875, right: 430, bottom: 962, left: 0 },
    ],
    null
  );
  assert.equal(blocked, true);
});

test("shouldShowMobileStickyCta: hero past but FAQ overlap suppresses bar", () => {
  assert.equal(shouldShowMobileStickyCta(true, true), false);
  assert.equal(shouldShowMobileStickyCta(true, false), true);
  assert.equal(shouldShowMobileStickyCta(false, false), false);
});
