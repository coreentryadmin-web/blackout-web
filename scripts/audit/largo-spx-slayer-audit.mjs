#!/usr/bin/env node
/**
 * SPX Slayer Largo comprehensive audit — desk + every submodule + edge cases.
 *
 *   node --import tsx scripts/audit/largo-spx-slayer-audit.mjs
 *   LARGO_SPX_AUDIT_LIMIT=5 node --import tsx scripts/audit/largo-spx-slayer-audit.mjs
 *   LARGO_SPX_AUDIT_OFFSET=12 LARGO_SPX_AUDIT_OUT=audit-output/largo-spx-slayer-audit-13-44.json ...
 *
 * READ-ONLY against production; temp Clerk user deleted in finally.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";
import { submodulesForDesk } from "../../src/lib/largo/slash-submodules.ts";
import { deskScopeConfig } from "../../src/lib/largo/desk-scope.ts";
import { scoreSpxScenario } from "./largo-spx-slayer-scoring.mjs";

const BASE = (process.env.LARGO_BASE_URL ?? "https://blackouttrades.com").replace(/\/$/, "");
const OUT = process.env.LARGO_SPX_AUDIT_OUT ?? "audit-output/largo-spx-slayer-audit.json";
const limit = process.env.LARGO_SPX_AUDIT_LIMIT ? Number(process.env.LARGO_SPX_AUDIT_LIMIT) : null;
const offset = process.env.LARGO_SPX_AUDIT_OFFSET ? Number(process.env.LARGO_SPX_AUDIT_OFFSET) : 0;

const deskCfg = deskScopeConfig("spx-slayer");
const submodules = submodulesForDesk("spx-slayer");

/** Build scenario matrix from live submodule registry. */
function buildScenarios() {
  const scenarios = [];

  scenarios.push({
    id: "desk-default-concrete",
    label: "SPX Slayer desk — default concrete",
    question: "What's the SPX setup right now — flip, walls, and dealer positioning?",
    desk_scope: "spx-slayer",
    depth: "concrete",
    preferredTools: deskCfg?.preferredTools,
    requireTopic: /\b(flip|wall|gamma|phase|play|spx)\b/i,
  });

  scenarios.push({
    id: "desk-default-deep",
    label: "SPX Slayer desk — deep dive",
    question: "Give me the full SPX Slayer read — play engine, GEX matrix, gates, and confluence.",
    desk_scope: "spx-slayer",
    depth: "deep",
    preferredTools: deskCfg?.preferredTools,
    minLen: 200,
    requireTopic: /\b(gex|gate|play|flip|wall)\b/i,
  });

  for (const mod of submodules) {
    scenarios.push({
      id: `sub-${mod.id}-concrete`,
      label: `${mod.label} — concrete`,
      question: mod.defaultQuestion("SPX"),
      desk_scope: "spx-slayer",
      desk_scope_args: { submodule: mod.id },
      submodule: mod.id,
      depth: "concrete",
      preferredTools: mod.preferredTools,
      maxLen: 4500,
    });
    scenarios.push({
      id: `sub-${mod.id}-deep`,
      label: `${mod.label} — deep`,
      question: `${mod.defaultQuestion("SPX")} Break it down with exact levels and gate detail.`,
      desk_scope: "spx-slayer",
      desk_scope_args: { submodule: mod.id },
      submodule: mod.id,
      depth: "deep",
      preferredTools: mod.preferredTools,
      minLen: 150,
    });
  }

  const edges = [
    {
      id: "edge-fomc-today",
      label: "FOMC / macro today",
      question: "Is there FOMC or any macro event today — and how should it change the SPX play?",
      desk_scope: "spx-slayer",
      depth: "concrete",
      requireTopic: /\b(fomc|cpi|macro|event|calendar|none|no scheduled|off-hours|gate)\b/i,
    },
    {
      id: "edge-cpi-gates",
      label: "CPI + gates",
      question: "CPI drops in 30 minutes — walk SPX gates and what fails if VIX spikes.",
      desk_scope: "spx-slayer",
      desk_scope_args: { submodule: "gates" },
      submodule: "gates",
      depth: "concrete",
      requireTopic: /\b(gate|vix|cpi|macro|block|pass|fail)\b/i,
    },
    {
      id: "edge-vix-unavailable",
      label: "VIX unavailable gate",
      question: "Is VIX data available and does G-4 pass on SPX right now?",
      desk_scope: "spx-slayer",
      desk_scope_args: { submodule: "gates" },
      submodule: "gates",
      depth: "concrete",
      requireTopic: /\b(vix|gate|g-?4|pass|fail|unavailable|available)\b/i,
    },
    {
      id: "edge-should-i-trade",
      label: "Should I trade",
      question: "Should I take a new SPX 0DTE trade right now?",
      desk_scope: "spx-slayer",
      depth: "concrete",
      requireTopic: /\b(gate|phase|action|wait|hold|no new|blocked|grade|play)\b/i,
    },
    {
      id: "edge-spx-vs-spy-gamma",
      label: "SPX vs SPY gamma",
      question: "Compare SPX vs SPY dealer gamma — flip and walls side by side.",
      desk_scope: "spx-slayer",
      desk_scope_args: { submodule: "gex" },
      submodule: "gex",
      depth: "deep",
      requireTopic: /\b(spx|spy|flip|wall|gamma)\b/i,
    },
    {
      id: "edge-power-hour",
      label: "Power hour pin",
      question: "Power hour: where is SPX likely to pin into the close?",
      desk_scope: "spx-slayer",
      desk_scope_args: { submodule: "power-hour" },
      submodule: "power-hour",
      depth: "concrete",
    },
    {
      id: "edge-flow-gex-conflict",
      label: "Flow vs GEX conflict",
      question: "HELIX flow is bullish but gamma is short — what does SPX Slayer say?",
      desk_scope: "spx-slayer",
      desk_scope_args: { submodule: "flow-gex" },
      submodule: "flow-gex",
      depth: "concrete",
      requireTopic: /\b(conflict|confluence|flow|gamma|bull|bear|skew)\b/i,
    },
    {
      id: "edge-invalidation",
      label: "Play invalidation",
      question: "What level invalidates today's SPX play?",
      desk_scope: "spx-slayer",
      desk_scope_args: { submodule: "play" },
      submodule: "play",
      depth: "concrete",
      requireTopic: /\b(invalid|stop|level|flip|wall|phase)\b/i,
    },
    {
      id: "edge-bare-spx",
      label: "Bare SPX?",
      question: "SPX?",
      desk_scope: "spx-slayer",
      depth: "concrete",
    },
    {
      id: "edge-wrong-desk-bleed",
      label: "Night Hawk bleed under SPX scope",
      question: "List every open Night Hawk 0DTE play with marks.",
      desk_scope: "spx-slayer",
      depth: "concrete",
      requireTopic: /\b(spx|slayer|different|night hawk|nighthawk|desk|0dte board)\b/i,
    },
    {
      id: "edge-off-hours-honest",
      label: "Off-hours honest state",
      question: "Market is closed — what's the last live SPX GEX flip and wall snapshot?",
      desk_scope: "spx-slayer",
      desk_scope_args: { submodule: "gex" },
      submodule: "gex",
      depth: "concrete",
      requireTopic: /\b(close|off-hours|stale|last|flip|wall|snapshot|session)\b/i,
    },
    {
      id: "edge-technicals-vwap",
      label: "VWAP vs flip",
      question: "Is SPX above VWAP and above the gamma flip?",
      desk_scope: "spx-slayer",
      desk_scope_args: { submodule: "technicals" },
      submodule: "technicals",
      depth: "concrete",
      requireTopic: /\b(vwap|flip|above|below|structure)\b/i,
    },
    // ── Best play + DTE horizons ──
    {
      id: "play-best-today-concrete",
      label: "Best play for SPX today",
      question: "What do you think is the best play for SPX today?",
      desk_scope: "spx-slayer",
      desk_scope_args: { submodule: "play" },
      submodule: "play",
      depth: "concrete",
      requireTopic: /\b(phase|action|grade|play|gate|wait|scan|hold|blocked)\b/i,
    },
    {
      id: "play-best-0dte",
      label: "Best 0DTE play",
      question: "What's the best 0DTE SPX play right now — direction, strike zone, and grade?",
      desk_scope: "spx-slayer",
      desk_scope_args: { submodule: "play" },
      submodule: "play",
      depth: "concrete",
      requireTopic: /\b(0dte|phase|action|grade|play|gate|direction)\b/i,
    },
    {
      id: "play-best-3dte",
      label: "Best 3DTE play",
      question: "What's the best 3DTE play on SPX — or is there no committed multi-day setup?",
      desk_scope: "spx-slayer",
      depth: "deep",
      requireTopic: /\b(3\s*dte|3dte|lotto|0dte|play|no committed|honest|weekly|expiry)\b/i,
    },
    {
      id: "play-best-7dte",
      label: "Best 7DTE play",
      question: "Best 7DTE SPX setup — lotto runner or should I look at a different expiry?",
      desk_scope: "spx-slayer",
      depth: "deep",
      requireTopic: /\b(7\s*dte|7dte|lotto|expiry|weekly|play|0dte)\b/i,
    },
    // ── Flow / GEX / VEX ──
    {
      id: "gex-vex-regime",
      label: "VEX + vanna regime",
      question: "What's SPX vanna/VEX telling us vs gamma — flip, walls, and regime?",
      desk_scope: "spx-slayer",
      desk_scope_args: { submodule: "gex" },
      submodule: "gex",
      depth: "concrete",
      requireTopic: /\b(vanna|vex|gamma|flip|wall|regime|dealer)\b/i,
    },
    {
      id: "flow-gex-spx-tape",
      label: "SPX flow tape",
      question: "Summarize SPX options flow right now — skew, biggest prints, and vs dealer GEX.",
      desk_scope: "spx-slayer",
      desk_scope_args: { submodule: "flow-gex" },
      submodule: "flow-gex",
      depth: "concrete",
      requireTopic: /\b(flow|premium|skew|print|gex|gamma|confluence|conflict)\b/i,
    },
    {
      id: "gex-net-short-long",
      label: "Long vs short gamma",
      question: "Is SPX in long gamma or short gamma here — one-line verdict with flip level.",
      desk_scope: "spx-slayer",
      desk_scope_args: { submodule: "gex" },
      submodule: "gex",
      depth: "concrete",
      requireTopic: /\b(long gamma|short gamma|gamma|flip|regime|dealer)\b/i,
    },
    // ── Macro / events / news ──
    {
      id: "macro-fomc-opinion-today",
      label: "FOMC day SPX opinion",
      question: "It's FOMC day — what do you think of SPX for today?",
      desk_scope: "spx-slayer",
      depth: "concrete",
      requireTopic: /\b(fomc|macro|event|gate|play|spx|vol|calendar|caution|wait)\b/i,
    },
    {
      id: "macro-cpi-tomorrow",
      label: "CPI tomorrow impact",
      question: "CPI is tomorrow — how should that change the SPX read and gates?",
      desk_scope: "spx-slayer",
      depth: "concrete",
      requireTopic: /\b(cpi|macro|tomorrow|gate|event|vol|play)\b/i,
    },
    {
      id: "macro-nfp-week",
      label: "NFP this week",
      question: "Any NFP or jobs data this week that matters for SPX Slayer?",
      desk_scope: "spx-slayer",
      depth: "concrete",
      requireTopic: /\b(nfp|jobs|macro|calendar|event|spx|gate)\b/i,
    },
    {
      id: "news-headlines-spx",
      label: "SPX headline news",
      question: "Any SPX-relevant headlines or catalysts in the news right now?",
      desk_scope: "spx-slayer",
      depth: "concrete",
      requireTopic: /\b(news|headline|catalyst|macro|earnings|spx|none|quiet)\b/i,
    },
    {
      id: "macro-implicit-today",
      label: "Implicit macro (no event named)",
      question: "What do you think of SPX for today?",
      desk_scope: "spx-slayer",
      depth: "concrete",
      requireTopic: /\b(spx|phase|flip|wall|play|gate|grade|macro|event|session)\b/i,
    },
    // ── Session / product edge cases ──
    {
      id: "play-lotto-vs-0dte",
      label: "Lotto vs 0DTE engine",
      question: "Is there a live SPX lotto runner vs the main 0DTE play — which is active?",
      desk_scope: "spx-slayer",
      desk_scope_args: { submodule: "lotto" },
      submodule: "lotto",
      depth: "concrete",
      requireTopic: /\b(lotto|0dte|play|phase|active|runner|engine)\b/i,
    },
    {
      id: "play-power-hour-engine",
      label: "Power hour play",
      question: "What's the SPX power hour play showing — phase, direction, and levels?",
      desk_scope: "spx-slayer",
      desk_scope_args: { submodule: "power-hour" },
      submodule: "power-hour",
      depth: "concrete",
      requireTopic: /\b(power hour|phase|direction|level|play|spx)\b/i,
    },
    {
      id: "gates-full-trace",
      label: "Full gate trace",
      question: "Run a full gate trace on SPX — every gate with pass/fail and the live reason.",
      desk_scope: "spx-slayer",
      desk_scope_args: { submodule: "gates", mode: "gate-trace" },
      submodule: "gates",
      depth: "deep",
      requireTopic: /\b(gate|pass|fail|block|trace|reason)\b/i,
    },
    {
      id: "vix-regime",
      label: "VIX regime for SPX",
      question: "Where is VIX and does vol regime support or block SPX longs today?",
      desk_scope: "spx-slayer",
      depth: "concrete",
      requireTopic: /\b(vix|vol|regime|gate|block|support|spx)\b/i,
    },
    {
      id: "confluence-score",
      label: "Confluence score",
      question: "What's the SPX confluence score and which factors agree or disagree?",
      desk_scope: "spx-slayer",
      desk_scope_args: { submodule: "flow-gex" },
      submodule: "flow-gex",
      depth: "deep",
      requireTopic: /\b(confluence|score|factor|agree|conflict|flow|gex)\b/i,
    },
    {
      id: "unscoped-best-play-spx",
      label: "Unscoped best play (no desk_scope in API)",
      question: "What's the best play for SPX today?",
      depth: "concrete",
      requireTopic: /\b(spx|play|phase|grade|gate|0dte|flip)\b/i,
    },
    {
      id: "edge-signal-log",
      label: "SPX signal log",
      question: "What was the last committed SPX signal — and is there open exposure?",
      desk_scope: "spx-slayer",
      desk_scope_args: { submodule: "signal-log" },
      submodule: "signal-log",
      depth: "concrete",
    },
    {
      id: "edge-engine-history",
      label: "Engine blocked at time",
      question: "Why was SPX blocked around 10:15 — what did the engine snapshots show?",
      desk_scope: "spx-slayer",
      desk_scope_args: { submodule: "engine-history" },
      submodule: "engine-history",
      depth: "deep",
    },
    {
      id: "edge-pin-cone",
      label: "Pin cone forecast",
      question: "Walk the SPX pin cone — magnet, projected close, and confidence band.",
      desk_scope: "spx-slayer",
      desk_scope_args: { submodule: "pin" },
      submodule: "pin",
      depth: "deep",
    },
    {
      id: "edge-tick-trin",
      label: "TICK TRIN breadth",
      question: "Where are TICK and TRIN — does breadth support or conflict with the SPX play?",
      desk_scope: "spx-slayer",
      desk_scope_args: { submodule: "internals" },
      submodule: "internals",
      depth: "concrete",
    },
    {
      id: "edge-pulse-rail",
      label: "Pulse rail events",
      question: "What's firing on the SPX pulse rail — flip cross, magnet shift, macro?",
      desk_scope: "spx-slayer",
      desk_scope_args: { submodule: "pulse" },
      submodule: "pulse",
      depth: "concrete",
    },
    {
      id: "edge-spx-record",
      label: "SPX graded record",
      question: "What's the SPX Slayer win rate and setup breakdown over the last 30 days?",
      desk_scope: "spx-slayer",
      desk_scope_args: { submodule: "record" },
      submodule: "record",
      depth: "concrete",
    },
    {
      id: "edge-vector-spx",
      label: "Vector vs Slayer",
      question: "Does Vector structure on SPX agree with the Slayer play engine?",
      desk_scope: "spx-slayer",
      desk_scope_args: { submodule: "vector" },
      submodule: "vector",
      depth: "concrete",
    },
    {
      id: "edge-open-play-exposure",
      label: "Open play exposure",
      question: "Do we have open SPX exposure right now — direction, entry, and invalidation?",
      desk_scope: "spx-slayer",
      desk_scope_args: { submodule: "signal-log" },
      submodule: "signal-log",
      depth: "concrete",
      requireTopic: /\b(open|exposure|play|direction|entry|invalid|signal)\b/i,
    },
    {
      id: "edge-premarket-honest",
      label: "Premarket honest state",
      question: "Premarket — what's the honest SPX read before the open (gates, GEX, macro)?",
      desk_scope: "spx-slayer",
      depth: "concrete",
      requireTopic: /\b(premarket|pre-market|open|gate|gex|macro|spx|session)\b/i,
    },
  ];

  return [...scenarios, ...edges];
}

