import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import {
  THERMAL_DISCORD_CARD_W,
  THERMAL_DISCORD_MAX_EXPIRIES,
  __resetFontconfigCacheDirForTest,
  bandStrikesAroundSpot,
  buildThermalDiscordCardSvg,
  discordDriftPct,
  discordPerExpiryExtremes,
  ensureFontconfigCacheDir,
  fmtCompactExpiry,
  fmtCompactHeatMoney,
  fmtDeskExpiry,
  resolveCompactExpiries,
  resolveDiscordDeskExpiry,
  resolveDiscordNearExpiries,
  resolveDiscordZeroDteExpiry,
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

test("fmtCompactHeatMoney always shows a number (never a blank dot)", () => {
  assert.equal(fmtCompactHeatMoney(0), "$0.0K");
  assert.equal(fmtCompactHeatMoney(2_500_000), "+$2.5M");
  assert.equal(fmtCompactHeatMoney(-150_000), "-$150K");
});

test("buildThermalDiscordCardSvg includes tickers and never invents spot", () => {
  const stub = {
    underlying: "SPY",
    spot: 634.5,
    change_pct: 0.1,
    asof: "2026-07-28T14:45:00.000Z",
    expiries: ["2026-07-28", "2026-07-29", "2026-07-30", "2026-07-31"],
    near_term_expiries: ["2026-07-28", "2026-07-29", "2026-07-30", "2026-07-31"],
    strikes: [630, 635, 640],
    max_pain: null,
    gex: {
      cells: {
        "635": { "2026-07-28": 1_000_000, "2026-07-29": -500_000, "2026-07-30": 200_000 },
        "630": { "2026-07-28": 100_000, "2026-07-29": 50_000 },
        "640": { "2026-07-28": -2_000_000, "2026-07-29": -100_000 },
      },
      strike_totals: { "630": 100_000, "635": 500_000, "640": -2_000_000 },
      call_wall: 635,
      put_wall: 640,
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
    shift: {
      available: true,
      delta_by_strike: { "635": 250_000, "640": -400_000 },
      wall_changes: {
        call_wall: { from: 630, to: 635, moved_pts: 5, grew_pct: 12.5 },
        put_wall: { from: 645, to: 640, moved_pts: -5, grew_pct: -8 },
      },
    },
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
  assert.match(svg, />DR%</);
  // Multi-expiry headers (compact M/D)
  assert.match(svg, /7\/28/);
  assert.match(svg, /7\/29/);
  assert.match(svg, /near-term GEX matrix/);
  assert.match(svg, /PLUS node \(yellow\)/);
  assert.match(svg, /MINUS node \(purple\)/);
  assert.match(svg, new RegExp(`${THERMAL_DISCORD_MAX_EXPIRIES} near expiries`));
  // Embedded desk mono (base64 @font-face) — cron must not depend on system fonts.
  assert.match(svg, /BlackOutDeskMono/);
  assert.match(svg, /@font-face/);
  assert.match(svg, /data:font\/ttf;base64,/);
  assert.doesNotMatch(svg, /ui-monospace|Menlo|Consolas/);
  // Yellow +node / purple −node bead fills
  assert.match(svg, /rgba\(255,214,10/);
  assert.match(svg, /rgba\(217,123,255/);
  assert.doesNotMatch(svg, /Unusual Whales|Polygon|Railway/i);

  const caption = thermalDiscordCaption(columns);
  assert.match(caption, /SPY/);
  assert.match(caption, /Call wall/);
  assert.match(caption, /640/);
  assert.match(caption, /Wall drift/);
  assert.match(caption, /Yellow=PLUS node/);
  assert.match(caption, /GEX · NEAR/);
  assert.doesNotMatch(caption, /Polygon|Unusual/i);
});

test("discordPerExpiryExtremes + discordDriftPct", () => {
  const cells = {
    "100": { "2026-07-28": 10 },
    "101": { "2026-07-28": 50 },
    "102": { "2026-07-28": -80 },
  };
  const ex = discordPerExpiryExtremes(cells, [100, 101, 102], ["2026-07-28"]);
  assert.equal(ex["2026-07-28"]?.callWall, 101);
  assert.equal(ex["2026-07-28"]?.putWall, 102);
  assert.equal(ex["2026-07-28"]?.king, 102);
  assert.equal(discordDriftPct(150, 50), 50);
  assert.equal(discordDriftPct(100, null), null);
});

test("resolveDiscordZeroDteExpiry prefers today when listed", () => {
  const near = ["2026-07-28", "2026-07-29", "2026-07-30"];
  assert.equal(resolveDiscordZeroDteExpiry(near, near, "2026-07-29"), "2026-07-29");
  assert.equal(resolveDiscordZeroDteExpiry(near, near, "2026-08-01"), "2026-07-28");
});

test("resolveDiscordDeskExpiry skips empty settled 0DTE for next live expiry", () => {
  const near = ["2026-07-28", "2026-07-29", "2026-07-30"];
  const strikes = [100, 101, 102];
  const cells = {
    "100": { "2026-07-28": 0, "2026-07-29": 1_000_000 },
    "101": { "2026-07-28": 0, "2026-07-29": -500_000 },
    "102": { "2026-07-28": 0, "2026-07-29": 250_000 },
  };
  assert.equal(
    resolveDiscordDeskExpiry(cells, strikes, near, near, "2026-07-28"),
    "2026-07-29"
  );
  // Today still wins when it has live cells.
  cells["100"]!["2026-07-28"] = 50_000;
  assert.equal(
    resolveDiscordDeskExpiry(cells, strikes, near, near, "2026-07-28"),
    "2026-07-28"
  );
});

test("resolveDiscordNearExpiries skips empty today and caps at 5", () => {
  const near = [
    "2026-07-28",
    "2026-07-29",
    "2026-07-30",
    "2026-07-31",
    "2026-08-03",
    "2026-08-04",
    "2026-08-05",
    "2026-08-06",
  ];
  const strikes = [100, 101];
  const cells: Record<string, Record<string, number>> = {
    "100": Object.fromEntries(near.map((e) => [e, e === "2026-07-28" ? 0 : 1_000])),
    "101": Object.fromEntries(near.map((e) => [e, e === "2026-07-28" ? 0 : -500])),
  };
  assert.deepEqual(resolveDiscordNearExpiries(cells, strikes, near, near, "2026-07-28", 5), [
    "2026-07-29",
    "2026-07-30",
    "2026-07-31",
    "2026-08-03",
    "2026-08-04",
  ]);
  // Live today stays first.
  cells["100"]!["2026-07-28"] = 10;
  assert.equal(
    resolveDiscordNearExpiries(cells, strikes, near, near, "2026-07-28", 5)[0],
    "2026-07-28"
  );
  assert.equal(
    resolveDiscordNearExpiries(cells, strikes, near, near, "2026-07-28", 5).length,
    5
  );
});

test("settled empty 0DTE multi-expiry SVG paints next days with money labels", () => {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [y, m, d] = today.split("-").map(Number);
  const next = new Date(Date.UTC(y!, m! - 1, d! + 1));
  const next2 = new Date(Date.UTC(y!, m! - 1, d! + 2));
  const nextYmd = next.toISOString().slice(0, 10);
  const next2Ymd = next2.toISOString().slice(0, 10);
  const stub = {
    underlying: "SPY",
    spot: 740,
    change_pct: 0.2,
    asof: "2026-07-29T02:00:00.000Z",
    expiries: [today, nextYmd, next2Ymd],
    near_term_expiries: [today, nextYmd, next2Ymd],
    strikes: [738, 740, 742],
    max_pain: null,
    gex: {
      cells: {
        "738": { [today]: 0, [nextYmd]: 2_500_000, [next2Ymd]: 900_000 },
        "740": { [today]: 0, [nextYmd]: -1_200_000, [next2Ymd]: -400_000 },
        "742": { [today]: 0, [nextYmd]: 800_000, [next2Ymd]: 100_000 },
      },
      strike_totals: { "738": 2_500_000, "740": -1_200_000, "742": 800_000 },
      call_wall: 738,
      put_wall: 740,
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
    shift: { available: false },
    source: "polygon",
    data_delay: "realtime",
  } as unknown as GexHeatmap;

  const columns: ThermalCardColumn[] = [{ ticker: "SPY", heatmap: stub }];
  const svg = buildThermalDiscordCardSvg(columns);
  assert.match(svg, /near-term GEX matrix/);
  assert.match(svg, new RegExp(fmtCompactExpiry(nextYmd).replace("/", "\\/")));
  assert.match(svg, new RegExp(fmtCompactExpiry(next2Ymd).replace("/", "\\/")));
  assert.match(svg, /\+\$2\.5M/);
  assert.match(svg, /-\$1\.2M/);
  assert.match(svg, /rgba\(255,214,10/);
  assert.match(svg, /rgba\(217,123,255/);
  const caption = thermalDiscordCaption(columns);
  assert.match(caption, /GEX · NEAR/);
  assert.match(caption, /Near `/);
  assert.match(caption, new RegExp(fmtCompactExpiry(nextYmd).replace("/", "\\/")));
});

/**
 * Regression for the "Fontconfig error: No writable cache directories" recurrence (72
 * occurrences/24h, 4-per-firing, RTH-only — matches this file's own `sharp(svg)` render inside the
 * `thermal-discord` cron). Before the fix, sharp's librsvg SVG backend had nowhere writable to
 * park fontconfig's cache in the ECS runtime container (root-owned build-time `/var/cache/fontconfig`
 * + no `$HOME` for the unprivileged `nextjs` user's XDG fallback), so it rebuilt its font cache
 * from scratch on every render — silent, but a real per-invocation latency tax. This asserts the
 * code-level mitigation actually runs: an `XDG_CACHE_HOME` fontconfig can use is set and exists
 * BEFORE sharp ever touches the SVG, so the cache can persist warm across renders within one task.
 */
test("ensureFontconfigCacheDir points fontconfig at a writable, existing cache dir", () => {
  const prior = process.env.XDG_CACHE_HOME;
  delete process.env.XDG_CACHE_HOME;
  __resetFontconfigCacheDirForTest();
  try {
    ensureFontconfigCacheDir();
    assert.ok(
      process.env.XDG_CACHE_HOME,
      "XDG_CACHE_HOME must be set so fontconfig has a per-user cache dir to fall back to"
    );
    assert.ok(
      existsSync(process.env.XDG_CACHE_HOME!),
      "the directory fontconfig is pointed at must actually exist, not just be a path"
    );
  } finally {
    if (prior === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = prior;
    __resetFontconfigCacheDirForTest();
  }
});

test("ensureFontconfigCacheDir never overrides an operator-supplied XDG_CACHE_HOME", () => {
  const prior = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = "/some/operator/chosen/dir";
  __resetFontconfigCacheDirForTest();
  try {
    ensureFontconfigCacheDir();
    assert.equal(process.env.XDG_CACHE_HOME, "/some/operator/chosen/dir");
  } finally {
    if (prior === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = prior;
    __resetFontconfigCacheDirForTest();
  }
});

test("renderThermalDiscordCardPng sets up the fontconfig cache dir before rendering", async () => {
  const prior = process.env.XDG_CACHE_HOME;
  delete process.env.XDG_CACHE_HOME;
  __resetFontconfigCacheDirForTest();
  try {
    const { renderThermalDiscordCardPng } = await import("./thermal-discord-card.ts");
    const columns: ThermalCardColumn[] = [
      { ticker: "SPY", heatmap: null },
      { ticker: "SPX", heatmap: null },
      { ticker: "QQQ", heatmap: null },
    ];
    const png = await renderThermalDiscordCardPng(columns);
    assert.ok(Buffer.isBuffer(png) && png.length > 0, "must still produce a real PNG buffer");
    assert.ok(
      process.env.XDG_CACHE_HOME && existsSync(process.env.XDG_CACHE_HOME),
      "rendering must leave a real, existing fontconfig cache dir behind for the next invocation"
    );
  } finally {
    if (prior === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = prior;
    __resetFontconfigCacheDirForTest();
  }
});
