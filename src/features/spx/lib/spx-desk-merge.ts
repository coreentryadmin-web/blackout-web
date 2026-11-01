/**
 * Client-safe desk merge — do NOT import spx-desk.ts from client components
 * (it pulls Polygon/UW server providers into the browser bundle).
 */
import type { SpxDeskPayload, SpxDeskPulse, SpxDeskFlow, SpxTapeItem } from "@/features/spx/lib/spx-desk";
import type { GexWall } from "@/lib/providers/gamma-desk";
import { todayEtYmd, widenSessionExtremesWithSpot } from "@/lib/providers/spx-session";
import { buildLevels } from "./spx-desk-levels";
import { computeFlowStrikeStacks } from "@/lib/largo/flow-strike-stacks";
import { safeTime } from "@/lib/safe-time";
import { tapeDedupKey } from "@/lib/tape-dedup-key";

export function recalcGexWallDistances(walls: GexWall[], spot: number): GexWall[] {
  if (!walls.length || spot <= 0) return walls;
  return walls.map((w) => ({
    ...w,
    // Recompute kind alongside distance so a price crossing flips support/resistance
    // (matches topGexWalls: strike <= spot is support, strike > spot is resistance).
    kind: w.strike > spot ? "resistance" : "support",
    distance_pts: Math.round((w.strike - spot) * 100) / 100,
  }));
}

export function mergeTapeItems(
  incoming: SpxTapeItem[],
  prev: SpxTapeItem[],
  max = 32
): SpxTapeItem[] {
  const seen = new Set<string>();
  const out: SpxTapeItem[] = [];
  for (const t of [...incoming, ...prev]) {
    const key = tapeDedupKey(t);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= max) break;
  }
  // Sort by time descending (newest prints first) with premium as tiebreaker, so the live
  // tape reflects real tape order instead of a static premium ranking that looks frozen
  // during fast prints (matches the server-side time-sort in the flows feed).
  return out.sort((a, b) => {
    const timeDiff = safeTime(b.time) - safeTime(a.time);
    if (timeDiff !== 0) return timeDiff;
    return (b.premium ?? 0) - (a.premium ?? 0);
  });
}

export function flowAlertToTapeItem(alert: {
  ticker: string;
  premium: number;
  option_type: string;
  strike: number;
  direction: string;
  alerted_at: string;
  /** Aggressor share, carried through so the merged tape scores direction the same way the
   *  desk-built tape does. Absent on callers that never had it — see `SpxFlowBrief.ask_pct`. */
  ask_pct?: number | null;
}): SpxTapeItem {
  const isPut = alert.option_type.toUpperCase().startsWith("P");
  return {
    kind: "flow",
    side: isPut ? "put" : "call",
    time: alert.alerted_at,
    label: `${isPut ? "PUT" : "CALL"} ${alert.strike}`,
    premium: alert.premium,
    detail: `${alert.ticker} | ${alert.direction}`,
    ask_pct: alert.ask_pct ?? null,
  };
}

/** Sticky session structure — pulse gaps must not drop HOD/PDH/VWAP from the desk. */
// ISSUE-22: TTL is session-date-based (not time-based) so the cache persists through
// the entire trading session and only resets at the session boundary, preventing a
// 1-2 poll cycle VWAP/EMA gap during active trading.
const STRUCTURE_REDIS_KEY = "desk:sticky:merge_structure";
const STRUCTURE_REDIS_TTL_SEC = 2 * 60 * 60; // 2 hours

const lastGoodStructure: {
  hod: number | null;
  lod: number | null;
  pdh: number | null;
  pdl: number | null;
  vwap: number | null;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  sma50: number | null;
  sma200: number | null;
  vix: number | null;
} = {
  hod: null,
  lod: null,
  pdh: null,
  pdl: null,
  vwap: null,
  ema20: null,
  ema50: null,
  ema200: null,
  sma50: null,
  sma200: null,
  vix: null,
};

let lastGoodStructureSessionDate: string | null = null;
let lastGoodStructureAt = 0;

export function resetSpxDeskMergeCache(): void {
  (Object.keys(lastGoodStructure) as Array<keyof typeof lastGoodStructure>).forEach((key) => {
    lastGoodStructure[key] = null;
  });
  lastGoodStructureSessionDate = null;
  lastGoodStructureAt = 0;
}

