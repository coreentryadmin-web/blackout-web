import assert from "node:assert/strict";
import test from "node:test";
import {
  THERMAL_DISCORD_CARD_W,
  bandStrikesAroundSpot,
  buildThermalDiscordCardSvg,
  fmtCompactExpiry,
  fmtCompactHeatMoney,
  fmtDeskExpiry,
  resolveCompactExpiries,
  thermalDiscordCaption,
  type ThermalCardColumn,
} from "./thermal-discord-card.ts";
import type { GexHeatmap } from "./providers/polygon-options-gex.ts";

test("fmtCompactExpiry → M/D", () => {
  assert.equal(fmtCompactExpiry("2026-07-28"), "7/28");
  assert.equal(fmtCompactExpiry("2026-12-01"), "12/1");
});

test("fmtDeskExpiry → Mon D", () => {
  assert.equal(fmtDeskExpiry("2026-07-28"), "Jul 28");
  assert.equal(fmtDeskExpiry("2026-12-01"), "Dec 1");
});

test("resolveCompactExpiries prefers near-term and caps", () => {
  const near = ["2026-07-28", "2026-07-29", "2026-07-30"];
  const all = [...near, "2026-09-18"];
  assert.deepEqual(resolveCompactExpiries(near, all, 2), ["2026-07-28", "2026-07-29"]);
  assert.deepEqual(resolveCompactExpiries([], all, 2), ["2026-07-28", "2026-07-29"]);
});

test("bandStrikesAroundSpot centers on nearest strike", () => {
  const strikes = [100, 101, 102, 103, 104, 105, 106];
  assert.deepEqual(bandStrikesAroundSpot(strikes, 103.4, 1), [102, 103, 104]);
});

test("fmtCompactHeatMoney dense labels", () => {
  assert.equal(fmtCompactHeatMoney(0), "·");
  assert.equal(fmtCompactHeatMoney(2_500_000), "+2.5M");
  assert.equal(fmtCompactHeatMoney(-150_000), "−150K");
});

test("buildThermalDiscordCardSvg includes tickers and never invents spot", () => {
  const stub = {
    underlying: "SPY",
    spot: 634.5,
    change_pct: 0.1,
    asof: "2026-07-28T14:45:00.000Z",
    expiries: ["2026-07-28", "2026-07-29"],
    near_term_expiries: ["2026-07-28", "2026-07-29"],
    strikes: [630, 635, 640],
    max_pain: null,
    gex: {
      cells: {
        "635": { "2026-07-28": 1_000_000, "2026-07-29": -500_000 },
        "630": { "2026-07-28": 100_000 },
        "640": { "2026-07-28": -200_000 },
      },
      strike_totals: {},
      call_wall: 640,
      put_wall: 630,
      total: 0,
      flip: null,
      regime: { flip: null, posture: null, read: "undetermined" },
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
    shift: { available: false, status: "collecting" },
    source: "polygon",
    data_delay: "realtime",
  } as unknown as GexHeatmap;

  const columns: ThermalCardColumn[] = [
    { ticker: "SPY", heatmap: stub },
    { ticker: "SPX", heatmap: null },
    { ticker: "QQQ", heatmap: null },
  ];
  const svg = buildThermalDiscordCardSvg(columns);
  assert.match(svg, new RegExp(`width="${THERMAL_DISCORD_CARD_W}"`));
  assert.match(svg, /SPY/);
  assert.match(svg, /SPX/);
  assert.match(svg, /QQQ/);
  assert.match(svg, /634\.50/);
  assert.match(svg, /CALL WALL/);
  assert.match(svg, /PUT WALL/);
  assert.match(svg, /FLIP/);
  assert.match(svg, /LIVE SNAPSHOT/);
  assert.match(svg, /Matrix unavailable/);
  assert.doesNotMatch(svg, /Unusual Whales|Polygon|Railway/i);

  const caption = thermalDiscordCaption(columns);
  assert.match(caption, /SPY/);
  assert.match(caption, /Call wall/);
  assert.match(caption, /640/);
  assert.doesNotMatch(caption, /Polygon|Unusual/i);
});
