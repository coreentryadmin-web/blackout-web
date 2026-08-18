import test from "node:test";
import assert from "node:assert/strict";
import {
  vectorPanelVisibility,
  shouldExitFocusMode,
  focusModeAvailable,
} from "./vector-focus-mode";

test("focus mode unmounts every side rail, keeps the chart", () => {
  const v = vectorPanelVisibility(true);
  assert.equal(v.chart, true);
  assert.equal(v.ladder, false);
  assert.equal(v.terminal, false);
  assert.equal(v.action, false);
  assert.equal(v.scanner, false);
});

test("normal mode mounts everything", () => {
  const v = vectorPanelVisibility(false);
  for (const key of ["chart", "ladder", "terminal", "action", "scanner"] as const) {
    assert.equal(v[key], true, `${key} should render outside focus mode`);
  }
});

test("Escape exits focus mode only without modifiers", () => {
  assert.equal(shouldExitFocusMode({ key: "Escape" }), true);
  assert.equal(shouldExitFocusMode({ key: "Escape", shiftKey: true }), false);
  assert.equal(shouldExitFocusMode({ key: "Escape", metaKey: true }), false);
  assert.equal(shouldExitFocusMode({ key: "Escape", ctrlKey: true }), false);
  assert.equal(shouldExitFocusMode({ key: "Escape", altKey: true }), false);
});

test("other keys never exit focus mode", () => {
  for (const key of ["Enter", "f", "F", "Esc", " ", "Tab"]) {
    assert.equal(shouldExitFocusMode({ key }), false, `${key} must not exit`);
  }
});

test("focus mode is desktop-web only", () => {
  assert.equal(focusModeAvailable({ chartOnly: false, nativeShell: false }), true);
  // SPX Slayer embed is already chart-only and owns its own chrome.
  assert.equal(focusModeAvailable({ chartOnly: true, nativeShell: false }), false);
  // iOS shell already shows one panel at a time via the segment switcher.
  assert.equal(focusModeAvailable({ chartOnly: false, nativeShell: true }), false);
  assert.equal(focusModeAvailable({ chartOnly: true, nativeShell: true }), false);
});
