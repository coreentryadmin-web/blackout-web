import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { selectPostType, isPostWindow } from "./x-content-schedule";

describe("2-hour post cadence", () => {
  it("isPostWindow true on even ET hours 8–20", () => {
    assert.equal(isPostWindow(new Date("2026-07-21T12:00:00-04:00")), true);
    assert.equal(isPostWindow(new Date("2026-07-21T13:00:00-04:00")), false);
    assert.equal(isPostWindow(new Date("2026-07-21T07:00:00-04:00")), false);
  });

  it("selectPostType rotates desk showcase themes every 2h", () => {
    const t8 = selectPostType(new Date("2026-07-21T08:30:00-04:00"));
    const t10 = selectPostType(new Date("2026-07-21T10:30:00-04:00"));
    assert.ok(t8);
    assert.ok(t10);
    assert.notEqual(t8, t10);
  });
});