/** C7: Load structure from Redis so workers that haven't run a full desk build
 *  can still serve non-null VWAP/HOD/LOD/EMAs (cross-instance sticky state). */
async function loadStructureFromRedis(): Promise<void> {
  if (!process.env.REDIS_URL?.trim()) return;
  try {
    const { sharedCacheGet } = await import("@/lib/shared-cache");
    const saved = await sharedCacheGet<{
      data: typeof lastGoodStructure;
      sessionDate: string;
    }>(STRUCTURE_REDIS_KEY);
    if (saved && saved.sessionDate === todayEtYmd()) {
      (Object.keys(lastGoodStructure) as Array<keyof typeof lastGoodStructure>).forEach((key) => {
        if (lastGoodStructure[key] == null && saved.data[key] != null) {
          lastGoodStructure[key] = saved.data[key];
        }
      });
      if (lastGoodStructureAt === 0) lastGoodStructureAt = Date.now();
      if (lastGoodStructureSessionDate == null) lastGoodStructureSessionDate = saved.sessionDate;
    }
  } catch {
    // keep in-process state on Redis failure
  }
}

/** C7: Fire-and-forget — persist local structure to Redis for other workers. */
function publishStructureToRedis(): void {
  if (!process.env.REDIS_URL?.trim()) return;
  void import("@/lib/shared-cache")
    .then(({ sharedCacheSet }) =>
      sharedCacheSet(
        STRUCTURE_REDIS_KEY,
        { data: { ...lastGoodStructure }, sessionDate: todayEtYmd() },
        STRUCTURE_REDIS_TTL_SEC
      )
    )
    .catch(() => {
      /* best-effort cross-instance sticky state — never throw into the hot path */
    });
}

function ensureStructureCacheFresh(): void {
  const today = todayEtYmd();
  // ISSUE-22: Reset only on session-date change, not on time-based TTL.
  // This avoids a 1-2 poll gap in VWAP/EMA signals during active trading.
  if (lastGoodStructureSessionDate != null && lastGoodStructureSessionDate !== today) {
    resetSpxDeskMergeCache();
    lastGoodStructureSessionDate = today;
    return;
  }
  if (lastGoodStructureSessionDate == null) {
    lastGoodStructureSessionDate = today;
  }
}

function seedStructureCacheFromBase(base: {
  hod: number | null;
  lod: number | null;
  pdh: number | null;
  pdl: number | null;
  vwap: number | null;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  sma50: number | null;
  sma200: number | null;
  vix: number | null;
}): void {
  // C7: If local structure is entirely null (worker that hasn't run a full desk build),
  // attempt to load from Redis before seeding from base. Fire-and-forget async load;
  // subsequent calls will pick up the Redis-populated values.
  const localIsEmpty = (Object.keys(lastGoodStructure) as Array<keyof typeof lastGoodStructure>)
    .every((k) => lastGoodStructure[k] == null);
  if (localIsEmpty) {
    void loadStructureFromRedis();
  }

  let updated = false;
  (Object.keys(lastGoodStructure) as Array<keyof typeof lastGoodStructure>).forEach((key) => {
    const val = base[key];
    if (lastGoodStructure[key] == null && val != null) {
      lastGoodStructure[key] = val;
      updated = true;
    }
  });
  if (updated) publishStructureToRedis();
}

