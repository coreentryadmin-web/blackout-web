/**
 * WHOLE-MARKET SWING DISCOVERY SCAN — the Night Hawk SWING (2–30 DTE) discovery funnel + dossiers.
 * ======================================================================================
 *
 * WHY: a swing thesis is "a move building across DAYS," so its discovery is whole-market and TWO-TIER —
 * a multi-day flow-accumulation screen (names with stacked directional positioning) AND a whole-market
 * breakout-structure screen (Polygon grouped-daily, ~12k stocks) — merged, then per-name enriched into a
 * scored `SwingDossier`. Unlike a same-day lottery, a candidate only reaches the WATCH rail once its
 * thesis has PERSISTED across ≥2 distinct session days (the accumulation-store persistence gate). This
 * harness runs the REAL production discovery core (`runSwingDiscoveryScan`, imported from src/, never
 * reimplemented) against REAL data and prints the funnel, the dossiers from BOTH paths, and the WATCH rail.
 *
 * EVIDENCE-ONLY: `commitEligibleCount` is held at 0 — PR-11 is a WATCH-only rail. Nothing commits or sizes
 * risk. Read-only; nothing is written except the pre-commit accumulation memory (persistence observations),
 * and only when a DATABASE_URL is configured. FM#1: a flow-less structure-only name STILL yields a dossier.
 *
 * USAGE
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *   node --import tsx scripts/audit/swing-discovery-scan.mjs [--date=YYYY-MM-DD] [--phase=POST_CLOSE]
 *        [--dte=14] [--tier1=40] [--min-premium=250000] [--json]
 *
 * Secrets from env only (POLYGON_API_KEY; optional DATABASE_URL for flow + persistence). Not in CI.
 */

// ── Env guard: the sandbox ships POLYGON_API_BASE as an unresolved placeholder. The provider modules read
//    process.env.POLYGON_API_BASE at IMPORT time, so this MUST run before any dynamic import below. ──
if (!process.env.POLYGON_API_BASE || !/^https?:\/\//.test(process.env.POLYGON_API_BASE)) {
  process.env.POLYGON_API_BASE = "https://api.massive.com";
}
const BASE = process.env.POLYGON_API_BASE;
const KEY = process.env.POLYGON_API_KEY;
const SRC = new URL("../../src/", import.meta.url).pathname;

// REAL production modules — the discovery core + the Tier-1 ingest assembler + the persistence store + the
// providers/DB accessors it drives. Never reimplemented here, so research and the live cron can't drift.
const { runSwingDiscoveryScan } = await import(`${SRC}lib/swing/discovery.ts`);
const { ingestSwingReads } = await import(`${SRC}lib/swing/swing-ingest.ts`);
const { fetchDailyMarketSummary, fetchStockDailyBars } = await import(`${SRC}lib/providers/polygon.ts`);
const { fetchTickerNews, DEFAULT_CATALYST_CHANNELS } = await import(`${SRC}lib/providers/polygon-news.ts`);
const { fetchUwTickerEarningsHistory, fetchUwIvRank } = await import(`${SRC}lib/providers/unusual-whales.ts`);
const db = await import(`${SRC}lib/db.ts`);

const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? "true"] : [a, "true"];
  }),
);
const PHASE = String(argv.phase ?? "POST_CLOSE").toUpperCase();
const INTENDED_DTE = Math.max(2, Math.min(30, Number(argv.dte ?? 14)));
const TIER1_CAP = Math.max(1, Number(argv.tier1 ?? 40));
const MIN_PREMIUM = Number(argv["min-premium"] ?? 250_000);
const EMIT_JSON = Boolean(argv.json);

const jget = async (u) => { const r = await fetch(u); return r.ok ? r.json() : null; };
const ymd = (d) => d.toISOString().slice(0, 10);
const pad = (s, w) => String(s).padEnd(w);
const padL = (s, w) => String(s).padStart(w);

