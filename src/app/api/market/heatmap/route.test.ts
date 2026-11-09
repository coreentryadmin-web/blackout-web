import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routeSrc = readFileSync("src/app/api/market/heatmap/route.ts", "utf8");

test("heatmap route rounds floats at the data layer", () => {
  assert.match(routeSrc, /roundFloats\(/);
  assert.match(routeSrc, /import \{ roundFloats \} from "@\/lib\/round-floats"/);
});

// Largo C1 (contract/session-anchor.test.ts): a payload that stamps a UTC `as_of` instant must
// also carry an ET session anchor beside it, or a consumer resolving "today" purely from the UTC
// calendar date reads a full session ahead for the last ~4 hours of RTH (the inversion class
// fixed in #2418/#2420/#2422 — this route was a known, listed gap in KNOWN_GAPS).
test("heatmap route anchors both as_of sites (success and degraded-config) to an ET session_date", () => {
  assert.match(routeSrc, /import \{ etSessionDate \} from "@\/lib\/largo\/temporal\/bar-session-date"/);
  const asOfSites = routeSrc.match(/as_of:\s*new Date\([^)]*\)\.toISOString\(\)/g) ?? [];
  const anchorSites = routeSrc.match(/session_date:\s*etSessionDate\(/g) ?? [];
  assert.equal(asOfSites.length, 2, "expected the success path and the degraded-config path each to stamp as_of");
  assert.equal(
    anchorSites.length,
    asOfSites.length,
    "every as_of construction site must carry an etSessionDate(...) anchor beside it"
  );
});
