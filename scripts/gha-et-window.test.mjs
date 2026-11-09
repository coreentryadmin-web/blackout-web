import assert from "node:assert/strict";
import test from "node:test";

import { inRthDeepAuditWindow, inRthOpenWindow } from "./gha-et-window.mjs";

test("inRthDeepAuditWindow: 16:30 ET Monday (scheduled post-close slot)", () => {
  assert.equal(inRthDeepAuditWindow(new Date("2026-11-09T21:30:00.000Z")), true);
});

test("inRthDeepAuditWindow: 18:12 ET Monday is outside deep-audit window", () => {
  assert.equal(inRthDeepAuditWindow(new Date("2026-11-09T23:12:00.000Z")), false);
  assert.equal(inRthOpenWindow(new Date("2026-11-09T23:12:00.000Z")), false);
});
