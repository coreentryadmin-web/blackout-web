// src/lib/swing/accumulation-store.ts — the PRE-COMMIT persistence memory for swing discovery (PR-11).
//
// WHY THIS EXISTS (the persistence gate): a swing thesis is "a move building across DAYS," so acting on a
// name the FIRST session it surfaces is exactly the single-day amnesia the 0DTE accumulation layer was
// built to cure — a lone print looks identical to a three-day build. This store gives whole-market swing
// discovery a cross-session memory: every scan accretes ONE observation per (ticker, direction) into
// `swing_candidate_accumulation` (PR-10), and a candidate is only promotable to the WATCH rail once its
// thesis has PERSISTED across ≥2 DISTINCT session days — never on a single sighting. That is the whole
// point of the pre-commit ledger: separate "showed up once" from "keeps showing up."
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

/** Distinct session days a candidate must persist before it can be promoted to the WATCH rail. Two is the
 *  minimum that distinguishes a real multi-session build from a one-off sighting (a single scan can only
 *  ever record one distinct day). Provisional — never a graduated edge, just the persistence floor. */
export const MIN_PERSISTENCE_SESSIONS = 2;

/** The PR-10 db.ts accessor surface this store drives. Injected so persistence policy is testable without a
 *  live DB. Shapes mirror the exported accessor signatures exactly (direction lowercased at the boundary). */
export interface SwingAccumAccessors {
  upsertSwingAccum(a: {
    ticker: string;
    direction: "long" | "short";
    session_day: string;
    phase: string;
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
  /** Discovery phase tag (POST_CLOSE first; see discovery.ts) — accreted into `phases_seen`. */
  phase: string;
}

/** A candidate that has cleared the cross-session persistence bar — eligible for the WATCH rail. */
export interface SwingWatchCandidate {
  ticker: string;
  direction: PlayDirection;
  observationCount: number;
  distinctSessionDays: number;
  phasesSeen: string[];
  lastSessionDay: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

const toStoreDir = (d: PlayDirection): "long" | "short" => (d === "LONG" ? "long" : "short");
/** Table direction → PlayDirection. Exported so the discovery shell can key its dossier map by it. */
export const fromStoreDir = (d: "long" | "short"): PlayDirection => (d === "long" ? "LONG" : "SHORT");

/**
 * PURE persistence predicate: has this candidate persisted across enough distinct session days to promote?
 * A single scan can only ever bump `distinct_session_days` to 1 (the upsert only increments it when the
 * session day actually CHANGES), so a first-sighting candidate is structurally below the bar until a LATER
 * session records a second distinct day. This is the gate that keeps a lone print off the WATCH rail.
 */
export function meetsPersistence(
  row: Pick<SwingAccumRow, "distinct_session_days">,
  minSessions: number = MIN_PERSISTENCE_SESSIONS,
): boolean {
  return Number.isFinite(row.distinct_session_days) && row.distinct_session_days >= minSessions;
}

/** Record one sighting for a directional swing candidate (accretes an observation; +1 distinct day only when
 *  the session day changed — the PR-10 upsert owns that logic). Ticker is normalized upstream by the accessor. */
export async function observeSwingCandidate(
  accessors: SwingAccumAccessors,
  obs: SwingAccumObservation,
): Promise<void> {
  await accessors.upsertSwingAccum({
    ticker: obs.ticker.toUpperCase(),
    direction: toStoreDir(obs.direction),
    session_day: obs.sessionDay,
    phase: obs.phase,
  });
}

const mapWatchRow = (r: SwingAccumRow): SwingWatchCandidate => ({
  ticker: r.ticker.toUpperCase(),
  direction: fromStoreDir(r.direction),
  observationCount: r.observation_count,
  distinctSessionDays: r.distinct_session_days,
  phasesSeen: r.phases_seen ?? [],
  lastSessionDay: r.last_session_day,
  firstSeenAt: r.first_seen_at,
  lastSeenAt: r.last_seen_at,
});

/**
 * Fetch the candidates eligible for the WATCH rail — accumulating (not yet promoted) AND past the
 * persistence bar. The DB accessor already filters `distinct_session_days >= minSessions`; `meetsPersistence`
 * re-applies the same predicate defensively so a caller passing a laxer accessor default can't leak a
 * one-session candidate onto the rail.
 */
export async function fetchWatchEligible(
  accessors: SwingAccumAccessors,
  minSessions: number = MIN_PERSISTENCE_SESSIONS,
  limit = 500,
): Promise<SwingWatchCandidate[]> {
  const rows = await accessors.fetchAccumulating(minSessions, limit);
  return rows.filter((r) => meetsPersistence(r, minSessions)).map(mapWatchRow);
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
