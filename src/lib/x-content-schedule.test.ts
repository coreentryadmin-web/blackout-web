import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { selectPostType, isPostWindow } from "./x-content-schedule";

describe("2-hour post cadence", () => {
  it("isPostWindow true on EDT post hours (8,10,12,14,16,18,20)", () => {
    // During EDT (UTC-4), the cron fires at UTC [0,12,14,16,18,20,22]
    // which maps to ET [20,8,10,12,14,16,18]
    assert.equal(isPostWindow(new Date("2026-07-21T12:00:00-04:00")), true);  // ET 12
    assert.equal(isPostWindow(new Date("2026-07-21T13:00:00-04:00")), false); // ET 13
    assert.equal(isPostWindow(new Date("2026-07-21T07:00:00-04:00")), false); // ET 7
  });

  it("selectPostType rotates desk showcase themes every 2h during EDT", () => {
    const t8 = selectPostType(new Date("2026-07-21T08:30:00-04:00"));
    const t10 = selectPostType(new Date("2026-07-21T10:30:00-04:00"));
    assert.ok(t8);
    assert.ok(t10);
    assert.notEqual(t8, t10);
  });

  it("DST: post window works during EST (Nov-Mar) at shifted hours", () => {
    // During EST (UTC-5), the SAME cron UTC times fire at different ET hours
    // UTC [0,12,14,16,18,20,22] → ET [19,7,9,11,13,15,17]
    // (shifted 1 hour earlier than EDT times)
    const mkET = (hour: number, minute = 0) => {
      // During EST: ET hour = UTC hour - 5, so UTC hour = ET hour + 5
      const utcHour = hour + 5;
      const utcDate = new Date(Date.UTC(2026, 0, 15, utcHour, minute, 0));
      const etString = utcDate.toLocaleString("en-US", { timeZone: "America/New_York" });
      return new Date(etString);
    };

    assert.equal(isPostWindow(mkET(7)), true);   // EST post window at 7 (EDT 8)
    assert.equal(isPostWindow(mkET(9)), true);   // EST post window at 9 (EDT 10)
    assert.equal(isPostWindow(mkET(11)), true);  // EST post window at 11 (EDT 12)
    assert.equal(isPostWindow(mkET(13)), true);  // EST post window at 13 (EDT 14)
    assert.equal(isPostWindow(mkET(15)), true);  // EST post window at 15 (EDT 16)
    assert.equal(isPostWindow(mkET(17)), true);  // EST post window at 17 (EDT 18)
    assert.equal(isPostWindow(mkET(19)), true);  // EST post window at 19 (EDT 20)

    // EDT times should NOT be post windows during EST
    assert.equal(isPostWindow(mkET(8)), false);  // EDT 8 not a post window in EST
    assert.equal(isPostWindow(mkET(10)), false); // EDT 10 not a post window in EST
  });

  it("DST: post window works during EDT (Mar-Nov) at original hours", () => {
    // During EDT (UTC-4), cron fires at original schedule
    const mkET = (hour: number, minute = 0) => {
      // During EDT: ET hour = UTC hour - 4, so UTC hour = ET hour + 4
      const utcHour = hour + 4;
      const utcDate = new Date(Date.UTC(2026, 6, 15, utcHour, minute, 0));
      const etString = utcDate.toLocaleString("en-US", { timeZone: "America/New_York" });
      return new Date(etString);
    };

    assert.equal(isPostWindow(mkET(8)), true);   // EDT post window at 8
    assert.equal(isPostWindow(mkET(10)), true);  // EDT post window at 10
    assert.equal(isPostWindow(mkET(12)), true);  // EDT post window at 12
    assert.equal(isPostWindow(mkET(14)), true);  // EDT post window at 14
    assert.equal(isPostWindow(mkET(16)), true);  // EDT post window at 16
    assert.equal(isPostWindow(mkET(18)), true);  // EDT post window at 18
    assert.equal(isPostWindow(mkET(20)), true);  // EDT post window at 20
  });

  it("DST: selectPostType returns correct post type for each time slot", () => {
    const mkET = (hour: number, minute = 0, month = 0, offsetHours = 5) => {
      // month: 0 for January (EST), 6 for July (EDT)
      // offsetHours: 5 for EST, 4 for EDT
      const utcHour = hour + offsetHours;
      const utcDate = new Date(Date.UTC(2026, month, 15, utcHour, minute, 0));
      const etString = utcDate.toLocaleString("en-US", { timeZone: "America/New_York" });
      return new Date(etString);
    };

    // During EDT: posting at 8 AM should be "desk_open"
    const edtPost8 = selectPostType(mkET(8, 0, 6, 4)); // July EDT
    assert.equal(edtPost8, "desk_open");

    // During EST: posting at 7 AM should also be "desk_open" (shifted schedule)
    const estPost7 = selectPostType(mkET(7, 0, 0, 5)); // January EST
    assert.equal(estPost7, "desk_open");
  });
});
