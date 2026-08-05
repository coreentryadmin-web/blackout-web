import assert from "node:assert/strict";
import test from "node:test";
import {
  filterNewBreachAlerts,
  priorSpotsForBreaches,
  shouldSeedSessionSpots,
  sideFromBreachEvent,
} from "./thermal-discord-breach-state.ts";
import type { ThermalBreachEvent } from "./thermal-discord-extras.ts";
import { detectThermalBreaches } from "./thermal-discord-extras.ts";
import { isThermalEodRecapDue } from "./thermal-discord-eod.ts";
import type { ThermalCardColumn } from "./thermal-discord-card.ts";

function breach(partial: Partial<ThermalBreachEvent> & Pick<ThermalBreachEvent, "ticker" | "kind">): ThermalBreachEvent {
  return {
    spot: 771,
    level: 744,
    direction: "crossed_above",
    priorSpot: 740,
    asof: "2026-08-05T14:00:00.000Z",
    ...partial,
  };
}

test("filterNewBreachAlerts — first cross alerts, same side silent", () => {
  const ev = breach({ ticker: "SPY", kind: "flip" });
  const first = filterNewBreachAlerts([ev], {});
  assert.equal(first.alerts.length, 1);
  assert.equal(first.state.SPY?.flip, "above");

  const again = filterNewBreachAlerts([ev], first.state);
  assert.equal(again.alerts.length, 0);
});

test("filterNewBreachAlerts — opposite cross re-alerts", () => {
  const ev = breach({ ticker: "QQQ", kind: "flip" });
  const { state } = filterNewBreachAlerts([ev], {});
  const below = breach({ ticker: "QQQ", kind: "flip", direction: "crossed_below" });
  const second = filterNewBreachAlerts([below], state);
  assert.equal(second.alerts.length, 1);
  assert.equal(second.state.QQQ?.flip, "below");
});

test("filterNewBreachAlerts — independent per ticker and kind", () => {
  const flip = breach({ ticker: "SPX", kind: "flip" });
  const call = breach({ ticker: "SPX", kind: "call_wall", level: 7780 });
  const r1 = filterNewBreachAlerts([flip, call], {});
  assert.equal(r1.alerts.length, 2);
  assert.equal(r1.state.SPX?.flip, "above");
  assert.equal(r1.state.SPX?.call_wall, "above");
});

test("shouldSeedSessionSpots on new session date", () => {
  assert.equal(shouldSeedSessionSpots(null, "2026-08-05"), true);
  assert.equal(
    shouldSeedSessionSpots({ sessionDate: "2026-08-04", spots: { SPY: 770 }, updatedAt: "" }, "2026-08-05"),
    true
  );
  assert.equal(
    shouldSeedSessionSpots({ sessionDate: "2026-08-05", spots: { SPY: 770 }, updatedAt: "" }, "2026-08-05"),
    false
  );
});

test("detectThermalBreaches — all three tickers independently", () => {
  const columns: ThermalCardColumn[] = [
    {
      ticker: "SPY",
      heatmap: {
        spot: 746,
        asof: "2026-08-05T14:00:00.000Z",
        gex: { call_wall: 775, put_wall: 735, flip: 744, regime: { read: "" } },
      } as ThermalCardColumn["heatmap"],
    },
    {
      ticker: "SPX",
      heatmap: {
        spot: 7550,
        asof: "2026-08-05T14:00:00.000Z",
        gex: { call_wall: 7780, put_wall: 7300, flip: 7560, regime: { read: "" } },
      } as ThermalCardColumn["heatmap"],
    },
    {
      ticker: "QQQ",
      heatmap: {
        spot: 678,
        asof: "2026-08-05T14:00:00.000Z",
        gex: { call_wall: 720, put_wall: 680, flip: 710, regime: { read: "" } },
      } as ThermalCardColumn["heatmap"],
    },
  ];

  const events = detectThermalBreaches(columns, { SPY: 740, SPX: 7600, QQQ: 715 });
  assert.equal(events.length, 3);
  assert.deepEqual(new Set(events.map((e) => e.ticker)), new Set(["SPY", "SPX", "QQQ"]));
});

test("sideFromBreachEvent", () => {
  assert.equal(sideFromBreachEvent(breach({ direction: "crossed_above" })), "above");
  assert.equal(sideFromBreachEvent(breach({ direction: "crossed_below" })), "below");
});

test("priorSpotsForBreaches — empty when session mismatch", () => {
  assert.deepEqual(
    priorSpotsForBreaches({ sessionDate: "2026-08-04", spots: { SPY: 1 }, updatedAt: "" }, "2026-08-05"),
    {}
  );
});

test("isThermalEodRecapDue — after close window", () => {
  assert.equal(isThermalEodRecapDue(new Date("2026-08-05T20:10:00.000Z")), true); // 4:10 PM ET (EDT)
  assert.equal(isThermalEodRecapDue(new Date("2026-08-05T13:30:00.000Z")), false); // 9:30 AM ET RTH
});
