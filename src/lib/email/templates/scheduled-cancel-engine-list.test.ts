import assert from "node:assert/strict";
import { test } from "node:test";
import { scheduledCancelEmail } from "./scheduled-cancel.ts";

// Regression for a live bug (found 2026-10-15): scheduledCancelEmail's body paragraph
// hardcodes the list of engines that "stay live" through the grace period — "SPX Slayer,
// Thermal, HELIX, Night Hawk, Largo AI, Vector" — but never named Meridian, the 7th live
// product (shipped 2026-10-11, commit 5103e7f8d). Same bug class as
// welcome-premium-downgrade-product-count.test.ts's fix in welcome-premium.ts/downgrade.ts,
// just in a sibling template that test didn't cover: a member scheduling a cancellation
// would be told "every engine you're paying for stays live" while the email itself omitted
// one of the seven engines they're actually entitled to.
test("scheduledCancelEmail: engine list names all seven live products, including Meridian", () => {
  const { html } = scheduledCancelEmail({ firstName: "Alex", accessUntil: new Date("2026-11-01") });
  for (const engine of ["SPX Slayer", "Thermal", "HELIX", "Night Hawk", "Largo AI", "Vector", "Meridian"]) {
    assert.match(html, new RegExp(engine), `expected engine list to include ${engine}`);
  }
});
