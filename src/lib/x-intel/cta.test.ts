import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildCta,
  CTA_CHAR_LIMIT,
  CASHTAG_LIMIT,
  cashtags,
  xWeightedLength,
  previewAllCtas,
  selectCtaVariant,
} from "@/lib/x-intel/cta";
import {
  X_INTEL_CTA_VARIANTS,
  type XIntelCtaVariant,
} from "@/lib/x-intel/queue-types";

const CYCLE = "2026-08-21T11";

describe("selectCtaVariant — deterministic rotation", () => {
  it("is deterministic on a cold start, so a replay picks the same thing", () => {
    assert.equal(selectCtaVariant([]), selectCtaVariant([]));
  });

  it("never repeats the variant just used", () => {
    for (const v of X_INTEL_CTA_VARIANTS) {
      assert.notEqual(selectCtaVariant([v]), v, `repeated ${v}`);
    }
  });

  it("never puts two paid asks back to back", () => {
    for (const paid of ["PRICING", "WHOP_OFFER"] as const) {
      const next = selectCtaVariant([paid]);
      assert.ok(
        next !== "PRICING" && next !== "WHOP_OFFER",
        `${paid} was followed by another paid ask (${next})`,
      );
    }
  });

  it("covers every variant within one full cycle — no variant is starved", () => {
    const history: XIntelCtaVariant[] = [];
    const seen = new Set<XIntelCtaVariant>();
    // Two full lengths is ample headroom: the paid-adjacency guard can defer a variant by at most
    // one slot, so starvation would show up well inside this window.
    for (let i = 0; i < X_INTEL_CTA_VARIANTS.length * 2; i += 1) {
      const next = selectCtaVariant(history);
      seen.add(next);
      history.unshift(next);
    }
    assert.equal(seen.size, X_INTEL_CTA_VARIANTS.length);
  });

  it("prefers a never-used variant over one already in the history", () => {
    // SOFT and DISCORD used; the next pick must be one of the untouched three.
    const next = selectCtaVariant(["DISCORD", "SOFT"]);
    assert.ok(!["SOFT", "DISCORD"].includes(next), `picked a used variant: ${next}`);
  });

  it("does not ask for money on more than half the rotation", () => {
    const history: XIntelCtaVariant[] = [];
    let paid = 0;
    const N = 20;
    for (let i = 0; i < N; i += 1) {
      const next = selectCtaVariant(history);
      if (next === "PRICING" || next === "WHOP_OFFER") paid += 1;
      history.unshift(next);
    }
    // An account that asks for a sale on every post stops being one traders open.
    assert.ok(paid <= N / 2, `${paid}/${N} posts carried a paid ask`);
  });
});

