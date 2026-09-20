import type { BieFreshness, BieUnavailableSource } from "@/lib/bie/answer-envelope";
import { freshnessFromAgeMs, freshnessFromObservedMs } from "@/lib/bie/answer-envelope";
import { etSessionFacts } from "@/lib/et-session-facts";
import { marketSessionDisclosure } from "@/lib/bie/market-session-disclosure";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import type { ConfluenceZone } from "@/features/vector/lib/vector-confluence";
import { etStampFromIso, parseEtStamp } from "@/lib/largo/temporal/bar-session-date";
import type {
  EcosystemContext,
  EcosystemNightHawkTake,
  EcosystemZeroDteTake,
} from "@/lib/bie/ecosystem-context";
import type { VectorAbsenceReport, VectorSection } from "@/lib/bie/vector-absent-sections";
import type { VectorFullState } from "@/lib/bie/vector-full-state";
import type { VectorFreshnessBlock } from "@/lib/bie/vector-state-freshness";
import type { GexPositioning } from "@/lib/providers/gex-positioning";
import type { SwingPlayBriefContext } from "./play-brief-types";
import type { SwingMeridianCatalystSlice } from "./play-brief-meridian";
import { WS_TIMESTAMP_FUTURE_TOLERANCE_MS } from "@/lib/ws/timestamp-freshness";
import { thesisHealthUncalibrated } from "./thesis-health";
import { daysBetweenYmd } from "@/lib/meridian/meridian-event-expiry-core";
import { deadPlayReason } from "./entry-enterability";

type VectorWithReadContext = VectorFullState & Partial<VectorAbsenceReport & VectorFreshnessBlock>;

const VECTOR_SECTION_LABELS: Record<VectorSection, string> = {
  gex_walls: "Vector GEX walls",
  gamma_flip: "Vector gamma flip",
  max_pain: "Vector max pain",
  expected_move: "Vector expected move",
  ladder: "Vector GEX ladder",
  heatmap: "Vector heatmap",
  technicals: "Vector technicals",
  flow_markers: "Vector flow prints",
  vex_walls: "Vector VEX walls",
  dark_pool_levels: "Vector dark pool",
  wall_history: "Vector wall history",
  play: "Vector play",
};

const VECTOR_STALE_MS = 120_000;
/** Shared with Vector — dealer posture must not read "Right now" past this age. */
export const GEX_MATRIX_STALE_MS = VECTOR_STALE_MS;

// FINRA short-interest settlement reports publish twice monthly. `BieFreshness` only has
// "live"/"recent"/"stale"/"unknown" buckets (a shared cross-product primitive — widening it is a
// design call, not a contained fix here), so a figure a few days old and one 8+ months old both
// render the identical "STALE" tag with no way for a trader to tell them apart — live-repro'd 3x:
// MSTX/2017 (~9yr — almost certainly a recycled-ticker entity mismatch), CRCG/2025-12-31 (~258d),
// ECO/2025-12-31 (~258d). Past this ceiling (60d — several missed FINRA publication cycles), the
// figure is not merely stale, it's very likely describing a different reality than "current short
// interest" — every call site must omit rather than present it under the same tag as a genuinely
// few-days-old read (the Largo contract's own absence principle: omission is honest, a misleading
// label is not). Shared here (not left local to one call site) because `catalystsSection`
// (play-brief-intel.ts) and `shortInterestCoaching` (play-brief-narrative-coaching.ts) read the
// exact same `arsenal.fundamentals` field and need the identical guard.
export const FUNDAMENTALS_ANCIENT_CEILING_MS = 60 * 24 * 60 * 60 * 1000;

