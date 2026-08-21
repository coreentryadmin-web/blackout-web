/**
 * GATE RULES — the thresholds themselves, not the decisions they produced.
 *
 * MEASURED LIVE 2026-08-10. Asked to name the gate that should have caught a losing trade, Largo
 * produced this, with real evidence and high stated confidence:
 *
 *   "The gate that should have caught this: Tape-mixed gate — the engine's own rule that
 *    'Cold BUY requires grade A or better AND tape must be clean (not mixed)'. Trade #47 violated
 *    this by committing cold despite mixed signals."
 *
 * There is no such rule. The real one is GRADE-SCALED:
 *
 *   mixedTapeBlockThreshold(grade, absScore)
 *     rank >= A ? base + 1 : rank >= B ? base : max(3, base - 1)
 *
 * An A setup tolerates MORE conflict before the block fires. Trade #47 was grade A / score 78; the
 * snapshots Largo cited as contradictory scored 26-44, where the threshold is lower. A grade-A play
 * passing while lower-graded ones were blocked in the same session is the DESIGNED behaviour, not a
 * contradiction.
 *
 * WHY IT GOT THERE. Largo can see `get_scan_rejections` and `get_spx_engine_snapshots` — what was
 * blocked and what the engine said — but it could not see the RULE. So it reasoned backwards from
 * outcomes to a plausible rule, and the reconstruction was wrong while every quoted fact was right.
 * Nothing in the answer looks uncertain, because the evidence is all real. That is the most
 * dangerous shape an answer can have: a confident, well-sourced, fabricated cause for a real loss.
 *
 * This module closes it by reading the REAL threshold functions at call time. Nothing is
 * reimplemented and no number is hard-coded — if a threshold changes, this changes with it, because
 * it IS the same function. A copy would drift and reintroduce exactly the problem it fixes.
 */

import {
  playMinGradeRank,
  playBuyCooldownSec,
  playBuyCooldownAplusBypass,
  playGexStaleMaxSec,
  playCooldownAfterStopMin,
  playWeightedConflictBlockMin,
} from "@/features/spx/lib/spx-play-config";
import { mixedTapeBlockThreshold } from "@/features/spx/lib/spx-play-gates";
// Largo product contract C1: an ET stamp and an ET session date, from the SHARED helpers
// (bar-session-date.ts, #2418) rather than a local Intl call — one definition of "what
// session is it" across every lane, so two tools can never disagree about today.
import { etSessionDate, etStamp } from "@/lib/largo/temporal/bar-session-date";

/** Grades the mixed-tape threshold is reported for. Ordered strongest-first. */
const GRADES = ["A+", "A", "B", "C"] as const;

export type GateRules = {
  /** UTC instant this snapshot was taken. */
  as_of: string;
  /**
   * The SAME instant in ET, and the ET trading session these rules govern.
   *
   * WHY BOTH, AND WHY THEY ARE NOT REDUNDANT. `as_of` alone is a bare UTC instant, and
   * these rules are read to answer "why was X blocked in TODAY'S session". Between roughly
   * 20:00 ET and midnight the UTC date is already TOMORROW, so a model resolving "today"
   * from `as_of` lands a full session ahead and attributes today's gate decisions to a
   * session that has not happened. That is not hypothetical: the same shape had
   * `largo-live-feed.ts` date a live SPX figure to the next day, conclude today's close
   * belonged to an earlier session, and fabricate one.
   */
  as_of_et: string | null;
  session_date: string | null;
  /**
   * The mixed-tape block, per grade, WITH the strong-conviction variant.
   *
   * Reported as a table rather than a sentence because the scaling is the whole point: quoting a
   * single number invites the same "the rule is X" reconstruction that got this wrong.
   */
  mixed_tape_block_threshold: Array<{
    grade: string;
    weighted_conflicts_at_or_above_blocks: number;
    with_strong_conviction_score_58_plus: number;
    note: string;
  }>;
  min_grade_rank: number;
  buy_cooldown_sec: number;
  buy_cooldown_a_plus_bypass: boolean;
  cooldown_after_stop_min: number;
  gex_stale_max_sec: number;
  weighted_conflict_block_base: number;
  /** Read this before quoting any of the above as "the rule". */
  interpretation: string[];
};

/**
 * Snapshot the live gate configuration.
 *
 * Every value comes from the function the engine itself calls, so this cannot report a rule the
 * engine does not enforce.
 */
export function gateRulesForLargo(): GateRules {
  const base = playWeightedConflictBlockMin();
  const nowMs = Date.now();
  return {
    as_of: new Date(nowMs).toISOString(),
    as_of_et: etStamp(nowMs),
    session_date: etSessionDate(nowMs),
    mixed_tape_block_threshold: GRADES.map((grade) => ({
      grade,
      weighted_conflicts_at_or_above_blocks: mixedTapeBlockThreshold(grade),
      with_strong_conviction_score_58_plus: mixedTapeBlockThreshold(grade, 58),
      note:
        grade === "A+" || grade === "A"
          ? "A-rank setups tolerate one MORE conflicting signal than B before the block fires."
          : grade === "B"
            ? "B sits at the base threshold."
            : "Below B the threshold is tighter — these block sooner.",
    })),
    min_grade_rank: playMinGradeRank(),
    buy_cooldown_sec: playBuyCooldownSec(),
    buy_cooldown_a_plus_bypass: playBuyCooldownAplusBypass(),
    cooldown_after_stop_min: playCooldownAfterStopMin(),
    gex_stale_max_sec: playGexStaleMaxSec(),
    weighted_conflict_block_base: base,
    interpretation: [
      "The mixed-tape block is GRADE-SCALED, not absolute. A grade-A play committing while a " +
        "grade-C play was blocked for 'Tape's mixed' in the same session is CORRECT behaviour — " +
        "the threshold is higher for A. Do not report that as a gate violation.",
      "A block message in a scan rejection or engine snapshot tells you a gate fired for THAT " +
        "candidate at THAT score and grade. It does not tell you the rule. Read the thresholds " +
        "here before attributing a loss to a gate that 'should have caught it'.",
      "These are the SPX Slayer play gates. 0DTE Command's commit gate (confluence-2), the " +
        "Cortex veto and the fail-closed firewall are separate systems with their own rules.",
      "Date these rules by `session_date` (the ET trading session), never by `as_of` — after " +
        "20:00 ET the UTC date in `as_of` is already the NEXT calendar day, and reading it as " +
        "'today' attributes this session's gate decisions to a session that has not happened.",
    ],
  };
}
