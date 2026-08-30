import test from "node:test";
import assert from "node:assert/strict";
import {
  vectorPanelVisibility,
  shouldExitFocusMode,
  shouldToggleFocusMode,
  focusModeAvailable,
  focusModeContentClass,
  VECTOR_PAGE_CONTENT_FOCUS_CLASS,
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

test("F toggles focus mode when available, ignored in text fields", () => {
  assert.equal(shouldToggleFocusMode({ key: "f" }, true), true);
  assert.equal(shouldToggleFocusMode({ key: "F" }, true), true);
  assert.equal(shouldToggleFocusMode({ key: "f", shiftKey: true }, true), false);
  assert.equal(shouldToggleFocusMode({ key: "f" }, false), false);
  const input = { tagName: "INPUT" };
  assert.equal(shouldToggleFocusMode({ key: "f", target: input }, true), false);
});

test("focus mode is desktop-web only", () => {
  assert.equal(focusModeAvailable({ chartOnly: false, nativeShell: false }), true);
  // SPX Slayer embed is already chart-only and owns its own chrome.
  assert.equal(focusModeAvailable({ chartOnly: true, nativeShell: false }), false);
  // iOS shell already shows one panel at a time via the segment switcher.
  assert.equal(focusModeAvailable({ chartOnly: false, nativeShell: true }), false);
  assert.equal(focusModeAvailable({ chartOnly: true, nativeShell: true }), false);
});

// ── FULLSCREEN MUST OUTRANK THE SITE HEADER (2026-08-19) ──────────────────────────────────────
// Member report: "in full screen mode I dont get to select nodes .. and other options .. even
// replay is missing". Nothing was missing. `.nav-bar` is `fixed top-0 z-[100]` and the focus
// overlay was `z-index: 60`, so the marketing header painted over the chart toolbar — NODES,
// Replay, the DTE chips, GEX/VEX and RINGS/EVENTS were all rendered and all unclickable.
//
// A layering bug is invisible to component tests (both elements exist, both are "visible" to the
// DOM) and only shows in a screenshot. This reads the actual stylesheet so the ordering is a
// checked invariant rather than a value someone has to remember.
test("focus-mode overlay stacks above the site nav and below the onboarding modal", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../../../app/globals.css", import.meta.url), "utf8");

  const ruleZ = (selector: string): number => {
    const at = css.indexOf(selector);
    assert.ok(at >= 0, `${selector} not found in globals.css`);
    const block = css.slice(at, css.indexOf("}", at));
    const m = block.match(/z-index:\s*(\d+)/) ?? block.match(/z-\[(\d+)\]/);
    assert.ok(m, `${selector} declares no z-index`);
    return Number(m![1]);
  };

  const focus = ruleZ(".vector-page-inner-focus");
  const nav = ruleZ(".nav-bar");
  const onboarding = ruleZ(".onboarding-overlay");

  assert.ok(
    focus > nav,
    `fullscreen (z${focus}) must outrank the site nav (z${nav}) or the chart toolbar is buried`
  );
  assert.ok(
    focus < onboarding,
    `fullscreen (z${focus}) must stay below the onboarding modal (z${onboarding})`
  );
});

// ── ...AND THE NUMBER ABOVE IS NOT SUFFICIENT (2026-08-19, measured on prod) ───────────────────
// The test above passed, the fix shipped, and the nav STILL painted over the chart toolbar.
// `scripts/audit/vector-fs-stacking-probe.cjs` on production returned, in fullscreen:
//
//   .vector-page-inner-focus   position:fixed  z-index:110
//     └ ancestor .vector-page-content   position:relative  z-index:10   <-- STACKING CONTEXT
//   header.nav-bar             position:fixed  z-index:100   (root context)
//   elementFromPoint(toolbar centre) -> header.nav-bar
//
// A z-index only ranks an element against its SIBLINGS. Because PageShell's content wrapper is
// `relative z-10`, the fullscreen surface's 110 was being compared inside a box that itself sat at
// 10 against the nav's 100 — it loses at 60, at 110, and at any number, and comparing the two leaf
// values could never reveal that. The wrapper has to be lifted as well, and only in focus mode
// (outside it, page content must stay UNDER the site header).
//
// So the invariant is now two-part: the leaf ordering above, AND that focus mode actually lifts the
// ancestor. This is the part the previous test could not have caught.
test("focus mode lifts PageShell's content wrapper out of its z-10 stacking context", async () => {
  assert.equal(focusModeContentClass(false), null, "ordinary desk must stay under the site nav");
  assert.equal(focusModeContentClass(true), VECTOR_PAGE_CONTENT_FOCUS_CLASS);

  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../../../app/globals.css", import.meta.url), "utf8");

  // TWO class selectors, not one. The value being overridden (`z-10`) is a Tailwind utility and the
  // utilities layer is emitted after the components layer, so a single-class rule of equal
  // specificity compiles fine, ships fine, and does nothing at all.
  const sel = `.vector-page-content.${VECTOR_PAGE_CONTENT_FOCUS_CLASS}`;
  const at = css.indexOf(sel);
  assert.ok(at >= 0, `${sel} not found in globals.css — a single-class rule would lose to \`z-10\``);

  const m = css.slice(at, css.indexOf("}", at)).match(/z-index:\s*(\d+)/);
  assert.ok(m, `${sel} declares no z-index`);
  const lifted = Number(m![1]);

  assert.ok(lifted > 100, `wrapper (z${lifted}) must outrank .nav-bar (z100) at the ROOT context`);
  assert.ok(lifted < 120, `wrapper (z${lifted}) must stay below .onboarding-overlay (z120)`);
});
