// Cron: phase-anchored whole-market SWING discovery (PR-13, HOLD / evidence-only).
//
// WHY: the swing lane discovers multi-session theses on a phase-anchored cadence (scan-cadence.ts) rather than
// a fixed heartbeat. EventBridge fires this route across a WIDE UTC band; the route resolves which discovery
// PHASE the firing belongs to and runs ONE whole-market scan per (session day, phase). The scan advances the
// cross-session accumulation memory (WATCH-only) — it COMMITS NOTHING (`commitEligibleCount` is a literal 0).
//
// IDEMPOTENT PER (date, phase): a redis marker is CLAIMED before scanning, so a re-fire inside the same phase
// window on the same day is a no-op — it must not re-increment the accumulation memory. FAIL-SOFT throughout:
// any provider/DB error is caught, logged via logCronRun, and returned — it never throws out of the cron.
//
// THIN HANDLER: the phase decision (scan-cadence) and the scan core (discovery.ts) are pure/injected and unit-
// tested; this handler only does auth, the idempotency claim, provider wiring, and the run/log.

import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { sharedCacheSetNx } from "@/lib/shared-cache";
import { todayEt } from "@/lib/et-date";
import { decideSwingScan } from "@/lib/swing/scan-cadence";
import {
  runSwingDiscoveryScan,
  DEFAULT_SWING_DISCOVERY_CONFIG,
  type SwingDiscoveryDeps,
} from "@/lib/swing/discovery";
import { ingestSwingReads } from "@/lib/swing/swing-ingest";
import { persistSwingServingSnapshot } from "@/lib/swing/serving-lane";
import {
  fetchRecentFlows,
  upsertSwingAccum,
  fetchAccumulating,
  markAccumPromoted,
  fadeStaleAccum,
} from "@/lib/db";
import { fetchDailyMarketSummary, fetchStockDailyBars } from "@/lib/providers/polygon";
import { fetchTickerNews, DEFAULT_CATALYST_CHANNELS } from "@/lib/providers/polygon-news";
import { fetchUwTickerEarningsHistory, fetchUwIvRank } from "@/lib/providers/unusual-whales";
import {
  MULTI_DAY_FLOW_HOURS,
  MULTI_DAY_MIN_PREMIUM,
  MULTI_DAY_FLOW_LIMIT,
  type MinimalFlowRow,
} from "@/lib/zerodte/flow-accumulation-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** How long a (date, phase) claim lives — 22h covers the whole session day so a same-day re-fire is suppressed. */
const PHASE_CLAIM_TTL_SEC = 22 * 60 * 60;
/** Enough calendar days back to yield the ~90 daily sessions swing-ingest wants for the EMA/return reads. */
const DAILY_BAR_LOOKBACK_DAYS = 200;

function ymdDaysAgo(nowMs: number, days: number): string {
  return new Date(nowMs - days * 86_400_000).toISOString().slice(0, 10);
}

/** Wire the live providers + ledger accessors into the injected discovery deps (all IO lives here). */
function buildDiscoveryDeps(nowMs: number, sessionDay: string, phase: SwingDiscoveryDeps["phase"]): SwingDiscoveryDeps {
  const to = todayEt(new Date(nowMs));
  const from = ymdDaysAgo(nowMs, DAILY_BAR_LOOKBACK_DAYS);
  const closesFor = async (ticker: string): Promise<number[]> => {
    const bars = await fetchStockDailyBars(ticker, from, to);
    return bars.map((b) => b.c).filter((c) => Number.isFinite(c));
  };
  return {
    fetchFlowWindow: async (): Promise<MinimalFlowRow[]> =>
      fetchRecentFlows({ since_hours: MULTI_DAY_FLOW_HOURS, min_premium: MULTI_DAY_MIN_PREMIUM, limit: MULTI_DAY_FLOW_LIMIT }),
    fetchGroupedDaily: async () => {
      const summary = await fetchDailyMarketSummary(to);
      return summary.results ?? [];
    },
    fetchSpyCloses: async () => closesFor("SPY"),
    enrichCandidate: (seed, ctx) =>
      ingestSwingReads(
        {
          fetchDailyCloses: (ticker) => closesFor(ticker),
          // CATALYST pillar + event-archetype extras: fresh Benzinga catalyst-channel news (rides the Polygon
          // key) + the UW earnings feed (one call yields BOTH the upcoming print for the earnings-in-window
          // hazard AND the recent print for post-earnings drift). VOLATILITY pillar: the UW EOD IV rank. Each
          // reader already fails open (→ [] / null), so a provider hiccup only drops those pillars for the name.
          fetchCatalystNews: async (ticker) => {
            const res = await fetchTickerNews(ticker, { channels: DEFAULT_CATALYST_CHANNELS, limit: 12 });
            return res.items.map((i) => ({ channels: i.channels, publishedAt: i.publishedAt }));
          },
          fetchEarningsRows: (ticker) =>
            fetchUwTickerEarningsHistory(ticker, 8) as Promise<Array<Record<string, unknown>>>,
          fetchIvRank: (ticker) => fetchUwIvRank(ticker),
        },
        {
          ticker: seed.ticker,
          asOf: ctx.asOf,
          intendedDte: ctx.intendedDte,
          accumulation: ctx.accumulation,
          flowWindowDays: MULTI_DAY_FLOW_HOURS / 24,
          spyCloses: ctx.spyCloses,
          mover: ctx.mover,
        },
      ),
    accum: { upsertSwingAccum, fetchAccumulating, markAccumPromoted, fadeStaleAccum },
    nowMs,
    sessionDay,
    phase,
    config: DEFAULT_SWING_DISCOVERY_CONFIG,
  };
}

