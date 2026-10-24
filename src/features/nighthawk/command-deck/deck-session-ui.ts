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

/**
 * Cross-deck / URL-seeded ticker focus (`focusTicker`, e.g. `/nighthawk?ticker=AAPL`, or a
 * Legacy "moved to Swings Open" link): which play a focus request should select and open on
 * mobile, decoupled from whatever `selId` happens to be right now.
 *
 * The naive guard this replaced was `selId !== match.id` — "only act if the selection would
 * actually change." That misreads a COINCIDENTAL match as "already handled": the board's own
 * default-selection effect (`preferredPlayId`, prefer OPEN/HOLD first) can independently land
 * on the exact ticker a focus request names — e.g. a top-ranked committed position is both the
 * default pick AND the `?ticker=` deep-link target. When that happens `selId` already equals
 * `match.id` on the FIRST render, so the old guard never fires `setMobileDetailOpen(true)`, and
 * a narrow (phone) viewport is left showing the list and detail rails stacked/overlapping
 * instead of switching to the single-column detail view — even though the right data IS
 * selected. Live repro 2026-09-13: `/nighthawk?view=swings&ticker=AAPL` at 430px, AAPL already
 * the default `selId` (rank #2 by score, also HOLD status) — CommandDeck rendered both panes.
 *
 * Tracking "have we handled THIS focusTicker value" (via `alreadyHandledFocusTicker`) instead
 * of inferring it from `selId` fixes the coincidence without reintroducing the bug this guard
 * was ALSO protecting against: re-opening the mobile detail view on every poll refresh after a
 * member has explicitly closed it (a plain `if (focusTicker)` with no memory would do that,
 * since `plays` — and therefore this effect's re-run — changes every poll).
 */
export function resolveFocusTickerMatch<T extends { id: string; ticker: string }>(
  plays: T[],
  focusTicker: string | null,
  alreadyHandledFocusTicker: string | null,
): { id: string } | null {
  if (!focusTicker || focusTicker === alreadyHandledFocusTicker) return null;
  const match = plays.find((p) => p.ticker.toUpperCase() === focusTicker.toUpperCase());
  return match ? { id: match.id } : null;
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
