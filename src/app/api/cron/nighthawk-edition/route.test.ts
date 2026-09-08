import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const routeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "route.ts"),
  "utf8"
);

test("nighthawk-edition wraps its background build in the shared background UW sweep helper", () => {
  assert.match(
    routeSrc,
    /runWithBackgroundUwSweep\(\(\) =>\s*\n\s*buildEveningEdition\(/,
    "the cron dispatch must reserve a UW slot for live traffic, matching zerodte-warm"
  );
});
