import assert from "node:assert/strict";
import { test } from "node:test";
import { SITE } from "./site.ts";
import { LINKS } from "./x-intel/cta.ts";

// Regression guard for a real live bug (2026-08-28): SITE.social.discord.url and
// x-intel/cta.ts's own LINKS.discord carried two DIFFERENT Discord invite codes with no test
// tying them together. One (5zSt7G34dw) had gone dead — verified live against Discord's public
// invite-resolve API, which returned "Unknown Invite" (code 10006) — while every site surface
// (marketing footer, community rail, contact page, welcome-sequence email) kept serving that
// dead link to every visitor, free and paid alike, because nothing ever compared the two
// constants. A comment in cta.ts already flagged the divergence in 2026-08-21 but nothing
// enforced reconciling it. This test makes a future edit to either constant fail loudly instead
// of silently reintroducing the split.
test("the Discord invite is a single source of truth — site config and X-posting CTAs must agree", () => {
  assert.equal(
    SITE.social.discord.url,
    LINKS.discord,
    "SITE.social.discord.url (src/lib/site.ts) and LINKS.discord (src/lib/x-intel/cta.ts) must be the same invite — a silent split is how a dead link shipped everywhere but the X-posting module"
  );
});

// Regression for a live content bug (2026-10-11): SITE.description — the root <meta
// name="description">, the OrganizationJsonLd/WebSiteJsonLd/SoftwareApplicationJsonLd
// description, the RSS feed description, AND llms.txt's summary line all share this ONE string
// (see JsonLd.tsx, layout.tsx, feed.xml/route.ts, llms.txt/route.ts) — so a stale description
// here is stale on every one of those surfaces at once. The pre-fix text named only 4 of the
// platform's capability areas (flow, dealer positioning, SPX structure, Night Hawk 0DTE) and
// never mentioned catalyst intelligence (Meridian) or the AI chat layer (Largo) at all. Checks
// capability COVERAGE via keywords rather than product names, deliberately: a description that
// names specific products goes stale at the next product launch (the exact bug class already
// found in email templates, the FAQ, and the Learn guide this session) — this asserts the
// platform's real capability breadth is represented, regardless of how products are branded.
test("SITE.description covers flow/dealer-positioning, SPX/0DTE, catalyst intelligence, and AI chat", () => {
  const d = SITE.description.toLowerCase();
  assert.match(d, /flow/);
  assert.match(d, /dealer positioning/);
  assert.match(d, /spx/);
  assert.match(d, /0dte/);
  assert.match(d, /catalyst/);
  assert.match(d, /ai/);
});

// Google truncates SERP snippets around ~155-160 chars — the same ceiling
// marketing-meta-description-length.test.ts enforces for standalone marketing pages, which does
// NOT cover SITE.description since it's set directly on layout.tsx's metadata rather than
// through publicPageMetadata().
test("SITE.description stays within the ~160-char SERP truncation ceiling", () => {
  assert.ok(
    SITE.description.length <= 160,
    `SITE.description is ${SITE.description.length} chars, over the 160-char SERP ceiling`
  );
});
