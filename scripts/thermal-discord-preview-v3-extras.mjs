#!/usr/bin/env node
/**
 * PREVIEW — posts three proposed Thermal Discord v3 extras to Discord:
 *   1) Full snapshot with shift-leader sub-lines
 *   2) Wall/flip breach alert (event-driven sample)
 *   3) 4:05 PM session-close recap embed
 *
 * Usage:
 *   DISCORD_THERMAL_WEBHOOK_URL=… node scripts/thermal-discord-preview-v3-extras.mjs
 */
import { writeFileSync } from "node:fs";
import { fetchGexHeatmap } from "../src/lib/providers/polygon-options-gex.ts";
import {
  THERMAL_DISCORD_TICKERS,
  renderThermalDiscordCardPng,
} from "../src/lib/thermal-discord-card.ts";
import {
  buildThermalDiscordEmbedWithExtras,
  buildThermalBreachAlertEmbed,
  buildThermalEodRecapEmbed,
  detectThermalBreaches,
} from "../src/lib/thermal-discord-extras.ts";
import { postDiscordWebhookWithFiles, postDiscordWebhook, redactWebhook } from "../src/lib/discord-post.ts";
import { todayEt } from "../src/lib/et-date.ts";

const PREVIEW_TAG = "**[PREVIEW — Thermal Discord v3 extras — not production]**";

function enrichShiftData(col) {
  const h = col.heatmap;
  if (!h?.gex) return;
  const spot = Math.round(h.spot);
  const strikes = [spot - 5, spot - 2, spot + 3, spot + 5, spot - 8].map((s) => String(s));
  h.gex.strike_totals = {
    [strikes[0]]: 1_200_000,
    [strikes[1]]: 800_000,
    [strikes[2]]: -950_000,
    [strikes[3]]: 2_100_000,
    [strikes[4]]: -600_000,
  };
  h.shift = {
    available: true,
    delta_by_strike: {
      [strikes[0]]: 250_000,
      [strikes[1]]: 180_000,
      [strikes[2]]: -320_000,
      [strikes[3]]: 410_000,
      [strikes[4]]: -150_000,
    },
    wall_changes: h.shift?.wall_changes ?? {},
  };
}

function buildPreviewSnapshotColumns() {
  const asof = new Date().toISOString();
  const expiries = ["2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07", "2026-08-08"];
  const mk = (underlying, spot, change_pct, call_wall, put_wall, flip, cDrift, pDrift, posture) => ({
    underlying,
    spot,
    change_pct,
    asof,
    expiries,
    near_term_expiries: expiries,
    strikes: Array.from({ length: 41 }, (_, i) => Math.round(spot - 20 + i)),
    max_pain: null,
    gex: {
      cells: Object.fromEntries(
        Array.from({ length: 41 }, (_, i) => {
          const strike = Math.round(spot - 20 + i);
          return [
            String(strike),
            Object.fromEntries(expiries.map((e, j) => [e, (strike % 3 === 0 ? 1 : -1) * (500_000 + j * 100_000)])),
          ];
        })
      ),
      strike_totals: {},
      call_wall,
      put_wall,
      total: 0,
      flip,
      regime: {
        flip,
        posture,
        read: posture === "long" ? "positive gamma — stabilizing" : posture === "short" ? "negative gamma — amplifying" : "undetermined",
      },
    },
    vex: { cells: {}, strike_totals: {}, pos_wall: null, neg_wall: null, total: 0, flip: null, regime: { posture: null, read: "" } },
    shift: {
      available: true,
      delta_by_strike: {},
      wall_changes: {
        call_wall: cDrift != null ? { from: call_wall, to: call_wall, moved_pts: 0, grew_pct: cDrift } : undefined,
        put_wall: pDrift != null ? { from: put_wall, to: put_wall, moved_pts: 0, grew_pct: pDrift } : undefined,
      },
    },
    source: "preview",
    data_delay: "preview",
  });

  const columns = [
    { ticker: "SPY", heatmap: mk("SPY", 771.51, 1.82, 775, 735, 744, -8.1, 2, "long") },
    { ticker: "SPX", heatmap: mk("SPX", 7736.63, 1.79, 7780, 7300, 7560, null, null, "long") },
    { ticker: "QQQ", heatmap: mk("QQQ", 723.52, 3.35, 720, 680, 710, 11.3, 1.4, "short") },
  ];
  for (const col of columns) enrichShiftData(col);
  return columns;
}

