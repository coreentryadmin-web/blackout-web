import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { UW_REST_SECTIONS } from "./uw-docs-catalog";

// Regression for the one export this module exists to share today: UW_REST_SECTIONS is the
// catalog `src/lib/providers/unusual-whales.test.ts` treats as ground truth for every real UW
// path the provider calls. Pin its shape so it can't silently collapse to an empty/malformed
// catalog without a test noticing.
test("UW_REST_SECTIONS is a non-empty catalog of UW endpoint sections", () => {
  assert.ok(Array.isArray(UW_REST_SECTIONS));
  assert.ok(UW_REST_SECTIONS.length > 0);
  for (const section of UW_REST_SECTIONS) {
    assert.equal(typeof section.id, "string");
    assert.equal(typeof section.title, "string");
    assert.ok(Array.isArray(section.endpoints));
    assert.ok(section.endpoints.length > 0);
    for (const ep of section.endpoints) {
      assert.equal(typeof ep.path, "string");
      assert.ok(ep.path.startsWith("/"));
    }
  }
});

// `UW_DOCS_BASE`/`UW_DOCS_URL`/`UW_OPENAPI_URL`/`UW_REST_TOC`/`UW_ENDPOINT_TOTAL`/
// `UW_BLACKOUT_ENDPOINT_COUNT` were real, imported constants until the `/docs/unusual-whales/*`
// internal reference-nav route tree that rendered them was deleted in `de9b1967f` ("delete the
// stale /docs/* analysis app routes (IP-leak surface, ~7.6k LOC)") — the exact same orphaning
// shape `polygon-docs-nav.ts`'s sibling `MASSIVE_DOCS_BASE`/`MASSIVE_REST_BASE` hit (#7040). They
// have had zero consumers anywhere in the repo since. Assert the module's export surface stays
// exactly `UwEndpoint`/`UwEndpointSection`/`UW_REST_SECTIONS` so an orphaned "convenience" constant
// re-emitted by `scripts/generate-uw-docs-catalog.mjs` can't silently drift back in unnoticed.
test("uw-docs-catalog.ts exports only the live UW_REST_SECTIONS surface, no orphaned convenience constants", () => {
  const source = readFileSync(join(__dirname, "uw-docs-catalog.ts"), "utf8");
  const exportNames = [...source.matchAll(/^export\s+(?:type\s+)?(?:const\s+)?([A-Za-z0-9_]+)/gm)].map(
    (m) => m[1]
  );
  assert.deepEqual(exportNames.sort(), ["UW_REST_SECTIONS", "UwEndpoint", "UwEndpointSection"].sort());
});

// Guard the generator script itself, so re-running it (as its own header instructs) can't
// reintroduce the removed dead constants into the generated file.
test("the generator script no longer emits the removed dead UW_DOCS_*/UW_REST_TOC/UW_*_COUNT constants", () => {
  const generator = readFileSync(
    join(__dirname, "..", "..", "scripts", "generate-uw-docs-catalog.mjs"),
    "utf8"
  );
  for (const removed of [
    "UW_DOCS_BASE",
    "UW_DOCS_URL",
    "UW_OPENAPI_URL",
    "UW_REST_TOC",
    "UW_ENDPOINT_TOTAL",
    "UW_BLACKOUT_ENDPOINT_COUNT",
  ]) {
    assert.ok(
      !generator.includes(`export const ${removed}`),
      `generator must not re-emit removed dead export ${removed}`
    );
  }
});
