import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const componentSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "ThermalSavedDesksMenu.tsx"),
  "utf8"
);

// Regression (2026-10-20, DISCOVERY-lane accessibility sweep): the save-desk-name input
// relied solely on a DYNAMIC placeholder (`defaultSavedDeskName(...)`) for an accessible
// name — even less reliable than a static placeholder, since screen readers don't announce
// placeholder text reliably at all, and the preceding "Save current view" text is a plain
// <p>, not a <label>. Same defect class as the earlier ExitIntentCapture fix. Fixed by
// adding aria-label.
test("the saved-desk-name input carries an aria-label, not just a dynamic placeholder", () => {
  const inputStart = componentSrc.indexOf("placeholder={defaultSavedDeskName(");
  assert.ok(inputStart > 0, "expected the save-desk-name input to still exist");
  const inputBlock = componentSrc.slice(Math.max(0, inputStart - 200), inputStart + 50);
  assert.match(
    inputBlock,
    /aria-label="Saved desk name"/,
    "the save-desk-name input must carry an aria-label so it has an accessible name independent of its dynamic placeholder"
  );
});
