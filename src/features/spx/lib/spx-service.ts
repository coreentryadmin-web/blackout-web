import {
  fetchClosedPlayOutcomes,
  fetchLottoPlaysForDate,
  fetchOpenSpxPlay,
  fetchRecentSpxSignalLogs,
  fetchSpxAdminRollups,
} from "@/lib/db";
import { observeSpxPlayVoiceTransitions } from "@/features/spx/lib/spx-voice-feed-store";
import { loadMergedSpxDesk, peekMergedSpxDesk } from "@/features/spx/lib/spx-desk-loader";
import { fetchRecentSpxSnapshots } from "@/features/spx/lib/spx-signal-log";
import { computeFlowStrikeStacks } from "@/lib/largo/flow-strike-stacks";
import { readSpxPlaySnapshot } from "@/features/spx/lib/spx-evaluator";
import { buildPlayTechnicals } from "@/features/spx/lib/spx-play-technicals";
import { resolveGuardedPlaybookMatch } from "@/features/spx/lib/playbook-match-resolver";
import { buildPlaybookShadowPanel } from "@/features/spx/lib/playbook-shadow-panel";
import { refreshOrBreakMemory } from "@/features/spx/lib/playbook-break-memory-store";
import { maybeLogPlaybookShadowMatch } from "@/features/spx/lib/playbook-shadow-log";
import { isPremarketPlanningWindow, isSpxEngineCronWindow } from "@/features/spx/lib/spx-play-session-guards";
import { loadOpenPlay } from "@/features/spx/lib/spx-play-store";
import {
  degradedPlayPayload,
  degradedPlayCatchingUpMessage,
  currentSessionPhase,
} from "@/features/spx/lib/spx-play-payload";
import { playMemberReadCacheSec, playMemberPeekMaxAgeSec } from "@/features/spx/lib/spx-play-config";
import {
  isSpxPlaySnapshotFreshEnough,
  isSpxPlaySnapshotShareable,
} from "@/features/spx/lib/spx-play-freshness";
import {
  playMemberReadMaxBlockMs,
  spxMergedDeskOffHoursRefreshIntervalSec,
} from "@/lib/providers/config";
import { todayEtYmd } from "@/lib/providers/spx-session";
import { sharedCacheDel, sharedCacheGetWithTtl, sharedCacheSet, sharedCacheSetNx } from "@/lib/shared-cache";
import { roundFloats } from "@/lib/round-floats";
import { withServerCache, peekServerCache } from "@/lib/server-cache";
import { loadPowerHourRecord } from "@/features/spx/lib/spx-power-hour-store";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import type { SpxDeskSummary } from "@/lib/platform/types";

export function summarizeSpxDesk(merged: SpxDeskPayload): SpxDeskSummary {
  const spx_flows = merged.spx_flows;
  return {
    as_of: merged.as_of,
    market_open: merged.market_open ?? false,
    market_label: merged.market_label ?? "",
    price: merged.price,
    change_pct: merged.spx_change_pct,
    vix: merged.vix,
    vwap: merged.vwap,
    above_vwap: merged.above_vwap,
    hod: merged.hod,
    lod: merged.lod,
    pdh: merged.pdh,
    pdl: merged.pdl,
    ema20: merged.ema20,
    ema50: merged.ema50,
    gamma_flip: merged.gamma_flip,
    gex_net: merged.gex_net,
    gex_king: merged.gex_king,
    max_pain: merged.max_pain,
    gamma_regime: merged.gamma_regime,
    gex_walls: merged.gex_walls,
    flow_0dte_net: merged.flow_0dte_net,
    tide_bias: merged.tide_bias,
    tide_net: merged.tide_net,
    nope: merged.nope,
    tick: merged.tick,
    trin: merged.trin,
    add: merged.add,
    uw_iv_rank: merged.uw_iv_rank,
    regime: merged.regime,
    levels: merged.levels,
    dark_pool: merged.dark_pool,
    spx_flows,
    unified_tape: merged.unified_tape,
    net_prem_ticks: merged.net_prem_ticks,
    news_headlines: merged.news_headlines,
    macro_events: merged.macro_events,
    sector_heat: merged.sector_heat,
    leader_stocks: merged.leader_stocks,
    oi_changes: merged.oi_changes,
    iv_term_structure: merged.iv_term_structure,
    vix_term: merged.vix_term,
    greek_exposure: merged.greek_exposure,
    market_breadth: merged.market_breadth,
    mag7_greek_flow: merged.mag7_greek_flow,
    macro_indicators: merged.macro_indicators,
    strike_stacks: computeFlowStrikeStacks(spx_flows ?? []),
    data_quality: merged.data_quality ?? null,
  };
}

