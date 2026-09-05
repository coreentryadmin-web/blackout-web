import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const routeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "route.ts"),
  "utf8"
);

test("spx-evaluate wraps loadMergedSpxDesk in runWithBackgroundUwSweep (UW fan-out on cache miss)", () => {
  assert.match(
    routeSrc,
    /import \{[^}]*\brunWithBackgroundUwSweep\b[^}]*\} from "@\/lib\/providers\/uw-rate-limiter"/
  );
  assert.match(
    routeSrc,
    /runWithBackgroundUwSweep\(\(\) => loadMergedSpxDesk\(\)\)/,
    "desk load must reserve a UW slot for live member traffic"
  );
});
