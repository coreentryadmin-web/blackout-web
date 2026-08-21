import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertCapturableUrl,
  CAPTURABLE_SURFACE_PATHS,
  checkCaptureUrl,
} from "@/lib/x-intel/capture-guard";

const HOST = "https://blackouttrades.com";

describe("checkCaptureUrl — denied routes", () => {
  for (const path of [
    "/admin",
    "/admin/users",
    "/admin/track-record",
    "/api/admin/analytics/x",
    "/api/cron/x-autopost",
    "/api/debug/state",
    "/api/webhooks/whop",
    "/sign-in",
    "/sign-up",
    "/account",
    "/account/billing",
    "/settings",
    "/billing",
    "/checkout",
  ]) {
    it(`refuses ${path}`, () => {
      assert.equal(checkCaptureUrl(`${HOST}${path}`).ok, false);
    });
  }
});

describe("checkCaptureUrl — allowed surfaces", () => {
  const cases: Array<[string, string]> = [
    ["/vector?ticker=SPX", "vector"],
    ["/flows", "helix"],
    ["/heatmap", "thermal"],
    ["/nighthawk", "nighthawk"],
    ["/terminal", "largo"],
    ["/meridian", "meridian"],
    ["/dashboard", "spx_slayer"],
    ["/track-record", "track_record"],
  ];
  for (const [path, surface] of cases) {
    it(`allows ${path} and names the surface`, () => {
      const v = checkCaptureUrl(`${HOST}${path}`);
      assert.equal(v.ok, true);
      assert.equal(v.ok && v.surface, surface);
    });
  }
});

describe("checkCaptureUrl — fails closed", () => {
  it("refuses a route that is on neither list", () => {
    // The whole point of the allowlist: an unknown route — a new admin page, an unexpected
    // redirect, anything added after this file was written — must fail CLOSED.
    const v = checkCaptureUrl(`${HOST}/some-new-internal-page`);
    assert.equal(v.ok, false);
    assert.match(v.ok ? "" : v.reason, /not an allowlisted BLACKOUT surface/);
  });

  it("refuses the marketing home page — allowed to exist, not allowed to be evidence", () => {
    assert.equal(checkCaptureUrl(`${HOST}/`).ok, false);
  });

  it("refuses a foreign host even on an allowlisted path", () => {
    const v = checkCaptureUrl("https://evil.example.com/vector");
    assert.equal(v.ok, false);
    assert.match(v.ok ? "" : v.reason, /non-BLACKOUT host/);
  });

  it("refuses about:blank — what Playwright shows before a nav and after a crash", () => {
    assert.equal(checkCaptureUrl("about:blank").ok, false);
  });

  it("refuses an empty, missing or non-string URL", () => {
    assert.equal(checkCaptureUrl("").ok, false);
    assert.equal(checkCaptureUrl(undefined).ok, false);
    assert.equal(checkCaptureUrl(null).ok, false);
    assert.equal(checkCaptureUrl(42).ok, false);
  });

  it("refuses a relative path", () => {
    assert.equal(checkCaptureUrl("/vector").ok, false);
  });

  it("refuses http", () => {
    assert.equal(checkCaptureUrl("http://blackouttrades.com/vector").ok, false);
  });
});

describe("checkCaptureUrl — deny beats allow", () => {
  it("refuses a denied path even though the allowlist would otherwise be consulted", () => {
    // Ordering matters: deny runs first, so a route reachable by both rules can only resolve to no.
    const v = checkCaptureUrl(`${HOST}/admin/vector`);
    assert.equal(v.ok, false);
    assert.match(v.ok ? "" : v.reason, /admin console/);
  });
});

describe("checkCaptureUrl — internal-state query flags", () => {
  it("refuses ?sim=1 — the admin 0DTE SIMULATOR board", () => {
    // A simulated session looks exactly like a real one. Publishing one as live market
    // intelligence is a fabricated claim with a real screenshot attached — worse than a leak.
    const v = checkCaptureUrl(`${HOST}/nighthawk?sim=1`);
    assert.equal(v.ok, false);
    assert.match(v.ok ? "" : v.reason, /simulated/);
  });

  for (const q of ["debug=1", "__debug=1", "trace=1", "impersonate=someone"]) {
    it(`refuses ?${q}`, () => {
      assert.equal(checkCaptureUrl(`${HOST}/vector?ticker=SPX&${q}`).ok, false);
    });
  }

  it("still allows ordinary desk query params", () => {
    assert.equal(checkCaptureUrl(`${HOST}/vector?ticker=NVDA&tf=15`).ok, true);
  });
});

describe("assertCapturableUrl", () => {
  it("throws on refusal so the check cannot be skipped by ignoring a return value", () => {
    assert.throws(
      () => assertCapturableUrl(`${HOST}/admin`, "thermal matrix"),
      /capture-guard.*thermal matrix.*admin console/s,
    );
  });

  it("returns the surface name on success", () => {
    assert.equal(assertCapturableUrl(`${HOST}/flows`), "helix");
  });
});

describe("the surface inventory", () => {
  it("covers all seven intelligence surfaces the lane publishes", () => {
    const surfaces = new Set(CAPTURABLE_SURFACE_PATHS.map((s) => s.surface));
    for (const s of [
      "vector",
      "helix",
      "thermal",
      "nighthawk",
      "largo",
      "meridian",
      "spx_slayer",
    ]) {
      assert.ok(surfaces.has(s), `no capturable route for ${s}`);
    }
  });
});
