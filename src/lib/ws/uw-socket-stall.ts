/**
 * Pure helpers for the UW multiplex-socket stall watchdog. Alias-free so they
 * are unit-testable under `tsx --test` without resolving the @/ alias or pulling
 * in the live WebSocket manager.
 */

import { isWsUpdatedAtFresh } from "./timestamp-freshness";

/** Stall window during RTH: OPEN socket with no delivery for this long is half-open. */
export const UW_SOCKET_STALL_MS = 75_000;

/** Off-hours stall window — price-only traffic is sparser AH, use a wider window. */
export const UW_SOCKET_STALL_OFFHOURS_MS = 5 * 60_000;

/**
 * Grace period for first message after connect. UW silently accepts duplicate
 * API-key connections but never sends data on them — after this many ms with
 * zero messages the socket is treated as dead so the stall watchdog tears it
 * down and reconnects (giving the leader lock a chance to cycle).
 */
export const UW_SOCKET_FIRST_MSG_GRACE_MS = 30_000;

/**
 * Off-hours first-message grace. During RTH, 30s of total silence right after
 * connect is a real signal (a healthy multiplex should see SOMETHING that
 * fast). Off-hours (evenings, weekends), flow/options traffic can legitimately
 * be silent far longer than 30s while the price channel itself may also be
 * quiet (e.g. a full weekend market closure) — using the RTH-tuned 30s grace
 * here produced a genuine reconnect-storm bug: a socket that connects, gets
 * zero messages within 30s (expected off-hours), tears down, reconnects, and
 * repeats every ~44s indefinitely (measured live 2026-09-20: 6+ continuous
 * hours of `[uw-socket] stall watchdog — OPEN 44s with ZERO messages` on a
 * Sunday, hundreds of reconnect attempts against UW's own connection slot —
 * the exact "API-key contention" the log line speculatively blames, self-
 * inflicted by reconnecting too eagerly). Mirrors the already-existing
 * RTH-vs-off-hours split on `UW_SOCKET_STALL_MS`/`UW_SOCKET_STALL_OFFHOURS_MS`
 * for the "has delivered before" case — this constant closes the same gap for
 * the "never delivered" case, which that split never covered.
 */
export const UW_SOCKET_FIRST_MSG_GRACE_OFFHOURS_MS = 5 * 60_000;

/**
 * Newest last-delivery timestamp across the supplied channels, or null when
 * none of them has ever delivered. `activeChannels` should be the channels that
 * currently have handlers — channels nobody listens to must not keep the socket
 * alive nor force a reconnect.
 */
export function freshestMessageAt(
  lastMessageAt: Partial<Record<string, number>>,
  activeChannels: readonly string[]
): number | null {
  let freshest: number | null = null;
  for (const ch of activeChannels) {
    const at = lastMessageAt[ch];
    if (typeof at === "number" && (freshest == null || at > freshest)) {
      freshest = at;
    }
  }
  return freshest;
}

/**
 * Whether an OPEN socket should be treated as stalled.
 *
 * Two modes:
 * 1. Has delivered before: stalled if freshest delivery > `stallMs` ago.
 * 2. Never delivered (freshest == null): stalled if the socket has been open
 *    longer than `firstMsgGraceMs` — catches UW silently accepting a duplicate
 *    API-key connection and never sending data.
 */
export function isUwSocketStalled(
  freshest: number | null,
  stallMs: number,
  now: number,
  openedAt?: number | null,
  firstMsgGraceMs?: number
): boolean {
  if (freshest != null) return !isWsUpdatedAtFresh(freshest, stallMs, now);
  if (openedAt != null && firstMsgGraceMs != null) {
    return now - openedAt > firstMsgGraceMs;
  }
  return false;
}

/** Merge local (this replica) and cluster (Redis leader heartbeat) delivery times. */
export function mergeFreshestTimestamps(local: number | null, cluster: number | null): number | null {
  if (local == null) return cluster;
  if (cluster == null) return local;
  return Math.max(local, cluster);
}
