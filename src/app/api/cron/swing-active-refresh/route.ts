// Cron: 15-minute MARK-AND-REVIEW of held SWING positions during RTH.
//
// WHY: once positions persist, the desk needs each one's live path recorded on a heartbeat. Every
// 15 minutes during market hours, this route reads every OPEN swing position, gathers fresh
// underlying/mark reads, APPENDS a snapshot to the position's longitudinal series, and runs the
// manager (via manage-sync) to latch live state on THAT SAMPLE. Stops, premium backstops, and
// scale cues are evaluated at sample time — intrahour touch-and-recover can still be missed between
// samples, but TACTICAL (2–7 DTE) positions now get four samples per hour instead of one.
// Snapshot series still feeds the offline multi-family grader (when bars are supplied) and trajectory studies.
//
// INVARIANTS: NEVER opens a position (no insertSwingPosition path). Snapshots are APPEND-ONLY. FAIL-SOFT: a
// bad read or DB error on one position is isolated and tallied; it never aborts the loop or throws out of
// the cron (the loop core is in active-refresh).
//
// THIN HANDLER: the refresh loop (active-refresh.ts) and the management mapping (manage-sync.ts) are pure/
// injected and unit-tested; this handler only does auth, the live provider wiring, and the run/log.

import { NextRequest, NextResponse, after } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { runSwingActiveRefresh } from "@/lib/swing/active-refresh";
import type { ManageSyncReads } from "@/lib/swing/manage-sync";
import { dteOf } from "@/lib/zerodte/scan-trigger";
import {
  fetchOpenSwingPositions,
  insertSwingSnapshot,
  updateSwingLiveState,
  insertSwingPosition,
  gradeSwingPosition,
  withSwingRollTx,
  fetchGradedSwingFeatureRows,
  type SwingPositionRow,
} from "@/lib/db";
import { fetchStockLastTrade } from "@/lib/providers/polygon-largo";
import { fetchOptionsUnifiedSnapshot } from "@/lib/providers/options-snapshot";
import { fetchUwIvRank } from "@/lib/providers/unusual-whales";
import { todayEt } from "@/lib/et-date";
import { buildSwingRollPlan } from "@/lib/swing/roll-plan";
import { modelRiskUsd, isEventArchetype, type CommitBookPosition } from "@/lib/swing/commit";
import { resolveProductionPortfolioBudget } from "@/lib/swing/swing-portfolio-budget";
import {
  analyzeSwingCalibration,
  graduatedEdgeRungsFromReport,
  swingCalibrationRowFromLedger,
} from "@/lib/swing/calibration";
import type { SwingManageRung } from "@/lib/swing/manage";
import type { ParentGradeFreeze } from "@/lib/swing/roll";
import type { SwingArchetype } from "@/lib/swing/taxonomy";
import { resolveTickerChainRows } from "@/features/nighthawk/lib/option-chain-prompt";
import { occSymbolFromSwingRow } from "@/lib/swing/occ-from-row";
import { thesisProgress01, volCollapsedFromIvRanks, addEligibleFromProgress } from "@/lib/swing/thesis-progress";
import {
  createDailyClosesBetaSource,
  fetchNameBeta,
  type CloseBar,
} from "@/lib/swing/beta";
import { fetchStockDailyBars } from "@/lib/providers/polygon";
import {
  readSwingServingSnapshot,
  persistSwingServingSnapshot,
} from "@/lib/swing/serving-lane";
import { sharedCacheGet, sharedCacheSet } from "@/lib/shared-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

/** Best-effort live underlying price from Polygon's last-trade (results.p). null when unavailable. */
async function loadUnderlyingSpot(ticker: string): Promise<number | null> {
  const trade = await fetchStockLastTrade(ticker);
  const p = trade && typeof trade === "object" ? Number((trade as Record<string, unknown>).p) : NaN;
  return Number.isFinite(p) && p > 0 ? p : null;
}

/**
 * Best-effort live OPTION mark for a held position's contract (reuses the 0DTE unified-snapshot marks path).
 * Reconstructs OCC from strike/expiry/type when `contract_occ` was null at commit (pre-fix rows). Returns
 * null when OCC is absent — fail-closed; premium rungs skip honestly (FINDINGS 2026-07-30 P0 #10).
 * rather than acting on a fabricated mark. `.mark` is the doc-priority mark (mid → last → day close).
 */
