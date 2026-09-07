import type { BieUnavailableSource } from "@/lib/bie/answer-envelope";
import { freshnessFromObservedMs } from "@/lib/bie/answer-envelope";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import { etStampFromIso } from "@/lib/largo/temporal/bar-session-date";
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
import { ageSecFromIso, WS_TIMESTAMP_FUTURE_TOLERANCE_MS } from "@/lib/ws/timestamp-freshness";
import { thesisHealthUncalibrated } from "./thesis-health";

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
    if (Number.isFinite(observedMs)) {
      const rawAgeMs = readMs - observedMs;
      if (rawAgeMs < -WS_TIMESTAMP_FUTURE_TOLERANCE_MS) return rawAgeMs;
    }
    const ageSec = ageSecFromIso(gex.asof, readMs);
    if (ageSec != null) return ageSec * 1000;
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
 */
export function resolveGammaPosture(
  ctx: SwingPlayBriefContext,
  vec: VectorWithReadContext | null | undefined,
  readMs: number = Date.now(),
): string | null {
  const vecPosture = vec?.regime?.posture ?? null;
  if (vecPosture != null && !vectorSnapshotStale(vec, readMs, ctx.sessionDate)) return vecPosture;
  const gex = ctx.ecosystem?.gex_positioning;
  if (gex?.gamma_posture == null) return null;
  if (gexMatrixStale(gex, readMs)) return null;
  return gex.gamma_posture;
}

/** Only committed working rows expect a live-synced option mark — WATCH uses static chain mid by design. */
export function playExpectsLiveOptionMark(status: string | null | undefined): boolean {
  return status === "OPEN" || status === "HOLD" || status === "TRIM";
}

/** True when an OPEN/HOLD/TRIM row carries an aged markAsOf (not the markIsSync no-timestamp case). */
export function optionMarkIsStale(play: TerminalPlay, readMs: number = Date.now()): boolean {
  if (!playExpectsLiveOptionMark(play.status)) return false;
  if (play.markIsSync === true || !play.markAsOf) return false;
  const markMs = Date.parse(play.markAsOf);
  if (!Number.isFinite(markMs)) return false;
  return freshnessFromObservedMs(markMs, readMs) === "stale";
}

/** Structured C3 absence for option marks — sync-without-timestamp OR aged markAsOf. */
export function collectOptionMarkStalenessAbsence(
  play: TerminalPlay | null | undefined,
  readMs: number = Date.now(),
): BieUnavailableSource | null {
  if (!play || !playExpectsLiveOptionMark(play.status)) return null;
  if (play.markIsSync === true) {
    return { source: "option mark", reason: "sync quote without freshness timestamp" };
  }
  if (optionMarkIsStale(play, readMs)) {
    const stamp = etStampFromIso(play.markAsOf!) ?? play.markAsOf!;
    return { source: "option mark", reason: `stale — last synced ${stamp}` };
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
      };
    }
  }
  if (!vectorAgeStale(vec, readMs)) return null;
  return { source: "Vector snapshot", reason: "stale — levels may lag spot" };
}

