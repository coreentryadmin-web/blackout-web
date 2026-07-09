/**
 * Tool agent registry — one dedicated agent per premium surface.
 */
import { spawnSync } from "node:child_process";
import {
  appendFinding,
  cronFetch,
  queryPlayOutcomes,
  analyzeSpxPlay,
  runScript,
  writeCtoReport,
} from "./_lib/base.mjs";
import { probeDataCorrectness } from "../audit/lib/data-correctness-probe.mjs";

const BASE = (process.env.CRON_TARGET_BASE_URL ?? "https://blackouttrades.com").replace(/\/$/, "");
const CRON = process.env.CRON_SECRET?.trim() ?? "";

function record(toolKey, findings, f) {
  findings.push(f);
  appendFinding(toolKey, f);
}

function matrixAudit(tickers) {
  return runScript("node", [
    "scripts/heatmap-matrix-audit.mjs",
    `--tickers=${tickers.join(",")}`,
    `--base=${BASE}`,
  ]);
}

export function buildAgent(def) {
  const state = { lastFindings: [], lastLatency: {}, lastPlay: null };
  const agent = {
    ...def,
    lastFindings: [],
    async tick(tickNum) {
      const findings = [];
      const latency = {};
      const checks = [];

      if (!CRON) {
        record(def.key, findings, { severity: "P0", id: "no-cron-secret", detail: "CRON_SECRET unset" });
        state.lastFindings = findings;
        return { findings, checks, skip: true };
      }

      for (const api of def.apis) {
        const r = await cronFetch(BASE, api.path, CRON);
        latency[api.key] = r.ms;
        const ok = r.status === 200 && r.json != null;
        checks.push({ key: api.key, ok, ms: r.ms, status: r.status });
        if (!ok) record(def.key, findings, { severity: "P1", id: `api-${api.key}`, detail: `HTTP ${r.status}` });
        else if (r.ms > (api.maxMs ?? 2000))
          record(def.key, findings, { severity: "P1", id: `slow-${api.key}`, detail: `${r.ms}ms` });
        if (api.validate) {
          const v = api.validate(r.json);
          if (v) record(def.key, findings, { severity: v.severity ?? "P1", id: v.id, detail: v.detail });
        }
      }

      if (def.playSurface && tickNum % 2 === 0) {
        const outcomes = await queryPlayOutcomes(def.playSurface);
        const playApi = def.apis.find((a) => a.key === "play");
        const playRes = playApi ? await cronFetch(BASE, playApi.path, CRON) : null;
        state.lastPlay = { outcomes, play: playRes?.json };
        if (def.playSurface === "spx") {
          for (const a of analyzeSpxPlay(playRes?.json, outcomes)) record(def.key, findings, a);
        }
        for (const f of outcomes?.failed ?? []) {
          record(def.key, findings, {
            severity: "P1",
            id: `outcome-${f.open_play_id ?? f.id}`,
            category: "play_failure",
            detail: `${f.outcome}: ${JSON.stringify(f).slice(0, 200)}`,
          });
        }
      }

      if (def.matrixTickers?.length && tickNum % def.matrixEvery === 0) {
        const m = matrixAudit(def.matrixTickers);
        checks.push({ key: "matrix-audit", ok: m.ok, ms: m.ms, tail: m.tail });
        if (!m.ok)
          record(def.key, findings, { severity: "P1", id: "matrix-audit", category: "matrix_cell", detail: m.tail });
      }

      if (def.e2eScript && tickNum % def.e2eEvery === 0) {
        const e = runScript("npm", ["run", def.e2eScript]);
        checks.push({ key: "e2e", ok: e.ok, ms: e.ms, tail: e.tail });
        if (!e.ok) record(def.key, findings, { severity: "P1", id: "e2e", detail: e.tail });
      }

      if (def.dataSurface && tickNum % 5 === 0) {
        const dc = await probeDataCorrectness({ base: BASE, cronSecret: CRON, tryFull: false });
        checks.push({ key: "data-correctness", ok: dc.ok, flags: dc.flags });
        if (!dc.ok)
          record(def.key, findings, {
            severity: "P1",
            id: "data-correctness",
            category: "data_correctness",
            detail: `${dc.flags} flags mode=${dc.mode}`,
          });
      }

      state.lastFindings = findings;
      state.lastLatency = latency;
      agent.lastFindings = findings;

      console.log(
        `[${def.key}] tick=${tickNum} apis=${checks.filter((c) => c.ok).length}/${checks.length} findings=${findings.length}`
      );

      return { findings, checks, latency, play: state.lastPlay };
    },
    writeReport(result) {
      const p1 = (result.findings ?? []).filter((f) => f.severity === "P1");
      const blocks = [
        {
          heading: "Executive summary",
          body: [
            `| Metric | Value |`,
            `| --- | --- |`,
            `| Tick | ${result.tick ?? "?"} |`,
            `| P1 findings | ${p1.length} |`,
            `| APIs checked | ${(result.checks ?? []).length} |`,
          ].join("\n"),
        },
        {
          heading: "1. Data correctness",
          body:
            p1.filter((f) => f.category === "data_correctness" || f.id?.startsWith("api-")).length
              ? p1.map((f) => `- **${f.id}**: ${f.detail}`).join("\n")
              : "All probed APIs returned 200 with in-band numbers.",
        },
        {
          heading: "2. Play quality & failures",
          body: state.lastPlay
            ? [
                `Open/failed outcomes loaded from Postgres.`,
                ...(result.findings ?? [])
                  .filter((f) => f.category === "play_failure" || f.id?.startsWith("play-"))
                  .map((f) => `- **${f.id}**: ${f.detail}`),
              ].join("\n") || "No play failures this window."
            : "Play surface not configured or skipped.",
        },
        {
          heading: "3. Matrix cells",
          body:
            (result.checks ?? []).find((c) => c.key === "matrix-audit")
              ? (result.checks.find((c) => c.key === "matrix-audit").ok
                  ? "Matrix audit GREEN — Σ strikes == headline, walls derivable."
                  : `Matrix audit FAIL: ${result.checks.find((c) => c.key === "matrix-audit").tail}`)
              : "Matrix audit on next deep tick.",
        },
        {
          heading: "4. Latency",
          body: Object.entries(state.lastLatency)
            .map(([k, ms]) => `- \`${k}\`: ${ms}ms`)
            .join("\n") || "—",
        },
        {
          heading: "5. Fix loop",
          body: [
            "1. Read `findings.ndjson` for this tool",
            "2. Branch `fix/<tool>-<slug>` → patch → `npm test` / tool e2e",
            "3. PR → auto-merge → `npm run validate:tool-agent:" + def.key + "` until GREEN",
          ].join("\n"),
        },
      ];
      writeCtoReport(def.key, { title: def.label, blocks });
    },
  };
  return agent;
}

