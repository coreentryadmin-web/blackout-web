import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const src = readFileSync(
  join(root, "src/features/vector/components/VectorHelixRail.tsx"),
  "utf8"
);

// Source-invariant checks for the operator's wording/layout feedback (2026-08-27):
// "remove extra wordings on Helix rail... move Full Helix tape below LIVE with an icon,
// that's it." Component markup isn't exercised by a render harness elsewhere in this
// feature (see vector-ios-native.test.ts for the established pattern of asserting against
// the .tsx source directly), so this mirrors that idiom rather than introducing a new one.

test("VectorHelixRail — verbose section/header qualifier text removed", () => {
  // The header no longer renders a subtitle line under the title...
  assert.doesNotMatch(src, /vectorLiveHelixSubtitle/);
  assert.doesNotMatch(src, /vector-helix-subtitle/);
  // ...and neither per-section kicker line survives ("Latest prints · by time" / "Session rank").
  assert.doesNotMatch(src, /Latest prints/);
  assert.doesNotMatch(src, /Session rank/);
  assert.doesNotMatch(src, /vector-helix-section-kicker/);
  // Section labels themselves are kept — only the qualifier text was cut.
  assert.match(src, /Recent<\/h3>/);
  assert.match(src, /Top by premium<\/h3>/);
});

test("VectorHelixRail — Full Helix tape link moved under LIVE, icon-only", () => {
  // No visible link text remains (the old ">Full Helix tape →" label) — a `title=` tooltip for
  // accessibility is fine and expected, but the link renders icon-only.
  assert.doesNotMatch(src, />\s*Full Helix tape[^<]*</);
  assert.match(src, /ExternalLink/);
  assert.match(src, /from "lucide-react"/);
  // The link and the FreshnessChip (LIVE/STALE badge) share one actions column so the icon
  // sits directly below the LIVE indicator, per the operator's ask.
  assert.match(src, /vector-helix-head-actions/);
  const actionsBlock = src.slice(
    src.indexOf("vector-helix-head-actions"),
    src.indexOf("</header>")
  );
  assert.match(actionsBlock, /FreshnessChip/);
  assert.match(actionsBlock, /ExternalLink/);
});