/** Resolve the session to scan: explicit --date, else walk back to the last day with grouped data. */
async function resolveSession() {
  if (argv.date && argv.date !== "true") return String(argv.date);
  let d = new Date();
  for (let i = 0; i < 6; i++) {
    const day = ymd(d);
    const g = await jget(`${BASE}/v2/aggs/grouped/locale/us/market/stocks/${day}?adjusted=true&apiKey=${KEY}`);
    if (g?.results?.length) return day;
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return ymd(new Date());
}

const dbOn = db.dbConfigured();
const closesFor = async (ticker, session, lookbackSessions) => {
  // ~2× the session count in calendar days to cover weekends/holidays.
  const from = ymd(new Date(new Date(`${session}T00:00:00Z`).getTime() - lookbackSessions * 2 * 86400000));
  const bars = await fetchStockDailyBars(ticker, from, session, String(lookbackSessions * 2)).catch(() => []);
  return (bars ?? []).map((b) => Number(b.c)).filter((c) => Number.isFinite(c) && c > 0);
};

// In-memory accumulation accessors when no DATABASE_URL — the scan still runs (structure path proves FM#1);
// persistence simply can't accrete across runs without the ledger. Mirrors the PR-10 distinct-day semantics.
function memAccum() {
  const rows = new Map();
  return {
    async upsertSwingAccum(a) {
      const k = `${a.ticker.toUpperCase()}|${a.direction}`;
      const cur = rows.get(k);
      if (!cur) rows.set(k, { ticker: a.ticker.toUpperCase(), direction: a.direction, observation_count: 1, distinct_session_days: 1, last_session_day: a.session_day, phases_seen: [a.phase], promoted_position_id: null, first_seen_at: new Date().toISOString(), last_seen_at: new Date().toISOString() });
      else { cur.observation_count += 1; if (cur.last_session_day !== a.session_day) cur.distinct_session_days += 1; cur.last_session_day = a.session_day; }
    },
    async fetchAccumulating(minSessionDays = 1, limit = 500) {
      return [...rows.values()].filter((r) => r.promoted_position_id == null && r.distinct_session_days >= minSessionDays).slice(0, limit);
    },
    async markAccumPromoted() {},
    async fadeStaleAccum() { return 0; },
  };
}

const accum = dbOn
  ? { upsertSwingAccum: db.upsertSwingAccum, fetchAccumulating: db.fetchAccumulating, markAccumPromoted: db.markAccumPromoted, fadeStaleAccum: db.fadeStaleAccum }
  : memAccum();

// ── MAIN ──────────────────────────────────────────────────────────────────────
const session = await resolveSession();
const nowMs = Date.parse(`${session}T21:00:00Z`);

const deps = {
  // 120h multi-day flow window — no max_dte cap (unlike 0DTE). Empty (structure-only) when no DB.
  fetchFlowWindow: async () =>
    dbOn ? db.fetchRecentFlows({ since_hours: 120, min_premium: MIN_PREMIUM, limit: 800 }) : [],
  fetchGroupedDaily: async () => {
    const g = await fetchDailyMarketSummary(session);
    return g?.results ?? [];
  },
  fetchSpyCloses: async () => closesFor("SPY", session, 90),
  enrichCandidate: async (seed, ctx) =>
    ingestSwingReads(
      {
        fetchDailyCloses: (ticker, lookback) => closesFor(ticker, session, lookback),
        // Parity with the live cron: ground the CATALYST + VOLATILITY pillars + the event-archetype extras.
        // Each reader fails open, so a Benzinga/UW hiccup only drops those pillars for the name.
        fetchCatalystNews: async (ticker) => {
          const r = await fetchTickerNews(ticker, { channels: DEFAULT_CATALYST_CHANNELS, limit: 12 }).catch(() => null);
          return (r?.items ?? []).map((i) => ({ channels: i.channels, publishedAt: i.publishedAt }));
        },
        fetchEarningsRows: (ticker) => fetchUwTickerEarningsHistory(ticker, 8).catch(() => []),
        fetchIvRank: (ticker) => fetchUwIvRank(ticker).catch(() => null),
      },
      {
        ticker: seed.ticker,
        asOf: ctx.asOf,
        intendedDte: ctx.intendedDte,
        accumulation: ctx.accumulation,
        flowWindowDays: 5,
        spyCloses: ctx.spyCloses,
        mover: ctx.mover,
      },
    ),
  accum,
  nowMs,
  sessionDay: session,
  phase: PHASE,
  config: { tier1Cap: TIER1_CAP, intendedDte: INTENDED_DTE },
};

const res = await runSwingDiscoveryScan(deps);

console.log("═".repeat(96));
console.log(`  SWING DISCOVERY SCAN — ${session} · phase ${res.phase} · DTE ${INTENDED_DTE}${dbOn ? "" : "  (no DATABASE_URL → structure-only)"}`);
console.log("═".repeat(96));
console.log(`  FUNNEL  tier0-flow ${res.tier0FlowCount} · tier0-structure ${res.tier0StructureCount} · merged ${res.mergedCount} · enriched ${res.enrichedCount}`);
console.log(`          watch-rail ${res.watchCount} · commit-eligible ${res.commitEligibleCount} (WATCH-only rail — evidence-only)`);
console.log("");

// ── RECALL BLOCK — the Tier-0→Tier-1 funnel + capped-out leak + per-cut recall (operator critique #7).
//    Precision without recall silently destroys discovery: the top-N cap can sever a strong candidate and
//    nothing downstream ever learns it existed. This block makes that leak VISIBLE, not silent.
const rc = res.recall;
if (rc) {
  const recallPct = (cut) => (cut.seen ? `${((cut.enriched / cut.seen) * 100).toFixed(0)}%` : "—");
  const printCuts = (label, rec) => {
    const keys = Object.keys(rec).sort();
    if (!keys.length) return;
    console.log(`  ${label}`);
    for (const k of keys) {
      const cut = rec[k];
      console.log(`    ${pad(k, 16)} seen ${padL(cut.seen, 3)} · enriched ${padL(cut.enriched, 3)} · recall ${padL(recallPct(cut), 4)}`);
    }
  };
  console.log("  ── RECALL (evidence-only — did the funnel silently drop a strong candidate?) ──");
  console.log(`  FUNNEL  tier0 ${rc.tier0Count} (flow ${rc.tier0FlowCount} / struct ${rc.tier0StructureCount}) → enriched ${rc.tier1EnrichedCount} · capped-out ${rc.cappedOutCount}`);
  const nearFloor = rc.cappedOut.filter((c) => c.reason.includes("NEAR ENRICHED FLOOR"));
  if (rc.cappedOutCount) {
    console.log(`  CAPPED-OUT (dropped purely by the top-N budget${nearFloor.length ? ` — ${nearFloor.length} NEAR the enriched floor` : ""}):`);
    for (const c of rc.cappedOut) console.log(`    ${pad(c.ticker, 7)} rank ${padL(c.tier0Rank, 4)} · ${c.reason}`);
  } else {
    console.log("  CAPPED-OUT: none (every Tier-0 candidate fit inside the Tier-1 budget).");
  }
  printCuts("RECALL BY ARCHETYPE (seen → enriched non-degraded):", rc.byArchetype);
  printCuts("RECALL BY LIQUIDITY TIER:", rc.byLiquidityTier);
  printCuts("RECALL BY REGIME:", rc.byRegime);
  console.log("");
}
console.log(`  ${pad("TICKER", 7)}${pad("DIR", 6)}${pad("ARCHETYPE", 22)}${padL("SCORE", 7)}${padL("PILLARS", 9)}${padL("SUBLANE", 10)}`);
console.log("  " + "─".repeat(90));
for (const d of res.dossiers) {
  console.log(
    `  ${pad(d.ticker, 7)}${pad(d.direction ?? "—", 6)}${pad(d.archetype.archetype ?? "unclassified", 22)}` +
    `${padL(d.score.score.toFixed(1), 7)}${padL(`${d.score.presentCount}/7`, 9)}${padL(d.subLane ?? "—", 10)}`,
  );
}
if (res.watchCandidates.length) {
  console.log("\n  WATCH RAIL (persisted ≥2 sessions, or an event archetype on 1 corroborated session):");
  for (const c of res.watchCandidates) {
    console.log(`    ${pad(c.ticker, 7)}${pad(c.direction, 6)} · ${c.distinctSessionDays} sessions · ${c.observationCount} obs · kinds ${(c.signalKinds ?? []).join("+") || "—"} · phases ${c.phasesSeen.join(",")}`);
  }
} else {
  console.log("\n  WATCH RAIL: empty (no candidate has persisted across ≥2 sessions yet — expected on a first scan).");
}
console.log("\n" + "═".repeat(96));
console.log(`  NOTE: evidence-only. Nothing commits (commitEligibleCount=${res.commitEligibleCount}); the lane graduates via its archetype×sub-lane bucket (PR-16).`);
console.log("═".repeat(96));
if (EMIT_JSON) {
  console.log("\n<<<JSON>>>");
  console.log(JSON.stringify({ session, phase: res.phase, funnel: { tier0FlowCount: res.tier0FlowCount, tier0StructureCount: res.tier0StructureCount, mergedCount: res.mergedCount, enrichedCount: res.enrichedCount, watchCount: res.watchCount, commitEligibleCount: res.commitEligibleCount }, recall: res.recall, dossiers: res.dossiers, watchCandidates: res.watchCandidates }, null, 2));
}

// The DB pool keeps the event loop alive; exit explicitly once the report is printed.
process.exit(0);
