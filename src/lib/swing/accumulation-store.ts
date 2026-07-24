// src/lib/swing/accumulation-store.ts — the PRE-COMMIT persistence memory for swing discovery (PR-11).
//
// WHY THIS EXISTS (the persistence gate): a swing thesis is "a move building across DAYS," so acting on a
// name the FIRST session it surfaces is exactly the single-day amnesia the 0DTE accumulation layer was
// built to cure — a lone print looks identical to a three-day build. This store gives whole-market swing
// discovery a cross-session memory: every scan accretes ONE observation per (ticker, direction) into
// `swing_candidate_accumulation` (PR-10), and a candidate is only promotable to the WATCH rail once its
// thesis has PERSISTED enough — never on a single sighting. That is the whole point of the pre-commit
// ledger: separate "showed up once" from "keeps showing up."
//
// ARCHETYPE-AWARE PERSISTENCE (operator critique #3): the gate is NO LONGER uniform. A "≥2 distinct
// sessions" bar is right for theses that BUILD across days (flow accumulation, pullback continuation,
// sector rotation, breakout, mean-reversion) but too restrictive for EVENT/IMMEDIATE setups
// (event-driven catalysts, post-earnings drift, freshly-triggered failed-breakdowns) that are actionable
// the session they fire. For those, the 2nd-SESSION requirement is replaced by a 2nd-INDEPENDENT-SIGNAL
// requirement (corroboration) — the per-archetype policy lives in taxonomy.ts (`ARCHETYPE_PERSISTENCE`).
//
// ANTI-LONE-PRINT INVARIANT (do NOT weaken): corroboration is NOT "1 print is enough." An event
// archetype still needs MORE than a single raw sighting — it needs ≥2 INDEPENDENT signals (e.g. a flow
// print AND a structure/catalyst signal, i.e. ≥2 distinct signal KINDS, carried in `signal_kinds`), or a
// 2nd session. A lone print (one observation, one signal kind, one session) NEVER promotes for ANY
// archetype. Corroboration swaps "wait a 2nd session" for "prove it twice, independently" — same anti-
// amnesia guarantee, just satisfiable within one session for setups that can't afford to wait a day.
//
// SIGNAL KIND ≠ CADENCE PHASE (fix 2026-07-24): corroboration counts `signal_kinds` — the SCREEN provenance
// (FLOW / STRUCTURE / CATALYST) — NOT `phases_seen`, which is the cadence phase/channel the writers stamp
// (POST_CLOSE / LIVE_FLOW). One KIND of evidence re-seen across cadence windows (FLOW at POST_CLOSE, FLOW
// again at MIDDAY) is still ONE independent signal, not two — counting phases would have let that masquerade
// as corroboration and weaken the anti-lone-print invariant. The screen provenance is the honest independence
// axis: a FLOW print AND a STRUCTURE breakout (or a grounded CATALYST) are genuinely two different reads.
//
// DB accessors are INJECTED (SwingAccumAccessors) — this module is the thin policy layer over the PR-10
// accessors (`upsertSwingAccum`/`fetchAccumulating`/`markAccumPromoted`/`fadeStaleAccum`), so the
// persistence logic is unit-testable with an in-memory fake and never needs a live Postgres. Direction is
// converted at the boundary: the dossier/serving layer speaks PlayDirection ("LONG"/"SHORT"); the table
// stores the lowercase ("long"/"short") the PR-10 schema uses.
//
// Evidence-only: promotion here means "eligible for the WATCH rail," NOT a commit. Nothing sizes risk.

import type { PlayDirection } from "../horizon-fanout";
import type { SwingAccumRow } from "../db";
import type { SwingArchetype } from "./taxonomy";
import { persistenceRuleFor } from "./taxonomy";

/** Distinct session days a CROSS-SESSION candidate (or an unclassified name) must persist before it can be
 *  promoted to the WATCH rail. Two is the minimum that distinguishes a real multi-session build from a
 *  one-off sighting (a single scan can only ever record one distinct day). Event/immediate archetypes use
 *  a lower floor + corroboration instead — see `ARCHETYPE_PERSISTENCE` in taxonomy.ts and the header.
 *  Provisional — never a graduated edge, just the persistence floor. */
export const MIN_PERSISTENCE_SESSIONS = 2;

/** The PR-10 db.ts accessor surface this store drives. Injected so persistence policy is testable without a
 *  live DB. Shapes mirror the exported accessor signatures exactly (direction lowercased at the boundary). */
export interface SwingAccumAccessors {
  upsertSwingAccum(a: {
    ticker: string;
    direction: "long" | "short";
    session_day: string;
    phase: string;
    /** Screen provenance (FLOW / STRUCTURE / CATALYST) accreted into `signal_kinds` — the corroboration set. */
    signal_kinds?: string[];
  }): Promise<void>;
  fetchAccumulating(minSessionDays?: number, limit?: number): Promise<SwingAccumRow[]>;
  markAccumPromoted(ticker: string, direction: "long" | "short", positionId: number): Promise<void>;
  fadeStaleAccum(beforeIso: string): Promise<number>;
}

