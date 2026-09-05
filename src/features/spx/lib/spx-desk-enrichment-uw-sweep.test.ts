// Regression for the 2026-09-05 hourly pattern scan: desk enrichment fans out to 5 UW REST
// endpoints via runUwPooled but was reachable from spx-evaluate / spx-signal-observe /
// market-regime-detector / data-correctness without a runWithBackgroundUwSweep tag — unlike
// desk-warm, which already wraps the same path.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const deskSrc = readFileSync(join(process.cwd(), "src/features/spx/lib/spx-desk.ts"), "utf8");

test("spx-desk imports runWithBackgroundUwSweep from the shared rate limiter", () => {
  assert.match(
    deskSrc,
    /import \{[^}]*\brunWithBackgroundUwSweep\b[^}]*\} from "@\/lib\/providers\/uw-rate-limiter"/
  );
});

test("fetchDeskEnrichmentFields wraps UW fan-out in runWithBackgroundUwSweep", () => {
  const fnStart = deskSrc.indexOf("async function fetchDeskEnrichmentFields");
  assert.ok(fnStart >= 0, "fetchDeskEnrichmentFields must exist");
  const fnBody = deskSrc.slice(fnStart, fnStart + 1200);
  assert.match(fnBody, /return runWithBackgroundUwSweep\(async \(\) => \{/);
  assert.match(fnBody, /runUwPooled\(/);
});