async function fetchLiveColumns(timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  const columns = [];
  for (const ticker of THERMAL_DISCORD_TICKERS) {
    if (Date.now() > deadline) break;
    process.stdout.write(`fetch ${ticker}... `);
    try {
      const heatmap = await Promise.race([
        fetchGexHeatmap(ticker),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), Math.max(5_000, deadline - Date.now()))),
      ]);
      console.log(heatmap ? `ok spot=${heatmap.spot}` : "null");
      columns.push({ ticker, heatmap });
    } catch (e) {
      console.log("skip", e.message);
    }
  }
  return columns.filter((c) => c.heatmap).length ? columns : null;
}

const webhook = process.env.DISCORD_THERMAL_WEBHOOK_URL?.trim();
if (!webhook) {
  console.error("DISCORD_THERMAL_WEBHOOK_URL unset");
  process.exit(1);
}
console.log("webhook host:", redactWebhook(webhook));

let columns = await fetchLiveColumns();
let dataNote = "live snapshot";
if (!columns) {
  console.log("live fetch unavailable — using representative preview data");
  columns = buildPreviewSnapshotColumns();
  dataNote = "representative preview data";
} else {
  for (const col of columns) enrichShiftData(col);
}

// ── 1) Full snapshot + shift leaders + PNG ──
const png = await renderThermalDiscordCardPng(columns);
writeFileSync("/opt/cursor/artifacts/thermal-v3-full-shift-leaders.png", png);

const embedFull = buildThermalDiscordEmbedWithExtras(columns, "full", { includeShiftLeaders: true });
embedFull.footer = { text: `${embedFull.footer?.text ?? ""} · shift leaders · PREVIEW` };

const ok1 = await postDiscordWebhookWithFiles(
  webhook,
  {
    content: `${PREVIEW_TAG}\n**Sample 1/3 — Full snapshot with shift-leader lines** (${dataNote})`,
    embeds: [embedFull],
  },
  [{ filename: "thermal-desk.png", bytes: png, contentType: "image/png" }],
  "thermal-v3-full-shift"
);
console.log("1/3 full+shift delivered:", ok1);

// ── 2) Breach alert — simulate SPY crossing flip (741 → 745 cross 744 flip) ──
const spyCol = columns.find((c) => c.ticker === "SPY") ?? columns[0];
const flip = spyCol?.heatmap?.gex?.flip ?? 744;
const breachCandidates = detectThermalBreaches(columns, {
  SPY: Number(flip) - 3,
  SPX: (spyCol?.heatmap?.gex?.flip ?? 7560) - 30,
  QQQ: (columns.find((c) => c.ticker === "QQQ")?.heatmap?.gex?.flip ?? 710) - 5,
});
const breachEvent =
  breachCandidates[0] ?? {
    ticker: "SPY",
    kind: "flip",
    spot: Number(spyCol?.heatmap?.spot ?? 771.51),
    level: Number(flip),
    direction: "crossed_above",
    priorSpot: Number(flip) - 3,
    asof: spyCol?.heatmap?.asof ?? new Date().toISOString(),
  };

const breachEmbed = buildThermalBreachAlertEmbed(breachEvent);

const ok2 = await postDiscordWebhook(
  webhook,
  {
    content: `${PREVIEW_TAG}\n**Sample 2/3 — Event-driven wall/flip breach alert** (${dataNote})`,
    embeds: [breachEmbed],
  },
  "thermal-v3-breach"
);
console.log("2/3 breach delivered:", ok2);

// ── 3) Session close recap (~4:05 PM ET style) ──
const recapEmbed = buildThermalEodRecapEmbed(columns, todayEt());
recapEmbed.footer = { text: `${recapEmbed.footer?.text ?? ""} · PREVIEW` };

const ok3 = await postDiscordWebhook(
  webhook,
  {
    content: `${PREVIEW_TAG}\n**Sample 3/3 — Session close recap (4:05 PM ET cadence)** (${dataNote})`,
    embeds: [recapEmbed],
  },
  "thermal-v3-eod"
);
console.log("3/3 EOD recap delivered:", ok3);

process.exit(ok1 && ok2 && ok3 ? 0 : 1);