function stickyStructureLevel(
  key: keyof typeof lastGoodStructure,
  pulseVal: number | null | undefined,
  baseVal: number | null | undefined,
  livePrice?: number
): number | null {
  ensureStructureCacheFresh();
  let next: number | null;
  if (key === "hod" || key === "lod") {
    // BUG FIX (2026-11-01, Ask Largo/5-engine standing mandate, live repro): this used to take
    // Math.max/Math.min across [pulseVal, baseVal, lastGoodStructure[key], livePrice]
    // UNCONDITIONALLY, every cycle, even when pulseVal/baseVal were both genuinely fresh THIS
    // cycle. That makes the ratchet a one-way trap: the instant ANY single cycle feeds a bad or
    // stale candidate (a transient index-feed glitch during RTH, or — the live case — an
    // off-hours pulse lane carrying forward a stale snapshot via `lastPulseForSignals`,
    // spx-desk.ts, which has no session-date staleness check of its own), `lastGoodStructure[key]`
    // latches onto it and keeps re-entering the max/min on every SUBSEQUENT cycle forever (within
    // the session), permanently out-ranking a correct, fresh `baseVal` that disagrees with it —
    // unlike every other key here (`pulseVal ?? baseVal ?? lastGoodStructure[key] ?? null`),
    // where a fresh value always wins outright and the sticky cache is a pure last resort.
    //
    // Confirmed live 2026-11-01: `GET /api/market/nighthawk/edition`'s `market_recap.spx_desk`
    // (built off this merge, via `getSpxDeskSummary()`) reported `hod: 7758.43` for a session
    // whose OWN independently-fetched daily OHLC bar (`spxContext()`, format.ts, reading
    // `ctx.spx_bars` directly — never routed through this sticky merge) and recap narrative both
    // said the session gapped down to 7631.07 and "continued lower" to close 7580.07, with a real
    // daily H of only 7637 — 7758.43 also exceeds the session's OWN prior-day high (pdh 7732.21),
    // which is impossible for a session that never traded above its own open. market_label was
    // EXTENDED (off-hours, no live spot to reconcile against: `livePrice` is undefined whenever
    // `!rthOpen`, see `mergePulseIntoDesk`'s `liveSpot`), so the ONLY way hod could read above the
    // real daily high is a stale/bad candidate winning the max against a correct `baseVal`.
    //
    // Fix: only fold `lastGoodStructure[key]` (and, implicitly, tolerate an on-the-day
    // pulse/base disagreement) into the max/min when THIS cycle has no live spot to widen
    // against (`livePrice == null`, i.e. off-hours/no RTH tick) AND neither `pulseVal` nor
    // `baseVal` has a fresh real read — otherwise prefer a straight `baseVal ?? pulseVal`
    // precedence, since `baseVal` (the full desk build) recomputes hod/lod fresh from real
    // settled minute bars on every poll regardless of market hours, while off-hours `pulseVal`
    // is exactly a sticky last-RTH-snapshot with no revalidation of its own. During RTH
    // (`livePrice != null`) the existing "pulse gaps must not drop HOD/LOD" widen behavior is
    // unchanged — this only removes the UNBOUNDED, self-perpetuating sticky carry-forward for
    // the off-hours case where there is no live price to justify reconciling two sources at all.
    const validLevel = (v: number | null | undefined): number | null =>
      v != null && Number.isFinite(v) && v > 0 ? v : null;
    if (livePrice == null) {
      next = validLevel(baseVal) ?? validLevel(pulseVal) ?? validLevel(lastGoodStructure[key]);
    } else {
      const candidates: number[] = [];
      for (const v of [pulseVal, baseVal, lastGoodStructure[key], livePrice]) {
        const valid = validLevel(v);
        if (valid != null) candidates.push(valid);
      }
      if (!candidates.length) return null;
      next = key === "hod" ? Math.max(...candidates) : Math.min(...candidates);
    }
  } else {
    next = pulseVal ?? baseVal ?? lastGoodStructure[key] ?? null;
  }
  if (next != null) {
    const changed = lastGoodStructure[key] !== next;
    lastGoodStructure[key] = next;
    lastGoodStructureAt = Date.now();
    lastGoodStructureSessionDate = todayEtYmd();
    // C7: Persist updated structure to Redis (fire-and-forget) so other workers
    // can pick up VWAP/HOD/LOD/EMAs without having run a full desk build.
    if (changed) publishStructureToRedis();
  }
  return next;
}

