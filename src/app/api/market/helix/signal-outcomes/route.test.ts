import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routeSrc = readFileSync("src/app/api/market/helix/signal-outcomes/route.ts", "utf8");

// FIXED 2026-09-04: this HELIX (/flows) desk route was gated with the COMMUNITY-tier
// authorizeMarketDeskApi instead of authorizePremiumDeskApi, letting a $49 community subscriber
// pull $199 premium HELIX data directly via the API (CWE-863) — the exact vulnerability class
// authorizePremiumDeskApi's own doc comment describes ("HELIX flows... were wired to this
// community gate"), just a route that class-wide fix missed. See
// docs/audit/findings-staging/2026-09-04-helix-signal-outcomes-community-gate.md.
test("helix signal-outcomes is gated PREMIUM, not the weaker community-tier authorizeMarketDeskApi", () => {
  assert.match(routeSrc, /authorizePremiumDeskApi/, "must gate at premium — this is a HELIX /flows desk route");
  assert.doesNotMatch(routeSrc, /authorizeMarketDeskApi/, "must not use the community-tier gate");
});