async function askLargo(cookie, scenario, sessionId) {
  const t0 = Date.now();
  const body = {
    question: scenario.question,
    session_id: sessionId,
    desk_scope: scenario.desk_scope,
    ...(scenario.desk_scope_args ? { desk_scope_args: scenario.desk_scope_args } : {}),
    ...(scenario.depth ? { depth: scenario.depth } : {}),
  };

  const res = await fetch(`${BASE}/api/market/largo/query`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(125_000),
  });
  const ms = Date.now() - t0;
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json, ms };
}

const allScenarios = buildScenarios();
let scenarios = allScenarios.slice(Number.isFinite(offset) ? offset : 0);
if (limit != null && Number.isFinite(limit)) scenarios = scenarios.slice(0, limit);

console.log(
  `SPX Slayer Largo audit — ${scenarios.length}/${allScenarios.length} scenarios @ ${BASE}` +
    (offset ? ` (offset ${offset})` : "") +
    `\n`
);

const session = await mintClerkPremiumSession({
  appUrl: BASE,
  email: `largo-spx-audit-${Date.now()}@blackouttrades.com`,
});

if (session.skip) {
  console.error("SKIP auth:", session.reason);
  process.exit(2);
}

const results = [];
let cookie = session.cookieHeader;
let tokenMintedAt = Date.now();
const TOKEN_MAX_MS = 45_000;
const sessionId = `spx-slayer-audit-${Date.now()}`;

