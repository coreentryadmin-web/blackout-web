#!/usr/bin/env node
/**
 * PREVIEW ONLY — posts proposed Thermal Discord v2 format (embed + one-liners + links +
 * regime summary + cadence modes) using production embed builders.
 *
 * Usage:
 *   DISCORD_THERMAL_WEBHOOK_URL=… node scripts/thermal-discord-preview-v2.mjs
 *
 * Posts two messages tagged [PREVIEW]:
 *   1) Full snapshot — embed + PNG (production cadence :00/:30 style)
 *   2) Text-only pulse — embed only (production cadence :15/:45 quiet-tick style)
 */
import { writeFileSync } from "node:fs";
import { fetchGexHeatmap } from "../src/lib/providers/polygon-options-gex.ts";
import {
  THERMAL_DISCORD_TICKERS,
  renderThermalDiscordCardPng,
  type ThermalCardColumn,
} from "../src/lib/thermal-discord-card.ts";
import { buildThermalDiscordEmbed } from "../src/lib/thermal-discord-embed.ts";
import { postDiscordWebhookWithFiles, postDiscordWebhook, redactWebhook } from "../src/lib/discord-post.ts";

const PREVIEW_TAG = "**[PREVIEW — Thermal Discord v2 — not production]**";

/** Representative structure for format preview when live cache/Polygon is unreachable from sandbox. */
function buildPreviewSnapshotColumns(): ThermalCardColumn[] {
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
      available: cDrift != null || pDrift != null,
      delta_by_strike: {},
      wall_changes: {
        call_wall: cDrift != null ? { from: call_wall, to: call_wall, moved_pts: 0, grew_pct: cDrift } : undefined,
        put_wall: pDrift != null ? { from: put_wall, to: put_wall, moved_pts: 0, grew_pct: pDrift } : undefined,
      },
    },
    source: "preview",
    data_delay: "preview",
  });

  return [
    { ticker: "SPY", heatmap: mk("SPY", 771.51, 1.82, 775, 735, 744, -8.1, 2, "long") },
    { ticker: "SPX", heatmap: mk("SPX", 7736.63, 1.79, 7780, 7300, 7560, null, null, "long") },
    { ticker: "QQQ", heatmap: mk("QQQ", 723.52, 3.35, 720, 680, 710, 11.3, 1.4, "short") },
  ];
}

async function fetchLiveColumns(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  const columns = [];
  for (const ticker of THERMAL_DISCORD_TICKERS) {
    if (Date.now() > deadline) break;
    process.stdout.write(`fetch ${ticker}... `);
    try {
      const heatmap = await Promise.race([
        fetchGexHeatmap(ticker, { forceRefresh: true }),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), Math.max(5_000, deadline - Date.now()))),
      ]);
      console.log(heatmap ? `ok spot=${heatmap.spot}` : "null");
      columns.push({ ticker, heatmap });
    } catch (e) {
      console.log("skip", e.message);
      columns.push({ ticker, heatmap: null });
    }
  }
  return columns.filter((c) => c.heatmap).length ? columns : null;
}

async function resolveWebhook() {
  return process.env.DISCORD_THERMAL_WEBHOOK_URL?.trim() || null;
}

const webhook = await resolveWebhook();
if (!webhook) {
  console.error("DISCORD_THERMAL_WEBHOOK_URL unset");
  process.exit(1);
}

console.log("webhook host:", redactWebhook(webhook));

let columns = await fetchLiveColumns(45_000);
let dataNote = "live cache/Polygon snapshot";
if (!columns || !columns.some((c) => c.heatmap)) {
  console.log("live fetch unavailable — using representative preview snapshot for layout demo");
  columns = buildPreviewSnapshotColumns();
  dataNote = "representative layout preview (sandbox could not reach live heatmap cache)";
}

const available = columns.filter((c) => c.heatmap).length;
if (!available) {
  console.error("No heatmap data for preview");
  process.exit(2);
}

// ── Message 1: full snapshot (embed + PNG) ──
const png = await renderThermalDiscordCardPng(columns);
writeFileSync("/opt/cursor/artifacts/thermal-discord-preview-v2-full.png", png);
console.log("png bytes", png.byteLength);

const embedFull = buildThermalDiscordEmbed(columns, "full");
embedFull.footer = {
  text: `${embedFull.footer?.text ?? ""} · PREVIEW · ${dataNote}`,
};

const ok1 = await postDiscordWebhookWithFiles(
  webhook,
  { content: PREVIEW_TAG, embeds: [embedFull] },
  [{ filename: "thermal-desk.png", bytes: png, contentType: "image/png" }],
  "thermal-preview-v2-full"
);
console.log("full snapshot delivered:", ok1);

// ── Message 2: text-only pulse (cadence demo) ──
const embedPulse = buildThermalDiscordEmbed(columns, "pulse");
embedPulse.footer = {
  text: `${embedPulse.footer?.text ?? ""} · PREVIEW · ${dataNote}`,
};

const ok2 = await postDiscordWebhook(
  webhook,
  {
    content: `${PREVIEW_TAG}\n_This second message shows the **text-only** cadence (no PNG attachment)._`,
    embeds: [embedPulse],
  },
  "thermal-preview-v2-pulse"
);
console.log("text-only pulse delivered:", ok2);

process.exit(ok1 && ok2 ? 0 : 1);