export function fundamentalsObservedMs(asOf: string): number | null {
  const trimmed = asOf.trim();
  // Date-only anchors at session close ET (Largo C1) — age uses that clock, not UTC midnight.
  const dateOnly = /^(\d{4}-\d{2}-\d{2})$/.exec(trimmed);
  if (dateOnly) return parseEtStamp(`${dateOnly[1]} 16:00 ET`);
  // Full ISO / clocked stamps: preserve sub-minute precision for skew guards (ET round-trip truncates).
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function fundamentalsAncient(
  asOf: string | null | undefined,
  readMs: number,
): boolean {
  if (!asOf) return false;
  const observedMs = fundamentalsObservedMs(asOf);
  return observedMs != null && readMs - observedMs > FUNDAMENTALS_ANCIENT_CEILING_MS;
}

// The generic cross-product `freshnessFromAgeMs`/`freshnessFromObservedMs` bucket (live <60s,
// recent <10min, else stale) exists for market-tick-cadence data. FINRA short-interest settlement
// reports publish roughly twice monthly, so on that generic scale EVERY short-interest read is
// unconditionally "stale" — a 2-hour-old figure and a 59-day-old one (this field's honest
// definition of current, vs. genuinely lagging) get the identical "STALE" tag, which is exactly
// the misleading-label failure `FUNDAMENTALS_ANCIENT_CEILING_MS` above exists to prevent for the
// omission decision — this is the same principle applied one layer up, to the freshness *tag*
// itself. Live-repro'd (2026-09-20, comment 5747893411 on #4076): CRWD's `fundamentals.as_of` ~2
// days old — well within a settlement cycle, i.e. current for this data type — still rendered
// "stale" because 2 days vastly exceeds the generic 10-minute "recent" window.
// One FINRA settlement cycle (~15 calendar days covers both twice-monthly windows with margin) is
// the natural "recent" ceiling for this data type; beyond it but still under the ancient ceiling
// above, "stale" is an honest label (a real, if imperfect, signal the read may be lagging the
// current settlement). This data can never be "live" — there is no sub-cycle cadence for it.
export const FUNDAMENTALS_RECENT_CEILING_MS = 15 * 24 * 60 * 60 * 1000;

export function fundamentalsFreshnessTag(
  asOf: string | null | undefined,
  readMs: number,
): BieFreshness {
  if (!asOf) return "unknown";
  const observedMs = fundamentalsObservedMs(asOf);
  if (observedMs == null || !Number.isFinite(observedMs)) return "unknown";
  const ageMs = readMs - observedMs;
  // Fail-closed on future skew past tolerance (Largo C2), mirroring freshnessFromObservedMs.
  if (ageMs < -WS_TIMESTAMP_FUTURE_TOLERANCE_MS) return "stale";
  if (ageMs < FUNDAMENTALS_RECENT_CEILING_MS) return "recent";
  return "stale";
}

/** Age of the shared GEX matrix in ms — prefers matrix_age_sec, else asof vs read time. */
export function gexMatrixAgeMs(
  gex: GexPositioning | null | undefined,
  readMs: number = Date.now(),
): number | null {
  if (!gex) return null;
  if (typeof gex.matrix_age_sec === "number" && Number.isFinite(gex.matrix_age_sec)) {
    return gex.matrix_age_sec * 1000;
  }
  if (gex.asof) {
    const observedMs = Date.parse(gex.asof);
    if (Number.isFinite(observedMs)) return readMs - observedMs;
  }
  return null;
}

export function gexMatrixStale(
  gex: GexPositioning | null | undefined,
  readMs: number = Date.now(),
): boolean {
  const ageMs = gexMatrixAgeMs(gex, readMs);
  if (ageMs == null) return false;
  // Fail-closed on clock-skewed future stamps — same guard as gexStaleFromAge / FreshnessChip.
  if (ageMs < -WS_TIMESTAMP_FUTURE_TOLERANCE_MS) return true;
  return ageMs > GEX_MATRIX_STALE_MS;
}

/**
 * GEX-matrix sibling of `describeVectorFreshness`'s `market_session_note` (#5306/#4076 comment
 * 5750099882, Mechanism 2). `gex.asof` traces to `polygon-options-gex.ts`'s
 * `calculatedAt = new Date(now).toISOString()` — a pure wall-clock compute stamp, same shape as
 * Vector's own `asOf` — so a weekend/holiday self-warm can compute a genuinely fresh GEX matrix
 * from Friday's closing chain while the market itself has been shut for hours. `gexMatrixStale`
 * alone cannot say so — it only ever saw the compute clock (same gap `describeVectorFreshness`'s
 * own module doc named for Vector).
 *
 * Delegates to the SAME `marketSessionDisclosure` helper Vector uses rather than forking a second
 * copy of the "is this misleading" conditional — the risk #5306's own PR description named this
 * follow-up to avoid. Null whenever `gexMatrixStale` is already true (that verdict's own staleness
 * already covers it — piling a second disclosure on top would bury the more important one) or when
 * age is unreadable.
 */
export function gexMarketSessionNote(
  gex: GexPositioning | null | undefined,
  readMs: number = Date.now(),
): string | null {
  const ageMs = gexMatrixAgeMs(gex, readMs);
  if (ageMs == null) return null;
  if (gexMatrixStale(gex, readMs)) return null;
  const ageSec = Math.max(0, Math.round(ageMs / 1000));
  const marketSession = etSessionFacts(new Date(readMs)).market_session;
  return marketSessionDisclosure(freshnessFromAgeMs(ageMs), ageSec, marketSession);
}

/**
 * Formats a millisecond age as a plain seconds label ("42s") for the "Last snapshot (~Ns old)"
 * narrative pattern several sections share (chart technicals, Vector desk, GEX posture, Meridian
 * catalysts, dark-pool/spot narration) — never a bare `Math.round(ageMs / 1000)`, which renders
 * garbage for the two failure modes the staleness gates guarding these lines (vectorAgeStale/
 * gexMatrixStale/meridianCatalystStale) already treat as "stale" but the raw display never
 * checked: `Number.POSITIVE_INFINITY` (Vector's future-skew sentinel, `withReadContext()`) rounds
 * to the literal string "Infinity" (live repro shape: "Vector data **Infinitys** old", fixed at
 * one call site in #5070 before this helper existed to share the fix), and a future-skewed
 * (negative) raw age rounds to a negative number ("-500s old"). Returns `null` when `ageMs`
 * itself is `null`/`undefined` so optional-suffix callers can omit the parenthetical entirely
 * rather than claim "clock-skewed" for a value that was simply never available.
 */
export function ageSecondsLabel(ageMs: number | null | undefined): string | null {
  if (ageMs == null) return null;
  if (!Number.isFinite(ageMs) || ageMs < 0) return "clock-skewed";
  return `${Math.round(ageMs / 1000)}s`;
}

/**
 * Human relative-age label ("14m ago" / "3h ago") for spans up to a day (recent_anomalies is a
 * last-24h feed — see `ecosystem-context.ts`'s own doc comment), as opposed to `ageSecondsLabel`'s
 * raw-seconds form meant for sub-minute staleness bars. Built for `flowNarrative`'s anomaly line
 * (live CRWD repro, 2026-09-16, Ask Largo standing mandate): the HELIX tape read is a 6h window
 * while `recent_anomalies` draws from the last 24h, so an anomaly can legitimately point the
 * OPPOSITE direction from the tape's own bias without either read being wrong — concatenating them
 * with no time label reads as a flat self-contradiction ("call-heavy... supports the long swing"
 * immediately followed by "one-sided put flow"). Labeling the anomaly's own age lets the reader
 * see it as an earlier, separate read rather than a clash within the same window. Returns `null`
 * for an unparseable/missing timestamp so callers can omit the parenthetical rather than fabricate
 * an age, and "clock-skewed" for a negative age for the same reason `ageSecondsLabel` does.
 */
export function relativeAgeLabel(
  isoTimestamp: string | null | undefined,
  nowMs: number = Date.now(),
): string | null {
  if (!isoTimestamp) return null;
  const observedMs = Date.parse(isoTimestamp);
  if (!Number.isFinite(observedMs)) return null;
  const ageMs = nowMs - observedMs;
  if (!Number.isFinite(ageMs) || ageMs < 0) return "clock-skewed";
  const ageMin = Math.round(ageMs / 60_000);
  if (ageMin < 60) return `${Math.max(ageMin, 0)}m ago`;
  const ageHr = Math.round(ageMin / 60);
  return `${ageHr}h ago`;
}

/**
 * Meridian catalyst timeline staleness (Largo C2). `slice.as_of` is stamped once, at the moment
 * `loadMeridianTimelineResponse` actually ran inside `withServerCache` — under that cache's
 * stale-while-revalidate path a degraded Benzinga upstream can legitimately keep serving the same
 * stored payload (and its original `as_of`) for up to `MAX_STALE_AGE_MS` (10 minutes,
 * server-cache.ts), well past this 120s bound. Same threshold as GEX/Vector so "quiet calendar"
 * narrative doesn't read as current when the read behind it is actually minutes old.
 */
const MERIDIAN_CATALYST_STALE_MS = GEX_MATRIX_STALE_MS;

export function meridianCatalystAgeMs(
  slice: SwingMeridianCatalystSlice | null | undefined,
  readMs: number = Date.now(),
): number | null {
  if (!slice?.as_of) return null;
  const observedMs = Date.parse(slice.as_of);
  if (!Number.isFinite(observedMs)) return null;
  return readMs - observedMs;
}

export function meridianCatalystStale(
  slice: SwingMeridianCatalystSlice | null | undefined,
  readMs: number = Date.now(),
): boolean {
  const ageMs = meridianCatalystAgeMs(slice, readMs);
  if (ageMs == null) return false;
  if (ageMs < -WS_TIMESTAMP_FUTURE_TOLERANCE_MS) return true;
  return ageMs > MERIDIAN_CATALYST_STALE_MS;
}

/**
 * Ticker news / catalyst headlines staleness (Largo C2, 2026-09-18, Ask Largo standing mandate).
 * `arsenal.news.as_of` is `NewsResult.asOf` (polygon-news.ts), stamped ONCE inside `serverCache`'s
 * cached builder at the moment the upstream Benzinga fetch actually completed — the exact same
 * stale-while-revalidate exposure `meridianCatalystStale` above already documents and guards for
 * the sibling Meridian catalyst read (a degraded upstream can keep serving the same stored payload,
 * and its true un-bumped `as_of`, for up to `MAX_STALE_AGE_MS` = 10 minutes, server-cache.ts). Same
 * threshold as GEX/Vector/Meridian so `catalystsSection`'s headlines can't read as current when the
 * fetch behind them is actually minutes old. See `EcosystemArsenalNews.as_of`'s own doc comment for
 * why this field previously never reached this file at all (dropped one layer up, at the arsenal
 * assembler) rather than merely being read incorrectly.
 */
const NEWS_CATALYST_STALE_MS = GEX_MATRIX_STALE_MS;

export function newsCatalystAgeMs(
  asOf: string | null | undefined,
  readMs: number = Date.now(),
): number | null {
  if (!asOf) return null;
  const observedMs = Date.parse(asOf);
  if (!Number.isFinite(observedMs)) return null;
  return readMs - observedMs;
}

export function newsCatalystStale(
  asOf: string | null | undefined,
  readMs: number = Date.now(),
): boolean {
  const ageMs = newsCatalystAgeMs(asOf, readMs);
  if (ageMs == null) return false;
  if (ageMs < -WS_TIMESTAMP_FUTURE_TOLERANCE_MS) return true;
  return ageMs > NEWS_CATALYST_STALE_MS;
}

/** ET session the Vector snapshot was measured in — freshness block wins over persisted sessionDate. */
export function vectorObservedSessionDate(vec: VectorWithReadContext): string | null {
  if (typeof vec.observed_session_date === "string" && vec.observed_session_date.length > 0) {
    return vec.observed_session_date;
  }
  if (typeof vec.sessionDate === "string" && vec.sessionDate.length > 0) return vec.sessionDate;
  return null;
}

/** Age-only staleness — same 120s bound as GEX matrix (Largo C2). */
export function vectorAgeStale(
  vec: VectorWithReadContext | null | undefined,
  readMs: number = Date.now(),
): boolean {
  if (!vec) return false;
  const ageMs = vec.dataAgeMs;
  // withReadContext() stamps POSITIVE_INFINITY on future skew — must not read as fresh.
  if (typeof ageMs === "number" && !Number.isFinite(ageMs)) return true;
  if (typeof ageMs === "number" && Number.isFinite(ageMs)) {
    if (ageMs < -WS_TIMESTAMP_FUTURE_TOLERANCE_MS) return true;
    if (ageMs > VECTOR_STALE_MS) return true;
  }
  if (vec.freshness === "stale" || vec.freshness === "unknown") return true;
  if (vec.asOf) {
    const observedMs = Date.parse(vec.asOf);
    if (Number.isFinite(observedMs)) {
      const rawAgeMs = readMs - observedMs;
      if (rawAgeMs < -WS_TIMESTAMP_FUTURE_TOLERANCE_MS) return true;
      if (rawAgeMs > VECTOR_STALE_MS) return true;
    }
  }
  return false;
}

/** Vector desk snapshot is untrustworthy for the brief — age-stale OR measured in a prior session. */
export function vectorSnapshotStale(
  vec: VectorWithReadContext | null | undefined,
  readMs: number = Date.now(),
  briefSessionDate?: string | null,
): boolean {
  if (!vec) return false;
  if (vectorAgeStale(vec, readMs)) return true;
  if (briefSessionDate != null) {
    const observed = vectorObservedSessionDate(vec);
    if (observed != null && observed !== briefSessionDate) return true;
  }
  return false;
}

/** Vector state is only live cross-desk signal when its measurement session matches the brief. */
export function vectorLiveForSession(
  vec: VectorWithReadContext | null | undefined,
  sessionDate: string | null | undefined,
): VectorWithReadContext | null {
  if (!vec) return null;
  if (sessionDate != null) {
    const observed = vectorObservedSessionDate(vec);
    if (observed != null && observed !== sessionDate) return null;
  }
  return vec;
}

/**
 * Gamma posture for narrative/coaching call sites that cite dealer positioning — mirrors the
 * stale-GEX gating already applied to gexPostureSection/counterThesisLine/watchForSection/
 * chartLevelsSection/narrateKing/narrateMagnet (largo C2). Live Vector regime always wins; the
 * GEX-only fallback is suppressed once the matrix is stale, since posture drives a directional
 * narrative claim ("pin risk" vs "acceleration", "long-gamma" vs not).
 *
 * BUG FIXED 2026-09-12 (Ask Largo standing mandate, live repro CG COMMIT brief): Vector's own
 * `regime.posture` (`vector-regime.ts`) is a FOUR-value enum — `"long"`/`"short"`/`"transition"`/
 * `"unknown"` — not the two-value `"long"|"short"|null` the GEX-matrix's own `gamma_posture` field
 * uses. The old `vecPosture != null` check treated the literal string `"unknown"` (Vector
 * genuinely could not compute a regime) as an equally-resolved answer to `"long"`/`"short"`, so it
 * won outright over a perfectly good GEX-matrix-only posture and never fell through to the
 * fallback below. Live: CG's own "GEX posture" section (reading `gex.gamma_posture` directly, a
 * real, non-stale "short") rendered "Gamma posture: dealers **short gamma**... Net GEX: -4.3M" —
 * while the SAME brief's "Trade manager read" (via this function) rendered "dealer gamma posture
 * not resolved on this read", because Vector's OWN regime read had independently landed on
 * "unknown" and this function let that silence a real, resolved GEX-matrix answer. `"unknown"` is
 * semantically equivalent to "Vector has nothing to say" — it must defer to the GEX fallback the
 * same way a null/absent Vector read already does, not out-rank it.
 */
export function resolveGammaPosture(
  ctx: SwingPlayBriefContext,
  vec: VectorWithReadContext | null | undefined,
  readMs: number = Date.now(),
): string | null {
  const vecPosture = vec?.regime?.posture ?? null;
  if (vecPosture != null && vecPosture !== "unknown" && !vectorSnapshotStale(vec, readMs, ctx.sessionDate)) {
    return vecPosture;
  }
  const gex = ctx.ecosystem?.gex_positioning;
  if (gex?.gamma_posture == null) return null;
  if (gexMatrixStale(gex, readMs)) return null;
  return gex.gamma_posture;
}

/** Only committed working rows expect a live-synced option mark — WATCH uses static chain mid by design. */
export function playExpectsLiveOptionMark(status: string | null | undefined): boolean {
  return status === "OPEN" || status === "HOLD" || status === "TRIM";
}

/**
 * A swing option mark's ONLY writer is `swing-active-refresh` (cron-registry.ts), which runs
 * every 15 minutes during market hours — unlike 0DTE/Vector, there is no faster "live-marks"
 * writer for the persisted `last_mark_at` column (the shared ~1s live-marks lane feeds an
 * ephemeral Redis/SSE display path, not this DB column — see live-marks-active.ts's header).
 * So under fully healthy, on-schedule operation, `markAsOf` legitimately ranges from 0 to ~15
 * minutes old at any read. The generic cross-product `freshnessFromObservedMs` bucket (stale at
 * 10 minutes, answer-envelope.ts) was written for feeds that refresh on a much tighter cadence,
 * and reusing it here mislabels a mark that is exactly on schedule (10-15 min old, waiting on
 * the next scheduled refresh) as "stale" — a false positive roughly a third of every refresh
 * cycle, confirmed live 2026-09-15 (CRWD/AAPL both showing `markAsOf` exactly on the :00/:15/:30/
 * :45 cadence yet flagged stale at the ~13-minute mark). 18 minutes gives one full cycle plus a
 * margin for a delayed/skipped tick before calling it genuinely stale, mirroring the cadence-aware
 * `stale_after_min` pattern cron-registry.ts already uses for its own health alerting (swing-
 * active-refresh's own `stale_after_min: 25` is more generous still, since that alert also has to
 * tolerate an outright missed run — this constant only needs to cover normal jitter within one
 * on-schedule cycle).
 */
const SWING_OPTION_MARK_STALE_MS = 18 * 60_000;

/** True when an OPEN/HOLD/TRIM row carries an aged markAsOf (not the markIsSync no-timestamp case). */
export function optionMarkIsStale(play: TerminalPlay, readMs: number = Date.now()): boolean {
  if (!playExpectsLiveOptionMark(play.status)) return false;
  if (play.markIsSync === true || !play.markAsOf) return false;
  const markMs = Date.parse(play.markAsOf);
  if (!Number.isFinite(markMs)) return false;
  const ageMs = readMs - markMs;
  if (ageMs < 0) return freshnessFromObservedMs(markMs, readMs) === "stale"; // fail-closed on future skew (Largo C2)
  return ageMs >= SWING_OPTION_MARK_STALE_MS;
}

/**
 * True only when `play.mark` is the TRUE entry-fallback echo, not a real (if untimestamped) quote.
 *
 * `markIsSync` alone cannot distinguish the two — it is set as bluntly as `markAsOf == null`
 * (adapters.ts), true for every banger-lane row regardless of whether `last_mark` is real (no
 * `mark_as_of` column exists for that lane at all). When `pnlPct` is a real (non-null) number, the
 * mark behind it must be real too — `livePnlPct(entry, mark)` cannot produce a percentage from a
 * value that doesn't exist — so the TRUE fallback signature is `markIsSync && pnlPct == null`
 * (play-brief.ts's `markGenuinelyUnknown`, extracted here 2026-09-12 so a second call site can
 * share it instead of re-deriving it, and inevitably drifting from it, a second time).
 *
 * Centralized after a live repro (Ask Largo standing mandate, EBS OPEN brief 2026-09-12) found a
 * SECOND call site computing straight off `play.mark` with no such gate: `watchForSection`'s
 * "Premium stop rail" cushion (play-brief-intel.ts) divided by `play.mark` whenever it was a
 * positive number above the stop — which the true entry-fallback case always satisfies, since the
 * fallback mark is exactly the entry premium and the stop is set below entry by construction. EBS
 * (stop $0.04, entry/fallback-mark $0.10) rendered "Premium stop rail: $0.04 — 60% cushion from
 * current mark" in "What to watch" in the SAME envelope whose own Position section, a few lines
 * above, correctly read "Mark: unknown _(sync quote, no live price yet — do not read as flat)_" —
 * a specific, confident percentage computed from the exact number the document itself says is not
 * known. Same self-contradiction class play-brief.ts's own comment already documents for its Mark
 * line (2026-09-11, live repro SWING:ALAB) — this is a second, previously-unchecked instance of it.
 */
export function optionMarkGenuinelyUnknown(play: TerminalPlay): boolean {
  return play.markIsSync === true && playExpectsLiveOptionMark(play.status) && play.pnlPct == null;
}

/** Structured C3 absence for option marks — sync-without-timestamp OR aged markAsOf. */
export function collectOptionMarkStalenessAbsence(
  play: TerminalPlay | null | undefined,
  readMs: number = Date.now(),
): BieUnavailableSource | null {
  if (!play || !playExpectsLiveOptionMark(play.status)) return null;
  if (play.markIsSync === true) {
    return {
      source: "option mark",
      reason: "sync quote without freshness timestamp",
      what_is_missing: "a live option-quote sync with a mark_as_of timestamp",
      // Whether the NEXT sync carries a timestamp depends on the lane's own schema (banger-lane
      // rows have no mark_as_of column at all, per the comment above) — not something a retry of
      // THIS read can fix, so this is honestly not retryable from the brief's own vantage point.
      retryable: false,
    };
  }
  if (optionMarkIsStale(play, readMs)) {
    const stamp = etStampFromIso(play.markAsOf!) ?? play.markAsOf!;
    return {
      source: "option mark",
      reason: `stale — last synced ${stamp}`,
      what_is_missing: "a fresh option-quote sync",
      retryable: true,
    };
  }
  return null;
}

/** HELIX recent_flow is only trustworthy when the feed is fresh — stale pipeline rows are absence, not signal. */
export function trustedHelixFlow(eco: EcosystemContext | null | undefined) {
  if (!eco?.recent_flow || eco.flow_feed_fresh === false) return null;
  return eco.recent_flow;
}

/** 0DTE take is only live cross-desk signal when its session matches the brief's session date. */
export function zerodteLiveForSession(
  z: EcosystemZeroDteTake | null | undefined,
  sessionDate: string | null | undefined,
): EcosystemZeroDteTake | null {
  if (!z) return null;
  if (sessionDate != null && z.session_date !== sessionDate) return null;
  return z;
}

/** Night Hawk swing take is only live cross-desk signal when edition_for matches the brief session. */
export function nighthawkLiveForSession(
  nh: EcosystemNightHawkTake | null | undefined,
  sessionDate: string | null | undefined,
): EcosystemNightHawkTake | null {
  if (!nh) return null;
  if (sessionDate != null && nh.edition_for !== sessionDate) return null;
  return nh;
}

function vectorOf(ctx: SwingPlayBriefContext): VectorWithReadContext | null {
  return ctx.vector ?? ctx.ecosystem?.vector_full_state ?? null;
}

function hasVectorDeskState(ctx: SwingPlayBriefContext): boolean {
  const vec = vectorOf(ctx);
  return vec != null && Number.isFinite(vec.spot);
}

function collectVectorSectionAbsences(vec: VectorWithReadContext): BieUnavailableSource[] {
  const sections = vec.unavailable_sections ?? [];
  if (!sections.length) return [];

  const out: BieUnavailableSource[] = [];
  for (const section of sections) {
    if (section === "wall_history" && vec.wall_history_empty_reason === "outside_rth_no_recording_yet") {
      continue;
    }
    out.push({
      source: VECTOR_SECTION_LABELS[section],
      reason: "not present on this read",
      what_is_missing: `${VECTOR_SECTION_LABELS[section]} data for this ticker/session`,
      retryable: true,
    });
  }
  return out;
}

function collectVectorStalenessAbsence(
  vec: VectorWithReadContext,
  briefSessionDate?: string | null,
  readMs: number = Date.now(),
): BieUnavailableSource | null {
  if (briefSessionDate != null) {
    const observed = vectorObservedSessionDate(vec);
    if (observed != null && observed !== briefSessionDate) {
      return {
        source: "Vector snapshot",
        reason: `prior session (${observed}) — today's desk read not yet run`,
        what_is_missing: "today's Vector desk snapshot",
        retryable: true,
      };
    }
  }
  if (!vectorAgeStale(vec, readMs)) return null;
  return {
    source: "Vector snapshot",
    reason: "stale — levels may lag spot",
    what_is_missing: "a fresh Vector desk snapshot",
    retryable: true,
  };
}

function collectGexStalenessAbsence(
  gex: GexPositioning | null | undefined,
  readMs: number,
): BieUnavailableSource | null {
  if (!gexMatrixStale(gex, readMs)) return null;
  return {
    source: "GEX matrix",
    reason: "stale — dealer posture may lag spot",
    what_is_missing: "a fresh GEX matrix rebuild for this ticker",
    retryable: true,
  };
}

/** Aggregate every honest absence signal for the swing play brief envelope (Largo C3). */
export function collectBriefUnavailableSources(ctx: SwingPlayBriefContext): BieUnavailableSource[] {
  const out: BieUnavailableSource[] = [...(ctx.ecosystem?.arsenal?.unavailable_sources ?? [])];

  // CLOSED plays are a historical record, not a live position — every check below this point
  // (HELIX flow freshness, GEX/Vector staleness+desk-state, discovery/0DTE/Night-Hawk "today's
  // scan/board/edition not yet run") measures whether TODAY's live desk state is current, which
  // does not apply to a play that closed on some earlier session. Left ungated, these are
  // individually honest but collectively permanent once ANY time has passed since close — every
  // one of them fires forever, producing a wall of true-but-unhelpful negative chips with no
  // positive content (reported live: a screenshot of a CLOSED AAPL play showing six such chips
  // and nothing else). Genuine fetch failures (ecosystemFetchFailed/vectorFetchFailed/meridian
  // unavailable) are NOT skipped below — those indicate the read itself broke, which is still
  // true after close.
  const status = String(ctx.play?.status ?? "").toUpperCase();
  const isClosed = status === "CLOSED";
  // GAP FOUND (Ask Largo standing mandate, 2026-09-19): a WATCH play whose entry is already dead
  // (`deadPlayReason` — thesis invalidated, entry-validity deadline passed, contract expired, or
  // extended past the valid entry window) is functionally identical to CLOSED for the purpose of
  // this file's own "isClosed" reasoning above — "today's live desk state" has nothing left to
  // say about a setup the brief itself narrates as "no longer live — skip it"
  // (tradeManagerNarrativeSection's "Break watch" bullet, play-brief-narrative.ts). Every OTHER
  // call site that reasons about "is this play actually actionable" already checks
  // `deadPlayReason` (play-brief.ts's Invalidation callout, play-brief-intel.ts's Entry-trigger
  // line, play-brief-narrative-coaching.ts's cross-desk coaching) — this file, whose entire job is
  // deciding what counts as live-vs-absent for the SAME brief, never imported it, so it never
  // suppressed the identical wall-of-stale-chips defect the CLOSED-play fix above was written for.
  // A dead WATCH candidate is arguably the WORSE case: nothing re-scans a candidate nobody can act
  // on anymore, so its Vector/GEX/HELIX reads keep aging with no refresh to ever clear them.
  // Scoped to the WATCH bucket only (mirroring `deadPlayReason`'s two existing call sites, both
  // gated on `bucket === "watch"`) — the same fields carry different meaning once a position is
  // live, so applying this to OPEN/HOLD/TRIM would risk misreading leftover pre-entry values.
  const isDeadWatch =
    !isClosed &&
    status !== "OPEN" &&
    status !== "HOLD" &&
    status !== "TRIM" &&
    ctx.play != null &&
    deadPlayReason(ctx.play) != null;
  const isNotLive = isClosed || isDeadWatch;

  if (!isNotLive && ctx.ecosystem?.flow_feed_fresh === false) {
    out.push({
      source: "HELIX flow",
      reason: "pipeline stale",
      what_is_missing: "a fresh HELIX flow-pipeline tick",
      retryable: true,
    });
  }
  // FINDINGS 2026-09-06 (#22) + live probe 2026-09-07: sync-without-timestamp AND aged markAsOf
  // must both reach unavailableSources — prose in dataHonestyCoaching alone is not enough (C3).
  const markAbsence = collectOptionMarkStalenessAbsence(ctx.play, Date.now());
  if (markAbsence) out.push(markAbsence);
  // Cold GEX is distinct from a total ecosystem fetch failure — the read succeeded but the shared
  // matrix had no positioning for this ticker.
  if (!isNotLive && !ctx.ecosystemFetchFailed && ctx.ecosystem && !ctx.ecosystem.gex_positioning) {
    out.push({
      source: "GEX positioning",
      reason: "cold matrix / no positioning read",
      what_is_missing: "a warm GEX positioning read for this ticker",
      retryable: true,
    });
  }
  if (!isNotLive) {
    const gex = ctx.ecosystem?.gex_positioning;
    const gexStale = collectGexStalenessAbsence(gex, Date.now());
    if (gexStale) out.push(gexStale);
  }
  // Missing Vector desk state is distinct from vectorFetchFailed — ecosystem read succeeded but
  // neither ctx.vector nor ecosystem.vector_full_state carried a live spot.
  if (!isNotLive && !ctx.vectorFetchFailed && ctx.ecosystem && !hasVectorDeskState(ctx)) {
    out.push({
      source: "Vector desk state",
      reason: "snapshot unavailable",
      what_is_missing: "a live Vector desk-state snapshot with spot",
      retryable: true,
    });
  }
  if (!isNotLive) {
    const vec = vectorOf(ctx);
    if (vec && hasVectorDeskState(ctx)) {
      out.push(...collectVectorSectionAbsences(vec));
      const stale = collectVectorStalenessAbsence(vec, ctx.sessionDate);
      if (stale) out.push(stale);
      // reportVectorAbsences treats non-null flowMarkers as present even when available=false.
      if (vec.flowMarkers?.available === false) {
        out.push({
          source: "Vector flow prints",
          reason: vec.flowMarkers.reason ?? "unavailable",
          what_is_missing: "Vector flow-print markers for this ticker",
          retryable: true,
        });
      }
    }
  }
  // Book-context concentration only informs a live/pending decision — irrelevant once a play is closed.
  if (!isNotLive && ctx.openBook === null) {
    out.push({
      source: "open book",
      reason: "ledger read failed",
      what_is_missing: "the open-positions ledger read for book-context concentration",
      retryable: true,
    });
  }
  if (ctx.meridian?.unavailable) {
    out.push({
      source: "Meridian catalysts",
      reason: "timeline read failed",
      what_is_missing: "the Meridian catalyst timeline for this ticker",
      retryable: true,
    });
  } else if (!isNotLive && meridianCatalystStale(ctx.meridian, Date.now())) {
    out.push({
      source: "Meridian catalysts",
      reason: "stale — calendar read may lag",
      what_is_missing: "a fresh Meridian catalyst timeline read for this ticker",
      retryable: true,
    });
  }
  // Largo C2/C3 (2026-09-18, Ask Largo standing mandate): #5166 disclosed ticker-news staleness
  // INLINE in the narrative (play-brief-intel.ts's `staleLead` prefix on the Headlines section,
  // reading `newsCatalystStale(arsenal.news.as_of, ...)`) but never wired the identical signal
  // into `unavailableSources` — the one place `UnavailableChip` (the UI's dedicated absence
  // surface) reads from. That is the exact split this file already treats as a bug for every
  // sibling freshness signal: Meridian catalyst staleness (two lines above), option-mark
  // staleness, GEX/Vector staleness all reach BOTH the narrative prose AND unavailableSources;
  // news catalysts reached only the former. A member skimming the chip row (rather than reading
  // the full narrative) had no way to know the headlines they're seeing could be up to
  // `NEWS_CATALYST_STALE_MS` (2min) old. Live-verified 2026-09-18: `arsenal.news.headlines`
  // renders on real committed plays right now, so this omission fires whenever the shared
  // Benzinga read (server-cache.ts stale-while-revalidate) is aged, not a theoretical gap. Same
  // `!isNotLive` gate as every other live-desk-state check above (a closed play's citation of
  // headlines-at-the-time is historical, not "may lag").
  if (
    !isNotLive &&
    ctx.ecosystem?.arsenal?.news?.headlines?.length &&
    newsCatalystStale(ctx.ecosystem.arsenal.news.as_of, Date.now())
  ) {
    out.push({
      source: "Ticker news",
      reason: "stale — headlines may lag",
      what_is_missing: "a fresh ticker-news/headlines read for this ticker",
      retryable: true,
    });
  }
  // FINDINGS 2026-09-06 (#11): `ecosystem`/`vector` being null is otherwise ambiguous between a
  // legitimately empty read and a total fetch failure — the arsenal-level unavailable_sources
  // above only covers a failure WITHIN a successful ecosystem read, not the whole call throwing.
  if (ctx.ecosystemFetchFailed === true) {
    out.push({
      source: "ecosystem context",
      reason: "fetch failed",
      what_is_missing: "the ecosystem context read (GEX/Vector/flow aggregate) for this ticker",
      retryable: true,
    });
  }
  // Standalone Vector fetch can fail while ecosystem.vector_full_state still succeeded in parallel.
  if (ctx.vectorFetchFailed === true && !ctx.vector && !ctx.ecosystem?.vector_full_state) {
    out.push({
      source: "Vector state",
      reason: "fetch failed",
      what_is_missing: "the standalone Vector desk-state read for this ticker",
      retryable: true,
    });
  }
  if (ctx.meridianPeer?.available === false) {
    const peer = ctx.meridianPeer;
    const reason = peer.error ?? peer.note ?? "unavailable";
    out.push({
      source: "Meridian peer cohort",
      reason,
      what_is_missing: "the Meridian sector peer-earnings cohort for this ticker",
      retryable: true,
    });
  } else if (ctx.meridianPeer?.available === true && ctx.meridianPeer.insufficient_reason?.trim()) {
    out.push({
      source: "Meridian peer cohort",
      reason: ctx.meridianPeer.insufficient_reason.trim(),
      what_is_missing: "enough peer names in the cohort to be directional",
      // Insufficiency here is a population-size fact (too few names printed this window), not a
      // transient read failure — asking again a moment later will not add peers to the cohort.
      retryable: false,
    });
  }
  // Prior-session discovery scan: WATCH rows can still carry yesterday's lane snapshot while the
  // brief stamps today's sessionDate — without this, scanAsOf prose looks current (C3 gap).
  // Not applicable once the play is CLOSED — there is no "today's scan" a historical record awaits.
  if (
    !isNotLive &&
    ctx.scanSessionDay &&
    ctx.sessionDate &&
    ctx.scanSessionDay !== ctx.sessionDate
  ) {
    out.push({
      source: "swing discovery scan",
      reason: `prior session (${ctx.scanSessionDay}) — today's scan not yet run`,
      what_is_missing: "today's swing discovery scan for this ticker",
      retryable: true,
    });
  }
  // Prior-session 0DTE: zerodteLiveForSession() already suppresses stale direction in prose (#4424),
  // but consumers reading unavailableSources alone still saw nothing wrong (C3 gap). Same
  // not-applicable-once-CLOSED reasoning as the discovery-scan check above.
  const z = ctx.ecosystem?.zerodte_today;
  if (!isNotLive && z && ctx.sessionDate && z.session_date !== ctx.sessionDate) {
    out.push({
      source: "0DTE Command",
      reason: `prior session (${z.session_date}) — today's board not yet run`,
      what_is_missing: "today's 0DTE Command board read",
      retryable: true,
    });
  }
  // Prior-session Night Hawk: nighthawkLiveForSession() already suppresses stale direction in prose
  // (#4427), but consumers reading unavailableSources alone still saw nothing wrong (C3 gap). Same
  // not-applicable-once-CLOSED reasoning as the discovery-scan/0DTE checks above — this is the
  // exact chip the user's live bug report screenshot showed on a CLOSED AAPL play.
  //
  // SOURCE LABEL — must say "Legacy", never "swings" (Largo C4 identity, fixed 2026-09-09).
  // `ctx.ecosystem.nighthawk_recent` is read from `nighthawk_play_outcomes` (db.ts), which is
  // Night Hawk LEGACY's next-day evening-edition table (`edition_for` + `next_day_open/close` +
  // "Legacy Chief Trade Alert Bot live state" — see the table's own column comments in db.ts).
  // It has nothing to do with the live Swing board this very brief is FOR — that board's own
  // staleness is already reported separately, correctly, as `"swing discovery scan"` a few lines
  // above. The original fix (#staged 2026-09-07, BO-P2-largo-nighthawk-unavailable-c3) labeled
  // this row "Night Hawk swings", which — read inside a Night Hawk SWINGS play-brief — says "our
  // own board is stale" when it actually means "the separate Legacy digest hasn't published
  // today's edition yet". That is exactly the C4 violation the product contract calls out (SPX
  // vs SPY): a plausible-looking wrong identity is worse than an obviously-missing one, and it
  // reaches Largo verbatim as this string, so the model would reason about it as the wrong product.
  //
  // BUG (found 2026-09-10, live GOOG brief): unlike the 0DTE/scan checks above, this query has NO
  // date filter (`ORDER BY edition_for DESC LIMIT 1` with no WHERE on date) — it is "the last time
  // THIS TICKER appeared in a Legacy edition," which for most tickers is not today or yesterday,
  // it is however long ago Legacy last happened to feature this specific name. Comparing that
  // per-ticker date to `ctx.sessionDate` and claiming "today's edition not yet run" was itself a
  // false, unverifiable system-wide claim from per-ticker data: live evidence the same cycle this
  // was found — GOOG's `nighthawk_recent.edition_for` read `2026-08-03` (5+ weeks old) while
  // `GET /api/market/nighthawk/edition` confirmed the real Legacy edition was freshly published
  // `2026-09-09T21:34:32Z`. The pipeline was fine; only GOOG hadn't been featured recently. A gap
  // this large says "this ticker isn't in Legacy's recent editions," not "the edition hasn't run" —
  // exactly the C4 wrong-identity-is-worse-than-missing failure this file's own history warns about
  // two paragraphs up, just on the freshness axis instead of the product-label axis. Bound the
  // "not yet run" claim to a small window (a normal within-week gap, incl. weekends) where it is
  // still a plausible same-cycle read; beyond that, report the per-ticker fact honestly instead of
  // asserting an unverified system-wide state.
  const nh = ctx.ecosystem?.nighthawk_recent;
  if (!isNotLive && nh && ctx.sessionDate) {
    const gapDays = daysBetweenYmd(nh.edition_for, ctx.sessionDate);
    if (gapDays !== null && gapDays > 0 && gapDays <= 4) {
      out.push({
        source: "Night Hawk Legacy",
        reason: `prior session (${nh.edition_for}) — today's edition not yet run`,
        what_is_missing: "today's Night Hawk Legacy edition featuring this ticker",
        retryable: true,
      });
    } else if (gapDays !== null && gapDays > 4) {
      out.push({
        source: "Night Hawk Legacy",
        reason: `no recent Legacy edition for this ticker (last featured ${nh.edition_for})`,
        what_is_missing: "a recent Night Hawk Legacy feature for this specific ticker",
        // A gap this large is a population fact (this name simply hasn't come up recently), not a
        // stale read — retrying does not make Legacy feature the ticker sooner.
        retryable: false,
      });
    }
  }
  // Committed positions compute thesis health without setup/entry/signal inputs — the aggregate
  // % collapses to a generic default. Surface that honestly (Largo C3/C6) rather than showing 46%.
  if (
    ctx.play &&
    ["OPEN", "HOLD", "TRIM"].includes(String(ctx.play.status ?? "").toUpperCase()) &&
    thesisHealthUncalibrated(ctx.play.thesisHealth)
  ) {
    out.push({
      source: "thesis health",
      reason: "setup/entry/signal inputs unavailable for committed positions",
      what_is_missing: "the setup/entry/signal inputs the thesis-health score is calibrated on",
      // Structural for a committed position, not a stale read — these inputs are never captured
      // once a candidate is promoted to a position, so a retry cannot surface them.
      retryable: false,
    });
  }

  return out;
}

/**
 * Confluence zones can cite a DIFFERENT call/put wall than the single, top-ranked one a brief
 * shows as "call wall"/"put wall" elsewhere — `vector-full-state.ts`'s confluence engine feeds it
 * the FULL ranked `gexWalls.callWalls`/`putWalls` list, not just `[0]`, so a lower-ranked wall can
 * cluster with max-pain/flip/golden-pocket under the same `call-wall`/`put-wall` kind label at a
 * materially different price.
 *
 * BUG FIX (2026-09-13, Ask Largo standing mandate — confirmed a 3-instance pattern across NRG/MU/
 * SKHY, raised on #4076 comments 5649059880/5649697371/5649766952): live repro NRG showed "call
 * wall: 145" (Key levels) beside "confluence (call-wall+max-pain): 125" (Trade manager read) — two
 * different strikes sharing the identical "call-wall" name with no disambiguation, reading as an
 * internal contradiction. Qualifies the kind name with its actual price ONLY when it differs from
 * the primary wall already shown — the common case (the confluence zone agrees with the top-ranked
 * wall) is byte-identical to before.
 *
 * EXTRACTED HERE (2026-09-14, forensic batch 13): originally lived as a private, unexported
 * function in play-brief.ts, so the fix only patched THAT file's structured `levels` array. Two
 * sibling call sites independently format a `ConfluenceZone`'s `kinds` the exact same
 * unpatched way — `formatConfluenceZone` (play-brief-intel.ts, the "Levels on chart" → "Confluence
 * nodes" bullet list) and `confluenceCoaching` (play-brief-narrative-coaching.ts, the "Trade
 * manager read" → "Confluence <price>" bullet) — live repro NAIL/IONX same day: envelope.levels
 * correctly read "confluence (call-wall@35+max-pain)" (disambiguated) while BOTH unpatched prose
 * call sites read "35.00 (call-wall+max-pain, score 5.0)" with no "@35", silently contradicting
 * "Call wall (GEX): 40.00" three lines above in the SAME brief. Same root cause, same fix, just
 * never swept to the sibling files — moved to this shared module (already imported by all three
 * call sites) so a future 4th call site inherits the disambiguation instead of re-copying the bug.
 * Deliberately swing-lane-only: this changes ONLY how a brief LABELS a zone it already receives —
 * it does not touch `confluenceZones`'s scoring/clustering (`vector-confluence.ts`) or what feeds
 * it (`vector-full-state.ts`), so Vector's own UI and Thermal (separate render call sites over the
 * same shared engine) are unaffected.
 */
export function confluenceZoneKindsLabel(
  z: Pick<ConfluenceZone, "kinds" | "levels">,
  primary: { callWall?: number | null; putWall?: number | null },
): string {
  return z.kinds
    .map((kind) => {
      const primaryPrice = kind === "call-wall" ? primary.callWall : kind === "put-wall" ? primary.putWall : null;
      if (primaryPrice == null) return kind;
      const level = z.levels?.find((l) => l.kind === kind);
      if (level == null || Math.abs(level.price - primaryPrice) < 0.01) return kind;
      return `${kind}@${level.price}`;
    })
    .join("+");
}