try {
  for (const scenario of scenarios) {
    if (Date.now() - tokenMintedAt > TOKEN_MAX_MS && session.refresh) {
      const next = await session.refresh();
      if (next?.cookieHeader) {
        cookie = next.cookieHeader;
        tokenMintedAt = Date.now();
      }
    }

    let row = { ...scenario, ok: false };
    try {
      let { status, body, ms } = await askLargo(cookie, scenario, sessionId);
      if (status === 401 && session.refresh) {
        const next = await session.refresh();
        if (next?.cookieHeader) {
          cookie = next.cookieHeader;
          tokenMintedAt = Date.now();
          ({ status, body, ms } = await askLargo(cookie, scenario, sessionId));
        }
      }
      if (status === 429) {
        await new Promise((r) => setTimeout(r, 4000));
        ({ status, body, ms } = await askLargo(cookie, scenario, sessionId));
      }

      const scored = scoreSpxScenario(scenario, body, status, ms);
      row = {
        ...scenario,
        status,
        ms,
        desk_scope_returned: body?.desk_scope ?? null,
        mini_panel: body?.mini_panel ?? null,
        envelope: body?.envelope ? { headline: body.envelope.headline?.slice(0, 120) } : null,
        ...scored,
        ok: scored.verdict !== "FAIL" && scored.verdict !== "SKIP",
      };
      const icon = scored.verdict === "PASS" ? "✓" : scored.verdict === "WARN" ? "⚠" : scored.verdict === "SKIP" ? "–" : "✗";
      console.log(
        `${icon} ${ms}ms ${scored.verdict} | ${scenario.id} | tools=${(scored.tools ?? []).slice(0, 3).join(",")}`
      );
      if (scored.issues?.length) console.log(`    ${scored.issues.join(", ")}`);
    } catch (e) {
      row.error = e instanceof Error ? e.message : String(e);
      console.log(`✗ ERR | ${scenario.id}: ${row.error}`);
    }
    results.push(row);
  }
} finally {
  await session.cleanup?.().catch(() => {});
}

mkdirSync("audit-output", { recursive: true });
const summary = {
  total: results.length,
  pass: results.filter((r) => r.verdict === "PASS").length,
  warn: results.filter((r) => r.verdict === "WARN").length,
  fail: results.filter((r) => r.verdict === "FAIL").length,
  skip: results.filter((r) => r.verdict === "SKIP").length,
  avg_ms: Math.round(results.reduce((a, r) => a + (r.ms ?? 0), 0) / Math.max(1, results.length)),
};

const payload = { base: BASE, at: new Date().toISOString(), summary, results };
writeFileSync(join(process.cwd(), OUT), JSON.stringify(payload, null, 2));
console.log(`\nWrote ${OUT}`);
console.log(JSON.stringify(summary, null, 2));

process.exit(summary.fail > 0 || summary.skip > 0 ? 1 : 0);