export const TOOL_AGENTS = {
  "spx-slayer": buildAgent({
    key: "spx-slayer",
    label: "SPX Slayer",
    route: "/dashboard",
    intervalMs: 90_000,
    reportEvery: 3,
    matrixEvery: 2,
    e2eEvery: 4,
    matrixTickers: ["SPX"],
    e2eScript: "validate:spx-e2e",
    playSurface: "spx",
    dataSurface: "spx",
    apis: [
      { key: "desk", path: "/api/market/spx/desk", maxMs: 1500 },
      { key: "pulse", path: "/api/market/spx/pulse", maxMs: 800 },
      { key: "bootstrap", path: "/api/market/spx/bootstrap", maxMs: 1500 },
      { key: "play", path: "/api/market/spx/play", maxMs: 800 },
      { key: "gex-matrix", path: "/api/market/gex-heatmap?ticker=SPX", maxMs: 2000 },
      { key: "positioning", path: "/api/market/gex-positioning?ticker=SPX", maxMs: 1200 },
      {
        key: "merged",
        path: "/api/market/spx/merged",
        maxMs: 1200,
        validate: (j) => {
          const spot = j?.merged?.price ?? j?.price;
          if (!Number.isFinite(Number(spot))) return { id: "merged-no-spot", detail: "missing spot" };
          return null;
        },
      },
    ],
  }),

  thermal: buildAgent({
    key: "thermal",
    label: "BlackOut Thermal",
    route: "/heatmap",
    intervalMs: 120_000,
    reportEvery: 3,
    matrixEvery: 2,
    e2eEvery: 6,
    matrixTickers: ["SPX", "SPY", "QQQ", "NVDA"],
    dataSurface: "heatmap",
    apis: [
      { key: "gex-spx", path: "/api/market/gex-heatmap?ticker=SPX", maxMs: 2000 },
      { key: "gex-spy", path: "/api/market/gex-heatmap?ticker=SPY", maxMs: 2000 },
      { key: "positioning-spx", path: "/api/market/gex-positioning?ticker=SPX", maxMs: 1200 },
      {
        key: "gex-spx-cells",
        path: "/api/market/gex-heatmap?ticker=SPX",
        validate: (j) => {
          const n = Object.keys(j?.gex?.strike_totals ?? {}).length;
          if (n < 15) return { id: "thin-matrix", detail: `only ${n} strikes` };
          return null;
        },
      },
    ],
  }),

  helix: buildAgent({
    key: "helix",
    label: "HELIX Flows",
    route: "/flows",
    intervalMs: 60_000,
    reportEvery: 5,
    matrixEvery: 99,
    e2eEvery: 8,
    apis: [
      { key: "flows", path: "/api/market/flows?limit=50", maxMs: 1500 },
      {
        key: "flows-rows",
        path: "/api/market/flows?limit=50",
        validate: (j) => {
          const rows = j?.flows ?? j?.items ?? [];
          if (!Array.isArray(rows)) return { id: "flows-shape", detail: "not array" };
          if (rows.length === 0) return { severity: "P2", id: "flows-empty", detail: "zero rows RTH" };
          const bad = rows.find((r) => !Number.isFinite(Number(r?.premium ?? r?.total_premium)));
          if (bad) return { id: "flows-bad-premium", detail: JSON.stringify(bad).slice(0, 80) };
          return null;
        },
      },
    ],
  }),

  largo: buildAgent({
    key: "largo",
    label: "Largo AI",
    route: "/terminal",
    intervalMs: 180_000,
    reportEvery: 2,
    matrixEvery: 99,
    e2eEvery: 6,
    apis: [
      { key: "platform", path: "/api/market/platform/snapshot", maxMs: 2000 },
    ],
  }),

  nighthawk: buildAgent({
    key: "nighthawk",
    label: "Night Hawk",
    route: "/nighthawk",
    intervalMs: 120_000,
    reportEvery: 3,
    matrixEvery: 99,
    e2eEvery: 6,
    playSurface: "nighthawk",
    apis: [
      { key: "edition", path: "/api/market/nighthawk/edition", maxMs: 1200 },
      {
        key: "edition-plays",
        path: "/api/market/nighthawk/edition",
        validate: (j) => {
          const plays = j?.plays ?? j?.edition?.plays ?? [];
          if (!Array.isArray(plays)) return null;
          const bad = plays.find((p) => p?.ticker && !Number.isFinite(Number(p?.premium ?? p?.entry_premium)));
          if (bad) return { id: "play-bad-premium", detail: String(bad.ticker) };
          return null;
        },
      },
    ],
  }),

  zerodte: buildAgent({
    key: "zerodte",
    label: "0DTE Command",
    route: "/nighthawk",
    intervalMs: 120_000,
    reportEvery: 3,
    matrixEvery: 99,
    e2eEvery: 4,
    e2eScript: "validate:grid-e2e",
    playSurface: "zerodte",
    apis: [
      { key: "board", path: "/api/market/zerodte/board", maxMs: 1200 },
      {
        key: "board-rows",
        path: "/api/market/zerodte/board",
        validate: (j) => {
          const setups = j?.setups ?? j?.board ?? [];
          if (!Array.isArray(setups)) return { id: "board-shape", detail: "not array" };
          return null;
        },
      },
    ],
  }),

  vector: buildAgent({
    key: "vector",
    label: "Vector",
    route: "/vector",
    intervalMs: 60_000,
    reportEvery: 5,
    matrixEvery: 3,
    e2eEvery: 6,
    e2eScript: "validate:vector-e2e",
    matrixTickers: ["SPX"],
    apis: [
      { key: "universe", path: "/api/market/vector/universe", maxMs: 1200 },
      { key: "gex-spx", path: "/api/market/gex-heatmap?ticker=SPX", maxMs: 2000 },
      {
        key: "universe-rows",
        path: "/api/market/vector/universe",
        validate: (j) => {
          const n = j?.rows?.length ?? 0;
          if (n < 10) return { severity: "P2", id: "universe-thin", detail: `${n} rows` };
          return null;
        },
      },
    ],
  }),
};

export const TOOL_KEYS = Object.keys(TOOL_AGENTS);
