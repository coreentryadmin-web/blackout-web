import { test } from "node:test";
import assert from "node:assert/strict";
import * as images from "./images";

// `IMAGE_FILES` ("Assets still referenced by the live site (guard / docs)") has had zero
// importers anywhere in the repo since the commit that introduced it (e71a0bb3, 2026-06-16) —
// confirmed by a repo-wide grep for the identifier outside its own definition in images.ts.
// It was dead data from day one: never consumed by a build-time asset guard, a doc generator,
// or any runtime code. Removed as verified-safe dead code.
//
// This test guards against silently reintroducing it (e.g. a careless revert) without anyone
// noticing it is still unused — if a future change re-adds `IMAGE_FILES`, this assertion is the
// signal to either wire up a real consumer or drop it again, rather than letting it sit unused.
test("images.ts does not re-export the removed dead IMAGE_FILES list", () => {
  assert.equal(
    (images as Record<string, unknown>).IMAGE_FILES,
    undefined,
    "IMAGE_FILES was removed as unreferenced dead code (docs/audit/findings-staging) — if it " +
      "has been reintroduced, wire it up to a real consumer (e.g. a build-time asset-existence " +
      "guard) or remove it again rather than leaving it unused.",
  );
});

test("images.ts still exports the live image/marketing constants used elsewhere", () => {
  assert.equal(images.IMAGES.brandEmblem, "/images/blackout-emblem.webp");
  assert.equal(images.IMAGES.ogImage, "/og-image.webp");
  assert.ok(images.MARKETING_MODULE_IMAGES.spx);
  assert.ok(Array.isArray(images.MARKETING_MODULE_GALLERY.spx));
  assert.ok(images.MARKETING_MODULE_GALLERY.spx.length > 0);
});