export async function getSpxDeskSummary(): Promise<SpxDeskSummary> {
  const { merged } = await loadMergedSpxDesk();
  return roundFloats(summarizeSpxDesk(merged));
}

/** Shared closed-market fast path — builds the honest "Session closed" snapshot from an
 *  already-loaded (fresh OR peeked-stale, caller's choice) merged desk bundle. Returns null when
 *  a position is still open after the close (needs the real evaluation below to force-settle
 *  it) — mirrors evaluateSpxPlayCore's own `!desk.market_open && !premarket` gate. */
async function closedMarketPlaySnapshot(
  merged: Awaited<ReturnType<typeof loadMergedSpxDesk>>["merged"]
): Promise<Awaited<ReturnType<typeof readSpxPlaySnapshot>> | null> {
  const openAfterClose = merged.price > 0 ? await loadOpenPlay() : null;
  if (openAfterClose) return null;
  const play = await readSpxPlaySnapshot(merged, null, {});
  void observeSpxPlayVoiceTransitions(play, todayEtYmd()).catch(() => {});
  return play;
}

const SPX_MERGED_DESK_BG_REFRESH_LOCK_PREFIX = "spx-merged-desk-bg-refresh";

/**
 * BUG FIX (2026-10-26, Ask Largo/5-engine standing mandate, live repro): the off-hours shortcut
 * below only ever PEEKS `spx-merged:<date>` (Redis/L1, never a real rebuild) with a 24h staleness
 * tolerance. Outside isSpxEngineCronWindow(), NOTHING else calls the real loadMergedSpxDesk()
 * either, so once the key's own short TTL (deskCacheTtlMs()) lapses in Redis, each ECS replica
 * falls back to its OWN independently-aged per-process copy (peekServerCache, server-cache.ts) —
 * and those copies can disagree by many minutes depending on when each replica last happened to
 * run a real load. Live-reproduced 2026-10-26 (pre-7am ET): GET /api/market/spx/play polled 20s
 * apart returned `as_of` jumping BACKWARD (2026-10-26T10:36:47Z → 10:19:08Z) with two DIFFERENT
 * computed scores (4, then 6) for what should be one "current" read — different replicas serving
 * different frozen desk vintages, non-monotonically, to the same member.
 *
 * Fix: kick a non-blocking background loadMergedSpxDesk() so `spx-merged:<date>` never goes fully
 * cold for the whole off-hours window — bounding how far any replica's local copy can drift from
 * the shared Redis value, and keeping that Redis value itself refreshed often enough that a
 * replica's own short-TTL local entry reliably re-syncs from it instead of falling through to its
 * stale local fallback. Throttled via sharedCacheSetNx (fails open/closed to "skip" on a Redis
 * error — this is a best-effort consistency aid, not a correctness-critical lock) so only one
 * replica actually performs the refresh per spxMergedDeskOffHoursRefreshIntervalSec() window, not
 * every single poll — this intentionally does NOT restore trading-hours (10s) refresh cadence
 * off-hours, only bounds the worst-case divergence window.
 */
export async function maybeRefreshMergedSpxDeskOffHours(): Promise<void> {
  const lockKey = `${SPX_MERGED_DESK_BG_REFRESH_LOCK_PREFIX}:${todayEtYmd()}`;
  const won = await sharedCacheSetNx(
    lockKey,
    Date.now(),
    spxMergedDeskOffHoursRefreshIntervalSec()
  ).catch(() => false);
  if (!won) return;
  await loadMergedSpxDesk().catch(() => undefined);
}

