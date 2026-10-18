import { test } from "node:test";
import assert from "node:assert/strict";
import { publishedAtRef, resolveLegacyPlayOcc } from "./legacy-play-contract";

test("resolveLegacyPlayOcc: parses formatOptionsPlay output to OCC", () => {
  const occ = resolveLegacyPlayOcc("NVDA", "NVDA $500 CALL @ $3.33 — Aug 10");
  assert.ok(occ);
  assert.match(occ!, /^NVDA\d{6}C\d{8}$/);
});

test("resolveLegacyPlayOcc: returns null for unparseable strings", () => {
  assert.equal(resolveLegacyPlayOcc("NVDA", "NVDA — no options data available"), null);
  assert.equal(resolveLegacyPlayOcc("NVDA", null), null);
});

// Regression (Night Hawk Legacy aggressive-improvement mandate, 2026-09-13): resolveLegacyPlayOcc
// used to always anchor its bare "Mon DD" year-inference on real wall-clock now, which is wrong
// for a play resolved long after publish (the Legacy edition calendar strip reopens editions up
// to 14 trading days old — legacy-board-calendar.ts). Threading a reference date through fixes it.
test("resolveLegacyPlayOcc: an explicit reference date anchors year-inference instead of real now", () => {
  const reference = new Date("2026-08-24T12:00:00Z");
  const occ = resolveLegacyPlayOcc("NVDA", "NVDA $180 CALL @ $4.00 — Aug 28", reference);
  assert.ok(occ);
  assert.match(occ!, /^NVDA260828C/, "must encode 2026-08-28, not a year-rolled 2027-08-28");
});

// Regression (2026-10-18, live-found by the Ask Largo / 5-engine monitor cycle): publishedAtRef
// used to be a private, untested helper duplicated only inside adapters.ts. It is now shared and
// exported so every resolveLegacyPlayOcc caller anchors the same way — covered directly here.
test("publishedAtRef: parses a valid ISO published_at into a Date", () => {
  const ref = publishedAtRef("2026-08-24T12:00:00Z");
  assert.ok(ref instanceof Date);
  assert.equal(ref!.toISOString(), "2026-08-24T12:00:00.000Z");
});

test("publishedAtRef: returns undefined for null/empty/unparseable input (falls back to real now)", () => {
  assert.equal(publishedAtRef(null), undefined);
  assert.equal(publishedAtRef(undefined), undefined);
  assert.equal(publishedAtRef(""), undefined);
  assert.equal(publishedAtRef("not-a-date"), undefined);
});

// Regression (2026-10-18): fetchLegacyDiscordLiveRows (src/lib/db.ts) used to call
// resolveLegacyPlayOcc with NO reference date at all, so a pending play from an older edition
// whose bare "Mon DD" expiry label's month/day had already passed in the current calendar year
// rolled a full year forward — live-reproduced against GET /api/market/nighthawk/edition?date=
// 2026-10-14 (CLS/VST/AMD, "Oct 16" label, published 2026-10-13): resolved to OCCs dated
// 2027-10-16 instead of 2026-10-16. Anchoring on the edition's own published_at (via
// publishedAtRef, same pattern adapters.ts already used) fixes it.
test("resolveLegacyPlayOcc + publishedAtRef: an old edition's past-due label anchors on its own publish instant, not real now", () => {
  const editionPublishedAt = "2026-10-13T21:00:00Z"; // the edition's own publish instant
  const occ = resolveLegacyPlayOcc("CLS", "CLS $370 CALL @ $5.00 — Oct 16", publishedAtRef(editionPublishedAt));
  assert.ok(occ);
  assert.match(occ!, /^CLS261016C/, "must encode 2026-10-16, not a year-rolled 2027-10-16");
});

test("legacyOccForSnapshot adds O: prefix for Polygon snapshot fetch", () => {
  const { legacyOccForSnapshot } = require("./legacy-play-contract.ts") as typeof import("./legacy-play-contract");
  assert.equal(legacyOccForSnapshot("MRNA260904C00155000"), "O:MRNA260904C00155000");
  assert.equal(legacyOccForSnapshot("O:MRNA260904C00155000"), "O:MRNA260904C00155000");
});
