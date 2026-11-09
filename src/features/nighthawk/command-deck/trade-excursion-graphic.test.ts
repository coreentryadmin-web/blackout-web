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

  it("formatExcursionPct rounds exact-half ties symmetrically by magnitude", () => {
    // Math.round() ties toward +Infinity (Math.round(-10.5) === -10 but
    // Math.round(10.5) === 11), so a plain Math.round(n) (or Math.round(n*10)/10
    // below 10) combined with a raw-value sign check understates the magnitude of a
    // negative excursion sitting exactly on a rounding tie relative to its positive
    // mirror image. A trader reading this on the trade-excursion graphic sees -10.5%
    // rendered as "-10%" while the identical-magnitude +10.5% renders as "+11%".
    assert.equal(formatExcursionPct(10.5), "+11%");
    assert.equal(formatExcursionPct(-10.5), "-11%");
    assert.equal(formatExcursionPct(0.25), "+0.3%");
    assert.equal(formatExcursionPct(-0.25), "-0.3%");
  });
});
