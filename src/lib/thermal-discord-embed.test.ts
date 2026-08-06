import assert from "node:assert/strict";
import test from "node:test";
import {
  buildThermalDiscordEmbed,
  buildThermalRegimeSummary,
  buildThermalTickerOneLiner,
  pctFromSpot,
  pinPhrase,
} from "./thermal-discord-embed.ts";
import {
  etMinuteSlot,
  extractWallSnapshot,
  resolveThermalDiscordMode,
  thermalDiscordBaseMode,
  thermalWallsShifted,
} from "./thermal-discord-cadence.ts";
import type { ThermalCardColumn } from "./thermal-discord-card.ts";
import type { GexHeatmap } from "./providers/polygon-options-gex.ts";

function stubHeatmap(overrides: Partial<GexHeatmap> = {}): GexHeatmap {
  return {
    underlying: "SPY",
    spot: 771.51,
    change_pct: 1.82,
    asof: "2026-08-04T18:30:00.000Z",
    expiries: ["2026-08-04", "2026-08-05"],
    near_term_expiries: ["2026-08-04", "2026-08-05"],
    strikes: Array.from({ length: 41 }, (_, i) => 750 + i),
    max_pain: null,
    gex: {
      cells: {},
      strike_totals: {},
      call_wall: 775,
      put_wall: 735,
      total: 0,
      flip: 744,
      regime: { flip: 744, posture: "long", read: "positive gamma — stabilizing" },
    },
    vex: {
      cells: {},
      strike_totals: {},
      pos_wall: null,
      neg_wall: null,
      total: 0,
      flip: null,
      regime: { posture: null, read: "" },
    },
    shift: {
      available: true,
      delta_by_strike: {},
      wall_changes: {
        call_wall: { from: 775, to: 775, moved_pts: 0, grew_pct: -8.1 },
        put_wall: { from: 735, to: 735, moved_pts: 0, grew_pct: 2 },
      },
    },
    source: "polygon",
    data_delay: "realtime",
    ...overrides,
  } as unknown as GexHeatmap;
}

test("pctFromSpot formats signed distance", () => {
  assert.equal(pctFromSpot(100, 105), "+5.0%");
  assert.equal(pctFromSpot(100, 95), "-5.0%");
  assert.equal(pctFromSpot(null, 95), null);
});

test("pinPhrase resolves wall / flip context", () => {
  assert.equal(pinPhrase(776, 775, 735, 744), "at/above call wall");
  assert.equal(pinPhrase(740, 775, 735, 744), "below flip");
  assert.equal(pinPhrase(760, 775, 735, 744), "above flip");
});

test("buildThermalTickerOneLiner includes heatmap link and wall drift", () => {
  const line = buildThermalTickerOneLiner({ ticker: "SPY", heatmap: stubHeatmap() });
  assert.match(line, /\[(\*\*)?SPY 771\.51/);
  assert.match(line, /heatmap\?ticker=SPY/);
  assert.match(line, /C 775/);
  assert.match(line, /walls C-8\.1% P\+2%/);
  assert.doesNotMatch(line, /Polygon|Unusual/i);
});

test("buildThermalRegimeSummary joins per-ticker gamma reads", () => {
  const columns: ThermalCardColumn[] = [
    { ticker: "SPY", heatmap: stubHeatmap() },
    {
      ticker: "QQQ",
      heatmap: stubHeatmap({
        underlying: "QQQ",
        spot: 723.52,
        gex: {
          cells: {},
          strike_totals: {},
          call_wall: 720,
          put_wall: 680,
          total: 0,
          flip: 710,
          regime: { flip: 710, posture: "short", read: "negative gamma — amplifying" },
        },
      }),
    },
  ];
  const summary = buildThermalRegimeSummary(columns);
  assert.match(summary, /\*\*Regime:\*\*/);
  assert.match(summary, /SPY: positive gamma/);
  assert.match(summary, /QQQ: negative gamma/);
});

test("buildThermalDiscordEmbed — full mode uses attachment image", () => {
  const columns: ThermalCardColumn[] = [{ ticker: "SPY", heatmap: stubHeatmap() }];
  const embed = buildThermalDiscordEmbed(columns, "full");
  assert.equal(embed.title, "BlackOut Thermal · GEX snapshot");
  assert.match(embed.description ?? "", /Regime:/);
  assert.match(embed.description ?? "", /SPY 771\.51/);
  assert.deepEqual(embed.image, { url: "attachment://thermal-desk.png" });
  assert.match(embed.footer?.text ?? "", /Full snapshot/);
});

test("buildThermalDiscordEmbed — pulse mode omits PNG attachment reference", () => {
  const columns: ThermalCardColumn[] = [{ ticker: "SPY", heatmap: stubHeatmap() }];
  const embed = buildThermalDiscordEmbed(columns, "pulse");
  assert.equal(embed.image, undefined);
  assert.match(embed.footer?.text ?? "", /Pulse update/);
});

test("thermalDiscordBaseMode — :00/:30 full, :15/:45 pulse", () => {
  assert.equal(thermalDiscordBaseMode(new Date("2026-08-04T14:00:00.000Z")), "full"); // 10:00 ET
  assert.equal(thermalDiscordBaseMode(new Date("2026-08-04T14:30:00.000Z")), "full"); // 10:30 ET
  assert.equal(thermalDiscordBaseMode(new Date("2026-08-04T14:15:00.000Z")), "pulse"); // 10:15 ET
  assert.equal(thermalDiscordBaseMode(new Date("2026-08-04T14:45:00.000Z")), "pulse"); // 10:45 ET
});

test("thermalWallsShifted detects call wall move", () => {
  const columns: ThermalCardColumn[] = [{ ticker: "SPY", heatmap: stubHeatmap() }];
  const prev = { SPY: { call_wall: 770, put_wall: 735 } };
  assert.equal(thermalWallsShifted(columns, prev), true);
});

test("resolveThermalDiscordMode upgrades pulse when walls shifted", () => {
  const columns: ThermalCardColumn[] = [{ ticker: "SPY", heatmap: stubHeatmap() }];
  const prev = { SPY: { call_wall: 770, put_wall: 735 } };
  const pulseTime = new Date("2026-08-04T14:15:00.000Z"); // 10:15 ET
  assert.equal(resolveThermalDiscordMode(columns, prev, pulseTime), "full");
  assert.equal(resolveThermalDiscordMode(columns, prev, pulseTime, true), "full");
});

test("resolveThermalDiscordMode keeps pulse when walls quiet", () => {
  const columns: ThermalCardColumn[] = [{ ticker: "SPY", heatmap: stubHeatmap() }];
  const prev = extractWallSnapshot(columns);
  const pulseTime = new Date("2026-08-04T14:15:00.000Z");
  assert.equal(resolveThermalDiscordMode(columns, prev, pulseTime), "pulse");
});

test("etMinuteSlot reads America/New_York minute", () => {
  assert.equal(etMinuteSlot(new Date("2026-08-04T14:15:00.000Z")), 15);
});
