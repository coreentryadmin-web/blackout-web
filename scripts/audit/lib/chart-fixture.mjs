/**
 * CHART FIXTURES — render real market data into a real PNG chart.
 *
 * WHY NOT A CANNED IMAGE. A committed screenshot proves only that the upload plumbing moves bytes.
 * The question that matters is whether Largo READS a chart correctly, and to grade that you must
 * know what the chart says. So the fixture is built from REAL Polygon minute bars: the ticker, the
 * session, the open/close, the high/low and the direction are all known facts before the image
 * exists, and the answer can be scored against them rather than eyeballed.
 *
 * WHY CHROMIUM. Producing a PNG needs a rasteriser. Chromium is already installed here, and
 * rendering a `data:` document requires no network — which matters because Chromium in this sandbox
 * cannot reach the network at all (see docs/audit/LIVE-UI-CONNECTION.md). Bars are fetched with
 * `fetch` through the agent proxy, the drawing happens offline, and the two never mix.
 */

import { chromium } from "playwright";

const POLY_BASE = process.env.POLYGON_API_BASE?.match(/^https?:/)
  ? process.env.POLYGON_API_BASE
  : "https://api.polygon.io";

/** Fetch one session of minute bars. Returns null rather than throwing when the day is empty. */
export async function fetchSessionBars(ticker, date) {
  const key = process.env.POLYGON_API_KEY;
  if (!key) throw new Error("POLYGON_API_KEY required to build a chart fixture");
  const url =
    `${POLY_BASE}/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/5/minute/${date}/${date}` +
    `?adjusted=true&sort=asc&limit=500&apiKey=${key}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const json = await res.json();
  const bars = Array.isArray(json.results) ? json.results : [];
  return bars.length ? bars : null;
}

/** The facts the chart depicts — the answer key this fixture is graded against. */
export function chartGroundTruth(ticker, date, bars) {
  const open = bars[0].o;
  const close = bars[bars.length - 1].c;
  const high = Math.max(...bars.map((b) => b.h));
  const low = Math.min(...bars.map((b) => b.l));
  return {
    ticker,
    date,
    open,
    close,
    high,
    low,
    changePct: ((close - open) / open) * 100,
    direction: close > open ? "up" : close < open ? "down" : "flat",
    bars: bars.length,
  };
}

/**
 * Draw a candlestick chart that looks like a trading platform, because that is what members
 * actually paste. A bare line on white would be an easier read than the real thing and would
 * flatter the result.
 */
function chartHtml(truth, bars, { labelTicker = true } = {}) {
  const W = 1200;
  const H = 680;
  const padL = 70;
  const padR = 24;
  const padT = 54;
  const padB = 40;
  const lo = truth.low;
  const hi = truth.high;
  const span = hi - lo || 1;
  const x = (i) => padL + (i / Math.max(1, bars.length - 1)) * (W - padL - padR);
  const y = (p) => padT + (1 - (p - lo) / span) * (H - padT - padB);
  const bw = Math.max(2, (W - padL - padR) / bars.length - 1.5);

  const candles = bars
    .map((b, i) => {
      const up = b.c >= b.o;
      const color = up ? "#22c55e" : "#ef4444";
      const yO = y(b.o);
      const yC = y(b.c);
      const top = Math.min(yO, yC);
      const bodyH = Math.max(1, Math.abs(yC - yO));
      return (
        `<rect x="${(x(i) - 0.5).toFixed(1)}" y="${y(b.h).toFixed(1)}" width="1" ` +
        `height="${Math.max(1, y(b.l) - y(b.h)).toFixed(1)}" fill="${color}"/>` +
        `<rect x="${(x(i) - bw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" ` +
        `height="${bodyH.toFixed(1)}" fill="${color}"/>`
      );
    })
    .join("");

  const ticks = Array.from({ length: 6 }, (_, i) => {
    const p = lo + (span * i) / 5;
    return (
      `<line x1="${padL}" y1="${y(p).toFixed(1)}" x2="${W - padR}" y2="${y(p).toFixed(1)}" stroke="#1e293b"/>` +
      `<text x="${padL - 8}" y="${(y(p) + 4).toFixed(1)}" fill="#94a3b8" font-size="13" text-anchor="end">${p.toFixed(2)}</text>`
    );
  }).join("");

  const title = labelTicker
    ? `${truth.ticker} · 5m · ${truth.date}`
    : `5m · ${truth.date}`;
  const last = `${truth.close.toFixed(2)}  (${truth.changePct >= 0 ? "+" : ""}${truth.changePct.toFixed(2)}%)`;

  return `<!doctype html><html><body style="margin:0;background:#0b1220">
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" style="display:block;font-family:Arial,Helvetica,sans-serif">
  <rect width="${W}" height="${H}" fill="#0b1220"/>
  ${ticks}
  <text x="${padL}" y="30" fill="#e2e8f0" font-size="20" font-weight="bold">${title}</text>
  <text x="${W - padR}" y="30" fill="${truth.changePct >= 0 ? "#22c55e" : "#ef4444"}" font-size="20" text-anchor="end">${last}</text>
  ${candles}
</svg></body></html>`;
}

/**
 * Render a chart to a PNG buffer.
 *
 * `labelTicker: false` produces the deliberately harder fixture — a chart with no symbol on it.
 * The correct answer there is "I can't tell which instrument this is", and a model that names one
 * anyway has invented it, which is precisely the failure the guidance block exists to prevent.
 */
export async function renderChartPng(truth, bars, opts = {}) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 680 } });
    await page.setContent(chartHtml(truth, bars, opts), { waitUntil: "load" });
    return await page.screenshot({ type: "png" });
  } finally {
    await browser.close();
  }
}