/** Overlay UW flow lane — tape, dark pool, GEX walls. */
export function mergeFlowIntoDesk(base: SpxDeskPayload, flow: SpxDeskFlow): SpxDeskPayload {
  const price = flow.price || base.price;
  const walls = flow.gex_walls.length ? flow.gex_walls : base.gex_walls;
  const spx_flows = flow.spx_flows.length ? flow.spx_flows : base.spx_flows;
  const strike_stacks =
    flow.strike_stacks?.length
      ? flow.strike_stacks
      : computeFlowStrikeStacks(spx_flows);
  // ISSUE-19: levels here use base.lod/hod/vwap, which may be stale from the full desk
  // build. This is intentional — mergePulseIntoDesk runs AFTER this and overwrites levels
  // with the fresh pulse values. Do not change this merge order or levels will regress.
  return {
    ...base,
    polled_at: flow.polled_at,
    dark_pool: flow.dark_pool ?? base.dark_pool,
    spx_flows,
    unified_tape: flow.unified_tape.length ? flow.unified_tape : base.unified_tape,
    strike_stacks,
    gex_walls: recalcGexWallDistances(walls, price),
    gex_net: flow.gex_net ?? base.gex_net,
    gex_king: flow.gex_king ?? base.gex_king,
    // Flow lane is available here (mergeDeskLayers gates on flow.available). Trust an explicit
    // null flip from the live matrix — `??` would otherwise resurrect a sticky desk flip and
    // disagree with /api/market/gex-heatmap (flip=null) on the same page.
    gamma_flip: flow.gamma_flip,
    above_gamma_flip: flow.above_gamma_flip,
    gamma_regime: flow.gamma_regime ?? base.gamma_regime,
    flow_0dte_call_premium: flow.flow_0dte_call_premium ?? base.flow_0dte_call_premium,
    flow_0dte_put_premium: flow.flow_0dte_put_premium ?? base.flow_0dte_put_premium,
    flow_0dte_net: flow.flow_0dte_net ?? base.flow_0dte_net,
    flow_data_age_ms: flow.flow_data_age_ms ?? base.flow_data_age_ms ?? null,
    flow_cluster_live: flow.flow_cluster_live ?? base.flow_cluster_live ?? false,
    // Reflect the ~4s flow lane's GEX freshness on the merged desk (not the 10s full-desk base) so
    // the 'last-good GEX · not live' staleness badge (#7a) fires promptly instead of lagging a cycle.
    gex_age_ms: flow.gex_age_ms ?? base.gex_age_ms ?? null,
    gex_stale: flow.gex_stale ?? base.gex_stale ?? false,
    net_prem_ticks: flow.net_prem_ticks?.length ? flow.net_prem_ticks : base.net_prem_ticks,
    flow_by_expiry: flow.flow_by_expiry?.length ? flow.flow_by_expiry : base.flow_by_expiry,
    net_flow_by_expiry: flow.net_flow_by_expiry?.length ? flow.net_flow_by_expiry : base.net_flow_by_expiry,
    greek_exposure: flow.greek_exposure ?? base.greek_exposure,
    price,
    levels: buildLevels({
      price,
      lod: base.lod,
      hod: base.hod,
      vwap: base.vwap,
      pdh: base.pdh,
      pdl: base.pdl,
      ema20: base.ema20,
      ema50: base.ema50,
      ema200: base.ema200,
      sma50: base.sma50,
      sma200: base.sma200,
      gex_king: flow.gex_king ?? base.gex_king,
      max_pain: base.max_pain,
      gamma_flip: flow.gamma_flip,
    }),
  };
}

