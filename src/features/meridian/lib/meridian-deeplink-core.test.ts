import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseDeskUrlState,
  deskUrlSearch,
  sameDeskUrlState,
} from "./meridian-deeplink-core";

test("parseDeskUrlState: a bare path selects nothing", () => {
  assert.deepEqual(parseDeskUrlState(""), { event: null, view: null, filter: null });
  assert.deepEqual(parseDeskUrlState("?"), { event: null, view: null, filter: null });
});

test("parseDeskUrlState: reads event, view and filter, with or without the leading ?", () => {
  const want = { event: "earnings:NVDA:2026-08-20", view: "analytics", filter: "watchlist" };
  assert.deepEqual(parseDeskUrlState("?event=earnings%3ANVDA%3A2026-08-20&view=analytics&filter=watchlist"), want);
  assert.deepEqual(parseDeskUrlState("event=earnings%3ANVDA%3A2026-08-20&view=analytics&filter=watchlist"), want);
});

test("parseDeskUrlState: an unknown view is dropped, not passed through", () => {
  // A pasted link must not be able to put the desk into a state with no branch behind it.
  assert.equal(parseDeskUrlState("?view=hacked").view, null);
  assert.equal(parseDeskUrlState("?view=analytics").view, "analytics");
});

test("parseDeskUrlState: an empty param is the same as an absent one", () => {
  assert.deepEqual(parseDeskUrlState("?event=&filter=%20"), { event: null, view: null, filter: null });
});

test("deskUrlSearch: defaults are omitted so an untouched desk has a clean URL", () => {
  assert.equal(deskUrlSearch({ event: null, view: "timeline", filter: "all" }), "");
});

test("deskUrlSearch: non-default state round-trips through parse", () => {
  const state = { event: "earnings:AMD:2026-09-01", view: "analytics" as const, filter: "board" };
  assert.deepEqual(parseDeskUrlState(deskUrlSearch(state)), state);
});

test("deskUrlSearch: the event id is encoded, so colons survive a round trip", () => {
  const search = deskUrlSearch({ event: "earnings:BRK.B:2026-09-01", view: null, filter: null });
  assert.ok(search.startsWith("?event="));
  assert.equal(parseDeskUrlState(search).event, "earnings:BRK.B:2026-09-01");
});

test("sameDeskUrlState: differing defaults compare equal (no duplicate history entries)", () => {
  // `view: null` and `view: "timeline"` both mean "the default view" — writing a history entry
  // for that transition would push a URL identical to the one already showing.
  assert.equal(
    sameDeskUrlState(
      { event: "a", view: null, filter: null },
      { event: "a", view: "timeline", filter: "all" }
    ),
    true
  );
  assert.equal(
    sameDeskUrlState({ event: "a", view: null, filter: null }, { event: "b", view: null, filter: null }),
    false
  );
});
