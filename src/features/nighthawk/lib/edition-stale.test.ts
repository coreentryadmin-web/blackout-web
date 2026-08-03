import assert from "node:assert/strict";
import test from "node:test";
import {
  publishedAtEtMeta,
  shouldRebuildStalePublishedEdition,
} from "./edition-stale";

test("publishedAtEtMeta parses UTC stamp to ET date + minutes", () => {
  const meta = publishedAtEtMeta("2026-07-28T10:49:14.000Z");
  assert.ok(meta);
  assert.equal(meta!.date, "2026-07-28");
  assert.equal(meta!.minutes, 6 * 60 + 49);
});

test("shouldRebuildStalePublishedEdition when published before today's window", () => {
  assert.equal(
    shouldRebuildStalePublishedEdition({
      publishedAtIso: "2026-07-28T10:49:14.000Z",
      todayYmd: "2026-07-29",
      windowStartMinutes: 17 * 60 + 30,
      inEditionWindow: true,
    }),
    true
  );
});

test("shouldRebuildStalePublishedEdition when same-day pre-window publish", () => {
  assert.equal(
    shouldRebuildStalePublishedEdition({
      publishedAtIso: "2026-08-03T10:49:14.000Z",
      todayYmd: "2026-08-03",
      windowStartMinutes: 17 * 60 + 30,
      inEditionWindow: true,
    }),
    true
  );
});

test("shouldRebuildStalePublishedEdition skips when published inside window", () => {
  assert.equal(
    shouldRebuildStalePublishedEdition({
      publishedAtIso: "2026-08-03T22:00:00.000Z",
      todayYmd: "2026-08-03",
      windowStartMinutes: 17 * 60 + 30,
      inEditionWindow: true,
    }),
    false
  );
});

test("shouldRebuildStalePublishedEdition skips outside edition window", () => {
  assert.equal(
    shouldRebuildStalePublishedEdition({
      publishedAtIso: "2026-08-03T10:49:14.000Z",
      todayYmd: "2026-08-03",
      windowStartMinutes: 17 * 60 + 30,
      inEditionWindow: false,
    }),
    false
  );
});

test("shouldRebuildStalePublishedEdition when published_at missing inside window", () => {
  assert.equal(
    shouldRebuildStalePublishedEdition({
      publishedAtIso: null,
      todayYmd: "2026-08-03",
      windowStartMinutes: 17 * 60 + 30,
      inEditionWindow: true,
    }),
    true
  );
});
