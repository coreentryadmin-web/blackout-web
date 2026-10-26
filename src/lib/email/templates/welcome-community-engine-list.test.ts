import assert from "node:assert/strict";
import { test } from "node:test";
import { welcomeCommunityEmail } from "./welcome-community.ts";

// Regression for a live bug (round 106, same class as
// scheduled-cancel-engine-list.test.ts / welcome-premium-downgrade-product-count.test.ts):
// welcomeCommunityEmail's upsell paragraph ("if you ever want the wider desk...") hardcodes
// the list of the other six live products a community (SPX Slayer) member would gain by
// upgrading to Premium — "Thermal, HELIX, Night Hawk, Largo AI, Vector" — but never named
// Meridian, the 7th live product (shipped 2026-10-11, commit 5103e7f8d). A community member
// reading this email would be undersold on the actual upgrade: told five engines wait on the
// other side of Premium when there are six.
test("welcomeCommunityEmail: Premium upsell paragraph names all six other live products, including Meridian", () => {
  const { html } = welcomeCommunityEmail({ firstName: "Alex" });
  for (const engine of ["Thermal", "HELIX", "Night Hawk", "Largo AI", "Vector", "Meridian"]) {
    assert.match(html, new RegExp(engine), `expected Premium upsell list to include ${engine}`);
  }
});