async function loadOptionMark(row: SwingPositionRow): Promise<number | null> {
  const occ = occSymbolFromSwingRow(row);
  if (!occ) return null;
  try {
    const snaps = await fetchOptionsUnifiedSnapshot([occ]);
    const mark = snaps.get(occ)?.mark;
    return typeof mark === "number" && Number.isFinite(mark) && mark > 0 ? mark : null;
  } catch {
    return null; // best-effort: a marks miss must never sink the refresh (underlying path still records)
  }
}

/** Calendar sessions held ≈ days since commit (ET-agnostic day count is fine for time_stop). */
function sessionsHeldFromRow(row: SwingPositionRow, nowMs: number): number | null {
  const raw = row.committed_at;
  if (!raw) return null;
  const t = new Date(raw).getTime();
  if (!Number.isFinite(t) || t <= 0) return null;
  return Math.max(0, Math.round((nowMs - t) / 86_400_000));
}

async function runSwingActiveRefreshCron(started: number): Promise<void> {
  const nowMs = started;
  try {
    // Fetch the open book ONCE — reused as the refresh working set AND as the roll gate's book snapshot (budget
    // + caps + idempotency). `rollBook` is then GROWN in place as each roll executes this pass: buildSwingRollPlan
    // (roll-plan.ts) swaps a closing parent for its new child directly on this array, so a SECOND same-pass roll's
    // gate check sees the first roll's child risk instead of a stale top-of-run snapshot (FINDINGS 2026-08-06 P1 —
    // mirrors commit.ts's `runningBook` growth across a commit batch).
    const openRows = await fetchOpenSwingPositions().catch(() => []);
    const rollBook: CommitBookPosition[] = openRows.map((r) => {
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
    const budget = resolveProductionPortfolioBudget();
    const sessionDay = todayEt(new Date(nowMs));
    // The roll child needs a fresh chain — the SAME resolver discovery uses; fail-soft (→ []) per name.
    const fetchChainRows = async (ticker: string) => {
      try {
        return (await resolveTickerChainRows(ticker))?.rows ?? [];
      } catch (err) {
        console.error(`[cron/swing-active-refresh] chain fetch failed for ${ticker} — roll can't build a child`, err);
        return [];
      }
    };

    // Graduated edge rungs — once per tick from the graded ledger. Fail-soft → [] (all edge rungs stay
    // advisory). Cold book ⇒ nothing graduates ⇒ nothing enforces — the intentional hard rail.
    let graduatedRungs: readonly SwingManageRung[] = [];
    try {
      const graded = await fetchGradedSwingFeatureRows(5000);
      const report = analyzeSwingCalibration(graded.map(swingCalibrationRowFromLedger));
      graduatedRungs = graduatedEdgeRungsFromReport(report);
    } catch (err) {
      console.error("[cron/swing-active-refresh] graduated-rungs load FAILED — edge rungs stay advisory", err);
      graduatedRungs = [];
    }

    const result = await runSwingActiveRefresh({
      // Reuse the once-fetched open book as the working set (also the roll gate's book snapshot above).
      fetchOpen: async () => openRows,
      // Per-position reads: fresh underlying spot + current DTE + the held contract's live OPTION mark.
      // Returning null skips the position for this tick (no fabricated snapshot). The underlying spot is
      // load-bearing (null → skip); the option mark is best-effort (null → the manager's premium rungs skip
      // via null-honesty, but the underlying path + snapshot still record). The live mark ALSO lets the roll
      // executor freeze the parent grade at roll time (roll-plan.ts gradeParentFromMark).
      loadReads: async (row): Promise<ManageSyncReads | null> => {
        const [spot, mark, ivRank] = await Promise.all([
          loadUnderlyingSpot(row.ticker),
          loadOptionMark(row),
          // EOD-cadence, Redis-cached — never a per-tick UW blast. Honest null on miss.
          fetchUwIvRank(row.ticker).catch(() => null),
        ]);
        if (spot == null) return null; // no usable underlying read → skip (fail-soft, no snapshot)
        const dte = row.contract_expiry ? dteOf(row.contract_expiry, nowMs) : null;
        const pinnedIv =
          row.feature_vector && typeof row.feature_vector.iv_rank === "number"
            ? (row.feature_vector.iv_rank as number)
            : null;
        const liveIv = ivRank != null && Number.isFinite(ivRank) ? ivRank : null;
        const progress = thesisProgress01({
          direction: row.direction === "short" ? "short" : "long",
          entryPx: row.entry_underlying_px,
          targetPx: row.target_underlying_px,
          spot,
        });
        return {
          underlyingPrice: spot,
          // Live contract mark → drives the premium ratchet (peak/trough) + the profit-ladder / −60% backstop
          // premium rungs, and lands on the snapshot's option_mark + feature-vector option_return_pct.
          mark,
          dte,
          // PRICE candidates for the ledger's underlying_mfe/underlying_mae high/low-water columns (ratcheted
          // via GREATEST/LEAST). The snapshot's running_mfe/running_mae is the SIGNED excursion % that
          // planManageSync derives from these ratcheted extremes + entry — NOT this raw spot.
          underlyingMfe: spot,
          underlyingMae: spot,
          // Structural stop = pinned thesis invalidation (underlying terms) — without this, gate 2 never fires.
          structuralStopLevel: row.thesis_invalidation_px,
          // Sessions held → time_stop advisory rung (STANDARD 8 / EXTENDED 14) — only with thesisProgress01.
          sessionsHeld: sessionsHeldFromRow(row, nowMs),
          // Progress toward pinned target — without this, time_stop is permanently inert.
          thesisProgress01: progress,
          // Fresh IV rank → feature-vector iv_rank (wins over commit-pinned value when present).
          ivRank: liveIv,
          // IV crush vs commit-pinned rank → vol_collapse advisory (null when either side absent).
          volCollapsed: volCollapsedFromIvRanks(pinnedIv, liveIv),
          // Advisory add when thesis is halfway+ to target and mark is not underwater.
          addEligible: addEligibleFromProgress({
            thesisProgress01: progress,
            entryPremium: row.entry_premium,
            mark,
          }),
          // Ladder-graduated edge rungs → manage.ts flips advisory→enforced for those rungs only.
          graduatedRungs,
        };
      },
      insertSnapshot: insertSwingSnapshot,
      updateLiveState: updateSwingLiveState,
      snapshotKind: "eod",
      // ── LIVE ROLL SEAM (go-live 2026-07-24) — the roll executor acts ONLY on a capital-preservation GATE rung
      //    and ONLY when it can freeze the parent (from a live/latched mark) AND gate the child (budget + caps +
      //    idempotency). Absent any of those → manage-sync stays evidence-only (no terminal write). The three
      //    roll-ledger accessors + runRollTx make the close+grade+child write ATOMIC (BEGIN/COMMIT, rollback on
      //    a 0-row grade race — db.ts withSwingRollTx). ──
      insertChild: insertSwingPosition,
      gradeParent: async (id: number, g: ParentGradeFreeze & { status: "CLOSED" | "ROLLED" }) => {
        await gradeSwingPosition(id, g);
      },
      runRollTx: withSwingRollTx,
      buildRollPlan: (row, verdict, reads) =>
        buildSwingRollPlan(row, verdict, reads, { fetchChainRows, book: rollBook, budget, sessionDay }),
    });

    // Tally the LIVE roll outcomes for observability (a roll writes a terminal parent status + opens a child).
    const rolls = result.outcomes.filter((o) => o.roll);

    // Refresh serving-snapshot spots for open tickers so pre-entry setup maturity stays live between
    // discovery phases (cache-writer on the cron; member path stays cache-reader).
    let spotsRefreshed = 0;
    try {
      const snap = await readSwingServingSnapshot();
      if (snap) {
        const spots = { ...(snap.spotsByTicker ?? {}) };
        for (const row of openRows) {
          const spot = await loadUnderlyingSpot(row.ticker).catch(() => null);
          if (spot != null) {
            spots[row.ticker.toUpperCase()] = spot;
            spotsRefreshed += 1;
          }
        }
        // Also refresh WATCH names already in the snapshot (bounded) so FORMING/TRIGGERED stays current.
        const watchTickers = [...new Set((snap.watch ?? []).map((w) => w.ticker.toUpperCase()))]
          .filter((t) => spots[t] == null || openRows.every((r) => r.ticker.toUpperCase() !== t))
          .slice(0, 30);
        await Promise.all(
          watchTickers.map(async (ticker) => {
            const spot = await loadUnderlyingSpot(ticker).catch(() => null);
            if (spot != null) {
              spots[ticker] = spot;
              spotsRefreshed += 1;
            }
          }),
        );
        await persistSwingServingSnapshot({ ...snap, spotsByTicker: spots });
      }
    } catch (err) {
      console.error("[cron/swing-active-refresh] serving-spot refresh failed (non-fatal)", err);
    }

    // Beta (OLS vs SPY) — Redis-cached per name so hourly refresh never blasts daily-bar upstream.
    // Stamped into cron payload for observability; risk math consumes via fetchNameBeta when sizing.
    const BETA_CACHE_TTL_SEC = 6 * 60 * 60;
    let betasResolved = 0;
    try {
      const from = new Date(nowMs - 200 * 86_400_000).toISOString().slice(0, 10);
      const to = sessionDay;
      const closesCache = new Map<string, Promise<CloseBar[]>>();
      const closesFor = (ticker: string): Promise<CloseBar[]> => {
        const key = ticker.toUpperCase();
        let cached = closesCache.get(key);
        if (!cached) {
          cached = fetchStockDailyBars(key, from, to).then((bars) =>
            bars
              .map((b) => ({ t: typeof b.t === "number" ? b.t : undefined, c: Number(b.c) }))
              .filter((b) => Number.isFinite(b.c)),
          );
          closesCache.set(key, cached);
        }
        return cached;
      };
      const source = createDailyClosesBetaSource({ fetchCloses: closesFor });
      for (const row of openRows.slice(0, 25)) {
        const cacheKey = `swing:beta:${row.ticker.toUpperCase()}:v1`;
        const hit = await sharedCacheGet<{ beta: number | null; n: number }>(cacheKey).catch(() => null);
        if (hit) {
          betasResolved += 1;
          continue;
        }
        const res = await fetchNameBeta(row.ticker, source);
        await sharedCacheSet(cacheKey, { beta: res.beta, n: res.n, missing: res.betaMissing }, BETA_CACHE_TTL_SEC).catch(
          () => undefined,
        );
        if (!res.betaMissing) betasResolved += 1;
      }
    } catch (err) {
      console.error("[cron/swing-active-refresh] beta warm failed (non-fatal)", err);
    }

    // FINDINGS 2026-08-06 (SEV-1 observability): syncSwingManagement is fail-soft — it CAPTURES the
    // per-position exception into ManageSyncOutcome.error (manage-sync.ts) and active-refresh.ts only
    // increments a counter from it. Nothing ever read the message, so a real-money write that failed on
    // 100% of positions for 5.5 hours of RTH surfaced as nothing but `errored=2` in the summary line
    // below — un-root-causable without a local DB repro. Emit the discarded message per position (with
    // the ticker, so a lane-wide vs row-specific failure is distinguishable at a glance).
    for (const o of result.outcomes) {
      if (!o.error) continue;
      const ticker = openRows.find((r) => r.id === o.positionId)?.ticker ?? "?";
      console.error(
        `[cron/swing-active-refresh] position sync FAILED — id=${o.positionId} ticker=${ticker}: ${o.error}`
      );
    }

    console.info(
      `[cron/swing-active-refresh] background done — positions=${result.positions} refreshed=${result.refreshed} snapshots=${result.snapshotsAppended} skipped=${result.skipped} errored=${result.errored} rolled=${rolls.filter((o) => o.roll?.action === "ROLL" && o.roll?.childId != null).length} closed=${rolls.filter((o) => o.roll?.action === "CLOSE" && o.roll?.parentGraded).length} spotsRefreshed=${spotsRefreshed} betasResolved=${betasResolved} elapsed=${Date.now() - started}ms`
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[cron/swing-active-refresh] background REJECTED: ${detail}`);
  }
}

export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Per-position Polygon/UW reads + serving-spot refresh + beta warm can exceed Cloudflare's ~100s
  // origin timeout when the open book is non-empty (ops #1364: market_hours_stale with no fresh row).
  // Mirror coaching-alerts / vector-universe-snapshot: handshake in seconds, refresh in after().
  const dispatchRefresh = () => {
    void runSwingActiveRefreshCron(started).catch((error) => {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[cron/swing-active-refresh] background refresh REJECTED: ${detail}`);
    });
  };

  try {
    after(dispatchRefresh);
  } catch {
    dispatchRefresh();
  }

  const accepted = {
    ok: true,
    status: "accepted",
    reason: "Swing active-refresh dispatched in background (fire-and-forget)",
  };
  await logCronRun("swing-active-refresh", started, accepted);
  return NextResponse.json(
    {
      ...accepted,
      note: "Position mark-and-review + serving-spot refresh run in background — handshake stays under edge timeout.",
    },
    { status: 202 }
  );
}
