import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { resolveMeridianEventId } from "./meridian-event-id";
import { parseMeridianEventId } from "@/features/meridian/lib/meridian-timeline";
import { isReadAllowed } from "@/lib/route-registry";

describe("resolveMeridianEventId: two ways in, and a refusal that explains itself", () => {
  test("a real timeline id passes straight through, for every kind", () => {
    // These are the id shapes the live timeline emits, taken verbatim from a 2026-08-21 read.
    for (const [id, kind] of [
      ["earnings:NVDA:2026-08-26", "earnings"],
      ["opex:2026-08-21", "opex"],
      ["macro:2026-08-21:US-Flash-Services-PMI", "macro"],
      ["fda:SAVA:2026-09-30", "fda"],
    ] as const) {
      const r = resolveMeridianEventId({ id });
      assert.equal(r.id, id, `${id} should round-trip`);
      assert.equal(r.kind, kind);
      assert.equal(r.reason, null);
    }
  });

  test("a ticker + kind + date is enough — the model should not have to build the key", () => {
    // "How did NVDA's last print go" gives a ticker and a kind, not an id. Forcing a timeline
    // call first would make every such question two round trips.
    assert.equal(resolveMeridianEventId({ kind: "earnings", ticker: "nvda", date: "2026-08-26" }).id, "earnings:NVDA:2026-08-26");
    assert.equal(resolveMeridianEventId({ kind: "fda", ticker: "sava", date: "2026-09-30" }).id, "fda:SAVA:2026-09-30");
    assert.equal(resolveMeridianEventId({ kind: "opex", date: "2026-09-18" }).id, "opex:2026-09-18");
  });

  test("a macro event REFUSES to be guessed, and says why", () => {
    // The event name is part of the key, so a constructed macro id would silently resolve to
    // whatever happened to be first on that date. Better to send the caller to the timeline.
    const r = resolveMeridianEventId({ kind: "macro", date: "2026-08-21" });
    assert.equal(r.id, null);
    assert.match(r.reason!, /full .?id.? from get_meridian_timeline/i);
  });

  test("every refusal names the fix rather than just failing", () => {
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ id: "nonsense:2026-08-21" }, /not a Meridian event kind/i],
      [{ id: "opex:not-a-date" }, /opex:YYYY-MM-DD/],
      [{ id: "earnings:NVDA" }, /earnings:TICKER:YYYY-MM-DD/],
      [{ id: "macro:2026-08-21" }, /macro:YYYY-MM-DD:Event-Name-Slug/],
      [{ kind: "earnings", date: "2026-08-26" }, /needs a .?ticker.?/i],
      [{ kind: "earnings", ticker: "NVDA", date: "26/08/2026" }, /YYYY-MM-DD/],
      [{}, /get_meridian_timeline/],
    ];
    for (const [input, want] of cases) {
      const r = resolveMeridianEventId(input);
      assert.equal(r.id, null, `${JSON.stringify(input)} should refuse`);
      assert.match(r.reason!, want, `reason for ${JSON.stringify(input)} was: ${r.reason}`);
    }
  });

  test("an id survives a lowercase ticker — the desk's ids are upper-case", () => {
    assert.equal(resolveMeridianEventId({ id: "earnings:nvda:2026-08-26" }).id, "earnings:NVDA:2026-08-26");
  });
});

test("this resolver and Meridian's OWN parser agree — a mirror that drifts is worse than an import", () => {
  // resolveMeridianEventId deliberately mirrors parseMeridianEventId rather than importing it,
  // because the shape it accepts is a contract this tool depends on. Running both over the same
  // inputs is what keeps the mirror honest: if the desk widens or narrows what it accepts, this
  // fails instead of quietly refusing ids the desk considers valid.
  const ids = [
    "earnings:NVDA:2026-08-26",
    "opex:2026-08-21",
    "macro:2026-08-21:US-Flash-Services-PMI",
    "fda:SAVA:2026-09-30",
    "earnings:NVDA",
    "opex:not-a-date",
    "macro:2026-08-21",
    "nonsense:2026-08-21",
    "",
  ];
  for (const id of ids) {
    const mine = resolveMeridianEventId({ id });
    const theirs = parseMeridianEventId(id);
    assert.equal(
      mine.id != null,
      theirs != null,
      `disagreement on "${id}": tool ${mine.id != null ? "accepts" : "refuses"}, desk ${theirs != null ? "accepts" : "refuses"}`
    );
    if (theirs) assert.equal(mine.kind, theirs.kind, `kind disagreement on "${id}"`);
  }
});

test("the routes the old guidance told the model to call are DENIED — which is why these tools exist", () => {
  // product-knowledge.ts documented three call_internal_api routes into Meridian. All three are
  // refused by the read allowlist, so following that guidance returned denied_not_read_allowlisted
  // every single time. Pinned so nobody re-adds the advice without also opening the gate.
  for (const p of [
    "/api/market/meridian/timeline",
    "/api/market/meridian/event",
    "/api/market/meridian/lookup",
  ]) {
    assert.equal(isReadAllowed(p, "GET"), false, `${p} is now allowlisted — update the guidance in product-knowledge.ts`);
  }
  // The contrast case: the earnings calendar IS allowlisted, which is why get_earnings_calendar
  // can go through call_internal_api and these two cannot.
  assert.equal(isReadAllowed("/api/market/earnings-calendar", "GET"), true);
});
