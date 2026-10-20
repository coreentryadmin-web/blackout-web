import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const pageSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "page.tsx"),
  "utf8"
);

// Regression (2026-10-20, DISCOVERY-lane accessibility sweep): the "paste the tweet ID"
// input relied solely on its `placeholder` for an accessible name — screen readers don't
// reliably announce placeholder text, and it clears once the field has a value. Same defect
// class as the earlier ExitIntentCapture fix. Fixed by adding `aria-label`.
test("the tweet-ID input carries an aria-label, not just a placeholder", () => {
  const inputStart = pageSrc.indexOf('placeholder="Paste the X/Twitter post ID here...');
  assert.ok(inputStart > 0, "expected the tweet-ID input to still exist");
  const inputBlock = pageSrc.slice(Math.max(0, inputStart - 200), inputStart + 50);
  assert.match(
    inputBlock,
    /aria-label="X\/Twitter post ID"/,
    "the tweet-ID input must carry an aria-label so it has an accessible name independent of its placeholder"
  );
});
