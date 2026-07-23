// Context-at-entry capture (decision doc C-2, docs/audit/NIGHTHAWK-0DTE-DECISION.md §2).
// The strongest factor split in the 7/13 forensics — day-open VIX 15-17 → 69% WR vs
// 17-20 → 25% WR — was derivable only DAY-LEVEL from Polygon after the fact, because
// no play surface persists any market context per play. This module captures that
// context AT COMMIT TIME so every future calibration can cut per-play instead of
// re-deriving a proxy: day-open VIX, the SPY session bias (the same marketBias() read
// the intraday edge layer scores with), the name's dealer gamma regime when the
// dossier carried one, the final score as committed, and the ET commit timestamp.
//
// Split the same way the rest of this directory is: buildZeroDteEntryContext() is a
// PURE function (unit-tested with fixtures, no providers); fetchZeroDteSessionContext()
// does the fetching, cached + soft-deadlined so it can never stall or fail a scan —
// context capture is best-effort by design (a null context must never block a commit;
// the ledger row is still the system of record for the play itself).

import { todayEt } from "@/features/nighthawk/lib/session";
import { fetchAggBars } from "@/lib/providers/polygon-largo";
import { withServerCache } from "@/lib/server-cache";
import { computeIntradayRead, marketBias, type MarketBias } from "./intraday";
import { priorEtYmd } from "@/lib/providers/spx-session";
// Runtime import is safe: ./regime is pure (no providers, no cycle) — it turns the SPY
// session/prior-day OHLC into the "what kind of day is it" read the feature store records.
import { classifyRegime, type MarketRegime } from "./regime";
// Runtime import is safe here: ./tiers is pure (its only import is ./gates
// constants), so it adds no providers to this module's load graph.
import { tierFromEntryContext, type ZeroDteTierAssignment } from "./tiers";
// Type-only (erased): keeps this module import-light — ./cortex-gate's runtime
// deps (the Cortex barrel) never enter this module's load graph.
import type { ZeroDteCortexEntryContext } from "./cortex-gate";

/** Await `p` for at most `ms`, else null — same semantics as scan.ts's within();
 *  duplicated (7 lines) rather than imported because scan.ts imports THIS module
 *  for the write path, and importing back would create a require cycle. */
function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      }
    );
  });
}

/** Session-level half of the context — identical for every play committed in the
 *  same window, so it is fetched once (cached) per scan, not once per row. */
export type ZeroDteSessionContext = {
  /** Official day-open of I:VIX (Polygon daily bar). Null when the bar is missing
   *  (holiday, provider outage) — never guessed from a stale close. */
  vix_open: number | null;
  /** SPY session bias from the SAME marketBias() read the edge layer scores with —
   *  "flat" is the mixed/no-lean state. Null when SPY minute bars were unreadable. */
  spy_bias: MarketBias | null;
  /** "What kind of day is it" (classifyRegime over SPY as the market proxy): structure /
   *  gap / vol band / calendar. Session-level, so it's computed ONCE here and stamped onto
   *  every setup's feature vector — identical for every play committed in the window. Null
   *  when the SPY OHLC needed to classify it was unreadable (never guessed). Optional so
   *  the many buildZeroDteEntryContext call sites (which don't read it) stay untouched. */
  regime?: MarketRegime | null;
};

/** The persisted per-row context blob (zerodte_setup_log.entry_context /
 *  spx_play_outcomes.entry_context). Additive by design: consumers must treat every
 *  field as optional — rows older than this column carry NULL forever. */