/** Overlay fast Polygon pulse — price/session only (does not touch tape or GEX). */
export function mergePulseIntoDesk(
  base: SpxDeskPayload,
  pulse: SpxDeskPulse
): SpxDeskPayload {
  seedStructureCacheFromBase(base);
  const price = pulse.price > 0 ? pulse.price : base.price;
  const rthOpen = pulse.market_open ?? base.market_open ?? false;
  const liveSpot = rthOpen && price > 0 ? price : undefined;
  let lod = stickyStructureLevel("lod", pulse.lod, base.lod, liveSpot);
  let hod = stickyStructureLevel("hod", pulse.hod, base.hod, liveSpot);
  ({ hod, lod } = widenSessionExtremesWithSpot(price, hod, lod, rthOpen));
  const vwap = stickyStructureLevel("vwap", pulse.vwap, base.vwap);
  // BUG FIX (2026-10-31, Ask Largo/5-engine standing mandate, live repro — Saturday market
  // closed): stickyStructureLevel's non-hod/lod branch resolves as `pulseVal ?? baseVal ??
  // lastGoodStructure[key] ?? null` — so `vwap` above came from the cross-request sticky
  // fallback, not a fresh read THIS cycle, exactly when BOTH pulse.vwap and base.vwap are
  // null/undefined and a prior cycle already seeded the sticky cache. That is routinely true
  // on a non-trading day (weekend/holiday), when the sticky cache keeps serving Friday's VWAP
  // forever with nothing on the payload saying so. Confirmed live: GET /api/market/spx/play
  // scored a "Below VWAP 7580.87 — sellers pressing" factor (-12) off this exact path while the
  // sibling GET /api/market/spx/desk (peekSpxDesk(), no sticky merge) correctly reported
  // vwap:null at the same instant. `vwap_stale` lets evaluateSpxPlayCore's closed-market branch
  // disclose this the same way it already discloses stale GEX factors (discloseStaleGexFactors)
  // instead of inventing a new mechanism.
  const vwapStale = pulse.vwap == null && base.vwap == null && vwap != null;
  const pdh = stickyStructureLevel("pdh", pulse.pdh, base.pdh);
  const pdl = stickyStructureLevel("pdl", pulse.pdl, base.pdl);
  const ema20 = stickyStructureLevel("ema20", pulse.ema20, base.ema20);
  const ema50 = stickyStructureLevel("ema50", pulse.ema50, base.ema50);
  const ema200 = stickyStructureLevel("ema200", pulse.ema200, base.ema200);
  const sma50 = stickyStructureLevel("sma50", pulse.sma50, base.sma50);
  const sma200 = stickyStructureLevel("sma200", pulse.sma200, base.sma200);
  // pulse.vix falls back to base.vix when pulse's own vix read is unavailable (below) — vix's
  // OWN change_pct must take the identical fallback, since pulse.vix_change_pct was computed
  // against pulse's (now-discarded) vix, not against base.vix. Serving pulse.vix_change_pct
  // unconditionally here let a null/stale pulse-side change% silently overwrite a perfectly
  // good base-side one whenever `vix` itself correctly fell back to base.
  //
  // BUG FIX (2026-11-01, Ask Largo/5-engine standing mandate, live repro): when BOTH pulse.vix
  // and base.vix are unavailable this cycle — e.g. a cold ECS replica serving the
  // deskShellFromPulse/emptyDeskPayload() fallback shell as `base` (vix seeded null there) while
  // pulse's own vix read is also momentarily unavailable — vix served a bare `null` right next
  // to other populated numeric fields (`available:true`, `price:7580.07`) on the SAME payload.
  // Reproduced live: 25/30 polls in a tight burst returned `vix:null` while a poll seconds
  // earlier (a different replica, cycling `as_of` timestamps) returned `vix:19.42`. vwap/pdh/
  // pdl/emas/smas already had exactly this gap closed via `stickyStructureLevel`'s cross-
  // instance Redis-backed last-known-good cache (`seedStructureCacheFromBase`/
  // `loadStructureFromRedis`); vix never got the same treatment. Route vix through the
  // identical mechanism as a third-tier fallback — it never fabricates a value no replica has
  // ever actually seen (lastGoodStructure.vix starts null, same as every sibling sticky field),
  // it only prevents a transient cold-replica/cold-pulse overlap from serving null next to an
  // otherwise fully-populated desk.
  const pulseVixLive = pulse.vix != null && pulse.vix > 0;
  const baseVixLive = base.vix != null && base.vix > 0;
  const vix = stickyStructureLevel(
    "vix",
    pulseVixLive ? pulse.vix : null,
    baseVixLive ? base.vix : null
  );
  return {
    ...base,
    // BUG FIX (Ask Largo standing mandate, 2026-10-25): same "never reassigned, inherited from
    // base/emptyDeskPayload forever" shape as the prior_close/gap_pct/gap_source fix and the
    // vix_term fix below — `available` was never reassigned either, so deskShellFromPulse's
    // fallback shell (mergePulseIntoDesk(emptyDeskPayload(...), pulse)) stayed available:false
    // forever even when pulse carried real, live data (pulse.available is true precisely when
    // buildSpxDeskPulse resolved a real price). computeSpxConfluence gates on `!desk.available`
    // and nulls confluence entirely when that happens, which cascades into
    // evaluateSpxPlayCore's closed-market branch emitting assessed:false/score:0/factors:[]/
    // direction:null/grade:"D" even with real underlying data sitting in pulse the whole time.
    available: pulse.available || base.available,
    price,
    // Fall back to the desk's own spx_change_pct when pulse could not anchor its own (common
    // off-hours/pre-open, when pulse has no trusted prior-close basis) — mirrors the vix
    // fallback immediately below rather than letting a null pulse-side value blank out a real
    // one already sitting on base, computed from the exact same price/prior_close this merged
    // payload reports.
    spx_change_pct: pulse.spx_change_pct ?? base.spx_change_pct,
    vix,
    // Only pulse/base carry a change% that's actually anchored to a fresh read THIS cycle —
    // the sticky-cache tier above never computes one, so when neither pulse nor base had a
    // live vix (the case the sticky fallback exists for), serve change_pct honestly as null
    // rather than reusing a stale base.vix_change_pct that was itself null right alongside the
    // null base.vix.
    vix_change_pct: pulseVixLive
      ? pulse.vix_change_pct
      : baseVixLive
        ? base.vix_change_pct
        : null,
    // BUG FIX (Ask Largo standing mandate, 2026-10-09): this function never assigned
    // prior_close/gap_pct/gap_source at all — the `...base` spread above silently carried
    // whatever `base` already had, forever, with no fallback to `pulse`'s own values the way
    // every other derived field here already gets (spx_change_pct/vix_change_pct two lines up,
    // pdh/pdl a few lines down). Harmless in the common path, where `base` is a REAL desk build
    // with its own correct prior_close — but `deskShellFromPulse` (spx-desk.ts) calls this exact
    // function as `mergePulseIntoDesk(emptyDeskPayload(...), pulse)` to build the FALLBACK merged
    // shell (`buildBootstrapFastLane`, used whenever the real merged build is cold/slow — e.g.
    // right after a deploy, a cache miss, or a cache stampede) — and `emptyDeskPayload` seeds
    // prior_close/gap_pct/gap_source to `null`. With no assignment here, that `null` survived
    // forever even though `pulse` (the ONLY data source this fallback shell has) carried the real,
    // correct value the whole time. Live-reproduced 2026-10-09 ~09:14 UTC, mid an ECS rolling
    // deploy (cold per-task cache): `GET /api/market/spx/merged` served
    // `available:false, source:"none", prior_close:null, gap_pct:null, gap_source:null` while
    // `pdh:7807.02/pdl:7763.34` (correctly pulled from pulse two lines down) and the sibling
    // `/api/market/spx/pulse` route (prior_close:7801.77, gap_pct/gap_source populated) proved the
    // real values were sitting right there, just never copied over. Same `?? base.X` fallback
    // shape as `spx_change_pct` above (prefer pulse's fresher ~1s read, fall back to base's slower
    // ~10s one when pulse itself has none) — not the heavier `stickyStructureLevel` treatment
    // pdh/pdl/vwap/emas get, since prior_close/gap_pct/gap_source don't flicker intraday the way a
    // live level can.
    prior_close: pulse.prior_close ?? base.prior_close,
    gap_pct: pulse.gap_pct ?? base.gap_pct,
    gap_source: pulse.gap_source ?? base.gap_source,
    // Recompute above_vwap from the price/vwap this function JUST resolved (sticky fallback
    // already applied), instead of trusting pulse's own flag — pulse computes above_vwap
    // against ITS OWN vwap, which is routinely null off-hours/pre-open even though the sticky
    // `vwap` above has a real value, so pulse.above_vwap can disagree with the vwap/price this
    // very payload reports (e.g. price genuinely above vwap, flag still reads false). Same
    // "recompute against the merged value, don't transport a stale derived flag" fix already
    // applied to above_gamma_flip below (ISSUE-18+20).
    above_vwap: vwap != null ? price >= vwap : pulse.above_vwap,
    lod,
    hod,
    vwap,
    vwap_stale: vwapStale,
    pdh,
    pdl,
    ema20,
    ema50,
    ema200,
    sma50,
    sma200,
    tick: pulse.tick ?? base.tick,
    trin: pulse.trin ?? base.trin,
    add: pulse.add ?? base.add,
    regime: pulse.regime ?? base.regime,
    leader_stocks: pulse.leader_stocks.length ? pulse.leader_stocks : base.leader_stocks,
    // BUG FIX (2026-10-21, Ask Largo 5-engine cycle, live repro): the off-hours "serve today's
    // own settled close" branch of buildSpxDeskPulse (spx-desk.ts, empty-shell spread) sets
    // vix_term to the DEFINED placeholder {vix9d:null,vix3m:null,structure:"unknown",detail:""},
    // never reassigning it. A bare `pulse.vix_term ?? base.vix_term` keeps that placeholder
    // (it's a defined object, not null/undefined) and discards the real base desk's vix_term —
    // silently dropping the scored "VIX curve" factor from GET /api/market/spx/play while the
    // sibling GET /api/market/spx/desk (built without this merge) still showed real contango/
    // backwardation data at the exact same instant. Same "check for real content, not just
    // definedness" fix already applied to leader_stocks two lines below (`.length ?` instead of
    // a bare `??`) — applied here the same way, since vix_term can likewise be a real,
    // non-empty object with no values set.
    vix_term:
      pulse.vix_term && (pulse.vix_term.vix9d != null || pulse.vix_term.vix3m != null)
        ? pulse.vix_term
        : base.vix_term,
    data_quality: pulse.data_quality ?? base.data_quality,
    market_open: pulse.market_open ?? base.market_open,
    market_status: pulse.market_status ?? base.market_status,
    market_label: pulse.market_label ?? base.market_label,
    as_of: pulse.polled_at,
    polled_at: pulse.polled_at,
    // Reflect the ~1s pulse lane's price freshness on the merged desk (not the 10s base) so the
    // 'feed stalled · price not live' indicator (#11) catches a half-open freeze within seconds.
    price_age_ms: pulse.price_age_ms ?? base.price_age_ms ?? null,
    feed_stalled: pulse.feed_stalled ?? base.feed_stalled ?? false,
    // Carry halt state from the pulse (updated every ~1s) so the desk always reflects the
    // current in-process halt store without waiting for the 10s full desk refresh.
    active_halts: pulse.active_halts ?? base.active_halts,
    halt_channel_stale: pulse.halt_channel_stale ?? base.halt_channel_stale,
    // ISSUE-18+20: Recompute above_gamma_flip with current price so price crossings
    // of the gamma flip level are reflected after each pulse — base value would be stale.
    above_gamma_flip: base.gamma_flip != null ? price > base.gamma_flip : base.above_gamma_flip,
    gex_walls: recalcGexWallDistances(base.gex_walls, price),
    levels: buildLevels({
      price,
      lod,
      hod,
      vwap,
      pdh,
      pdl,
      ema20,
      ema50,
      ema200,
      sma50,
      sma200,
      gex_king: base.gex_king,
      max_pain: base.max_pain,
      gamma_flip: base.gamma_flip,
    }),
  };
}

