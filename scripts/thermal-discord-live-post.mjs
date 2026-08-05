#!/usr/bin/env node
/**
 * One-shot: fetch live SPY/SPX/QQQ heatmaps → PNG → Discord.
 * Loads keys from env (or pass via Secrets Manager dump into env before run).
 * Never prints webhook URL/token.
 */
import { writeFileSync } from "node:fs";
import { fetchGexHeatmap } from "../src/lib/providers/polygon-options-gex.ts";
import * as card from "../src/lib/thermal-discord-card.ts";
import { buildThermalDiscordEmbed } from "../src/lib/thermal-discord-embed.ts";
import { postDiscordWebhookWithFiles, redactWebhook } from "../src/lib/discord-post.ts";

const tickers = card.THERMAL_DISCORD_TICKERS ?? ["SPY", "SPX", "QQQ"];
const webhook = process.env.DISCORD_THERMAL_WEBHOOK_URL?.trim();
if (!webhook) {
  console.error("DISCORD_THERMAL_WEBHOOK_URL unset");
  process.exit(1);
}
// Prefer POLYGON_API_BASE from env / Secrets Manager. Provider code self-defaults if unset.

const columns = [];
for (const ticker of tickers) {
  process.stdout.write(`fetch ${ticker}... `);
  const heatmap = await fetchGexHeatmap(ticker);
  console.log(
    heatmap
      ? `ok spot=${heatmap.spot} expiries=${heatmap.expiries?.length ?? 0}`
      : "null"
  );
  columns.push({ ticker, heatmap });
}

const available = columns.filter((c) => c.heatmap).length;
if (!available) {
  console.error("No heatmap snapshots available");
  process.exit(2);
}

const png = await card.renderThermalDiscordCardPng(columns);
writeFileSync("/opt/cursor/artifacts/thermal-discord-live.png", png);
console.log("png bytes", png.byteLength, "host", redactWebhook(webhook));

const embed = buildThermalDiscordEmbed(columns, "full");
const ok = await postDiscordWebhookWithFiles(
  webhook,
  { embeds: [embed] },
  [{ filename: "thermal-desk.png", bytes: png, contentType: "image/png" }],
  "thermal-desk-live"
);
console.log("delivered", ok);
process.exit(ok ? 0 : 1);
