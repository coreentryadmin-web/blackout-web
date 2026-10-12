/**
 * Regression guard: `MeridianBeatHistory` rendered every row as a real `<button disabled>` even
 * though `onSelect` has never been wired by either real call site (`MeridianEarningsHistoryPanel`,
 * `MeridianEarningsReportPanel` — confirmed via `git log -S"onSelect" -- meridian-viz.tsx`, present
 * since the component's introduction). A `disabled` button is markup for a control that can NEVER
 * be activated — no click, no keyboard focus, nothing a `disabled` state would ever lift — exactly
 * the "non-control wearing interactive markup" pattern this same file's `MeridianTargetRail`
 * (`onTargetClick`) and `MeridianDarkPoolTape` (`onPrintClick`) were already fixed for
 * (UI-UX-OPPORTUNITIES.md item 13, `meridian-interaction-audit.mjs`), but the fix was never applied
 * here.
 *
 * Fix: mirrors the sibling split exactly — render a plain `<span>` when no `onSelect` is passed,
 * a real `<button type="button">` only when one is. Does not render the component (no market data
 * in this test); asserts on the source so this guard cannot be silently dropped.
 * Run: `npx tsx --test src/features/meridian/components/meridian-viz-beat-history-tap-target.test.ts`
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(process.cwd(), "src/features/meridian/components/meridian-viz.tsx"), "utf8");

function section(name: string): string {
  const start = src.indexOf(`export function ${name}(`);
  assert.ok(start > 0, `${name} exists`);
  return src.slice(start, start + 5000);
}

test("MeridianBeatHistory: renders a plain span, never a disabled button, when onSelect is absent", () => {
  const body = section("MeridianBeatHistory");
  assert.match(
    body,
    /if \(!onSelect \|\| !prints\)/,
    "must branch on whether a real onSelect handler was passed"
  );
  assert.match(
    body,
    /<span key=\{p\.date \?\? i\} className="mv-beat-row"/,
    "must render a plain <span> in the no-handler branch"
  );
  assert.doesNotMatch(
    body,
    /disabled=\{!onSelect\}/,
    "must not render a permanently-disabled button — neither real call site ever passes onSelect"
  );
});

test("MeridianBeatHistory: renders a real button, wired to onSelect, only when one is passed", () => {
  const body = section("MeridianBeatHistory");
  assert.match(body, /<button\s*\n\s*type="button"/, "the handler branch must render a real <button>");
  assert.match(
    body,
    /onClick=\{\(\) => onSelect\(prints\[i\]!\)\}/,
    "the button branch must wire onClick to the real onSelect handler"
  );
});

test("mv-beat-row CSS: cursor/hover affordance is scoped to the real button, not the always-present span", () => {
  const css = readFileSync(join(process.cwd(), "src/app/desk-app.css"), "utf8");
  const start = css.indexOf(".mv-beat-row {");
  assert.ok(start > 0, ".mv-beat-row base rule exists");
  const block = css.slice(start, start + 900);
  assert.match(
    block,
    /\.mv-beat-row\[type="button"\]\s*\{\s*cursor: pointer;\s*\}/,
    "pointer cursor must be scoped to the button variant, matching .mv-target-dot[type=\"button\"]"
  );
  assert.doesNotMatch(
    block,
    /\.mv-beat-row\s*\{[^}]*cursor:\s*pointer/,
    "the base (span-or-button) rule must not unconditionally claim pointer affordance"
  );
});
