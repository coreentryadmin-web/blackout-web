import type { PlaybookPlay } from "./types";
import {
  fetchPendingNighthawkOutcomes,
  insertAlertAuditLog,
  pruneNighthawkPlayOutcomesForEdition,
  upsertNighthawkPlayOutcomes,
  updateNighthawkPlayOutcome,
  type NighthawkPlayOutcomeRow,
} from "@/lib/db";

// Per-edition distributed lock for outcome sync.
// Prevents concurrent force-rebuilds from racing on the same upsert and
// overwriting each other's rows. One Promise chain per editionFor key.
const _syncLocks = new Map<string, Promise<void>>();
import { fetchStockDailyBars } from "@/lib/providers/polygon";
import { polygonConfigured } from "@/lib/providers/config";

// Level parsing lives in the dependency-free ./play-levels leaf so the publish-time
// geometry gate (client-bundled via play-constraints) shares the exact parser without
// dragging this module's Polygon/db imports into a client bundle.
export { parsePlayLevels, type ParsedPlayLevels } from "./play-levels";
import { parsePlayLevels } from "./play-levels";

// ── Stage 4 audit trail (alert_audit_log) ─────────────────────────────────────────
// Shape matches the alert_audit_log columns in src/lib/db.ts — mirrors
// zerodte/board.ts's buildZeroDteAuditRow. Pure function of a play + edition date +
// sector, no I/O, so it's unit-testable with fixture plays like the rest of this
// module's parsing/grading logic already is.

export type NighthawkAuditRow = {
  alert_type: "nighthawk";
  source_table: "nighthawk_play_outcomes";
  source_key: { edition_for: string; ticker: string };
  ticker: string;
  direction: "LONG" | "SHORT";
  confidence_score: number | null;
  confidence_label: string | null;
  trigger_reason: string;
  decision_trace: Array<{ check: string; passed: boolean; value: unknown; threshold: unknown }>;
  input_snapshot: Record<string, unknown>;
  final_output: Record<string, unknown>;
};

/** Build the audit-trail row for a play's FIRST publish in an edition. Every play
 *  reaching this function already survived `validatePlayGeometry()` at synthesis
 *  time (claude-edition.ts) — this scope only records the parseable-levels check,
 *  since the individual gate verdicts (geometry/premium-cap/strike-validation) are
 *  computed upstream and not yet threaded down to this call site. A richer trace
 *  (and the rejected-play half of Stage 4) is explicit follow-up work, tracked in
 *  docs/bie/AUDIT-TRAIL-SCHEMA.md — not invented here. */
export function buildNighthawkAuditRow(
  play: PlaybookPlay,
  editionFor: string,
  sector: string | null
): NighthawkAuditRow {
  const ticker = String(play.ticker ?? "").toUpperCase();
  const levels = parsePlayLevels(play);
  const direction: "LONG" | "SHORT" = String(play.direction ?? "LONG").toUpperCase().includes("SHORT")
    ? "SHORT"
    : "LONG";
  const hasGeometry = levels.target != null && levels.stop != null;
  return {
    alert_type: "nighthawk",
    source_table: "nighthawk_play_outcomes",
    source_key: { edition_for: editionFor, ticker },
    ticker,
    direction,
    confidence_score: play.score ?? null,
    confidence_label: String(play.conviction ?? "B").toUpperCase(),
    trigger_reason: "published in the Night Hawk edition (survived synthesis + trade-geometry validation)",
    decision_trace: [
      {
        check: "target_and_stop_parsed",
        passed: hasGeometry,
        value: { target: levels.target, stop: levels.stop },
        threshold: null,
      },
    ],
    input_snapshot: {
      entry_range_low: levels.entry_range_low,
      entry_range_high: levels.entry_range_high,
      target: levels.target,
      stop: levels.stop,
      score: play.score ?? null,
      sector,
    },
    final_output: {
      thesis: play.thesis,
      key_signal: play.key_signal,
      entry_range: play.entry_range,
      target: play.target,
      stop: play.stop,
      options_play: play.options_play,
      entry_premium: play.entry_premium ?? null,
    },
  };
}

/** Fire-and-forget: one audit row per FRESHLY published ticker (never on a
 *  force-rebuild refresh of an already-published play). Failures are logged,
 *  never thrown — the audit trail must not be able to break edition publishing. */
function recordNighthawkAuditTrail(
  freshTickers: Set<string>,
  plays: PlaybookPlay[],
  editionFor: string,
  sectors: Record<string, string | null | undefined>
): void {
  for (const play of plays) {
    const ticker = String(play.ticker ?? "").toUpperCase();
    if (!freshTickers.has(ticker)) continue;
    const row = buildNighthawkAuditRow(play, editionFor, sectors[ticker] ?? null);
    void insertAlertAuditLog(row).catch((err) => {
      console.warn(`[nighthawk-audit] failed to write alert_audit_log for ${ticker}:`, err);
    });
  }
}

