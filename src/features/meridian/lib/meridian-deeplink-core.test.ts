import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseDeskUrlState,
  deskUrlSearch,
  sameDeskUrlState,
} from "./meridian-deeplink-core";

test("parseDeskUrlState: a bare path selects nothing", () => {
  assert.deepEqual(parseDeskUrlState(""), { event: null, view: null, filter: null, ticker: null });
  assert.deepEqual(parseDeskUrlState("?"), { event: null, view: null, filter: null, ticker: null });
});

test("parseDeskUrlState: reads event, view and filter, with or without the leading ?", () => {
  const want = { event: "earnings:NVDA:2026-08-20", view: "analytics", filter: "watchlist", ticker: null };
  assert.deepEqual(parseDeskUrlState("?event=earnings%3ANVDA%3A2026-08-20&view=analytics&filter=watchlist"), want);
  assert.deepEqual(parseDeskUrlState("event=earnings%3ANVDA%3A2026-08-20&view=analytics&filter=watchlist"), want);
});

test("parseDeskUrlState: an unknown view is dropped, not passed through", () => {
  // A pasted link must not be able to put the desk into a state with no branch behind it.
  assert.equal(parseDeskUrlState("?view=hacked").view, null);
  assert.equal(parseDeskUrlState("?view=analytics").view, "analytics");
});

test("parseDeskUrlState: an empty param is the same as an absent one", () => {
  assert.deepEqual(parseDeskUrlState("?event=&filter=%20"), { event: null, view: null, filter: null, ticker: null });
});

test("parseDeskUrlState: reads ticker — the read-only bootstrap symbol from a cross-product link", () => {
  assert.equal(parseDeskUrlState("?ticker=TSLA").ticker, "TSLA");
  assert.equal(parseDeskUrlState("?ticker=tsla").ticker, "tsla", "case is preserved — normalization is the search box's job, not the URL layer's");
  assert.equal(parseDeskUrlState("?ticker=%20").ticker, null, "whitespace-only is the same as absent");
  assert.equal(parseDeskUrlState("?ticker=").ticker, null);
});

test("deskUrlSearch: defaults are omitted so an untouched desk has a clean URL", () => {
  assert.equal(deskUrlSearch({ event: null, view: "timeline", filter: "all", ticker: null }), "");
});

test("deskUrlSearch: never emits ticker — it is read-only, a bootstrap seed, not desk state", () => {
  // Even when the caller (wrongly) sets a ticker on a DeskUrlState it's about to serialize, the
  // address bar must never carry it back out — see DeskUrlState.ticker's own comment for why.
  const search = deskUrlSearch({ event: "earnings:AMD:2026-09-01", view: null, filter: null, ticker: "AMD" });
  assert.ok(!search.includes("ticker"));
});

test("deskUrlSearch: non-default state round-trips through parse", () => {
  const state = { event: "earnings:AMD:2026-09-01", view: "analytics" as const, filter: "board", ticker: null };
  assert.deepEqual(parseDeskUrlState(deskUrlSearch(state)), state);
});

test("deskUrlSearch: the event id is encoded, so colons survive a round trip", () => {
  const search = deskUrlSearch({ event: "earnings:BRK.B:2026-09-01", view: null, filter: null, ticker: null });
  assert.ok(search.startsWith("?event="));
  assert.equal(parseDeskUrlState(search).event, "earnings:BRK.B:2026-09-01");
});

test("sameDeskUrlState: differing defaults compare equal (no duplicate history entries)", () => {
  // `view: null` and `view: "timeline"` both mean "the default view" — writing a history entry
  // for that transition would push a URL identical to the one already showing.
  assert.equal(
    sameDeskUrlState(
      { event: "a", view: null, filter: null, ticker: null },
      { event: "a", view: "timeline", filter: "all", ticker: null }
    ),
    true
  );
  assert.equal(
    sameDeskUrlState(
      { event: "a", view: null, filter: null, ticker: null },
      { event: "b", view: null, filter: null, ticker: null }
    ),
    false
  );
});

test("sameDeskUrlState: a ticker-only difference never counts as a change (ticker isn't serialized)", () => {
  assert.equal(
    sameDeskUrlState(
      { event: "a", view: null, filter: null, ticker: "TSLA" },
      { event: "a", view: null, filter: null, ticker: null }
    ),
    true
  );
});
