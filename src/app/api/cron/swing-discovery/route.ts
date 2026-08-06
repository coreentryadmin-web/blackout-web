// Cron: phase-anchored whole-market SWING discovery (PR-13, HOLD / evidence-only).
//
// WHY: the swing lane discovers multi-session theses on a phase-anchored cadence (scan-cadence.ts) rather than
// a fixed heartbeat. EventBridge fires this route across a WIDE UTC band; the route resolves which discovery
// PHASE the firing belongs to and runs ONE whole-market scan per (session day, phase). The scan advances the
// cross-session accumulation memory (WATCH-only) — it COMMITS NOTHING (`commitEligibleCount` is a literal 0).
//
// IDEMPOTENT PER (date, phase): a redis marker is CLAIMED before scanning, so a re-fire inside the same phase
// window on the same day is a no-op — it must not re-increment the accumulation memory. CRITICAL: on scan
// FAILURE the claim is RELEASED — otherwise an ALB/Lambda 60s abort burns the phase for 22h and Swing stays
// dark (prod 2026-07-29: 38/38 EventBridge FailedInvocations, zero successful swing-discovery hits).
// `?force=1` clears any prior claim and re-runs. FAIL-SOFT throughout: provider/DB errors are caught,
// logged via logCronRun, and returned — never thrown out of the cron.
//
// THIN HANDLER: the phase decision (scan-cadence) and the scan core (discovery.ts) are pure/injected and unit-
// tested; this handler only does auth, the idempotency claim, provider wiring, and the run/log.

import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { sharedCacheDel, sharedCacheSet, sharedCacheSetNx } from "@/lib/shared-cache";
import { todayEt } from "@/lib/et-date";
import { decideSwingScan, phaseRunKey } from "@/lib/swing/scan-cadence";
import {
  runSwingDiscoveryScan,
  DEFAULT_SWING_DISCOVERY_CONFIG,
  type SwingDiscoveryDeps,
} from "@/lib/swing/discovery";
import { ingestSwingReads } from "@/lib/swing/swing-ingest";
import { persistSwingServingSnapshot, readSwingServingSnapshot } from "@/lib/swing/serving-lane";
import { carryLegacyPromotedIntoSnapshot } from "@/lib/swing/legacy-confirm-promote";
import { swingThesisKey } from "@/lib/swing/accumulation-store";
import {
  fetchRecentFlows,
  upsertSwingAccum,
  fetchAccumulating,
  markAccumPromoted,
  fadeStaleAccum,
  fetchGradedSwingFeatureRows,
  fetchOpenSwingPositions,
  insertSwingPosition,
  insertSwingShadowPosition,
} from "@/lib/db";
import { promoteSwingCandidate, type SwingAccumAccessors } from "@/lib/swing/accumulation-store";
import { swingCalibrationRowFromLedger } from "@/lib/swing/calibration";
import { modelRiskUsd, isEventArchetype, type CommitBookPosition } from "@/lib/swing/commit";
import { resolveProductionPortfolioBudget } from "@/lib/swing/swing-portfolio-budget";
import type { SwingArchetype } from "@/lib/swing/taxonomy";
import { resolveTickerChainRows } from "@/features/nighthawk/lib/option-chain-prompt";
import { fetchDailyMarketSummary, fetchStockDailyBars } from "@/lib/providers/polygon";
import { screenBreakoutMovers } from "@/features/nighthawk/lib/candidates";
import {
  buildSessionBarFromMinuteBars,
  mergeMinuteRefreshedBars,
} from "@/lib/zerodte/breakout-intraday-breadth";
import {
  BREAKOUT_INTRADAY_REFRESH,
  BREAKOUT_INTRADAY_REFRESH_LIMIT,
} from "@/lib/zerodte/breakout-discovery";
import { fetchStockMinuteBars } from "@/lib/providers/polygon";
import { fetchPolygonTickerDetails } from "@/lib/providers/polygon-largo";
import { fetchTickerNews, DEFAULT_CATALYST_CHANNELS } from "@/lib/providers/polygon-news";
import {
  fetchUwTickerEarningsHistory,
  fetchUwIvRank,
  fetchUwIvRankSeries,
} from "@/lib/providers/unusual-whales";
import { fetchStockLastTrade } from "@/lib/providers/polygon-largo";
import {
  MULTI_DAY_FLOW_HOURS,
  MULTI_DAY_MIN_PREMIUM,
  MULTI_DAY_FLOW_LIMIT,
  type MinimalFlowRow,
} from "@/lib/zerodte/flow-accumulation-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** In-progress claim — short TTL so an ALB/Lambda abort that never reaches `catch` still expires and the
 *  next EventBridge fire (every 30m) can retry. Success upgrades to PHASE_DONE_TTL_SEC via sharedCacheSet. */