export async function syncNighthawkPlayOutcomes(
  editionFor: string,
  plays: PlaybookPlay[],
  sectors: Record<string, string | null | undefined> = {}
): Promise<void> {
  const rows = plays.map((play) => {
    const ticker = String(play.ticker ?? "").toUpperCase();
    const levels = parsePlayLevels(play);
    const direction = String(play.direction ?? "LONG").toUpperCase().includes("SHORT") ? "SHORT" : "LONG";
    return {
      edition_for: editionFor,
      ticker,
      direction: direction as "LONG" | "SHORT",
      conviction: String(play.conviction ?? "B").toUpperCase(),
      entry_range_low: levels.entry_range_low,
      entry_range_high: levels.entry_range_high,
      target: levels.target,
      stop: levels.stop,
      score: Number(play.score ?? 0),
      sector: sectors[ticker] ?? null,
    };
  });

  // Serialize concurrent syncs for the same edition to prevent the second
  // force-rebuild from racing the first and overwriting atomically-merged fields.
  const prior = _syncLocks.get(editionFor) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => { release = resolve; });
  _syncLocks.set(editionFor, prior.then(() => next));

  try {
    await prior;
    // upsertNighthawkPlayOutcomes must use INSERT … ON CONFLICT DO UPDATE SET
    // so that each row is merged atomically in the DB rather than blindly overwritten.
    const freshlyPublished = await upsertNighthawkPlayOutcomes(rows);
    if (freshlyPublished.size > 0) {
      recordNighthawkAuditTrail(freshlyPublished, plays, editionFor, sectors);
    }
    await pruneNighthawkPlayOutcomesForEdition(editionFor, rows.map((row) => row.ticker));
  } finally {
    release();
    // Clean up the lock entry once all chains for this edition have resolved.
    if (_syncLocks.get(editionFor) === prior.then(() => next)) {
      _syncLocks.delete(editionFor);
    }
  }
}

export function outcomeSessionDate(row: Pick<NighthawkPlayOutcomeRow, "edition_for">): string {
  return row.edition_for;
}

export function resolveOutcome(row: NighthawkPlayOutcomeRow): {
  hit_target: boolean;
  hit_stop: boolean;
  outcome: "target" | "stop" | "open" | "ambiguous" | "pending" | "unfilled";
  // True when a stop level is defined but intraday high/low data is unavailable,
  // making it impossible to determine whether the stop was hit. These plays must
  // be excluded from win/loss tallies and reported separately so operators know
  // the effective sample size rather than silently inflating the win rate.
  stop_data_unavailable: boolean;
} {
  const close = row.next_day_close;
  const high = row.session_high;
  const low = row.session_low;
  const open = row.next_day_open;
  const target = row.target;
  const stop = row.stop;

  if (close == null) {
    return { hit_target: false, hit_stop: false, outcome: "pending", stop_data_unavailable: false };
  }

  const isLong = row.direction === "LONG";
  const hasIntraday = high != null && low != null;

  // FILLABILITY (grading-honesty, audit MEDIUM): the entry range is part of the
  // published play — a LONG that gaps ABOVE its band at the open and runs to target
  // was never fillable at the published entry, yet it graded "target" and its
  // return was computed FROM that unfillable entry (phantom win inflating the
  // public win rate; the mirror books phantom losses). If the session never
  // traded back into reach of the band — long: session low stayed above the top
  // of the band; short: session high stayed below the bottom — grade 'unfilled'
  // and exclude from win/loss tallies (same treatment as stop_data_unavailable).
  if (hasIntraday && row.entry_range_low != null && row.entry_range_high != null) {
    const fillable = isLong ? low! <= row.entry_range_high : high! >= row.entry_range_low;
    if (!fillable) {
      return { hit_target: false, hit_stop: false, outcome: "unfilled", stop_data_unavailable: false };
    }
  }
  // When a stop is defined but only close data is available we cannot determine
  // whether the stop was hit intraday. Flag the play so callers can exclude it
  // from win-rate calculations rather than counting it as a non-stop outcome.
  const stop_data_unavailable = stop != null && !hasIntraday;
  let hit_target = false;
  let hit_stop = false;

  if (target != null) {
    hit_target = hasIntraday
      ? isLong
        ? high! >= target
        : low! <= target
      : isLong
        ? close >= target
        : close <= target;
  }
  if (stop != null && hasIntraday) {
    hit_stop = isLong ? low! <= stop : high! >= stop;
  }

  let outcome: "target" | "stop" | "open" | "ambiguous" | "pending" | "unfilled" = "open";
  if (hit_target && hit_stop) {
    if (open != null && target != null && (isLong ? open >= target : open <= target)) {
      outcome = "target";
    } else if (open != null && stop != null && (isLong ? open <= stop : open >= stop)) {
      outcome = "stop";
    } else {
      outcome = "ambiguous";
    }
  } else if (hit_stop) {
    outcome = "stop";
  } else if (hit_target) {
    outcome = "target";
  }

  return { hit_target, hit_stop, outcome, stop_data_unavailable };
}

export async function resolvePendingNighthawkOutcomes(opts?: {
  lookbackDays?: number;
}): Promise<{ resolved: number; skipped: number; errors: string[] }> {
  if (!polygonConfigured()) {
    return { resolved: 0, skipped: 0, errors: ["Polygon not configured"] };
  }

  const lookbackDays = opts?.lookbackDays ?? 7;
  const pending = await fetchPendingNighthawkOutcomes(lookbackDays);
  let resolved = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const row of pending) {
    try {
      const sessionDate = outcomeSessionDate(row);
      const bars = await fetchStockDailyBars(row.ticker, sessionDate, sessionDate, "1");
      const bar = bars[0];
      if (!bar) {
        skipped += 1;
        continue;
      }

      const next_day_open = bar.o;
      const next_day_close = bar.c;
      const session_high = bar.h;
      const session_low = bar.l;

      const verdict = resolveOutcome({
        ...row,
        next_day_open,
        next_day_close,
        session_high,
        session_low,
      });

      await updateNighthawkPlayOutcome(row.id, {
        next_day_open,
        next_day_close,
        session_high,
        session_low,
        hit_target: verdict.hit_target,
        hit_stop: verdict.hit_stop,
        outcome: verdict.outcome,
      });
      resolved += 1;
    } catch (err) {
      errors.push(`${row.ticker}@${row.edition_for}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { resolved, skipped, errors };
}