async function evaluateSpxPlayState() {
  // MEASURED LIVE 2026-10-18: even after the 2026-10-17 fix below skipped
  // buildPlayTechnicals/refreshOrBreakMemory/resolveGuardedPlaybookMatch on a closed-market read,
  // the fast path still depended on `merged` from the UNCONDITIONAL `await loadMergedSpxDesk()`
  // just below — and on a cold `spx-merged:<date>` cache (reliably cold off-hours/weekends, since
  // nothing RTH-gated keeps it warm then), that load alone can legitimately take up to
  // deskBootstrapMaxBlockMs() (3s default), which already exceeds the OUTER
  // playMemberReadMaxBlockMs() budget (800ms) wrapping this whole function — so the honest
  // closed-market branch was STILL never reached; `getSpxPlayState()`'s own withServerCache threw
  // ServerCacheTimeoutError before ever getting here. Reproduced live 2026-10-18: 15-19/19 cold
  // evals over two separate 15-min windows, 0 successes.
  //
  // Fix: when we're confidently OUTSIDE real trading hours (isSpxEngineCronWindow() false — i.e.
  // not 7am-4:15pm ET on a trading day), try a cheap, non-blocking PEEK of the merged desk first
  // (peekMergedSpxDesk(), Redis/L1 only, never triggers a rebuild). Once the market is genuinely
  // closed, "stale" and "correct" are the same thing — a Friday-close snapshot read on a quiet
  // Sunday is accurate, not wrong — so a generous staleness ceiling is safe here specifically.
  // isSpxEngineCronWindow() being false guarantees this branch NEVER activates during or near real
  // trading hours (cron ticks + real member traffic both keep the cache warm well within that
  // window regardless), so the existing fresh/correct path below is completely unchanged for
  // every trading-hours eval — this only shortcuts the already-broken off-hours case.
  if (!isSpxEngineCronWindow()) {
    const peeked = await peekMergedSpxDesk({ maxStaleMs: 24 * 60 * 60 * 1000 });
    if (peeked && !peeked.merged.market_open && !isPremarketPlanningWindow()) {
      // Non-blocking — see maybeRefreshMergedSpxDeskOffHours's own comment for the live
      // cross-replica divergence bug this guards against. Fires at most once per
      // spxMergedDeskOffHoursRefreshIntervalSec() window regardless of poll volume.
      void maybeRefreshMergedSpxDeskOffHours();
      const play = await closedMarketPlaySnapshot(peeked.merged);
      if (play) return roundFloats({ ...play, playbook_shadow: null });
    }
  }

  const { merged } = await loadMergedSpxDesk();

  // Same gate as above, now against a FRESH `merged` — the only path trading-hours evals (and any
  // off-hours eval the peek above couldn't shortcut, e.g. a genuinely cold replica with no cached
  // snapshot anywhere) ever take. Mirrors evaluateSpxPlayCore's own `!desk.market_open &&
  // !premarket` gate plus its loadOpenPlay() fallthrough, so behavior for every OTHER state is
  // unchanged from before the 2026-10-17 fix.
  if (!merged.market_open && !isPremarketPlanningWindow()) {
    const play = await closedMarketPlaySnapshot(merged);
    if (play) return roundFloats({ ...play, playbook_shadow: null });
  }

  const technicals = await buildPlayTechnicals(merged.price, {
    vwap: merged.vwap,
    pdh: merged.pdh,
    pdl: merged.pdl,
    hod: merged.hod,
    lod: merged.lod,
  });
  const sessionDate = todayEtYmd();
  const orBreakMemory = await refreshOrBreakMemory(sessionDate, merged, technicals, true);
  const playbookMatch = technicals.available
    ? await resolveGuardedPlaybookMatch(sessionDate, merged, technicals, {
        or_break_memory: orBreakMemory,
      })
    : null;
  const play = await readSpxPlaySnapshot(merged, technicals, {
    or_break_memory: orBreakMemory,
    playbook_resolved: playbookMatch,
  });
  const playbook_shadow = buildPlaybookShadowPanel(merged, technicals, {
    or_break_memory: orBreakMemory,
    match: playbookMatch,
  });
  const primaryVerdict = playbook_shadow?.verdicts.find((v) => v.primary && v.trigger_fired);
  void maybeLogPlaybookShadowMatch(
    merged,
    playbook_shadow,
    {
      action: play.action,
      score: play.score,
    },
    {
      technicals,
      resolved: playbookMatch,
      persist_instances: false,
      gate_blocks: play.gates.blocks,
      first_block_category: play.gates.first_block_category,
      primary_playbook_id: playbook_shadow?.primary_playbook_id ?? null,
      primary_direction:
        primaryVerdict?.direction === "long" || primaryVerdict?.direction === "short"
          ? primaryVerdict.direction
          : null,
      opened_direction:
        play.phase === "OPEN" && play.open_play?.direction
          ? play.open_play.direction
          : null,
      option_contract_candidate: play.option_ticket ?? null,
    }
  ).catch((err) => {
    console.warn("[spx-playbook-shadow]", err instanceof Error ? err.message : err);
  });
  void observeSpxPlayVoiceTransitions(play, sessionDate).catch(() => {});
  return roundFloats({
    ...play,
    playbook_shadow,
  });
}

