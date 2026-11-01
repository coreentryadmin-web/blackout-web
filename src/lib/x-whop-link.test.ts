import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { whopMarketingUrl, xPostFooterLine } from "./x-whop-link";
import { SITE } from "./site";

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "x-whop-link.ts"),
  "utf8",
);

describe("x-whop-link", () => {
  const prevUrl = process.env.X_DESK_POST_INCLUDE_URL;
  const prevTier = process.env.X_API_ACCESS_TIER;

  beforeEach(() => {
    delete process.env.X_DESK_POST_INCLUDE_URL;
    delete process.env.X_API_ACCESS_TIER;
  });

  afterEach(() => {
    if (prevUrl === undefined) delete process.env.X_DESK_POST_INCLUDE_URL;
    else process.env.X_DESK_POST_INCLUDE_URL = prevUrl;
    if (prevTier === undefined) delete process.env.X_API_ACCESS_TIER;
    else process.env.X_API_ACCESS_TIER = prevTier;
  });

  it("includes UTM params for attribution", () => {
    const url = whopMarketingUrl("desk_midday");
    assert.match(url, /utm_source=x/);
    assert.match(url, /utm_campaign=desk_midday/);
  });

  it("footer omits URL by default (PPU $0.015/post)", () => {
    const line = xPostFooterLine("desk_open");
    assert.match(line, /@BlackOutTrade/);
    assert.doesNotMatch(line, /blackouttrades\.com/);
    assert.match(line, /link in bio/i);
  });

  it("footer includes pricing URL when opted in", () => {
    const line = xPostFooterLine("desk_open", { includeUrl: true });
    assert.match(line, /blackouttrades\.com\/pricing/);
    assert.match(line, /utm_source=x/);
  });

  // Regression guard (findings-staging 2026-10-31): the footer's handle must be
  // DERIVED from SITE.social.x.handle, not a separate hardcoded literal — that is
  // exactly how it drifted apart from x-content.ts's X_ACCOUNT_USERNAME before
  // (#849 removed the only consumer of the shared constant; #915 added
  // SITE.social.x duplicating its value instead of importing it). This proves the
  // wiring, not just today's value: it would still pass if the handle ever
  // legitimately changes, because both sides would move together.
  it("footer handle tracks SITE.social.x.handle (single source of truth)", () => {
    const line = xPostFooterLine("desk_open");
    assert.match(line, new RegExp(`@${SITE.social.x.handle}`));
  });

  // The runtime assertion above would pass even on the old code (today's literal
  // happens to equal SITE.social.x.handle's value), so it alone can't prove the
  // DRIFT is fixed — only that today's values coincide. This checks the actual
  // wiring in source: no re-hardcoded "@BlackOutTrade" literal, built from SITE
  // instead, so the two genuinely can't diverge again.
  it("source has no re-hardcoded @BlackOutTrade literal — built from SITE instead", () => {
    assert.doesNotMatch(SRC, /["'`]@BlackOutTrade/);
    assert.match(SRC, /import \{ SITE \} from "@\/lib\/site";/);
    assert.match(SRC, /SITE\.social\.x\.handle/);
  });
});
