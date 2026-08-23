/**
 * Resolve UW flow print timestamps from persisted columns + raw_payload.
 * Shared by Postgres reads and tests — mirrors flow-persist.ts ingest logic.
 */

export type FlowTimestampInput = {
  created_at?: string | Date | null;
  inserted_at?: string | Date | null;
  raw_payload?: Record<string, unknown> | null;
};

export type ResolvedFlowTimes = {
  /** Real UW print time when known; null otherwise. */
  event_at: string | null;
  /** Tape display time — event_at, else ingest time when UW gave none. */
  display_at: string | null;
  /** True when display_at is inserted_at (not a UW print timestamp). */
  tape_time_estimated: boolean;
};

/**
 * Plausible epoch bounds, as MILLISECONDS: 2001-09-09 .. 2286-11-20. Anything outside is not a
 * time we should be inventing from a number — better `null` than a print stamped in 1970.
 */
const EPOCH_MS_MIN = 1_000_000_000_000;
const EPOCH_MS_MAX = 9_999_999_999_999;

/**
 * Epoch → milliseconds, by MAGNITUDE rather than by assuming a unit.
 *
 * UW is not consistent about this. On the very same `flow-alerts` payload, `created_at` is an ISO
 * string (`"2026-08-21T20:14:37.211537Z"`) while `start_time` is epoch MILLISECONDS
 * (`1787343258239`) — captured live 2026-08-23. This file already knew that: the `start_time`
 * branch below has always coerced numerically. Only `created_at` / `executed_at` were assumed to
 * be date strings, which is the assumption this fixes.
 *
 * Scaling by magnitude covers seconds, milliseconds, microseconds and nanoseconds without needing
 * to know which one arrived — the point being that we should not have to know.
 */
function epochToMs(n: number): number | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  let ms = n;
  // Nanoseconds (~1e18) and microseconds (~1e15) scale down; seconds (~1e9) scale up.
  if (ms >= 1e17) ms = Math.floor(ms / 1e6);
  else if (ms >= 1e14) ms = Math.floor(ms / 1e3);
  else if (ms < 1e11) ms = Math.floor(ms * 1000);
  return ms >= EPOCH_MS_MIN && ms <= EPOCH_MS_MAX ? ms : null;
}

/**
 * Parse a UW timestamp that may be an ISO string OR an epoch number.
 *
 * ── THE DEFECT THIS FIXES ───────────────────────────────────────────────────────────────────────
 *
 * This function used to be `new Date(String(value))` and nothing else. `new Date("1787343258239")`
 * is **Invalid Date** — a numeric string is not a date string — so an epoch arriving under
 * `created_at` or `executed_at` silently produced `null`, and the row lost its print time.
 *
 * MEASURED on the live member tape, 5000 rows / 168h, 2026-08-23: **3500 rows (70%) carry no
 * `event_at`**, and `event_at` is present on a row **if and only if** `alert_rule` is (SPX 39/39,
 * SPY 82/82). `alert_rule` comes only from the `flow_alerts` channel; the other 3500 carry
 * `implied_volatility`, whose ONLY writer in this codebase is `optionTradePrintToFlowRaw` — the
 * `option_trades` WS path. That path DROPS any print with a falsy `executed_at`, and stamps both
 * `created_at` and `executed_at` from it. So every one of those 3500 rows arrived WITH a truthy
 * `executed_at` that `new Date()` could not parse.
 *
 * ── WHY IT MATTERS FAR BEYOND A MISSING FIELD ───────────────────────────────────────────────────
 *
 * `flowEventTimeMs` returns null without `event_at`, and BOTH persisted HELIX signals filter on it
 * — `detectVelocitySpikes` skips such rows outright, `detectSplitFlow` filters on the same. So the
 * population carrying **92.1% of all tape premium** is structurally incapable of firing either
 * signal, while dominating every premium panel. HELIX-MAP §4A records that as a property of the
 * feed. On this evidence it is not: it is a parse.
 *
 * ── WHAT IS DEDUCED vs MEASURED ─────────────────────────────────────────────────────────────────
 *
 * Measured: the row counts, the iff-relationship, IV's single writer, and that
 * `new Date("1787343258239")` is invalid. Deduced: that the unparseable value is specifically an
 * epoch. The market was closed, so the live `option_trades` frame could not be captured to name
 * the wire format outright. **That is why this parses by magnitude rather than to one assumed
 * unit** — the fix is correct for seconds, ms, µs, ns AND for the ISO case that already worked,
 * so it does not rest on the deduction being exactly right.
 */
function toIso(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null;

  // A number, or a string that is only digits, is an epoch — never a date string.
  if (typeof value === "number" || (typeof value === "string" && /^\d+$/.test(value.trim()))) {
    const ms = epochToMs(Number(value));
    return ms == null ? null : new Date(ms).toISOString();
  }

  const d = new Date(String(value));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/** Extract the real UW alert time from a raw alert/print payload. */
export function extractUwTimestampFromRaw(raw: Record<string, unknown> | null | undefined): string | null {
  if (!raw) return null;
  const fromCreated = toIso(raw.created_at);
  if (fromCreated) return fromCreated;
  const fromExecuted = toIso(raw.executed_at);
  if (fromExecuted) return fromExecuted;
  // `start_time` always was an epoch and always had its own coercion — now the SAME one, so the
  // three fields cannot disagree about what a number means. Its old `> 1e12` heuristic silently
  // produced a 1970 date for anything smaller than a second-epoch; `epochToMs` returns null there
  // instead, because a fabricated 1970 print time is worse than an absent one.
  const fromStart = toIso(raw.start_time);
  if (fromStart) return fromStart;
  return null;
}

export function resolveFlowTimes(input: FlowTimestampInput): ResolvedFlowTimes {
  const fromColumn = toIso(input.created_at);
  const fromRaw = extractUwTimestampFromRaw(
    input.raw_payload && typeof input.raw_payload === "object" ? input.raw_payload : null
  );
  const event_at = fromColumn ?? fromRaw;
  const ingest_at = toIso(input.inserted_at);
  if (event_at) {
    return { event_at, display_at: event_at, tape_time_estimated: false };
  }
  if (ingest_at) {
    return { event_at: null, display_at: ingest_at, tape_time_estimated: true };
  }
  return { event_at: null, display_at: null, tape_time_estimated: false };
}

/** Milliseconds for LIVE / freshness — real UW time only, never ingest fallback. */
export function flowEventTimeMs(flow: {
  event_at?: string | null;
  alerted_at?: string | null;
  tape_time_estimated?: boolean;
}): number | null {
  const iso = flow.event_at ?? (flow.tape_time_estimated ? null : flow.alerted_at);
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : null;
}
