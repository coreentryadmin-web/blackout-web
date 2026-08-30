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

  it("searchCaptureCatalog: the ticker filter actually narrows the result — a nonexistent ticker excludes entries with no override path", () => {
    // No entry's id, default ticker param, or spx_only flag can ever match a ticker that appears
    // nowhere in the catalog, so any entry WITHOUT an overridable ticker param must be dropped.
    const all = searchCaptureCatalog({});
    const nonsense = searchCaptureCatalog({ ticker: "ZZZNOPE" });
    assert.ok(nonsense.length < all.length, "an unmatched ticker must exclude at least the non-generic entries");
    for (const e of nonsense) {
      const hasTickerParam = e.params.some((p) => p.key === "ticker");
      assert.ok(
        hasTickerParam || e.spx_only,
        `${e.id} has no ticker param and isn't spx_only — it should have been excluded`
      );
    }
  });

  it("searchCaptureCatalog: an entry with no ticker param and no id/spx_only hit is excluded by a mismatched ticker", () => {
    const entry = VISUAL_CAPTURE_CATALOG.find(
      (e) => !e.params.some((p) => p.key === "ticker") && !e.spx_only && !e.id.toUpperCase().includes("MSFT")
    )!;
    assert.ok(entry, "fixture assumption: at least one non-generic, non-spx entry must exist");
    const result = searchCaptureCatalog({ ticker: "MSFT" });
    assert.ok(!result.some((e) => e.id === entry.id), `${entry.id} has no path to matching MSFT and must be excluded`);
  });

  it("searchCaptureCatalog: an entry whose id names the ticker is kept even with no ticker param", () => {
    const result = searchCaptureCatalog({ ticker: "NVDA" });
    assert.ok(
      result.some((e) => e.id.toUpperCase().includes("NVDA")),
      "an id-hit entry must survive the ticker filter"
    );
  });

  it("searchCaptureCatalog: spx_only entries are always kept regardless of the searched ticker", () => {
    const spxOnly = VISUAL_CAPTURE_CATALOG.filter((e) => e.spx_only);
    assert.ok(spxOnly.length > 0, "fixture assumption: at least one spx_only entry exists");
    const result = searchCaptureCatalog({ ticker: "NVDA" });
    for (const e of spxOnly) {
      assert.ok(result.some((r) => r.id === e.id), `${e.id} is spx_only and must survive any ticker search`);
    }
  });

  it("searchCaptureCatalog: a generic entry with an overridable ticker param is kept even when its default doesn't match", () => {
    // A default of "SPX" is a placeholder, not a lock — the caller can override it at generation
    // time, so the entry must stay in scope for an unrelated search ticker.
    const generic = VISUAL_CAPTURE_CATALOG.find(
      (e) => e.params.find((p) => p.key === "ticker")?.default === "SPX" && !e.spx_only
    )!;
    assert.ok(generic, "fixture assumption: at least one non-spx-only entry defaults its ticker param to SPX");
    const result = searchCaptureCatalog({ ticker: "NVDA" });
    assert.ok(result.some((e) => e.id === generic.id), `${generic.id} has an overridable ticker param and must be kept`);
  });
});