const PHASE_RUNNING_TTL_SEC = 3 * 60;
/** How long a successful (date, phase) claim lives — covers the rest of the session day. */
const PHASE_DONE_TTL_SEC = 22 * 60 * 60;
/** Enough calendar days back to yield the ~90 daily sessions swing-ingest wants for the EMA/return reads. */
const DAILY_BAR_LOOKBACK_DAYS = 200;

function ymdDaysAgo(nowMs: number, days: number): string {
  return new Date(nowMs - days * 86_400_000).toISOString().slice(0, 10);
}

/** Wire the live providers + ledger accessors into the injected discovery deps (all IO lives here). */
function buildDiscoveryDeps(nowMs: number, sessionDay: string, phase: SwingDiscoveryDeps["phase"]): SwingDiscoveryDeps {
  const to = todayEt(new Date(nowMs));
  const from = ymdDaysAgo(nowMs, DAILY_BAR_LOOKBACK_DAYS);
  // Memoize daily closes per ticker for the WHOLE scan. The name, SPY, and every SECTOR_ROTATION benchmark
  // ETF (SMH/XLK/KBE/GDX/…) are shared across many candidates — a semis-heavy scan would otherwise refetch
  // SMH once per name. One in-flight promise per symbol ⇒ each series is fetched at most once per scan.
  const closesCache = new Map<string, Promise<number[]>>();
  const closesFor = (ticker: string): Promise<number[]> => {
    const key = ticker.toUpperCase();
    let cached = closesCache.get(key);
    if (!cached) {
      cached = fetchStockDailyBars(key, from, to).then((bars) =>
        bars.map((b) => b.c).filter((c) => Number.isFinite(c)),
      );
      closesCache.set(key, cached);
    }
    return cached;
  };
  const accum: SwingAccumAccessors = { upsertSwingAccum, fetchAccumulating, markAccumPromoted, fadeStaleAccum };
  return {
    fetchFlowWindow: async (): Promise<MinimalFlowRow[]> =>
      fetchRecentFlows({ since_hours: MULTI_DAY_FLOW_HOURS, min_premium: MULTI_DAY_MIN_PREMIUM, limit: MULTI_DAY_FLOW_LIMIT }),
    fetchGroupedDaily: async () => {
      const summary = await fetchDailyMarketSummary(to);
      return summary.results ?? [];
    },
    ...(BREAKOUT_INTRADAY_REFRESH
      ? {
          fetchIntradayStructureBars: async () => {
            const summary = await fetchDailyMarketSummary(to);
            const results = summary.results ?? [];
            const pre = screenBreakoutMovers(results, 40);
            const tickers = pre.map((m) => m.ticker).slice(0, BREAKOUT_INTRADAY_REFRESH_LIMIT);
            const refreshed = new Map<string, import("@/lib/providers/polygon").DailyMarketBar>();
            await Promise.all(
              tickers.map(async (t) => {
                const bars = await fetchStockMinuteBars(t, to, to).catch(() => []);
                const minuteBars: import("@/lib/zerodte/breakout-intraday-breadth").MinuteBarLike[] = [];
                for (const b of bars) {
                  if (typeof b.t !== "number" || !Number.isFinite(b.t) || !Number.isFinite(b.o) || !Number.isFinite(b.c)) continue;
                  minuteBars.push({
                    t: b.t,
                    o: b.o,
                    h: b.h ?? b.o,
                    l: b.l ?? b.o,
                    c: b.c,
                    v: b.v ?? 0,
                  });
                }
                const bar = buildSessionBarFromMinuteBars(t, minuteBars);
                if (bar) refreshed.set(t.toUpperCase(), bar);
              })
            );
            return mergeMinuteRefreshedBars(results, refreshed);
          },
        }
      : {}),
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
          // Historical IV-rank series — fills the VOLATILITY pillar / feature-vector iv_rank when the
          // point stats endpoint is thin (SWING-ENGINE §6 gap #2). Long-TTL cached; fail-soft → null.
          fetchIvRankSeries: async (ticker) => {
            const rows = await fetchUwIvRankSeries(ticker, 30);
            return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : null;
          },
          // SECTOR_ROTATION benchmark classifier: Polygon reference data (sic_code/sic_description/type) —
          // rate-limit-free and already fail-open (→ null). Resolves the name's industry-group / sector ETF so
          // the archetype classifies on real industry-group RS instead of the coarse name-vs-SPY RS. A hiccup
          // just drops the sector-rotation signal for the name (the static sector-map is the zero-IO fallback).
          fetchTickerClassification: async (ticker) => {
            const details = await fetchPolygonTickerDetails(ticker);
            const r = (details?.results ?? null) as Record<string, unknown> | null;
            if (!r) return null;
            return {
              sicCode: typeof r.sic_code === "string" ? r.sic_code : null,
              sicDescription: typeof r.sic_description === "string" ? r.sic_description : null,
              tickerType: typeof r.type === "string" ? r.type : null,
            };
          },
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
    accum,
    // ── ATTACH WATCH CONTRACTS: resolve the ATM chain (front expiries) per candidate so `playSet.SWING` is
    //    non-empty and the commit gate has a concrete instrument to open. FAIL-SOFT: a chain miss/throw for one
    //    name returns [] (that candidate simply carries no contract), never sinks the cron. ──
    fetchChainRows: async (ticker: string) => {
      try {
        const resolved = await resolveTickerChainRows(ticker);
        return resolved?.rows ?? [];
      } catch (err) {
        console.error(`[cron/swing-discovery] chain fetch failed for ${ticker} — dropping contract`, err);
        return [];
      }
    },
    // ── LIVE COMMIT SEAM (go-live 2026-07-24). Its PRESENCE authorizes real opens — but every commit still
    //    passes graduation ∧ armed budget ∧ book-percent caps ∧ idempotency inside commit.ts. ──
    // The GRADUATION input: graded roll-chain legs → the calibration-row shape the ladder reads.
    fetchGradedHistory: async () => {
      const rows = await fetchGradedSwingFeatureRows(5000);
      return rows.map(swingCalibrationRowFromLedger);
    },
    // The live book (budget + caps + idempotency). Prefer the pinned commit-time risk; fall back to the model
    // reference lot (premium × 100) so a legacy/roll row without a pinned risk still counts honestly.
    fetchOpenBook: async (): Promise<CommitBookPosition[]> => {
      const rows = await fetchOpenSwingPositions();
      return rows.map((r) => {
        const pinned = r.entry_context?.risk_usd;
        const riskUsd = typeof pinned === "number" && Number.isFinite(pinned) ? pinned : modelRiskUsd(r.entry_premium);
        return {
          ticker: r.ticker,
          direction: r.direction === "short" ? "SHORT" : "LONG",
          archetype: r.archetype,
          commitKey: r.commit_key,
          riskUsd,
          isEvent: isEventArchetype(r.archetype as SwingArchetype | null),
          isOvernight: true,
          expiry: r.contract_expiry,
        };
      });
    },
    insertPosition: insertSwingPosition,
    promoteCommit: (ticker, direction, positionId, archetype) =>
      promoteSwingCandidate(accum, ticker, direction, positionId, archetype),
    insertShadowPosition: insertSwingShadowPosition,
    budget: resolveProductionPortfolioBudget(),
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
  // Ops recovery: force=1 clears a burned phase claim (timeout/abort after NX) and re-runs.
  // Outside a phase window, force still runs as POST_CLOSE so we can revive the serving snapshot
  // without waiting for the next EventBridge window.
  const force = req.nextUrl.searchParams.get("force") === "1";

  // Resolve the active phase (pure). The idempotency dedup is now the ATOMIC claim below, so the
  // decision runs with an empty ranKeys — it only tells us whether the ET clock is inside a phase window.
  let decision = decideSwingScan({ nowMs, sessionDay, ranKeys: new Set() });
  if (!decision.run && force) {
    const forcePhase = decision.phase ?? "POST_CLOSE";
    const key = `swing:discovery:${sessionDay}:${forcePhase}`;
    decision = {
      run: true,
      phase: forcePhase,
      window: decision.window,
      key,
      reason: `force=1 — run as ${forcePhase} outside/inside window`,
    };
  }
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
  //
  // TWO-STAGE TTL (prod 2026-07-29): claim first with a SHORT "running" TTL. On success, upgrade to a
  // full-day "done" TTL. On throw, delete. If the HTTP client aborts (ALB 60s / Lambda AbortError) and
  // the handler never reaches catch, the running key still expires in ~3m so the next :00/:30 fire retries
  // instead of burning the phase for 22h.
  // force=1: delete any prior claim first so a timed-out prior attempt cannot block recovery.
  if (force && decision.key) {
    await sharedCacheDel(decision.key).catch(() => undefined);
  }
  const acquired = decision.key
    ? await sharedCacheSetNx(
        decision.key,
        { status: "running", at: nowMs },
        PHASE_RUNNING_TTL_SEC,
      ).catch(() => true)
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

    // Persist the scored output so the member horizons route can serve it. If the write fails, RELEASE the
    // phase claim so the next EventBridge fire can retry — upgrading to DONE without a snapshot locks the
    // member board on a stale/empty state for 22h.
    // Ground setup-maturity spots for the member serve path (cache-reader): start from each dossier's
    // plan entry (last close at ingest), then refresh live last-trade for persistence-cleared WATCH
    // names so FORMING/TRIGGERED/EXTENDED can diverge from the pinned trigger during RTH.
    const spotsByTicker: Record<string, number> = {};
    for (const d of result.dossiers) {
      const px = d.plan?.entryUnderlyingPx;
      if (px != null && Number.isFinite(px) && px > 0) spotsByTicker[d.ticker.toUpperCase()] = px;
    }
    const watchTickers = [...new Set(result.watchCandidates.map((w) => w.ticker.toUpperCase()))].slice(0, 40);
    await Promise.all(
      watchTickers.map(async (ticker) => {
        try {
          const trade = await fetchStockLastTrade(ticker);
          const p = trade && typeof trade === "object" ? Number((trade as Record<string, unknown>).p) : NaN;
          if (Number.isFinite(p) && p > 0) spotsByTicker[ticker] = p;
        } catch {
          // fail-soft: keep the plan-entry fallback
        }
      }),
    );

    const existing = await readSwingServingSnapshot();
    const flagAnchorsByThesisKey: Record<string, number> = {
      ...(existing?.flagAnchorsByThesisKey ?? {}),
    };
    for (const cand of [...result.watchCandidates, ...result.observedCandidates]) {
      const key = swingThesisKey(cand.ticker, cand.direction, cand.archetype);
      if (flagAnchorsByThesisKey[key] != null) continue;
      const px = spotsByTicker[cand.ticker.toUpperCase()];
      if (px != null && Number.isFinite(px) && px > 0) flagAnchorsByThesisKey[key] = px;
    }

    const persisted = await persistSwingServingSnapshot(
      carryLegacyPromotedIntoSnapshot(
        {
          asOf: result.asOf,
          sessionDay,
          dossiers: result.dossiers,
          plays: result.playSet.SWING,
          watch: result.watchCandidates,
          observed: result.observedCandidates,
          spotsByTicker,
          flagAnchorsByThesisKey,
        },
        existing,
      ),
    );
    if (!persisted) {
      if (decision.key) {
        await sharedCacheDel(decision.key).catch(() => undefined);
      }
      const payload = {
        ok: false,
        phase: decision.phase,
        sessionDay,
        error: "serving snapshot persist failed — phase claim released for retry",
        claim_released: true,
        fadedStale: result.fadedStale ?? 0,
      };
      await logCronRun("swing-discovery", started, payload);
      return NextResponse.json(payload, { status: 500 });
    }

    // Upgrade running → done (full-day lock). Only after persist so a crash mid-scan does not lock the day.
    if (decision.key) {
      await sharedCacheSet(
        decision.key,
        { status: "done", at: Date.now() },
        PHASE_DONE_TTL_SEC,
      ).catch(() => undefined);
    }

    const payload = {
      ok: true,
      phase: decision.phase,
      sessionDay,
      forced: force || undefined,
      tier0Flow: result.tier0FlowCount,
      tier0Structure: result.tier0StructureCount,
      merged: result.mergedCount,
      enriched: result.enrichedCount,
      dossiers: result.dossiers.length,
      watch: result.watchCount,
      observed: result.observedCount,
      // LIVE (go-live 2026-07-24): the REAL count of WATCH candidates whose archetype×sub-lane bucket GRADUATED,
      // and how many actually opened after the armed budget + book-percent caps + idempotency gates.
      commitEligible: result.commitEligibleCount,
      committed: result.commit?.committed.filter((c) => c.positionId != null).length ?? 0,
      commitErrors: result.commit?.errors ?? 0,
      commitSkipped: result.commit?.skipped.length ?? 0,
      fadedStale: result.fadedStale ?? 0,
      duration_ms: Date.now() - started,
    };
    await logCronRun("swing-discovery", started, payload);
    return NextResponse.json(payload);
  } catch (error) {
    // RELEASE the phase claim so the next EventBridge fire (or ?force=1) can retry. Leaving the NX key
    // after a timeout/throw is what kept Swing dark all day: claim stuck, every re-fire skipped.
    if (decision.key) {
      await sharedCacheDel(decision.key).catch(() => undefined);
    }
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[cron/swing-discovery]", error);
    await logCronRun("swing-discovery", started, {
      ok: false,
      phase: decision.phase,
      error: detail,
      claim_released: true,
      duration_ms: Date.now() - started,
    });
    return NextResponse.json({ ok: false, error: "Swing discovery failed", claim_released: true }, { status: 500 });
  }
}
