import assert from "node:assert/strict";
import test from "node:test";
import {
  inNighthawkEditionCatchupAlertWindow,
  isInEditionWindow,
  nighthawkStaleJobIdleMinutes,
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

// ICU renders ET midnight (00:00-00:59) as hour "24" under `hour12: false`, not "00" — the
// same quirk #4703 fixed in session.ts's etNowParts/isBeforeOrAtMarketCloseEt. Unnormalised,
// a published_at stamp genuinely in that window computes minutes=1440-1499 instead of 0-59,
// so shouldRebuildStalePublishedEdition's `meta.minutes < windowStart` comparison reads FALSE
// (looks "inside today's window, not stale") when it should read TRUE (published before
// tonight's 17:30 window even started) — an edition wrongly published at 00:xx ET would be
// judged fresh and skip the rebuild it actually needs.
test("publishedAtEtMeta computes 0-59 minutes for a midnight ET stamp (ICU hour24 quirk)", () => {
  // 2026-09-10T04:15:00Z = 2026-09-10T00:15:00 ET (EDT, UTC-4).
  const meta = publishedAtEtMeta("2026-09-10T04:15:00.000Z");
  assert.ok(meta);
  assert.equal(meta!.date, "2026-09-10");
  assert.equal(meta!.minutes, 15);
});

test("shouldRebuildStalePublishedEdition rebuilds a same-day midnight-ET publish", () => {
  assert.equal(
    shouldRebuildStalePublishedEdition({
      // Published 00:15 ET "today" — before tonight's 17:30 window, must rebuild.
      publishedAtIso: "2026-09-10T04:15:00.000Z",
      todayYmd: "2026-09-10",
      windowStartMinutes: 17 * 60 + 30,
      inEditionWindow: true,
    }),
    true
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

test("isInEditionWindow: weekday evening inside catch-up window", () => {
  const prevHour = process.env.NIGHTHAWK_EDITION_HOUR_ET;
  const prevMinute = process.env.NIGHTHAWK_EDITION_MINUTE_ET;
  const prevCatchup = process.env.NIGHTHAWK_EDITION_CATCHUP_MIN;
  delete process.env.NIGHTHAWK_EDITION_HOUR_ET;
  delete process.env.NIGHTHAWK_EDITION_MINUTE_ET;
  delete process.env.NIGHTHAWK_EDITION_CATCHUP_MIN;
  try {
    // Mon 2026-08-03 6:55 PM ET = 22:55 UTC
    assert.equal(isInEditionWindow(new Date("2026-08-03T22:55:00Z")), true);
    // Before 5:30 PM ET same day
    assert.equal(isInEditionWindow(new Date("2026-08-03T20:00:00Z")), false);
  } finally {
    if (prevHour === undefined) delete process.env.NIGHTHAWK_EDITION_HOUR_ET;
    else process.env.NIGHTHAWK_EDITION_HOUR_ET = prevHour;
    if (prevMinute === undefined) delete process.env.NIGHTHAWK_EDITION_MINUTE_ET;
    else process.env.NIGHTHAWK_EDITION_MINUTE_ET = prevMinute;
    if (prevCatchup === undefined) delete process.env.NIGHTHAWK_EDITION_CATCHUP_MIN;
    else process.env.NIGHTHAWK_EDITION_CATCHUP_MIN = prevCatchup;
  }
});

test("inNighthawkEditionCatchupAlertWindow pages one hour after edition start", () => {
  const prevHour = process.env.NIGHTHAWK_EDITION_HOUR_ET;
  const prevMinute = process.env.NIGHTHAWK_EDITION_MINUTE_ET;
  const prevCatchup = process.env.NIGHTHAWK_EDITION_CATCHUP_MIN;
  delete process.env.NIGHTHAWK_EDITION_HOUR_ET;
  delete process.env.NIGHTHAWK_EDITION_MINUTE_ET;
  delete process.env.NIGHTHAWK_EDITION_CATCHUP_MIN;
  try {
    // 6:55 PM ET — inside alert window (6:30–7:30)
    assert.equal(inNighthawkEditionCatchupAlertWindow(new Date("2026-08-03T22:55:00Z")), true);
    // 5:45 PM ET — still inside edition window but before alert grace
    assert.equal(inNighthawkEditionCatchupAlertWindow(new Date("2026-08-03T21:45:00Z")), false);
  } finally {
    if (prevHour === undefined) delete process.env.NIGHTHAWK_EDITION_HOUR_ET;
    else process.env.NIGHTHAWK_EDITION_HOUR_ET = prevHour;
    if (prevMinute === undefined) delete process.env.NIGHTHAWK_EDITION_MINUTE_ET;
    else process.env.NIGHTHAWK_EDITION_MINUTE_ET = prevMinute;
    if (prevCatchup === undefined) delete process.env.NIGHTHAWK_EDITION_CATCHUP_MIN;
    else process.env.NIGHTHAWK_EDITION_CATCHUP_MIN = prevCatchup;
  }
});

test("nighthawkStaleJobIdleMinutes is shorter during the edition window", () => {
  const prevEdition = process.env.NIGHTHAWK_STALE_JOB_MIN_EDITION;
  const prevHours = process.env.NIGHTHAWK_STALE_JOB_HOURS;
  delete process.env.NIGHTHAWK_STALE_JOB_MIN_EDITION;
  delete process.env.NIGHTHAWK_STALE_JOB_HOURS;
  try {
    assert.equal(nighthawkStaleJobIdleMinutes(new Date("2026-08-03T22:55:00Z")), 25);
    assert.equal(nighthawkStaleJobIdleMinutes(new Date("2026-08-03T14:00:00Z")), 240);
  } finally {
    if (prevEdition === undefined) delete process.env.NIGHTHAWK_STALE_JOB_MIN_EDITION;
    else process.env.NIGHTHAWK_STALE_JOB_MIN_EDITION = prevEdition;
    if (prevHours === undefined) delete process.env.NIGHTHAWK_STALE_JOB_HOURS;
    else process.env.NIGHTHAWK_STALE_JOB_HOURS = prevHours;
  }
});