export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const nowMs = started;
  const sessionDay = todayEt(new Date(nowMs));

  // Resolve the active phase (pure). The idempotency dedup is now the ATOMIC claim below, so the
  // decision runs with an empty ranKeys — it only tells us whether the ET clock is inside a phase window.
  const decision = decideSwingScan({ nowMs, sessionDay, ranKeys: new Set() });
  if (!decision.run) {
    const payload = { ok: true, skipped: true, phase: decision.phase, reason: decision.reason };
    await logCronRun("swing-discovery", started, payload);
    return NextResponse.json(payload);
  }

  // ATOMIC (date, phase) CLAIM — the load-bearing idempotency gate. This used to be a GET-then-SET
  // (sharedCacheGet the marker → decide → sharedCacheSet), which is a read-then-write RACE: two replicas
  // firing the same cron minute can BOTH read "not yet claimed" and BOTH proceed → duplicate discovery
  // that double-increments the accumulation memory for the same (day, phase). `SET key val NX EX ttl` is a
  // single atomic Redis command, so exactly ONE replica's SET wins (acquired=true) and every other
  // concurrent firing gets acquired=false and skips here. On a Redis miss/outage we DEFAULT TO RUN
  // (acquired=true): losing dedup is better than silently skipping the whole phase — a lone double-run only
  // over-accretes one observation, harmless to the ≥2-distinct-session persistence gate.
  const acquired = decision.key
    ? await sharedCacheSetNx(decision.key, nowMs, PHASE_CLAIM_TTL_SEC).catch(() => true)
    : true;
  if (!acquired) {
    const payload = {
      ok: true,
      skipped: true,
      phase: decision.phase,
      reason: `phase ${decision.phase} already claimed for ${sessionDay} (idempotent skip)`,
    };
    await logCronRun("swing-discovery", started, payload);
    return NextResponse.json(payload);
  }

  try {
    const deps = buildDiscoveryDeps(nowMs, sessionDay, decision.phase!);
    const result = await runSwingDiscoveryScan(deps);

    // Persist the scored output so the member horizons route can serve it (getSwingServingLane's `discover`
    // reads this blob). Before this, the scan advanced only the accumulation memory — the dossiers/plays/watch
    // it produced were dropped, so the SWING board had nothing to read and rendered permanently empty.
    // Best-effort (persist swallows its own errors) — a cache miss must never fail the discovery cron.
    // `playSet.SWING` is only non-empty once discovery attaches concrete WATCH contracts (the OPTIONAL
    // fetchChainRows dep — the evidence-only "WATCH by persistence, not by contract" posture); until then the
    // member board is honestly empty, but the dossiers + watch list are persisted and the read path is live.
    await persistSwingServingSnapshot({
      asOf: result.asOf,
      sessionDay,
      dossiers: result.dossiers,
      plays: result.playSet.SWING,
      watch: result.watchCandidates,
    });

    const payload = {
      ok: true,
      phase: decision.phase,
      sessionDay,
      tier0Flow: result.tier0FlowCount,
      tier0Structure: result.tier0StructureCount,
      merged: result.mergedCount,
      enriched: result.enrichedCount,
      dossiers: result.dossiers.length,
      watch: result.watchCount,
      // Evidence-only rail: PR-13 commits nothing. This stays 0 by construction (not derived).
      commitEligible: result.commitEligibleCount,
    };
    await logCronRun("swing-discovery", started, payload);
    return NextResponse.json(payload);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[cron/swing-discovery]", error);
    await logCronRun("swing-discovery", started, { ok: false, phase: decision.phase, error: detail });
    return NextResponse.json({ ok: false, error: "Swing discovery failed" }, { status: 500 });
  }
}
