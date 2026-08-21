import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isBrandQuery, positionBand, classifyQueryOpportunities, pageOpportunities } from "./gsc-opportunities.mjs";

describe("gsc-opportunities classification", () => {
  it("treats brand mentions and site: audits as brand, not organic demand", () => {
    assert.equal(isBrandQuery("blackout trades"), true);
    assert.equal(isBrandQuery("(blackouttrades.com) site:blackouttrades.com"), true);
    assert.equal(isBrandQuery("what is gex"), false);
  });

  it("bands positions where the LEVER changes (CTR / on-page / authority)", () => {
    assert.equal(positionBand(2.7), "page1");     // won ranking → CTR lever
    assert.equal(positionBand(11.5), "striking"); // page 2 → on-page lever
    assert.equal(positionBand(32), "deep");       // page 3-5 → authority
    assert.equal(positionBand(67), "far");        // page 6+ → authority
  });

  it("routes queries to the bucket whose lever matches, excluding brand noise", () => {
    const rows = [
      { keys: ["p", "is 0dte gambling"], clicks: 0, impressions: 4, position: 11.5 }, // striking
      { keys: ["p", "what is gex"], clicks: 0, impressions: 6, position: 67 },         // deep/far demand
      { keys: ["p", "(blackouttrades.com) site:blackouttrades.com"], clicks: 0, impressions: 44, position: 4 }, // brand → excluded
      { keys: ["p", "learn options"], clicks: 0, impressions: 8, position: 6 },        // page1 zero-click → ctrGap
      { keys: ["p", "rare term"], clicks: 0, impressions: 1, position: 12 },           // below minImpressions → dropped
    ];
    const o = classifyQueryOpportunities(rows);
    assert.deepEqual(o.strikingDistance.map((r) => r.keys[1]), ["is 0dte gambling"]);
    assert.deepEqual(o.ctrGap.map((r) => r.keys[1]), ["learn options"]);
    assert.deepEqual(o.deepDemand.map((r) => r.keys[1]), ["what is gex"]);
    // the brand query must appear in NONE of the buckets
    const all = [...o.strikingDistance, ...o.ctrGap, ...o.deepDemand].map((r) => r.keys[1]);
    assert.ok(!all.some((q) => q.includes("site:")));
  });

  it("surfaces pages hosting striking-distance demand, sorted by impressions", () => {
    const pages = [
      { keys: ["/a"], clicks: 0, impressions: 101, position: 16.8 }, // striking, most demand
      { keys: ["/b"], clicks: 0, impressions: 50, position: 14.3 },  // striking
      { keys: ["/c"], clicks: 9, impressions: 269, position: 2.7 },  // page1 → not an on-page opportunity
      { keys: ["/d"], clicks: 0, impressions: 3, position: 12 },     // below minImpressions
    ];
    const p = pageOpportunities(pages);
    assert.deepEqual(p.map((r) => r.keys[0]), ["/a", "/b"]);
  });
});
