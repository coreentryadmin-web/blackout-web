import assert from "node:assert/strict";
import test from "node:test";
import { storeAge, timeAgoIso } from "./admin-store-age";

test("storeAge: future timestamp beyond tolerance reads as clock skew, not just now", () => {
  const now = Date.now();
  const result = storeAge(now + 60_000);
  assert.equal(result.label, "clock skew");
  assert.equal(result.ok, false);
});

test("storeAge: small future skew within tolerance still reads as just now", () => {
  const now = Date.now();
  const result = storeAge(now + 2_000);
  assert.equal(result.label, "just now");
  assert.equal(result.ok, true);
});

test("storeAge: null/ zero returns No data", () => {
  assert.deepEqual(storeAge(null), { label: "No data", ok: null });
  assert.deepEqual(storeAge(0), { label: "No data", ok: null });
});

test("timeAgoIso: future timestamp beyond tolerance reads as clock skew", () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  assert.equal(timeAgoIso(future), "clock skew");
});

test("timeAgoIso: null returns em dash", () => {
  assert.equal(timeAgoIso(null), "—");
});
