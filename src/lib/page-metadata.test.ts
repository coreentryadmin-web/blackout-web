import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { noindexPageMetadata, publicPageMetadata } from "@/lib/page-metadata";

describe("publicPageMetadata", () => {
  it("sets title, description, canonical, OG, and Twitter", () => {
    const meta = publicPageMetadata("Test Title", "Test description.", "/pricing");
    assert.equal(meta.title, "Test Title");
    assert.equal(meta.description, "Test description.");
    assert.equal(meta.alternates?.canonical, "https://blackouttrades.com/pricing");
    assert.equal(meta.openGraph?.title, "Test Title");
    assert.equal(meta.openGraph?.description, "Test description.");
    assert.equal(meta.twitter?.title, "Test Title");
    assert.equal(meta.twitter?.description, "Test description.");
  });

  it("uses site root for homepage canonical", () => {
    const meta = publicPageMetadata("Home", "Home description.", "/");
    assert.equal(meta.alternates?.canonical, "https://blackouttrades.com");
  });

  it("includes description param in OG image URL", () => {
    const meta = publicPageMetadata("Test", "A short desc.", "/test");
    const ogImages = meta.openGraph?.images;
    assert.ok(Array.isArray(ogImages) && ogImages.length === 1);
    const ogUrl = (ogImages[0] as { url: string }).url;
    assert.ok(ogUrl.includes("description=A+short+desc."), `expected description param in ${ogUrl}`);
  });

  it("passes articleType as type param on OG image URL", () => {
    const meta = publicPageMetadata("Art", "Desc.", "/learn/test", {
      ogType: "article",
      articleType: "pillar",
    });
    const ogImages = meta.openGraph?.images;
    assert.ok(Array.isArray(ogImages) && ogImages.length === 1);
    const ogUrl = (ogImages[0] as { url: string }).url;
    assert.ok(ogUrl.includes("type=pillar"), `expected type=pillar in ${ogUrl}`);
  });

  it("sets twitter card to summary_large_image with @site", () => {
    const meta = publicPageMetadata("Test", "Desc.", "/test");
    assert.equal(meta.twitter?.card, "summary_large_image");
    assert.equal(meta.twitter?.site, "@BlackOutTrade");
    const twitterImages = meta.twitter?.images;
    assert.ok(Array.isArray(twitterImages) && twitterImages.length === 1);
  });
});

describe("noindexPageMetadata", () => {
  it("sets title and robots noindex/nofollow only", () => {
    const meta = noindexPageMetadata("Desk · BlackOut");
    assert.equal(meta.title, "Desk · BlackOut");
    assert.deepEqual(meta.robots, { index: false, follow: false });
    assert.equal(meta.description, undefined);
  });

  it("sets self-referential canonical when path is provided", () => {
    const meta = noindexPageMetadata("SPX Slayer · BlackOut", "/dashboard");
    assert.equal(meta.alternates?.canonical, "https://blackouttrades.com/dashboard");
  });
});
