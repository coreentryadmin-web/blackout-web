import test from "node:test";
import assert from "node:assert/strict";
import {
  isNighthawkContextEditionFresh,
  NIGHTHAWK_CONTEXT_MAX_AGE_MS,
} from "./nighthawk-context-freshness";

const NOW = Date.parse("2026-09-04T14:00:00.000Z");

test("fresh edition within 24h is accepted", () => {
  const published = new Date(NOW - 2 * 60 * 60 * 1000).toISOString();
  assert.equal(isNighthawkContextEditionFresh(published, NOW), true);
});

test("edition older than 24h is rejected", () => {
  const published = new Date(NOW - NIGHTHAWK_CONTEXT_MAX_AGE_MS - 1).toISOString();
  assert.equal(isNighthawkContextEditionFresh(published, NOW), false);
});

test("future-dated edition is rejected (clock skew)", () => {
  const published = new Date(NOW + 5 * 60 * 1000).toISOString();
  assert.equal(isNighthawkContextEditionFresh(published, NOW), false);
});

test("unparseable published_at is rejected", () => {
  assert.equal(isNighthawkContextEditionFresh("not-a-date", NOW), false);
});