export type ZeroDteEntryContext = {
  vix_open: number | null;
  spy_bias: MarketBias | null;
  /** Dealer gamma regime for the NAME at commit (dossier positioning) — null when
   *  the dossier had none (or, for SPX Slayer rows, until the engine threads its
   *  own desk regime through; see the store's call site). */
  gamma_regime: string | null;
  /** The score exactly as committed. The row's `score` column is refreshed on every
   *  later scan tick and `score_max` only ratchets up, so without this the
   *  commit-time score is unrecoverable — and it is the number every score-band
   *  gate/calibration actually acted on. */
  score: number | null;
  /** Human-readable ET commit stamp (e.g. "2026-07-13 09:55 ET"). first_flagged_at
   *  already stores the exact TIMESTAMPTZ; this is the self-contained ET rendering
   *  so a context blob read in isolation still answers "when, desk time?". */
  committed_at_et: string;
  /** Night Hawk Cortex evidence vector at commit (NIGHTHAWK-CORTEX-DESIGN.md §3.1 —
   *  the calibration loop's raw material), or the honest {abstained, reason} record
   *  when the Cortex could not see. Null on rows committed before the wire-in and
   *  on refresh-lane setups (the Cortex only runs on fresh gate survivors); the
   *  upsert's COALESCE pin keeps the commit-time value either way. */
  cortex: ZeroDteCortexEntryContext | null;
  /** Merit tier at commit (PR-F: assignZeroDteTier over the SAME values pinned
   *  above), with the complete factor list arguing it — the pane's tier chip
   *  renders these verbatim. Null when the tier computation itself failed
   *  (fail-soft: a tier is advisory ranking, never allowed to block a commit).
   *  Note the tier is DERIVED from the blob's own fields, so a null here costs
   *  nothing durable — tierFromEntryContext re-derives it from the same pins. */
  tier: ZeroDteTierAssignment | null;
};

/** "YYYY-MM-DD HH:mm ET" for an epoch-ms instant. en-CA date + en-GB 24h time give
 *  stable ISO-ish parts without manual timezone math. */
export function formatEtStamp(epochMs: number): string {
  const d = new Date(epochMs);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return `${day} ${time} ET`;
}

/** Pure assembly of the persisted blob — session half + the play's own fields.
 *  Numbers are rounded HERE (data layer), per the repo's malformed-float rule. */
export function buildZeroDteEntryContext(
  play: {
    score: number | null;
    gamma_regime: string | null;
    /** Cortex context blob (cortexEntryContextFor, ./cortex-gate.ts). Optional so
     *  pre-wire-in callers/tests are untouched; passed through verbatim — the
     *  Cortex composer already rounds its own weights/score at emission. */
    cortex?: ZeroDteCortexEntryContext | null;
  },
  session: ZeroDteSessionContext | null,
  nowMs: number
): ZeroDteEntryContext {
  const vix = session?.vix_open;
  const ctx: ZeroDteEntryContext = {
    vix_open: vix != null && Number.isFinite(vix) ? Math.round(vix * 100) / 100 : null,
    spy_bias: session?.spy_bias ?? null,
    gamma_regime: play.gamma_regime ?? null,
    score: play.score != null && Number.isFinite(play.score) ? Math.round(play.score) : null,
    committed_at_et: formatEtStamp(nowMs),
    cortex: play.cortex ?? null,
    tier: null,
  };
  // Commit-time merit tier (PR-F wiring): computed by feeding the JUST-BUILT blob
  // through tierFromEntryContext — the SAME adapter the calibration/record analyses
  // use to tier past rows retroactively — so the pinned tier and a retroactive
  // re-derivation of the same row can never disagree (one blob→input mapping, one
  // assignZeroDteTier call). tierFromEntryContext is defensive on data by design;
  // this catch guards programmer error only, and FAIL-SOFT is the contract: a tier
  // is an advisory ranking, so its failure must never block a commit (null tier,
  // log-only — same posture as the Cortex outage path in cortex-gate.ts).
  try {
    ctx.tier = tierFromEntryContext(ctx as unknown as Record<string, unknown>);
  } catch (err) {
    console.warn("[zerodte-tiers] commit-time tier assignment failed (fail-soft, tier=null):", err);
  }
  return ctx;
}

const SESSION_CTX_TTL_MS = 3 * 60 * 1000; // same cadence as the intraday read cache
const SESSION_CTX_WAIT_MS = 2_500; // soft deadline — a slow provider degrades to null

/** A daily/minute OHLC bar as polygon-largo's fetchAggBars returns it. */
type OhlcBar = { t?: number; o?: number; h?: number; l?: number; c?: number };

/** ET YYYY-MM-DD for a bar's epoch-ms `t` (bars are keyed at UTC day-start; render in ET
 *  so "is this today's bar" compares against the ET session date, not a UTC date). */
function barEtYmd(t: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(t));
}

/** 14-period ATR over COMPLETED daily bars (Wilder's true range, simple mean of the last
 *  14). Needs ≥15 bars so the first TR has a prior close. Null otherwise. */
function atr14Daily(bars: OhlcBar[]): number | null {
  if (bars.length < 15) return null;
  const trs: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const cur = bars[i]!;
    const prev = bars[i - 1]!;
    if (![cur.h, cur.l, prev.c].every((n) => n != null && Number.isFinite(n))) continue;
    trs.push(Math.max(cur.h! - cur.l!, Math.abs(cur.h! - prev.c!), Math.abs(cur.l! - prev.c!)));
  }
  if (trs.length < 14) return null;
  const slice = trs.slice(-14);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