function collectGexStalenessAbsence(
  gex: GexPositioning | null | undefined,
  readMs: number,
): BieUnavailableSource | null {
  if (!gexMatrixStale(gex, readMs)) return null;
  return { source: "GEX matrix", reason: "stale — dealer posture may lag spot" };
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
  const isClosed = String(ctx.play?.status ?? "").toUpperCase() === "CLOSED";

  if (!isClosed && ctx.ecosystem?.flow_feed_fresh === false) {
    out.push({ source: "HELIX flow", reason: "pipeline stale" });
  }
  // FINDINGS 2026-09-06 (#22) + live probe 2026-09-07: sync-without-timestamp AND aged markAsOf
  // must both reach unavailableSources — prose in dataHonestyCoaching alone is not enough (C3).
  const markAbsence = collectOptionMarkStalenessAbsence(ctx.play, Date.now());
  if (markAbsence) out.push(markAbsence);
  // Cold GEX is distinct from a total ecosystem fetch failure — the read succeeded but the shared
  // matrix had no positioning for this ticker.
  if (!isClosed && !ctx.ecosystemFetchFailed && ctx.ecosystem && !ctx.ecosystem.gex_positioning) {
    out.push({ source: "GEX positioning", reason: "cold matrix / no positioning read" });
  }
  if (!isClosed) {
    const gex = ctx.ecosystem?.gex_positioning;
    const gexStale = collectGexStalenessAbsence(gex, Date.now());
    if (gexStale) out.push(gexStale);
  }
  // Missing Vector desk state is distinct from vectorFetchFailed — ecosystem read succeeded but
  // neither ctx.vector nor ecosystem.vector_full_state carried a live spot.
  if (!isClosed && !ctx.vectorFetchFailed && ctx.ecosystem && !hasVectorDeskState(ctx)) {
    out.push({ source: "Vector desk state", reason: "snapshot unavailable" });
  }
  if (!isClosed) {
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
        });
      }
    }
  }
  // Book-context concentration only informs a live/pending decision — irrelevant once a play is closed.
  if (!isClosed && ctx.openBook === null) {
    out.push({ source: "open book", reason: "ledger read failed" });
  }
  if (ctx.meridian?.unavailable) {
    out.push({ source: "Meridian catalysts", reason: "timeline read failed" });
  }
  // FINDINGS 2026-09-06 (#11): `ecosystem`/`vector` being null is otherwise ambiguous between a
  // legitimately empty read and a total fetch failure — the arsenal-level unavailable_sources
  // above only covers a failure WITHIN a successful ecosystem read, not the whole call throwing.
  if (ctx.ecosystemFetchFailed === true) {
    out.push({ source: "ecosystem context", reason: "fetch failed" });
  }
  // Standalone Vector fetch can fail while ecosystem.vector_full_state still succeeded in parallel.
  if (ctx.vectorFetchFailed === true && !ctx.vector && !ctx.ecosystem?.vector_full_state) {
    out.push({ source: "Vector state", reason: "fetch failed" });
  }
  if (ctx.meridianPeer?.available === false) {
    const peer = ctx.meridianPeer;
    const reason = peer.error ?? peer.note ?? "unavailable";
    out.push({ source: "Meridian peer cohort", reason });
  } else if (ctx.meridianPeer?.available === true && ctx.meridianPeer.insufficient_reason?.trim()) {
    out.push({
      source: "Meridian peer cohort",
      reason: ctx.meridianPeer.insufficient_reason.trim(),
    });
  }
  // Prior-session discovery scan: WATCH rows can still carry yesterday's lane snapshot while the
  // brief stamps today's sessionDate — without this, scanAsOf prose looks current (C3 gap).
  // Not applicable once the play is CLOSED — there is no "today's scan" a historical record awaits.
  if (
    !isClosed &&
    ctx.scanSessionDay &&
    ctx.sessionDate &&
    ctx.scanSessionDay !== ctx.sessionDate
  ) {
    out.push({
      source: "swing discovery scan",
      reason: `prior session (${ctx.scanSessionDay}) — today's scan not yet run`,
    });
  }
  // Prior-session 0DTE: zerodteLiveForSession() already suppresses stale direction in prose (#4424),
  // but consumers reading unavailableSources alone still saw nothing wrong (C3 gap). Same
  // not-applicable-once-CLOSED reasoning as the discovery-scan check above.
  const z = ctx.ecosystem?.zerodte_today;
  if (!isClosed && z && ctx.sessionDate && z.session_date !== ctx.sessionDate) {
    out.push({
      source: "0DTE Command",
      reason: `prior session (${z.session_date}) — today's board not yet run`,
    });
  }
  // Prior-session Night Hawk: nighthawkLiveForSession() already suppresses stale direction in prose
  // (#4427), but consumers reading unavailableSources alone still saw nothing wrong (C3 gap). Same
  // not-applicable-once-CLOSED reasoning as the discovery-scan/0DTE checks above — this is the
  // exact chip the user's live bug report screenshot showed on a CLOSED AAPL play.
  const nh = ctx.ecosystem?.nighthawk_recent;
  if (!isClosed && nh && ctx.sessionDate && nh.edition_for !== ctx.sessionDate) {
    out.push({
      source: "Night Hawk swings",
      reason: `prior session (${nh.edition_for}) — today's edition not yet run`,
    });
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
    });
  }

  return out;
}
