import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveSelectActiveIndex, type SelectOption } from "./Select";

const OPTIONS: SelectOption[] = [
  { value: "a", label: "A" },
  { value: "b", label: "B" },
  { value: "c", label: "C" },
];

test("resolveSelectActiveIndex finds the index matching the current value", () => {
  assert.equal(resolveSelectActiveIndex(OPTIONS, "b"), 1);
});

test("resolveSelectActiveIndex falls back to 0 when value matches no option", () => {
  assert.equal(resolveSelectActiveIndex(OPTIONS, "missing"), 0);
});

test("resolveSelectActiveIndex re-derives a fresh index for a changed value — the bug was reusing a stale one", () => {
  // Real-world failure this guards: `active` used to be seeded from `value` once at
  // mount and never resynced. A parent changing `value` after mount (the normal case
  // for a controlled component) left `active` pointing at the old option, so opening
  // the menu and pressing Enter called `commit(active)` and silently re-selected it
  // instead of the option `value` actually names. The fix re-runs this same resolver
  // in a `useEffect` keyed on `value`/`options`, so it must give a different answer
  // for a different value rather than memoizing the first one.
  const first = resolveSelectActiveIndex(OPTIONS, "a");
  const second = resolveSelectActiveIndex(OPTIONS, "c");
  assert.equal(first, 0);
  assert.equal(second, 2);
  assert.notEqual(first, second);
});
