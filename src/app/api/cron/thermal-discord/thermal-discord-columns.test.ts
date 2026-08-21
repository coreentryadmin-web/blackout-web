import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { thermalColumnsFromSettled } from "./thermal-discord-columns";

const TICKERS = ["SPY", "SPX", "QQQ"] as const;
const hm = (spot: number) => ({ spot }) as never;

describe("thermalColumnsFromSettled", () => {
  it("keeps the healthy tickers when one rejects", () => {
    const seen: Array<[string, unknown]> = [];
    const cols = thermalColumnsFromSettled(
      TICKERS,
      [
        { status: "fulfilled", value: hm(762.6) },
        { status: "rejected", reason: new Error("upstream 502") },
        { status: "fulfilled", value: hm(710.66) },
      ],
      (t, r) => seen.push([t, r])
    );

    assert.equal(cols.length, 3);
    // The regression: a single rejection used to throw past the whole handler, taking the
    // snapshot, the EOD recap AND the breach alerts for the other two tickers with it.
    assert.equal(cols[0].heatmap != null, true, "SPY survives");
    assert.equal(cols[1].heatmap, null, "SPX degrades to a null column");
    assert.equal(cols[2].heatmap != null, true, "QQQ survives");
    assert.equal(cols.filter((c) => c.heatmap != null).length, 2);
    // Ticker order is preserved, so columns still line up with THERMAL_DISCORD_TICKERS.
    assert.deepEqual(cols.map((c) => c.ticker), ["SPY", "SPX", "QQQ"]);
  });

  it("reports every failure rather than dropping it silently", () => {
    const seen: Array<[string, unknown]> = [];
    thermalColumnsFromSettled(
      TICKERS,
      [
        { status: "rejected", reason: "a" },
        { status: "rejected", reason: "b" },
        { status: "fulfilled", value: hm(1) },
      ],
      (t, r) => seen.push([t, r])
    );
    // A null column is indistinguishable from a cold cache downstream, so a silent drop would
    // hide a real upstream fault behind a benign-looking gap.
    assert.deepEqual(seen, [["SPY", "a"], ["SPX", "b"]]);
  });

  it("treats a fulfilled null (cold matrix) as a null column, not an error", () => {
    const seen: string[] = [];
    const cols = thermalColumnsFromSettled(
      ["SPY"],
      [{ status: "fulfilled", value: null }],
      (t) => seen.push(t)
    );
    assert.equal(cols[0].heatmap, null);
    assert.deepEqual(seen, [], "a cold matrix is data, not a fault");
  });

  it("treats a missing result slot as a failure rather than trusting undefined", () => {
    const seen: string[] = [];
    const cols = thermalColumnsFromSettled(TICKERS, [{ status: "fulfilled", value: hm(1) }], (t) =>
      seen.push(t)
    );
    assert.equal(cols.length, 3);
    assert.equal(cols[1].heatmap, null);
    assert.deepEqual(seen, ["SPX", "QQQ"]);
  });

  it("returns no columns for no tickers", () => {
    assert.deepEqual(thermalColumnsFromSettled([], []), []);
  });
});
