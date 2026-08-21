import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encodeSiteProperty, isoDate, reportRange, jwtClaim, brandedSplit } from "./gsc-query.mjs";

describe("gsc-query helpers", () => {
  it("encodes a DOMAIN property with %3A, not a literal colon (wrong form returns EMPTY, not an error)", () => {
    assert.equal(encodeSiteProperty("sc-domain:blackouttrades.com"), "sc-domain%3Ablackouttrades.com");
    // the raw colon is exactly the silent-empty trap this function exists to prevent
    assert.notEqual(encodeSiteProperty("sc-domain:blackouttrades.com"), "sc-domain:blackouttrades.com");
  });

  it("isoDate subtracts UTC days and yields YYYY-MM-DD", () => {
    const base = Date.UTC(2026, 7, 21); // 2026-08-21
    assert.equal(isoDate(base, 0), "2026-08-21");
    assert.equal(isoDate(base, 3), "2026-08-18");
    assert.equal(isoDate(base, 28), "2026-07-24");
  });

  it("reportRange ends on the 3-day lag boundary and spans `days`, never including partial recent data", () => {
    const base = Date.UTC(2026, 7, 21); // 2026-08-21
    const r = reportRange(base, 28, 3);
    assert.equal(r.endDate, "2026-08-18");   // 3 days back — GSC finalized
    assert.equal(r.startDate, "2026-07-22"); // 28-day window inclusive
  });

  it("jwtClaim carries the readonly scope and a 1h expiry", () => {
    const c = jwtClaim("svc@proj.iam.gserviceaccount.com", "https://oauth2.googleapis.com/token", 1000);
    assert.equal(c.scope, "https://www.googleapis.com/auth/webmasters.readonly");
    assert.equal(c.iss, "svc@proj.iam.gserviceaccount.com");
    assert.equal(c.exp - c.iat, 3600);
  });

  it("brandedSplit counts brand mentions AND site: audits as branded, everything else as non-branded", () => {
    const rows = [
      { keys: ["blackout trades"], clicks: 5, impressions: 50 },
      { keys: ["(blackouttrades.com) site:blackouttrades.com"], clicks: 0, impressions: 26 },
      { keys: ["dealer gamma"], clicks: 1, impressions: 10 },
      { keys: ["0dte spx strategy"], clicks: 0, impressions: 8 },
    ];
    const s = brandedSplit(rows);
    assert.equal(s.branded.queries, 2);
    assert.equal(s.branded.impressions, 76);
    assert.equal(s.nonBranded.queries, 2);
    assert.equal(s.nonBranded.clicks, 1);
    assert.equal(s.nonBranded.impressions, 18);
  });
});