/** Merge desk + flow + pulse lanes (shared by server loader and client hooks). */
export function mergeDeskLayers(
  desk: SpxDeskPayload,
  flow: SpxDeskFlow | null | undefined,
  pulse: SpxDeskPulse | null | undefined
): SpxDeskPayload {
  let merged = desk;
  if (flow?.available) merged = mergeFlowIntoDesk(merged, flow);
  if (pulse) {
    if (pulse.available) merged = mergePulseIntoDesk(merged, pulse);
    else {
      merged = {
        ...merged,
        market_open: pulse.market_open,
        market_status: pulse.market_status,
        market_label: pulse.market_label,
        polled_at: pulse.polled_at,
      };
    }
  }
  return merged;
}

const signalDeskStub = (): SpxDeskPayload => ({
  available: false,
  as_of: new Date().toISOString(),
  source: "pulse+flow",
  price: 0,
  spx_change_pct: null,
  vix: null,
  vix_change_pct: null,
  above_vwap: false,
  lod: null,
  hod: null,
  vwap: null,
  pdh: null,
  pdl: null,
  prior_close: null,
  gap_pct: null,
  gap_source: null,
  ema20: null,
  ema50: null,
  ema200: null,
  sma50: null,
  sma200: null,
  tick: null,
  trin: null,
  add: null,
  gex_net: null,
  gex_king: null,
  max_pain: null,
  gamma_flip: null,
  above_gamma_flip: false,
  gamma_regime: "unknown",
  gex_walls: [],
  flow_0dte_call_premium: null,
  flow_0dte_put_premium: null,
  flow_0dte_net: null,
  tide_bias: null,
  tide_call_premium: null,
  tide_put_premium: null,
  tide_net: null,
  nope: null,
  nope_net_delta: null,
  uw_iv_rank: null,
  regime: "unknown",
  levels: [],
  dark_pool: null,
  spx_flows: [],
  unified_tape: [],
  strike_stacks: [],
  net_prem_ticks: [],
  vix_term: { vix9d: null, vix3m: null, structure: "unknown", detail: "" },
  data_quality: { vix_term_partial: false, missing: [] },
  sector_heat: [],
  leader_stocks: [],
  oi_changes: [],
  iv_term_structure: [],
  macro_events: [],
  news_headlines: [],
  greek_exposure: null,
  flow_by_expiry: [],
  net_flow_by_expiry: [],
  market_breadth: null,
  mag7_greek_flow: null,
  macro_indicators: [],
});
