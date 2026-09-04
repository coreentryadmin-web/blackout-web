import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const routeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "route.ts"),
  "utf8"
);

test("swing-discovery wraps the scan in runWithBackgroundUwSweep (UW IV/earnings deps)", () => {
  assert.match(
    routeSrc,
    /import \{[^}]*\brunWithBackgroundUwSweep\b[^}]*\} from "@\/lib\/providers\/uw-rate-limiter"/
  );
  assert.match(routeSrc, /runWithBackgroundUwSweep\(\(\) => runSwingDiscoveryScan\(deps\)\)/);
});

test("swing-discovery runs inline so phase-claim release stays synchronous on failure", () => {
  assert.match(routeSrc, /Runs inline \(not after\(\)\) so phase-claim release on failure is synchronous/);
  assert.doesNotMatch(routeSrc, /after\(dispatch/);
});