/**
 * PURE regime read for the session (SPY as the market proxy). Composes today's session OHLC
 * (open from the daily bar, high/low/last/vwap from the intraday minute read) with the prior
 * session's OHLC and a daily ATR, then classifyRegime()s it. Returns null — never a fabricated
 * regime — unless EVERY field it needs is a real finite number: a null regime is honest; a
 * guessed one poisons the feature store the calibration layer trusts.
 *
 * `dailyBars` must be ascending by time and include today's (forming) session as the last bar.
 */
export function buildSessionRegime(
  dailyBars: OhlcBar[],
  spyRead: { last: number | null; day_high: number | null; day_low: number | null; vwap: number | null },
  vixLevel: number | null,
  todayYmd: string
): MarketRegime | null {
  if (dailyBars.length < 2 || vixLevel == null || !Number.isFinite(vixLevel)) return null;
  const todayBar = dailyBars.at(-1)!;
  // Today's bar must actually be today's — a stale/lagged series (last bar = a prior session)
  // can't give a session open, so the regime is unknowable rather than wrong.
  if (todayBar.t == null || barEtYmd(todayBar.t) !== todayYmd) return null;
  const prevBar = dailyBars.at(-2)!;
  const atr = atr14Daily(dailyBars.slice(0, -1)); // completed sessions only — exclude today's partial
  const open = todayBar.o ?? null;
  const last = spyRead.last ?? todayBar.c ?? null;
  const high = spyRead.day_high ?? todayBar.h ?? null;
  const low = spyRead.day_low ?? todayBar.l ?? null;
  const vwap = spyRead.vwap ?? null;
  const prevClose = prevBar.c ?? null;
  const prevHigh = prevBar.h ?? null;
  const prevLow = prevBar.l ?? null;
  const need = [open, last, high, low, vwap, prevClose, prevHigh, prevLow, atr];
  if (need.some((n) => n == null || !Number.isFinite(n as number))) return null;
  return classifyRegime({
    open: open!, last: last!, high: high!, low: low!,
    prevClose: prevClose!, prevHigh: prevHigh!, prevLow: prevLow!,
    vwap: vwap!, atr: atr!, vix: vixLevel, dateYmd: todayYmd,
  });
}

/**
 * Fetch the session half of the context, cached per (session, 3-min window) across
 * all replicas. VIX day-open is a daily-bar `o` (fixed at 9:30 ET, so the 3-min TTL
 * only matters for the SPY bias half). Best-effort throughout: any failure → null,
 * never a throw into the scan.
 */
export async function fetchZeroDteSessionContext(): Promise<ZeroDteSessionContext | null> {
  const today = todayEt();
  return within(
    withServerCache<ZeroDteSessionContext>(`zerodte:entryctx:${today}`, SESSION_CTX_TTL_MS, async () => {
      // ~40 calendar days back → ≥15 completed daily bars for ATR + the prior session's OHLC.
      const dailyFrom = priorEtYmd(40);
      const [vixBars, spyBars, spyDaily] = await Promise.all([
        fetchAggBars("I:VIX", 1, "day", today, today).catch(() => []),
        fetchAggBars("SPY", 1, "minute", today, today, "1000").catch(() => []),
        fetchAggBars("SPY", 1, "day", dailyFrom, today).catch(() => []),
      ]);
      const vixOpen = vixBars.length ? vixBars[0]!.o : null;
      const spyRead = computeIntradayRead(
        spyBars
          .filter((b) => b.t != null && Number.isFinite(b.t))
          .map((b) => ({ t: b.t as number, h: b.h, l: b.l, c: b.c, v: b.v }))
      );
      const vixLevel = vixOpen != null && Number.isFinite(vixOpen) ? vixOpen : null;
      return {
        vix_open: vixLevel,
        spy_bias: marketBias(spyRead),
        regime: buildSessionRegime(
          spyDaily.filter((b) => b.t != null && Number.isFinite(b.t)),
          { last: spyRead.last, day_high: spyRead.day_high, day_low: spyRead.day_low, vwap: spyRead.vwap },
          vixLevel,
          today
        ),
      };
    }),
    SESSION_CTX_WAIT_MS
  );
}
