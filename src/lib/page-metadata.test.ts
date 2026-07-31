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
});

describe("noindexPageMetadata", () => {
  it("sets title and robots noindex/nofollow only", () => {
    const meta = noindexPageMetadata("Desk · BlackOut");
    assert.equal(meta.title, "Desk · BlackOut");
    assert.deepEqual(meta.robots, { index: false, follow: false });
    assert.equal(meta.description, undefined);
  });
});