/** One per-scan sighting: this (ticker, direction) thesis was observed on `sessionDay` during `phase`. */
export interface SwingAccumObservation {
  ticker: string;
  direction: PlayDirection;
  /** ET calendar session day (YYYY-MM-DD) — the distinct-day key that measures persistence. */
  sessionDay: string;
  /** Discovery CADENCE phase tag (POST_CLOSE first; see discovery.ts) — accreted into `phases_seen`. Provenance
   *  only; NOT the corroboration axis. */
  phase: string;
  /** SCREEN provenance this sighting carried (FLOW / STRUCTURE / CATALYST) — accreted into `signal_kinds`, the
   *  independent-signal set corroboration counts. Omitted/empty for a sighting with no screen provenance. */
  signalKinds?: string[];
}

/** A candidate that has cleared the cross-session persistence bar — eligible for the WATCH rail. */
export interface SwingWatchCandidate {
  ticker: string;
  direction: PlayDirection;
  observationCount: number;
  distinctSessionDays: number;
  phasesSeen: string[];
  /** The distinct screen provenances (FLOW / STRUCTURE / CATALYST) the name accreted — its corroboration set. */
  signalKinds: string[];
  lastSessionDay: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

const toStoreDir = (d: PlayDirection): "long" | "short" => (d === "LONG" ? "long" : "short");
/** Table direction → PlayDirection. Exported so the discovery shell can key its dossier map by it. */
export const fromStoreDir = (d: "long" | "short"): PlayDirection => (d === "long" ? "LONG" : "SHORT");

/** The row fields the persistence predicate reads. `distinct_session_days` is always present;
 *  `observation_count`/`signal_kinds` are optional so a bare `{ distinct_session_days }` (the
 *  cross-session path never needs corroboration signals) still typechecks at call sites/tests. */
type PersistenceRowFields = Pick<SwingAccumRow, "distinct_session_days"> &
  Partial<Pick<SwingAccumRow, "observation_count" | "signal_kinds">>;

/**
 * Corroboration = "proved twice, independently" — the substitute for a 2nd session that event/immediate
 * archetypes rely on. It is TRUE when the candidate carries ≥2 INDEPENDENT signals:
 *   - it has been seen across ≥2 distinct sessions (each session is an independent observation), OR
 *   - it showed up under ≥2 distinct signal KINDS — `signal_kinds`, the deduped set of SCREEN provenances
 *     the name surfaced under (FLOW / STRUCTURE / CATALYST): a flow print AND a structure breakout (or a
 *     grounded catalyst) land as two distinct entries. One kind = one signal = NOT corroborated.
 *
 * COUNTS signal_kinds, NOT phases_seen (fix 2026-07-24): `phases_seen` is the cadence phase/channel the
 * writers stamp (POST_CLOSE / MIDDAY / LIVE_FLOW), so counting IT let one KIND of evidence re-seen across
 * cadence windows read as two independent signals — a false corroboration that weakened the anti-lone-print
 * invariant. The screen provenance in `signal_kinds` is the honest independence axis.
 *
 * DELIBERATELY does NOT count raw `observation_count`: two prints of the SAME signal kind are still one
 * kind of evidence repeated, not two independent signals — that's exactly the lone-print class this gate
 * exists to reject. Distinct KINDS (or a 2nd session) is the bar.
 */
function hasCorroboration(row: PersistenceRowFields): boolean {
  const distinctSignalKinds = new Set(row.signal_kinds ?? []).size;
  return (Number.isFinite(row.distinct_session_days) && row.distinct_session_days >= 2) ||
    distinctSignalKinds >= 2;
}

/**
 * PURE persistence predicate: has this candidate persisted ENOUGH to promote, given its archetype?
 *
 * Cross-session archetypes (and the unclassified default) require ≥2 DISTINCT session days — a single
 * scan can only ever bump `distinct_session_days` to 1 (the PR-10 upsert increments it only when the
 * session day actually CHANGES), so a first-sighting candidate is structurally below the bar until a
 * LATER session records a second distinct day.
 *
 * Event/immediate archetypes (EVENT_DRIVEN, POST_EARNINGS_DRIFT, FAILED_BREAKDOWN) drop the floor to 1
 * distinct session BUT require corroboration — a 2nd INDEPENDENT signal in the same session. This lets a
 * post-earnings drift / catalyst / fresh reclaim promote the day it fires WITHOUT waiting for tomorrow's
 * scan, while still refusing a lone print.
 *
 * ANTI-LONE-PRINT INVARIANT: no archetype ever promotes on a single raw sighting. For cross-session
 * archetypes the 2-session floor enforces it; for event archetypes `requiresCorroboration` enforces it
 * (a lone print has 1 signal kind + 1 session → not corroborated → not promoted). See the header.
 *
 * `archetype` is passed by the caller (the accumulation row itself carries no archetype column). Omitting
 * it — or passing null — selects the conservative cross-session default, i.e. the pre-critique-#3 gate.
 */
export function meetsPersistence(
  row: PersistenceRowFields,
  archetype: SwingArchetype | null = null,
): boolean {
  // Non-finite distinct-session count is never a truthy accident.
  if (!Number.isFinite(row.distinct_session_days)) return false;

  const rule = persistenceRuleFor(archetype);

  // Cross-session archetypes: the classic gate — a real multi-session build (≥ minDistinctSessions),
  // never a first sighting. Corroboration is irrelevant here; the distinct-session count IS the proof.
  if (!rule.requiresCorroboration) {
    return row.distinct_session_days >= rule.minDistinctSessions;
  }

  // Event/immediate archetypes: promote once the (lower) session floor is met AND the thesis is
  // independently corroborated. Corroboration REPLACES the missing 2nd session — it never lowers the
  // bar to a single lone print (hasCorroboration rejects one-kind-one-session).
  return row.distinct_session_days >= rule.minDistinctSessions && hasCorroboration(row);
}

/** Record one sighting for a directional swing candidate (accretes an observation; +1 distinct day only when
 *  the session day changed — the PR-10 upsert owns that logic). Ticker is normalized upstream by the accessor.
 *  The sighting's SCREEN provenance (`signalKinds`) is accreted into the corroboration set. */
export async function observeSwingCandidate(
  accessors: SwingAccumAccessors,
  obs: SwingAccumObservation,
): Promise<void> {
  await accessors.upsertSwingAccum({
    ticker: obs.ticker.toUpperCase(),
    direction: toStoreDir(obs.direction),
    session_day: obs.sessionDay,
    phase: obs.phase,
    signal_kinds: obs.signalKinds,
  });
}

const mapWatchRow = (r: SwingAccumRow): SwingWatchCandidate => ({
  ticker: r.ticker.toUpperCase(),
  direction: fromStoreDir(r.direction),
  observationCount: r.observation_count,
  distinctSessionDays: r.distinct_session_days,
  phasesSeen: r.phases_seen ?? [],
  signalKinds: r.signal_kinds ?? [],
  lastSessionDay: r.last_session_day,
  firstSeenAt: r.first_seen_at,
  lastSeenAt: r.last_seen_at,
});

/** The lowest distinct-session floor any archetype can promote at (event/immediate archetypes = 1).
 *  Used as the DB pre-fetch floor when a per-candidate archetype resolver is supplied, so a 1-session
 *  event candidate isn't excluded by the scalar DB filter before its per-archetype rule is applied. */
export const MIN_EVENT_PERSISTENCE_SESSIONS = 1;

/**
 * Fetch the candidates eligible for the WATCH rail — accumulating (not yet promoted) AND past the
 * persistence bar. `meetsPersistence` is the authority on the bar (per-archetype); the DB accessor's
 * `distinct_session_days >= floor` filter is only a coarse pre-narrow.
 *
 * Pass `archetypeOf` to make promotion ARCHETYPE-AWARE: event/immediate archetypes may clear on a single
 * corroborated session, so we fetch at the global minimum floor (1) and let `meetsPersistence` apply the
 * real per-archetype rule — otherwise the scalar DB filter would drop those candidates before we could
 * classify them. WITHOUT a resolver the behavior is the conservative cross-session default (≥2 distinct
 * sessions for every candidate): `meetsPersistence(r, null)` re-applies the 2-session floor defensively so
 * a laxer accessor default can't leak a one-session candidate onto the rail.
 */
export async function fetchWatchEligible(
  accessors: SwingAccumAccessors,
  minSessions: number = MIN_PERSISTENCE_SESSIONS,
  limit = 500,
  archetypeOf?: (c: { ticker: string; direction: PlayDirection }) => SwingArchetype | null,
): Promise<SwingWatchCandidate[]> {
  const fetchFloor = archetypeOf ? MIN_EVENT_PERSISTENCE_SESSIONS : minSessions;
  const rows = await accessors.fetchAccumulating(fetchFloor, limit);
  return rows
    .filter((r) =>
      meetsPersistence(
        r,
        archetypeOf
          ? archetypeOf({ ticker: r.ticker.toUpperCase(), direction: fromStoreDir(r.direction) })
          : null,
      ),
    )
    .map(mapWatchRow);
}

/** Link a candidate to the position it promoted into (stops it counting as a fresh candidate). PR-13+ wires
 *  this once positions actually persist; exposed here so the store owns the full accretion→promotion lifecycle. */
export async function promoteSwingCandidate(
  accessors: SwingAccumAccessors,
  ticker: string,
  direction: PlayDirection,
  positionId: number,
): Promise<void> {
  await accessors.markAccumPromoted(ticker.toUpperCase(), toStoreDir(direction), positionId);
}

/** Fade candidates that stopped showing up (unpromoted rows not seen since `beforeIso`). Returns the count. */
export async function fadeStaleSwingCandidates(
  accessors: SwingAccumAccessors,
  beforeIso: string,
): Promise<number> {
  return accessors.fadeStaleAccum(beforeIso);
}