describe("buildCta", () => {
  it("places the CTA in the post body — operator decision, replacing the sign-off", () => {
    // Originally built as a reply on reach grounds; the operator asked for a body CTA twice, which
    // settles it. The field stays so the choice is visible and measurable, not so it can drift.
    for (const cta of previewAllCtas(CYCLE)) {
      assert.equal(cta.placement, "body");
    }
  });

  it("fits its attention budget, measured the way X measures", () => {
    // Raw .length reported 586 for a block X sees as roughly half that, because each tagged link
    // is ~120 characters of mostly UTM and X counts every URL as 23. Budgeting against the raw
    // number would mean stripping the tracking the learning loop runs on to fix a limit that was
    // never being exceeded.
    for (const cta of previewAllCtas(CYCLE)) {
      const n = xWeightedLength(cta.text);
      assert.ok(n <= CTA_CHAR_LIMIT, `${cta.variant} is ${n} weighted chars`);
    }
  });

  it("counts a URL as 23 regardless of how long it really is", () => {
    const short = xWeightedLength("a https://x.com b");
    const long = xWeightedLength(`a https://x.com/${"q".repeat(200)} b`);
    assert.equal(short, long);
  });

  it("tags every link with the cycle key so a click traces to its package", () => {
    for (const cta of previewAllCtas(CYCLE)) {
      if (!cta.url) continue;
      const u = new URL(cta.url);
      assert.equal(u.searchParams.get("utm_source"), "x");
      assert.equal(u.searchParams.get("utm_campaign"), "x-intel");
      assert.equal(u.searchParams.get("utm_content"), `${CYCLE}:${cta.variant}`);
    }
  });

  it("puts the URL it reports in the text it reports", () => {
    // A url field that disagrees with the copy would make the tracked link a fiction.
    for (const cta of previewAllCtas(CYCLE)) {
      if (cta.url) assert.ok(cta.text.includes(cta.url), `${cta.variant} text omits its url`);
    }
  });

  it("every variant now carries a link — the CTA replaces the sign-off, so it must lead somewhere", () => {
    // The operator asked for a link on every post. SOFT was previously the no-link variant; it now
    // carries the site, so the rotation varies the WORDING and the DESTINATION rather than whether
    // there is one at all.
    for (const cta of previewAllCtas(CYCLE)) {
      assert.ok(cta.url, `${cta.variant} has no link`);
      assert.match(cta.text, /https?:\/\//, `${cta.variant} text carries no URL`);
    }
  });

  it("puts every destination in every post, not one per post", () => {
    // The operator's call: the links are how a lead arrives, so a post missing them cannot convert.
    // What rotates is the CLAIM above them, not whether the ask is present.
    for (const cta of previewAllCtas(CYCLE)) {
      for (const host of ["discord.gg", "whop.com", "blackouttrades.com"]) {
        assert.ok(cta.text.includes(host), `${cta.variant} omits ${host}`);
      }
    }
  });

  it("carries no hashtags and no @tags other than our own handle", () => {
    // x-post-guard.ts rejects both patterns on the timeline; the reply should not introduce them.
    for (const cta of previewAllCtas(CYCLE)) {
      assert.ok(!/#\w/.test(cta.text), `${cta.variant} contains a hashtag`);
      const tags = cta.text.match(/@\w+/g) ?? [];
      for (const t of tags) assert.equal(t, "@BlackOutTrade");
    }
  });

  it("records the variant it chose so the funnel can attribute it", () => {
    const cta = buildCta(CYCLE, ["SOFT"]);
    assert.ok(X_INTEL_CTA_VARIANTS.includes(cta.variant));
    assert.notEqual(cta.variant, "SOFT");
  });

  it("states both desk prices and the promo code on every post", () => {
    for (const c of previewAllCtas(CYCLE)) {
      assert.ok(c.text.includes("$199/mo"), `${c.variant} omits the full-desk price`);
      assert.ok(c.text.includes("$49/mo"), `${c.variant} omits the SPX price`);
      assert.ok(c.text.includes("BLACK50"), `${c.variant} omits the promo code`);
    }
  });

  it("leads every post with a claim, and never the same one twice running", () => {
    const lines = previewAllCtas(CYCLE).map((c) => c.text.split("\n")[0]!);
    assert.equal(new Set(lines).size, lines.length, "two variants share a claim line");
    for (const l of lines) assert.ok(l.length > 40, `claim too thin to be specific: "${l}"`);
  });
});

describe("cashtags — the one distribution channel a cold account still has", () => {
  it("prefixes and upper-cases, and drops duplicates keeping the lead ticker first", () => {
    assert.equal(cashtags(["bac", "NVDA", "bac"]), "$BAC $NVDA");
  });

  it("caps the list — a wall of tickers reads as spam to a reader and to the ranker", () => {
    assert.equal(cashtags(["A", "B", "C", "D", "E", "F"]).split(" ").length, CASHTAG_LIMIT);
  });

  it("refuses things that are not symbols rather than emitting a bare $", () => {
    assert.equal(cashtags(["", "  ", "TOOLONGSYM"]), "");
  });

  it("accepts an already-prefixed ticker without doubling the $", () => {
    assert.equal(cashtags(["$SPY"]), "$SPY");
  });
});
