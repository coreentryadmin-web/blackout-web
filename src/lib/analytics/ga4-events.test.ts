import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DESK_PATH_PREFIXES, isDeskPath, learnArticleSlugFromPath } from "./ga4-events.ts";
import { DESK_NAV_LINKS } from "@/lib/desk-nav-links.ts";

describe("isDeskPath", () => {
  it("matches product desk routes", () => {
    assert.equal(isDeskPath("/dashboard"), true);
    assert.equal(isDeskPath("/flows"), true);
    assert.equal(isDeskPath("/pricing"), false);
  });

  it("matches Meridian — BUG: DESK_PATH_PREFIXES was missing the 7th desk, so the first authenticated Meridian visit of a session never fired `desk_opened`, permanently under-counting that desk in the GA4 funnel vs the other six", () => {
    assert.equal(isDeskPath("/meridian"), true);
    assert.equal(isDeskPath("/meridian/some-event-id"), true);
  });

  it("covers every desk in the canonical DESK_NAV_LINKS list (Nav/DeskSidebar's single source of truth), so a future 8th desk can't repeat this same drift", () => {
    for (const { href } of DESK_NAV_LINKS) {
      assert.ok(
        DESK_PATH_PREFIXES.includes(href as (typeof DESK_PATH_PREFIXES)[number]),
        `DESK_PATH_PREFIXES is missing desk route ${href} — desk_opened will never fire for it`
      );
    }
  });
});

describe("learnArticleSlugFromPath", () => {
  it("extracts article slug", () => {
    assert.equal(learnArticleSlugFromPath("/learn/what-is-gex"), "what-is-gex");
    assert.equal(learnArticleSlugFromPath("/learn"), null);
    assert.equal(learnArticleSlugFromPath("/learn/glossary"), null);
  });
});
