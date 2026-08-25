import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CAPTURE_PRODUCTS,
  VISUAL_CAPTURE_CATALOG,
  VISUAL_CAPTURE_BY_ID,
  captureCatalogByProduct,
  exportCaptureCatalogJson,
  resolveSignatureTemplate,
  searchCaptureCatalog,
} from "@/lib/x-intel/capture-catalog";
import { checkCaptureUrl } from "@/lib/x-intel/capture-guard";

describe("capture-catalog", () => {
  it("has unique capture ids", () => {
    const ids = VISUAL_CAPTURE_CATALOG.map((e) => e.id);
    assert.equal(new Set(ids).size, ids.length, `duplicate ids: ${ids.length - new Set(ids).size}`);
  });

  it("indexes every entry by id", () => {
    assert.equal(Object.keys(VISUAL_CAPTURE_BY_ID).length, VISUAL_CAPTURE_CATALOG.length);
  });

  it("covers every major product with multiple frames", () => {
    const grouped = captureCatalogByProduct();
    for (const product of CAPTURE_PRODUCTS) {
      assert.ok(grouped[product].length >= 5, `${product} has only ${grouped[product].length} captures`);
    }
  });

  it("every entry has clip selector and recipe", () => {
    for (const e of VISUAL_CAPTURE_CATALOG) {
      assert.ok(e.recipe, `${e.id} missing recipe`);
      assert.ok(e.clip.selector.trim().length > 3, `${e.id} missing clip`);
      assert.ok(e.signature_template.includes("|") || e.signature_template.length > 3, `${e.id} bad signature`);
    }
  });

  it("every route survives capture-guard", () => {
    for (const e of VISUAL_CAPTURE_CATALOG) {
      const verdict = checkCaptureUrl(`https://blackouttrades.com${e.path}`);
      assert.equal(verdict.ok, true, `${e.id} path ${e.path} blocked`);
    }
  });

  it("export JSON is stable-shaped", () => {
    const j = exportCaptureCatalogJson();
    assert.equal(j.version, 1);
    assert.ok(j.entry_count >= 80, `expected large catalog, got ${j.entry_count}`);
    assert.ok(j.products.helix.length >= 10);
    assert.ok(j.products.thermal.length >= 10);
    assert.ok(j.products.meridian.length >= 5);
  });

  it("resolveSignatureTemplate substitutes params", () => {
    const entry = VISUAL_CAPTURE_BY_ID["thermal.matrix.spx.gex"]!;
    assert.ok(entry);
    const sig = resolveSignatureTemplate(entry, { ticker: "SPX", lens: "gex" });
    assert.match(sig, /SPX/);
    assert.match(sig, /gex/);
  });

  it("searchCaptureCatalog filters by product and tag", () => {
    const helixWhale = searchCaptureCatalog({ product: "helix", story_tag: "whale" });
    assert.ok(helixWhale.length >= 3);
    const earnings = searchCaptureCatalog({ franchise: "EARNINGS_WAR_ROOM" });
    assert.ok(earnings.some((e) => e.product === "meridian"));
  });
});
