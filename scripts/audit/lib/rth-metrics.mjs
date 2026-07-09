/**
 * Shared RTH metrics sink — NDJSON for latency regression analysis.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ROOT =
  process.env.RTH_METRICS_DIR ||
  join(process.cwd(), "audit-output", "rth-continuous");

export function metricsPathForDate(ymd = new Date().toISOString().slice(0, 10)) {
  const dir = join(ROOT, ymd);
  mkdirSync(dir, { recursive: true });
  return join(dir, "metrics.ndjson");
}

export function appendMetric(entry, ymd) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
  appendFileSync(metricsPathForDate(ymd), line + "\n");
  return line;
}

/** P1 latency thresholds (ms) — warm-path expectations during RTH */
export const THRESHOLDS = {
  apiFast: 2000,
  apiWarm: 1200,
  pageDom: 2000,
  pageReady: 2500,
  navSoft: 1500,
  matrixMinRows: 15,
};

export const FAST_APIS = [
  { key: "ready", path: "/api/ready", warmMax: 400 },
  { key: "spx-bootstrap", path: "/api/market/spx/bootstrap", warmMax: 800 },
  { key: "spx-desk", path: "/api/market/spx/desk", warmMax: 800 },
  { key: "spx-pulse", path: "/api/market/spx/pulse", warmMax: 500 },
  { key: "spx-play", path: "/api/market/spx/play", warmMax: 500 },
  { key: "gex-spx", path: "/api/market/gex-heatmap?ticker=SPX", warmMax: 1200 },
  { key: "gex-spy", path: "/api/market/gex-heatmap?ticker=SPY", warmMax: 1200 },
  { key: "gex-pos", path: "/api/market/gex-positioning?ticker=SPX", warmMax: 800 },
  { key: "vector-universe", path: "/api/market/vector/universe", warmMax: 800 },
  { key: "flows", path: "/api/market/flows?limit=30", warmMax: 800 },
  { key: "zerodte", path: "/api/market/zerodte/board", warmMax: 600 },
  { key: "nighthawk", path: "/api/market/nighthawk/edition", warmMax: 600 },
];

export const NAV_TOOLS = [
  { path: "/dashboard", navLabel: /SPX Slayer/i, ready: () => document.querySelectorAll(".spx-gex-matrix-table tbody tr").length },
  { path: "/flows", navLabel: /HELIX/i, ready: () => document.body.innerText.length > 400 },
  { path: "/heatmap", navLabel: /BlackOut Thermal|Thermal/i, ready: () => document.querySelector(".gex-heatmap-panel") != null },
  { path: "/vector", navLabel: /Vector/i, ready: () => document.querySelector(".vector-chart-canvas") != null },
  { path: "/terminal", navLabel: /Largo/i, ready: () => document.querySelector(".largo-chat-container") != null },
  { path: "/nighthawk", navLabel: /Night Hawk/i, ready: () => document.body.innerText.length > 300 },
];
