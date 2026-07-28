/**
 * Pure session/UI helpers for the 0DTE Command Deck — default filter, mark-stream badge,
 * and preferred play selection. Split out of React modules so they unit-test without DOM.
 */

export type DeckStatusFilter = "ALL" | "OPEN" | "WATCH" | "CLOSED";

export type DeckSessionHeatState =
  | "CLOSED"
  | "PRE_MARKET"
  | "OPENING_DRIVE"
  | "RTH"
  | "POWER_HOUR"
  | "LATE_SESSION"
  | string
  | null
  | undefined;

/** True when the board heat (or ET clock fallback) says the cash session is live/warming. */
export function isZeroDteSessionActive(
  heatState: DeckSessionHeatState,
  etMinutes?: number,
): boolean {
  const h = String(heatState ?? "").toUpperCase();
  if (
    h === "RTH" ||
    h === "OPENING_DRIVE" ||
    h === "POST_COMMIT" ||
    h === "POWER_HOUR" ||
    h === "LATE_SESSION"
  ) {
    return true;
  }
  if (h === "CLOSED" || h === "PRE_MARKET") return false;
  // Heat unknown — fall back to ET clock (09:25–16:00).
  if (etMinutes == null || !Number.isFinite(etMinutes)) return false;
  return etMinutes >= 9 * 60 + 25 && etMinutes < 16 * 60;
}

/**
 * Default status filter for the left rail:
 *  - During RTH: OPEN if any working plays, else WATCH (so members see actionable tape first)
 *  - After close / weekend: ALL (closed book + remaining watches visible together)
 */
export function defaultZeroDteStatusFilter(opts: {
  heatState?: DeckSessionHeatState;
  open: number;
  watch: number;
  etMinutes?: number;
}): DeckStatusFilter {
  if (isZeroDteSessionActive(opts.heatState, opts.etMinutes)) {
    if (opts.open > 0) return "OPEN";
    if (opts.watch > 0) return "WATCH";
    return "ALL";
  }
  return "ALL";
}

export type MarkStreamKind = "LIVE" | "SYNC" | "STALE" | "CLOSED" | "NONE";

/**
 * Honest mark-stream badge. Never paints LIVE when the session is closed or the quote is
 * sync/stale — that was the "looks broken" after-hours failure mode.
 */
export function markStreamKind(opts: {
  live: boolean;
  sync: boolean;
  stale: boolean;
  playClosed: boolean;
  sessionClosed: boolean;
  hasMark: boolean;
}): MarkStreamKind {
  if (opts.live) return "LIVE";
  if (opts.playClosed) return "CLOSED";
  if (opts.sessionClosed && !opts.live) return "CLOSED";
  if (opts.stale) return "STALE";
  if (opts.sync && opts.hasMark) return "SYNC";
  if (opts.hasMark) return "SYNC";
  return "NONE";
}

/** Prefer working → watch → closed when picking the initial selected play. */
export function preferredPlayId<T extends { id: string; status: string }>(plays: T[]): string | null {
  if (plays.length === 0) return null;
  const rank = (s: string) => {
    const u = s.toUpperCase();
    if (u === "OPEN" || u === "HOLD" || u === "TRIM") return 0;
    if (u === "WATCH") return 1;
    if (u === "SKIP") return 2;
    if (u === "CLOSED") return 3;
    return 4;
  };
  let best = plays[0]!;
  for (const p of plays) {
    if (rank(p.status) < rank(best.status)) best = p;
  }
  return best.id;
}
