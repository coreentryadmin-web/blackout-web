import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  entryCenteredExcursionLayout,
  formatExcursionPct,
  pctToEntryCenteredPos,
  tradeJourneyLayout,
} from "./trade-excursion-graphic.ts";

describe("trade-excursion-graphic", () => {
  it("pctToEntryCenteredPos pins entry at 50 and maps worst/best to edges", () => {
    assert.equal(pctToEntryCenteredPos(-50, 14, 0), 50);
    assert.equal(pctToEntryCenteredPos(-50, 14, -50), 2);
    assert.equal(pctToEntryCenteredPos(-50, 14, 14), 98);
  });

  it("entryCenteredExcursionLayout builds worst/entry/best/current markers", () => {
    const layout = entryCenteredExcursionLayout(-50, 14, -50, { closed: true });
    assert.ok(layout);
    const keys = layout!.markers.map((m) => m.key);
    assert.deepEqual(keys, ["worst", "entry", "best", "current"]);
    assert.equal(layout!.markers.find((m) => m.key === "entry")!.posPct, 50);
    assert.equal(layout!.markers.find((m) => m.key === "current")!.label, "Close");
  });

  it("tradeJourneyLayout returns a path when peak is grounded", () => {
    const journey = tradeJourneyLayout(-50, 14, -50, { closed: true });
    assert.ok(journey);
    assert.equal(journey!.nodes.length, 3);
    assert.match(journey!.pathD, /^M[\d.]+,[\d.]+ L/);
  });

  it("formatExcursionPct signs positive moves", () => {
    assert.equal(formatExcursionPct(14.2), "+14%");
    assert.equal(formatExcursionPct(-50.4), "-50%");
  });
});
