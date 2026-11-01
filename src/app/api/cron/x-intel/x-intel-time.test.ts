import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { etDateString, etTimeString, cycleName, attachmentImagePath } from "./x-intel-time";

describe("x-intel-time", () => {
  it("zero-pads month/day in etDateString", () => {
    assert.equal(etDateString(new Date(2026, 0, 5, 9, 0, 0)), "2026-01-05");
    assert.equal(etDateString(new Date(2026, 11, 31, 23, 59, 0)), "2026-12-31");
  });

  it("zero-pads hour/minute/second in etTimeString", () => {
    assert.equal(etTimeString(new Date(2026, 5, 1, 9, 5, 3)), "09:05:03 ET");
    assert.equal(etTimeString(new Date(2026, 5, 1, 0, 0, 0)), "00:00:00 ET");
  });

  it("cycleName zero-pads the hour segment", () => {
    assert.equal(cycleName(new Date(2026, 5, 1, 9, 30, 0), "desk_flow"), "2026-06-01T09:desk_flow");
    assert.equal(cycleName(new Date(2026, 5, 1, 0, 30, 0), "desk_open"), "2026-06-01T00:desk_open");
  });

  // ROOT-CAUSE REGRESSION: cycleName and attachmentImagePath are the two fields the x-intel
  // cron persists on ONE queue row (route.ts's `cycle_key` and `attachments[].image_url`). The
  // live bug this file replaces split their date/hour derivation across several independent
  // `nowET()` reads (one per call site), so a slow request straddling an hour boundary could
  // persist the two fields describing different hours, AND even with the clock held still the
  // image path used an unpadded hour ("9") against cycleName's padded one ("09"). Both helpers
  // here take the SAME `et` with no internal clock read, so for any `et` the two must always
  // embed the identical date+hour bucket.
  it("cycleName and attachmentImagePath always embed the same date+hour bucket for one et", () => {
    const samples: Array<[Date, string]> = [
      [new Date(2026, 5, 1, 9, 59, 59, 999), "desk_flow"],
      [new Date(2026, 5, 1, 0, 0, 0, 1), "desk_open"],
      [new Date(2026, 11, 31, 23, 59, 59), "desk_evening"],
      [new Date(2026, 0, 1, 10, 0, 0), "desk_ai"],
    ];
    for (const [et, postType] of samples) {
      const key = cycleName(et, postType);
      const path = attachmentImagePath(et, postType);
      const keyBucket = key.split(":")[0]; // "<date>T<hour>"
      const pathBucket = path.replace(`/x-intel/`, "").split("/")[0]; // "<date>T<hour>"
      assert.equal(
        pathBucket,
        keyBucket,
        `attachmentImagePath bucket "${pathBucket}" must match cycleName bucket "${keyBucket}" for et=${et.toISOString()}`,
      );
    }
  });

  it("neither helper reads the live clock — same et in, byte-identical out, regardless of call order/count", () => {
    const et = new Date(2026, 2, 8, 1, 30, 0); // DST-transition day, pre-2am — a realistic edge instant
    const firstKey = cycleName(et, "desk_open");
    const firstPath = attachmentImagePath(et, "desk_open");
    // Simulate the real request shape: several more calls happen "later" during the same
    // handler (skip-row build, draft build, attachment capture) — all must reproduce exactly,
    // because nothing here ever calls `new Date()` internally.
    for (let i = 0; i < 5; i++) {
      assert.equal(cycleName(et, "desk_open"), firstKey);
      assert.equal(attachmentImagePath(et, "desk_open"), firstPath);
    }
  });
});