const SPX_PLAY_EVAL_LOCK_PREFIX = "spx-play-eval-lock";
/** Bounds the NX claim — must outlive a slow cold eval but self-heal if a replica dies mid-build. */
const SPX_PLAY_EVAL_LOCK_TTL_SEC = 45;

function spxPlayServerCacheKey(date: string): string {
  return `server:spx-play-read:${date}`;
}

/** When another replica holds the eval lock, poll Redis for its published snapshot.
 *
 * Uses `isSpxPlaySnapshotShareable` (not the plain freshness bound) so a closed-market
 * snapshot — whose `as_of` is the desk snapshot's own timestamp by design, not eval time — is
 * trusted regardless of age; a live-market snapshot still has to clear the real bound. See
 * spx-play-freshness.ts's doc comment for why (fix for a same-day regression in PR #6719).
 */
async function waitForPeerSpxPlaySnapshot(
  date: string,
  maxMs = 800
): Promise<Awaited<ReturnType<typeof evaluateSpxPlayState>> | null> {
  const maxAgeMs = playMemberPeekMaxAgeSec() * 1000;
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const hit = await sharedCacheGetWithTtl<Awaited<ReturnType<typeof evaluateSpxPlayState>>>(
      spxPlayServerCacheKey(date)
    );
    if (hit?.value && isSpxPlaySnapshotShareable(hit.value, Date.now(), maxAgeMs)) {
      return hit.value;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return null;
}

/**
 * Cross-replica single-flight around the expensive eval. Without this, parallel
 * cache misses on different ECS replicas can return divergent grade/score/direction
 * (spx-bie-consistency prod double-fetch caught flow-skew long vs SCANNING).
 */
export async function evaluateSpxPlayStateCrossReplica(): Promise<Awaited<ReturnType<typeof evaluateSpxPlayState>>> {
  const date = todayEtYmd();
  const lockKey = `${SPX_PLAY_EVAL_LOCK_PREFIX}:${date}`;
  // Fail CLOSED (treat as lock-not-won) on a Redis error: this lock only exists to stop every
  // replica recomputing the expensive eval at once, and Redis being unavailable is exactly the
  // moment the platform can least afford N-way redundant compute. Falling through to the
  // stale-cache/peer-wait/degraded chain below costs nothing extra, unlike a cron overlap guard
  // (where fail-open is the right call because the alternative is a stuck cron) — this is a
  // single-flight optimization, not a guard against a stuck background job.
  const won = await sharedCacheSetNx(lockKey, Date.now(), SPX_PLAY_EVAL_LOCK_TTL_SEC).catch(() => false);
  if (!won) {
    // BUG FIX (2026-10-25, Ask Largo/5-engine standing mandate, live repro): this read the shared
    // spxPlayServerCacheKey hit unconditionally the instant it was non-null, trusting
    // sharedCacheGetWithTtl's Redis-native `ttl > 0` gate alone. Live polling of
    // GET /api/market/spx/play caught snapshots up to ~24 minutes stale served non-monotonically
    // (a later poll returning an OLDER as_of than an earlier one, with genuinely different
    // score/direction/factors) -- the exact "divergent grade/score/direction across replicas"
    // failure this cross-replica lock exists to prevent (see comment above). peekSpxPlayState,
    // the only other reader of this same key, already bounds it with
    // isSpxPlaySnapshotFreshEnough; apply the same bound here instead of trusting the TTL alone.
    //
    // BUG FIX #2 (2026-10-25, same day, found live immediately after the fix above shipped):
    // a plain freshness bound over-corrected for the CLOSED-MARKET case. Once the market is
    // genuinely closed, evaluateSpxPlayState's closed-market branch (spx-play-engine.ts)
    // deliberately stamps `as_of` from the desk snapshot's own timestamp, not eval time -- a
    // 20s bound can never pass against that legitimately-old stamp, so every closed-market read
    // here was rejecting the just-published snapshot and falling through to a redundant
    // re-evaluation on every single contended request (defeating the single-flight cache this
    // lock exists to provide), without fixing anything -- the re-eval reads the same stale desk
    // peek and produces an identical answer. isSpxPlaySnapshotShareable trusts a
    // `session_phase: "closed"` snapshot regardless of age while still applying the real bound
    // to a live-market one, so PR #6719's live-market fix above is unchanged.
    const maxAgeMs = playMemberPeekMaxAgeSec() * 1000;
    const stale = await sharedCacheGetWithTtl<Awaited<ReturnType<typeof evaluateSpxPlayState>>>(
      spxPlayServerCacheKey(date)
    );
    if (stale?.value && isSpxPlaySnapshotShareable(stale.value, Date.now(), maxAgeMs)) {
      return stale.value;
    }
    const peer = await waitForPeerSpxPlaySnapshot(date);
    if (peer) return peer;
    return spxPlayReadDegraded();
  }
  try {
    const result = await evaluateSpxPlayState();
    void sharedCacheSet(
      spxPlayServerCacheKey(date),
      result,
      Math.max(playMemberReadCacheSec() * 2, 10)
    ).catch(() => undefined);
    return result;
  } finally {
    await sharedCacheDel(lockKey).catch(() => undefined);
  }
}

/**
 * Single derivation for member `/api/market/spx/play`, BIE `spx_full_state`, and Largo
 * `get_spx_play`. Collapses member polls into one eval per cache window — no
 * stale-while-revalidate so BIE/Largo and the dashboard never disagree on grade/score.
 *
 * BUG FIX (2026-10-21, Ask Largo/5-engine standing mandate, live repro): this used to call
 * `degradedPlayPayload()` bare, which defaults `session_phase: "closed"` — a flat, false claim
 * about the DESK (not just the play-eval pipeline that actually failed/lost the lock). That
 * field feeds `spx-play-verdict-bar.ts`'s `resolveMode()` (`session_phase === "closed"` ⇒ show
 * the member-facing CLOSED badge) regardless of whether the real market session is open. Same
 * root cause the 2026-10-16 headline fix (route.ts, see that comment) addressed for a different
 * field — the pipeline failing is not evidence the desk/session is closed. `peekMergedSpxDesk()`
 * is already proven fast/non-blocking even when the expensive play-eval path times out or loses
 * its cross-replica lock (see `docs/audit/MARKET-OPEN-VALIDATION.md` #398), so peek it here and
 * derive the real phase via the same `currentSessionPhase()` every non-degraded path already uses.
 *
 * BUG FIX (2026-10-26, Ask Largo/5-engine standing mandate, live repro during RTH): the fix above
 * only ever touched `session_phase` here. This function still fell straight through to
 * `degradedPlayPayload()`'s bare `headline`/`idle_message` default ("Desk warming — play state
 * unavailable") — the exact same false "the DESK is cold" claim the 2026-10-16 fix removed from
 * route.ts's catch block, just never carried over to this sibling call site. Confirmed live
 * 2026-10-26T13:37:52Z: `GET /api/market/spx/play` returned that literal headline with
 * `session_phase:"cash"` (the field above DID get corrected) while a parallel `GET
 * /api/market/spx/desk` call showed the real desk fully live (`market_open:true`, a ~45s-old
 * poll). This path is reached on every ORDINARY lock-loss-with-no-stale/peer-snapshot outcome —
 * the file's own top-of-function comment calls it routine, not rare — so, same as route.ts's
 * ServerCacheTimeoutError branch, the honest "pipeline didn't finish in time" message always
 * applies here, not only when the desk peek happens to succeed. `degradedPlayCatchingUpMessage()`
 * is the SAME shared helper route.ts's catch block now also pulls from, so the two call sites
 * cannot independently drift again.
 */
async function spxPlayReadDegraded(): Promise<Awaited<ReturnType<typeof evaluateSpxPlayState>>> {
  const peeked = await peekMergedSpxDesk().catch(() => null);
  const extras = {
    ...degradedPlayCatchingUpMessage(),
    ...(peeked ? { session_phase: currentSessionPhase(peeked.merged) } : {}),
  };
  return degradedPlayPayload(extras) as Awaited<ReturnType<typeof evaluateSpxPlayState>>;
}

async function spxPlayReadFallback(): Promise<Awaited<ReturnType<typeof evaluateSpxPlayState>>> {
  const date = todayEtYmd();
  const maxAgeMs = playMemberPeekMaxAgeSec() * 1000;
  const hit = await sharedCacheGetWithTtl<Awaited<ReturnType<typeof evaluateSpxPlayState>>>(
    spxPlayServerCacheKey(date)
  );
  // isSpxPlaySnapshotShareable (not the plain freshness bound) — see waitForPeerSpxPlaySnapshot's
  // comment above: a closed-market snapshot's as_of is desk time by design, so it's trusted
  // regardless of age, while a live-market snapshot still has to clear the real bound.
  if (hit?.value && isSpxPlaySnapshotShareable(hit.value, Date.now(), maxAgeMs)) {
    return hit.value;
  }
  const peer = await waitForPeerSpxPlaySnapshot(date, 800);
  if (peer) return peer;
  return spxPlayReadDegraded();
}

/**
 * Bug fixed 2026-09-13 (live audit): this used to return `mem`/`hit.value` unconditionally the
 * instant either was non-null, trusting `peekServerCache`'s generic up-to-10-minute staleness
 * tolerance (server-cache.ts's `MAX_STALE_AGE_MS`) as if it matched this route's actual 5s
 * freshness contract (`playMemberReadCacheSec`). It didn't: polling `/api/market/spx/play` at 1s
 * intervals in production caught snapshots up to ~234s stale, `as_of` jumping BACKWARD between
 * consecutive requests (different ECS replicas each independently peeking their own up-to-10-min-
 * stale in-memory copy, since `peekServerCache`'s `store` Map is per-process, not shared), and
 * `assessed`/`score` flapping true/39 <-> false/0 a second apart on the SAME member's poll loop.
 * Now both the in-process and Redis-backed peek results are checked against
 * `playMemberPeekMaxAgeSec()` (a real multiple of the route's own TTL, not the generic ceiling)
 * before being trusted; a too-stale result falls through to `null`, and the route's own fallback
 * (`getSpxPlayState()`) does a properly cross-replica-coordinated refresh instead.
 */
export async function peekSpxPlayState(): Promise<Awaited<ReturnType<typeof evaluateSpxPlayState>> | null> {
  const date = todayEtYmd();
  const maxAgeMs = playMemberPeekMaxAgeSec() * 1000;
  const mem = await peekServerCache<Awaited<ReturnType<typeof evaluateSpxPlayState>>>(
    `spx-play-read:${date}`
  );
  if (mem && isSpxPlaySnapshotFreshEnough(mem.as_of, Date.now(), maxAgeMs)) return mem;
  const hit = await sharedCacheGetWithTtl<Awaited<ReturnType<typeof evaluateSpxPlayState>>>(
    spxPlayServerCacheKey(date)
  );
  if (hit?.value && isSpxPlaySnapshotFreshEnough(hit.value.as_of, Date.now(), maxAgeMs)) return hit.value;
  return null;
}

export async function getSpxPlayState() {
  const date = todayEtYmd();
  const ttlMs = playMemberReadCacheSec() * 1000;
  return withServerCache(`spx-play-read:${date}`, ttlMs, evaluateSpxPlayStateCrossReplica, {
    staleWhileRevalidate: false,
    staleOnInflight: true,
    maxBlockMs: playMemberReadMaxBlockMs(),
    fallback: spxPlayReadFallback,
    // BUG (found live 2026-10-16, Ask Largo standing mandate): without this, withServerCache's
    // own `!swr` fast lane (server-cache.ts) measures staleness against the generic
    // MAX_STALE_AGE_MS (10 minutes) for this exact cache key — a much looser bound than
    // peekSpxPlayState() enforces one call earlier in the same request via
    // playMemberPeekMaxAgeSec() (20s). So a snapshot peekSpxPlayState() had just correctly
    // rejected as too stale was served anyway by this fallback, unchanged, because the two
    // call sites touching the SAME `spx-play-read:<date>` entry disagreed on "how old is too
    // old." Live-reproduced: `as_of` jumping backward up to ~238s across consecutive polls of
    // GET /api/market/spx/play. Passing the same bound here closes the gap at the source
    // rather than relying on the generic 10-minute default to coincidentally agree.
    maxStaleAgeMs: playMemberPeekMaxAgeSec() * 1000,
    // BUG (found live 2026-10-08, ~50% degraded rate measured via repeated polling):
    // evaluateSpxPlayStateCrossReplica() INTENTIONALLY RESOLVES (never throws) to
    // degradedPlayPayload() when this replica loses the cross-replica Redis lock and
    // neither a stale snapshot nor a peer's published result shows up within the wait —
    // a routine outcome, not a rare one, since the in-memory TTL here is only 5s
    // (playMemberReadCacheSec()) while the real eval can easily take longer than the
    // 800ms peer-wait. Because that placeholder is a normally-RESOLVED value, not a
    // thrown error, refreshCache()'s success path (server-cache.ts) was writing it into
    // BOTH the in-memory store AND shared Redis for the FULL TTL with no shouldCache
    // guard — so one replica losing the lock didn't just degrade that one request, it
    // cached "Desk warming" cluster-wide (via the shared Redis copy) for the next ~5s,
    // repeatedly amplifying a single lock-contention loss into a flapping outage visible
    // to every member/BIE/Largo reader of this cache key. `assessed` is the payload's own
    // documented absence marker (see SpxPlayPayload's doc comment: explicit `false` means
    // "grade/score are placeholder literals, NOT a measurement") and is `false` ONLY on
    // this placeholder path — never on a genuine closed-session/no-trade assessment
    // (which still sets `assessed: true` with real factors) — so gating on it here is the
    // same fix already shipped for Night Hawk's edition route (`available !== false`,
    // src/app/api/market/nighthawk/edition/route.ts), applied to the field that's actually
    // exclusive to this payload's placeholder state.
    shouldCache: (value) => (value as Awaited<ReturnType<typeof evaluateSpxPlayState>>).assessed !== false,
    // BUG (found live 2026-10-16, Ask Largo standing mandate — the fallback-timeout-race
    // investigation that ALSO produced ServerCacheTimeoutError/the route catch-block fix):
    // without `localOnly`, withServerCache's OWN generic Redis layer (server-cache.ts's
    // `writeRedisCache`) was a SECOND, uncoordinated writer to the exact same Redis key
    // (`server:spx-play-read:<date>`) that evaluateSpxPlayStateCrossReplica() ALSO publishes
    // to directly a few lines up, via its own `sharedCacheSet(..., Math.max(playMemberReadCacheSec()
    // * 2, 10))` — a DELIBERATE 10s TTL, double the 5s refresh cadence, specifically so a slow
    // refresh cycle still has a stale copy for every OTHER replica's `!won` branch (and
    // spxPlayReadFallback below) to serve. That 10s margin was being defeated on EVERY single
    // successful eval, deterministically, not intermittently: evaluateSpxPlayStateCrossReplica's
    // own write lands first (awaited via its `finally`'s sharedCacheDel before the promise even
    // resolves back up to refreshCache), then refreshCache's own post-loader write
    // (`writeRedisCache`, generation-guarded but NOT TTL-aware — it only skips a write that is
    // OLDER than the last one, it has no concept of "don't shorten an existing longer TTL") fires
    // moments later with the OUTER ttlMs (5s), silently overwriting the 10s TTL down to 5s every
    // time. Confirmed via CloudWatch (live RTH throws at 2026-10-15 14:33/15:17/17:02/17:27/19:25
    // UTC, `[server-cache] spx-play-read:<date>: cold miss exceeded maxBlockMs`, reproduced again
    // 2026-10-16 02:12:27 UTC — 18s after the #6085/#6076 deploy rollout itself completed, so this
    // is NOT explained by stale pre-deploy code) that these throws correlate with sustained UW
    // provider queue congestion (same-window logs show individual UW calls queued 830ms-3.6s) —
    // under that kind of congestion a cold eval can easily run past 5s, so halving its published
    // snapshot's survival time from the intended 10s down to 5s measurably shrinks the window every
    // OTHER replica has to find a usable stale copy instead of also going cold, compounding a
    // transient upstream slowdown into a cluster-wide outage. `evaluateSpxPlayStateCrossReplica`'s
    // own lock + explicit `sharedCacheGetWithTtl` reads (here and in spxPlayReadFallback) already
    // fully own this key's cross-replica publish/read semantics — `localOnly` just removes the
    // SECOND, conflicting generic writer/reader withServerCache would otherwise layer on top,
    // restoring the intended 10s margin without changing anything about the purpose-built logic.
    // (Considered instead retuning spxPlayReadFallback's/waitForPeerSpxPlaySnapshot's internal
    // 800ms peer-wait against the same 800ms outer maxBlockMs — the originally-hypothesized "two
    // races of the same duration" root cause. Live CloudWatch evidence above shows the actual cold
    // evals are slow because of real upstream (UW) queue latency, not a timing-margin coincidence;
    // shrinking that internal wait would not make a multi-second cold eval finish any faster and
    // was not shipped — this TTL fix addresses the mechanism the evidence actually points to.)
    localOnly: true,
  });
}

export async function getSpxOpenPlay() {
  return { open_play: await fetchOpenSpxPlay(todayEtYmd()) };
}

export async function getSpxTradeHistory(opts?: { ticker?: string; days?: number }) {
  const days = opts?.days ?? 30;
  const cutoff = Date.now() - days * 86400000;
  // OPTIMIZATION NEEDED: fetchClosedPlayOutcomes does not yet accept ticker/date
  // params, so ticker and date filters are applied in-process after fetching 300
  // rows. Push these filters into the DB query layer (fetchClosedPlayOutcomes)
  // to avoid over-fetching when ticker or a short date range is requested.
  let rows = await fetchClosedPlayOutcomes(300);
  if (opts?.ticker) {
    const sym = opts.ticker.toUpperCase();
    rows = rows.filter((r) => r.headline.toUpperCase().includes(sym));
  }
  return rows.filter((r) => new Date(r.closed_at ?? r.opened_at).getTime() >= cutoff).slice(0, 50);
}

export async function getSpxSetupStats() {
  return fetchSpxAdminRollups();
}

export async function getSpxSignalLog(limit = 20) {
  return fetchRecentSpxSignalLogs(limit);
}

/**
 * Task #108 — retrospective engine-state snapshot log, the sibling of getSpxSignalLog
 * above that answers "why was the last signal rejected / what was the engine doing at
 * time Y" instead of "what did it actually fire." Routed through
 * fetchRecentSpxSnapshots (src/lib/providers/spx-signal-log.ts) rather than calling
 * db.ts's fetchRecentSpxEngineSnapshots directly (unlike getSpxSignalLog above, which
 * does bypass its own provider-layer sibling fetchRecentSpxSignals) — kept the query
 * threaded through the provider module that owns the throttle/write side of this
 * feature so both halves live in one place.
 */
export async function getSpxEngineSnapshots(limit = 20) {
  return fetchRecentSpxSnapshots(limit);
}

export async function getSpxLottoState() {
  return fetchLottoPlaysForDate(todayEtYmd());
}

export async function getSpxPowerHourState() {
  return loadPowerHourRecord();
}
