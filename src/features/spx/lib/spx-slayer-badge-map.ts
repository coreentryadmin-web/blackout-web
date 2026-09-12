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
    // BUG FOUND 2026-09-12 (Ask Largo × Night Hawk standing mandate, 5-engine health sweep):
    // this used to read `payload.idle_message ?? "SPX Slayer desk unavailable"` — but
    // `idle_message` is deliberately left `null` on the CLOSED-SESSION terminal branch
    // (spx-play-engine.ts's `evaluateSpxPlayCore`, the `!desk.market_open && !premarket` path)
    // even though that SAME branch sets a perfectly good, specific `headline: "Session closed"`.
    // The two `available:false` payload builders that actually run in production both carry a
    // real, non-generic `headline` (the other is "Desk warming — play state unavailable", where
    // idle_message already equals headline, so this change is a no-op there) — so preferring
    // `headline` before the last-resort generic string costs nothing on the paths that already
    // worked and fixes the one that didn't.
    //
    // Blast radius: this is EVERY evening (~4pm-6:30am PT) and all weekend, whenever there is no
    // open play — i.e. most hours in a week. Confirmed live 2026-09-12 (Saturday):
    // GET /api/market/zerodte/board -> spx_slayer_badge.headline: "Session closed" but
    // .unavailable_reason: "SPX Slayer desk unavailable" — the badge's own tooltip (`title` in
    // zerodte-board-strips.tsx's SpxSlayerBadgeStrip) told the member the desk was BROKEN
    // ("unavailable... retrying" is the sibling string's own connotation) on every single routine
    // market-closed render, discarding the honest, already-computed "Session closed" reason that
    // sat right next to it in the same payload.
    //
    // `||` (not `??`) guards against a theoretical empty-string headline the same way the final
    // generic fallback does — `SpxPlayPayload.headline` is typed as a required `string`, but
    // nothing enforces it is non-empty at every call site, so this never regresses to a blank
    // tooltip even in that hypothetical case.
    unavailable_reason: payload.available
      ? null
      : payload.idle_message || payload.headline || "SPX Slayer desk unavailable",
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
