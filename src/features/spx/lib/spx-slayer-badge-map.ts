/**
 * Pure DTO + mapper for the Night Hawk board's SPX Slayer badge (feat/nh-spx-badge).
 *
 * Split out of spx-slayer-badge.ts on purpose: this file imports ONLY the `SpxPlayPayload` TYPE
 * (erased at compile time, no runtime import), so it can be unit-tested directly without pulling in
 * spx-play-engine.ts's full dependency graph (which transitively hits `server-only`-guarded provider
 * modules and cannot be constructed outside a real server request). spx-slayer-badge.ts re-exports
 * everything here and adds the async, server-only snapshot loader.
 */
import type { SpxPlayPayload } from "@/features/spx/lib/spx-play-payload";

/** Minimal display DTO for the Night Hawk board's 4th badge/tile — a badge, not a full panel. */
export interface SpxSlayerBadge {
  available: boolean;
  symbol: "SPX";
  /** SCANNING (flat, no setup) / WATCHING (building) / OPEN (position live). */
  phase: SpxPlayPayload["phase"];
  /** Finer-grained than `phase` — SCANNING/WATCHING/BUY/HOLD/TRIM/SELL. */
  action: SpxPlayPayload["action"];
  direction: SpxPlayPayload["direction"];
  grade: string;
  score: number;
  headline: string;
  as_of: string;
  /** Non-null only when `available` is false — the human reason to show in the idle state. */
  unavailable_reason: string | null;
}

/** Pure mapper: SpxPlayPayload -> the board badge DTO. No I/O — unit-testable in isolation. */
export function mapSpxPlayToBadge(payload: SpxPlayPayload): SpxSlayerBadge {
  return {
    available: payload.available,
    symbol: "SPX",
    phase: payload.phase,
    action: payload.action,
    direction: payload.direction,
    grade: payload.grade,
    score: payload.score,
    headline: payload.headline,
    as_of: payload.as_of,
    unavailable_reason: payload.available ? null : payload.idle_message ?? "SPX Slayer desk unavailable",
  };
}

/** The idle/unavailable badge state — shown when SPX Slayer has no live play or the read failed. */
export function unavailableSpxSlayerBadge(reason: string): SpxSlayerBadge {
  return {
    available: false,
    symbol: "SPX",
    phase: "SCANNING",
    action: "SCANNING",
    direction: null,
    grade: "D",
    score: 0,
    headline: "SPX Slayer unavailable",
    as_of: new Date().toISOString(),
    unavailable_reason: reason,
  };
}
