import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const routeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "route.ts"),
  "utf8"
);

// Regression for 2026-09-04 audit sweep: nighthawk-edition dispatches buildEveningEdition in
// after() with heavy per-ticker UW REST but was not tagged with runWithBackgroundUwSweep.
test("nighthawk-edition imports runWithBackgroundUwSweep from the shared rate limiter", () => {
  assert.match(
    routeSrc,
    /import \{[^}]*\brunWithBackgroundUwSweep\b[^}]*\} from "@\/lib\/providers\/uw-rate-limiter"/,
    "must import the background-sweep tag from the shared rate limiter"
  );
});

test("nighthawk-edition wraps background buildEveningEdition in runWithBackgroundUwSweep", () => {
  assert.match(
    routeSrc,
    /void runWithBackgroundUwSweep\(\(\) =>\s*buildEveningEdition/,
    "edition build must run inside the background-sweep tag"
  );
  assert.doesNotMatch(
    routeSrc,
    /void buildEveningEdition\(/,
    "must not dispatch buildEveningEdition bare outside the sweep wrapper"
  );
});
