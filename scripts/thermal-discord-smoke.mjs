#!/usr/bin/env node
/**
 * One-shot smoke: render a Thermal desk PNG and POST to DISCORD_THERMAL_WEBHOOK_URL.
 * Uses synthetic matrices when POLYGON keys are absent — never prints the webhook.
 *
 *   DISCORD_THERMAL_WEBHOOK_URL=… node scripts/thermal-discord-smoke.mjs
 */
import sharp from "sharp";
import { writeFileSync } from "node:fs";

const webhook = process.env.DISCORD_THERMAL_WEBHOOK_URL?.trim();
if (!webhook) {
  console.error("DISCORD_THERMAL_WEBHOOK_URL unset");
  process.exit(1);
}

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cellFill(value, peak) {
  if (!value || peak <= 0) return "rgba(255,255,255,0.03)";
  const mag = Math.min(1, Math.abs(value) / peak);
  const alpha = (0.08 + Math.pow(mag, 1.35) * 0.82).toFixed(3);
  const rgb = value > 0 ? "0,230,118" : "255,45,85";
  return `rgba(${rgb},${alpha})`;
}

function synthColumn(ticker, spot, call, put) {
  const strikes = [];
  for (let i = -12; i <= 12; i++) strikes.push(Math.round(spot + i * (ticker === "SPX" ? 5 : 1)));
  const expiries = ["2026-07-28", "2026-07-29", "2026-07-30", "2026-07-31", "2026-08-01"];
  const cells = {};
  let peak = 0;
  for (const s of strikes) {
    cells[String(s)] = {};
    for (const e of expiries) {
      const dist = Math.abs(s - spot);
      const v = (s > spot ? 1 : -1) * Math.exp(-dist / (spot * 0.01)) * 5_000_000 * (0.6 + Math.random());
      cells[String(s)][e] = v;
      peak = Math.max(peak, Math.abs(v));
    }
  }
  return { ticker, spot, call, put, strikes, expiries, cells, peak };
}

const cols = [
  synthColumn("SPY", 634.2, 640, 630),
  synthColumn("SPX", 6345, 6400, 6300),
  synthColumn("QQQ", 568.4, 575, 560),
];

const W = 1400;
const H = 780;
const pad = 28;
const headerH = 72;
const colGap = 14;
const usable = W - pad * 2 - colGap * 2;
const colW = usable / 3;
const colTop = pad + headerH;
const colH = H - colTop - pad;

let colsSvg = "";
cols.forEach((col, i) => {
  const x0 = pad + i * (colW + colGap);
  colsSvg += `<rect x="${x0}" y="${colTop}" width="${colW}" height="${colH}" rx="10" fill="#08090e" stroke="rgba(34,211,238,0.28)" stroke-width="1.5"/>`;
  colsSvg += `<text x="${x0 + 14}" y="${colTop + 22}" fill="#f8fafc" font-family="ui-monospace,Menlo,monospace" font-size="22" font-weight="800">${esc(col.ticker)}</text>`;
  colsSvg += `<text x="${x0 + colW - 14}" y="${colTop + 22}" text-anchor="end" fill="#22d3ee" font-family="ui-monospace,Menlo,monospace" font-size="18" font-weight="700">${col.spot.toFixed(2)}</text>`;
  colsSvg += `<text x="${x0 + 14}" y="${colTop + 44}" fill="#ffd60a" font-family="ui-monospace,Menlo,monospace" font-size="12" font-weight="700">C ${col.call}</text>`;
  colsSvg += `<text x="${x0 + 90}" y="${colTop + 44}" fill="#e9d5ff" font-family="ui-monospace,Menlo,monospace" font-size="12" font-weight="700">P ${col.put}</text>`;
  const gridTop = colTop + 58;
  const strikeColW = 42;
  const gridLeft = x0 + 8;
  const gridW = colW - 16 - strikeColW;
  const cellW = gridW / col.expiries.length;
  const cellH = Math.min(18, (colH - 70) / col.strikes.length);
  col.expiries.forEach((exp, ei) => {
    const [y, m, d] = exp.split("-").map(Number);
    colsSvg += `<text x="${gridLeft + strikeColW + ei * cellW + cellW / 2}" y="${gridTop}" text-anchor="middle" fill="#22d3ee" font-family="ui-monospace,Menlo,monospace" font-size="9" font-weight="700">${m}/${d}</text>`;
  });
  col.strikes.forEach((strike, si) => {
    const y = gridTop + 6 + si * cellH;
    const isSpot = Math.abs(strike - col.spot) < (col.ticker === "SPX" ? 3 : 0.6);
    colsSvg += `<text x="${gridLeft + strikeColW - 4}" y="${y + cellH * 0.72}" text-anchor="end" fill="${isSpot ? "#22d3ee" : "#f8fafc"}" font-family="ui-monospace,Menlo,monospace" font-size="9" font-weight="700">${strike}</text>`;
    col.expiries.forEach((exp, ei) => {
      const n = col.cells[String(strike)][exp];
      const cx = gridLeft + strikeColW + ei * cellW;
      colsSvg += `<rect x="${cx + 0.5}" y="${y}" width="${cellW - 1}" height="${cellH - 1}" fill="${cellFill(n, col.peak)}"${isSpot ? ` stroke="rgba(34,211,238,0.55)" stroke-width="0.8"` : ""}/>`;
    });
  });
});

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#0a1018"/><stop offset="100%" stop-color="#040407"/></linearGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <text x="${pad}" y="${pad + 28}" fill="#22d3ee" font-family="ui-monospace,Menlo,monospace" font-size="20" font-weight="800" letter-spacing="4">BLACKOUT THERMAL</text>
  <text x="${pad}" y="${pad + 52}" fill="#7dd3fc" font-family="ui-monospace,Menlo,monospace" font-size="13">SPY · SPX · QQQ · GEX · smoke test (synthetic until cron deploys)</text>
  ${colsSvg}
</svg>`;

const png = await sharp(Buffer.from(svg)).png().toBuffer();
const out = "/opt/cursor/artifacts/thermal-discord-smoke.png";
writeFileSync(out, png);
console.log("wrote", out, "bytes", png.byteLength);

const form = new FormData();
form.append(
  "payload_json",
  JSON.stringify({
    content:
      "Thermal desk · GEX (smoke test)\n**SPY** 634.20 · C 640 / P 630\n**SPX** 6345.00 · C 6400 / P 6300\n**QQQ** 568.40 · C 575 / P 560\n_Synthetic layout preview — live numbers start when the cron ships._",
  })
);
form.append("files[0]", new Blob([png], { type: "image/png" }), "thermal-desk.png");

const res = await fetch(`${webhook}?wait=true`, { method: "POST", body: form });
console.log("discord status", res.status, res.ok ? "OK" : "FAIL");
if (!res.ok) {
  const text = await res.text();
  console.error("discord body", text.slice(0, 300));
  process.exit(1);
}
console.log("posted to discord host", new URL(webhook).host);
