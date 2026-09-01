import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { looksLikeAnalystAction, meridianFeedText, meridianFeedTextOrNull } from "./meridian-feed-text";

const root = process.cwd();
const CATALYST = readFileSync(join(root, "src/lib/meridian/meridian-catalyst-enrich.ts"), "utf8");
// `shapeCatalystBriefs` itself lives here now (server-only import moved it out for testability,
// 2026-08-25) — CATALYST above still covers shapeAnalyst/loadPriceTargetRows.
const CATALYST_CORE = readFileSync(join(root, "src/lib/meridian/meridian-catalyst-enrich-core.ts"), "utf8");
const EARNINGS = readFileSync(join(root, "src/lib/meridian/meridian-earnings-enrich.ts"), "utf8");

/**
 * MEASURED ON PROD 2026-08-21. `/api/market/meridian/event?id=earnings:BEKE:2026-08-21` served
 * NINE strings carrying raw HTML entities, across six fields, and the desk rendered them literally.
 * These are the exact strings, copied from that response.
 */
const LIVE = {
  amp: "Stock Market: Will S&amp;P 500 Open Up or Down Today?",
  apos: "KE Holdings Gears Up For Q2 Print; Here Are The Recent Forecast Changes From Wall Street&#39;s Most Accurate Analysts",
  mixed: "Dow Tumbles Over 700 Points As Yields Rise Again: Investor Sentiment Weakens, Fear &amp; Greed Index Moves To ‘Neutral’ Zone",
};

describe("the exact strings the desk printed raw", () => {
  test("&amp; renders as an ampersand, not as five characters", () => {
    assert.equal(meridianFeedText(LIVE.amp), "Stock Market: Will S&P 500 Open Up or Down Today?");
  });

  test("&#39; renders as an apostrophe", () => {
    assert.match(meridianFeedText(LIVE.apos), /Wall Street's Most Accurate Analysts$/);
    assert.equal(meridianFeedText(LIVE.apos).includes("&#39;"), false);
  });

  test("a headline already carrying real punctuation is not damaged", () => {
    // The smart quotes around 'Neutral' are genuine characters, not entities — they must survive.
    const out = meridianFeedText(LIVE.mixed);
    assert.match(out, /Fear & Greed Index/);
    assert.match(out, /‘Neutral’ Zone$/);
  });

  test("no live string still contains an entity after decoding", () => {
    for (const [name, raw] of Object.entries(LIVE)) {
      assert.equal(
        /&(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[0-9a-f]+);/i.test(meridianFeedText(raw)),
        false,
        `${name} still encoded`
      );
    }
  });
});

describe("the boundary is total — a panel must never be handed a throw or an [object Object]", () => {
  test("nullish and non-string inputs collapse to empty, never to a stringified type", () => {
    for (const bad of [null, undefined, {}, [], 42, true]) {
      const out = meridianFeedText(bad);
      assert.equal(out.includes("[object"), false, `input ${String(bad)}`);
      assert.equal(typeof out, "string");
    }
    assert.equal(meridianFeedText(null), "");
    assert.equal(meridianFeedText(undefined), "");
  });

  test("absence stays absence — an empty headline is null, not an empty string to render", () => {
    assert.equal(meridianFeedTextOrNull(null), null);
    assert.equal(meridianFeedTextOrNull("   "), null);
    assert.equal(meridianFeedTextOrNull("&nbsp;"), null, "a headline of only a space is not a headline");
    assert.equal(meridianFeedTextOrNull(LIVE.amp), meridianFeedText(LIVE.amp));
  });

  test("markup cannot survive into a headline", () => {
    // A feed title is untrusted. Decoding &lt;b&gt; must not hand a panel live angle brackets.
    assert.equal(meridianFeedText("Beat &lt;b&gt;big&lt;/b&gt;"), "Beat bbig/b");
    assert.equal(meridianFeedText("a\nb   c"), "a b c", "newlines and runs collapse");
  });

  test("double-encoding decodes exactly one level, so &amp;amp; does not become an ampersand", () => {
    // Over-decoding is its own defect: it would turn a literal '&amp;' in a headline into '&'.
    assert.equal(meridianFeedText("AT&amp;amp;T"), "AT&amp;T");
  });
});

describe("the enrichment shapers are wired to it — and decode BEFORE they parse", () => {
  test("every shaped free-text field goes through the boundary", () => {
    assert.match(EARNINGS, /title: meridianFeedText\(r\.title\)/, "headline titles");
    assert.match(CATALYST, /const title = meridianFeedText\(r\.title\)/, "analyst-note titles");
    assert.match(CATALYST, /summary: meridianFeedText\(/, "price-target summaries");
    assert.match(CATALYST_CORE, /title: meridianFeedText\(c\.title\)/, "catalyst-brief titles");
  });

  test("no shaper still trims the raw string instead of decoding it", () => {
    assert.equal(CATALYST.includes('String(r.title ?? "").trim()'), false);
    assert.equal(EARNINGS.includes("String(r.title).trim()"), false);
  });

  test("shapeAnalyst decodes before it slices out the firm — order is the correctness claim", () => {
    // `firm` is `title.match(/^([^:]+):/)`. Parse an encoded title and the entity lands INSIDE a
    // derived value the desk displays as a firm name.
    const decodeAt = CATALYST.indexOf("const title = meridianFeedText(r.title)");
    const firmAt = CATALYST.indexOf("title.match(/^([^:]+):/)");
    assert.notEqual(decodeAt, -1);
    assert.notEqual(firmAt, -1);
    assert.ok(decodeAt < firmAt, "the decode must precede the firm parse");
  });

  test("the price-target parser reads decoded text — its output is a NUMBER shown to a member", () => {
    const decodeAt = CATALYST.indexOf("const text = meridianFeedText(");
    const parseAt = CATALYST.indexOf("parsePriceTargetFromText(text)");
    assert.notEqual(decodeAt, -1);
    assert.notEqual(parseAt, -1);
    assert.ok(decodeAt < parseAt, "the decode must precede the price-target parse");
  });

  test("Meridian reuses Largo's decoder rather than carrying a second entity table", () => {
    // Two tables drift, and then the same headline reads differently on two surfaces — which is
    // exactly the bug being fixed here, in reverse.
    const MOD = readFileSync(join(root, "src/lib/meridian/meridian-feed-text.ts"), "utf8");
    assert.match(MOD, /from "@\/lib\/largo\/sanitize-feed-text"/);
    assert.equal(/NAMED_ENTITIES|String\.fromCodePoint/.test(MOD), false, "no second decoder here");
  });
});

describe("looksLikeAnalystAction", () => {
  test("a price-target/rating headline reads as an analyst action", () => {
    assert.equal(
      looksLikeAnalystAction("JP Morgan Maintains Overweight on Dick's Sporting Goods, Lowers Price Target to $245"),
      true
    );
    assert.equal(
      looksLikeAnalystAction("Wells Fargo Upgrades Dick's Sporting Goods to Overweight, Raises Price Target to $240"),
      true
    );
  });

  // The trap this function exists to avoid: a company genuinely "raises guidance" using the same
  // bare verb an analyst note uses for "raises price target" -- matching on the verb alone would
  // misclassify real corporate guidance as an analyst note.
  test("a real corporate-guidance headline is NOT read as an analyst action", () => {
    assert.equal(looksLikeAnalystAction("Dick's Sporting Goods Raises Full-Year Revenue Guidance"), false);
    assert.equal(looksLikeAnalystAction("Company Lowers Full-Year Outlook Amid Demand Softness"), false);
  });
});
