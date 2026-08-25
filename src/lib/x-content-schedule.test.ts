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

  it("DST: post window works during EST (Nov-Mar)", () => {
    // Use the nowET() trick: create UTC date, convert to ET string, parse back
    // This produces a Date whose getHours() returns the ET hour (on UTC server)
    const mkET = (hour: number, minute = 0) => {
      // During EST: ET hour = UTC hour - 5, so UTC hour = ET hour + 5
      const utcHour = hour + 5;
      const utcDate = new Date(Date.UTC(2026, 0, 15, utcHour, minute, 0));
      const etString = utcDate.toLocaleString("en-US", { timeZone: "America/New_York" });
      return new Date(etString);
    };

    assert.equal(isPostWindow(mkET(8)), true);   // ET 8:00 during EST
    assert.equal(isPostWindow(mkET(10)), true);  // ET 10:00 during EST
    assert.equal(isPostWindow(mkET(12)), true);  // ET 12:00 during EST
    assert.equal(isPostWindow(mkET(14)), true);  // ET 14:00 during EST
    assert.equal(isPostWindow(mkET(16)), true);  // ET 16:00 during EST
    assert.equal(isPostWindow(mkET(18)), true);  // ET 18:00 during EST
    assert.equal(isPostWindow(mkET(20)), true);  // ET 20:00 during EST
  });

  it("DST: post window works during EDT (Mar-Nov)", () => {
    // Use the nowET() trick: create UTC date, convert to ET string, parse back
    // This produces a Date whose getHours() returns the ET hour (on UTC server)
    const mkET = (hour: number, minute = 0) => {
      // During EDT: ET hour = UTC hour - 4, so UTC hour = ET hour + 4
      const utcHour = hour + 4;
      const utcDate = new Date(Date.UTC(2026, 6, 15, utcHour, minute, 0));
      const etString = utcDate.toLocaleString("en-US", { timeZone: "America/New_York" });
      return new Date(etString);
    };

    assert.equal(isPostWindow(mkET(8)), true);   // ET 8:00 during EDT
    assert.equal(isPostWindow(mkET(10)), true);  // ET 10:00 during EDT
    assert.equal(isPostWindow(mkET(12)), true);  // ET 12:00 during EDT
    assert.equal(isPostWindow(mkET(14)), true);  // ET 14:00 during EDT
    assert.equal(isPostWindow(mkET(16)), true);  // ET 16:00 during EDT
    assert.equal(isPostWindow(mkET(18)), true);  // ET 18:00 during EDT
    assert.equal(isPostWindow(mkET(20)), true);  // ET 20:00 during EDT
  });

  it("DST: selectPostType works during both EDT and EST", () => {
    const mkET = (hour: number, minute = 0, year = 2026, month = 0, day = 15, offsetHours = 5) => {
      // offsetHours: 5 for EST (UTC-5), 4 for EDT (UTC-4)
      const utcHour = hour + offsetHours;
      const utcDate = new Date(Date.UTC(year, month, day, utcHour, minute, 0));
      const etString = utcDate.toLocaleString("en-US", { timeZone: "America/New_York" });
      return new Date(etString);
    };

    // Both seasons should post at the same ET hour
    const edtPost = selectPostType(mkET(8, 0, 2026, 6, 15, 4)); // EDT (July)
    const estPost = selectPostType(mkET(8, 0, 2026, 0, 15, 5)); // EST (January)
    assert.equal(edtPost, "desk_open");
    assert.equal(estPost, "desk_open");
  });
});
