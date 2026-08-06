// PR-N10 — the Debrief, aggregate layer: rolling failure-mode counts, per-conviction
// (and per-tier, when a tier is ever pinned) records, counterfactual PUBLISH-GATE
// validation, and the machine-readable improvement queue.
//
// This is the Night Hawk analogue of zerodte/calibration.ts: pure core
// (analyzeNighthawkDebriefs + helpers) over rows the caller supplies, with a thin
// data layer at the bottom (buildNighthawkDebriefReport) doing dynamic RELATIVE
// imports. Same non-negotiables:
//  - LOW-N discipline is absolute: every bucket under the shared LOW_N_THRESHOLD is
//    flagged, and the improvement queue NEVER attaches a suggestion to low-n evidence
//    (the item still appears, suggestion: null — visible, not actionable).
//  - Anti-blend (#333): every record-shaped number is computed over CURRENT-methodology
//    rows only; legacy-graded rows are counted (`legacy_excluded`) and never bucketed.
//  - Counterfactuals are read from what the debrief cron PERSISTED (debrief-persist.ts
//    grades gate-blocked plays with the same daily-bar path grading uses) — this module
//    never grades anything itself, so the report is a pure read.

import type { NighthawkPlayOutcomeRow } from "@/lib/db";
// The one platform-wide LOW-N disclosure threshold (zerodte/record.ts) — same flag the
// 0DTE calibration report and the NH record cuts already use.
import { LOW_N_THRESHOLD } from "@/lib/zerodte/record";
import { isCurrentGradeMethodology } from "./grade-methodology";
import {
  DEBRIEF_FAILURE_MODES,
  type DebriefFailureMode,
} from "./debrief";
import { GATE_BAND_MAX_DISTANCE_PCT, GATE_TARGET_MAX_ATR_MULTIPLE } from "./publish-gates";
import { targetAtrHistogram, type TargetAtrHistogramBin } from "./target-reachability";

export const NIGHTHAWK_DEBRIEF_METHODOLOGY =
  "Night Hawk session debrief over graded outcome rows (v2 fillability grades only — legacy-" +
  "methodology rows are counted but never bucketed, #333 anti-blend). Failure modes come from " +
  "each row's pinned debrief (first-write-wins, written by the outcomes cron after grading). " +
  "Publish-gate blocked value grades the gate-rejected plays counterfactually on the SAME " +
  "next-session daily bar the grader uses (underlying level-touch basis — option premium is " +
  "never fabricated); the published mirror re-applies each gate to the publish geometry of " +
  "plays that DID publish, using the threshold PINNED with that play (falling back to the live " +
  "constant only for pins that predate gate pinning) so the mirror is a fixed historical " +
  "baseline rather than a figure that silently rewrites itself when a constant moves. " +
  "Every win rate here is taken over DECIDED rows (wins+losses) only: never-fillable " +
  "('unfilled') and no-touch (open/ambiguous) plays are counted and reported but NEVER enter " +
  "a rate — the mirror carries the unfilled share as its own separate read, which is the only " +
  "lane in which the band_detached gate can be measured at all. " +
  "Buckets under n=" +
  `${LOW_N_THRESHOLD} are low_n and never produce a suggestion.`;

const round1 = (v: number): number => Math.round(v * 10) / 10;
const round2 = (v: number): number => Math.round(v * 100) / 100;

// ── Row/pin shapes ──────────────────────────────────────────────────────────────────

/** The outcome-row slice the aggregate reads (structural subset so tests build small
 *  fixtures). `debrief` is the JSONB pin from debrief-persist.ts. */
export type DebriefAggregateRow = Pick<
  NighthawkPlayOutcomeRow,
  | "edition_for"
  | "ticker"
  | "direction"
  | "conviction"
  | "outcome"
  | "pulled"
  | "grade_methodology"
  | "publish_context"
  | "entry_range_low"
  | "entry_range_high"
  | "target"
  | "stop"
  | "debrief"
>;

/** Structural read of a pinned debrief — only the fields aggregation needs. A blob
 *  without a recognizable version + taxonomy tag is "no debrief on record", never a
 *  guess (same never-trust-a-JSON-column rule as every other pin reader). */
export function readPinnedDebriefTag(raw: unknown): DebriefFailureMode | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const d = raw as Record<string, unknown>;
  if (typeof d.debrief_version !== "number" || !Number.isFinite(d.debrief_version)) return null;
  const fm = d.failure_mode;
  if (fm == null || typeof fm !== "object") return null;
  const tag = (fm as Record<string, unknown>).tag;
  return typeof tag === "string" && (DEBRIEF_FAILURE_MODES as readonly string[]).includes(tag)
    ? (tag as DebriefFailureMode)
    : null;
}

/** Pinned publish-context tier, when one exists. The tier engine (PR-N7) pins
 *  `tier: { tier: NighthawkTier, factors: [...] }` (publish-context.ts), NOT a bare
 *  string — this used to check `typeof t === "string"` against that object and always
 *  returned null, silently keeping `by_tier` empty since the tier engine shipped. */
export function readPinnedTier(publishContext: unknown): string | null {
  if (publishContext == null || typeof publishContext !== "object" || Array.isArray(publishContext)) return null;
  const t = (publishContext as Record<string, unknown>).tier;
  if (t == null || typeof t !== "object" || Array.isArray(t)) return null;
  const letter = (t as Record<string, unknown>).tier;
  return typeof letter === "string" && letter.length > 0 ? letter.toUpperCase() : null;
}

// ── Summary (also served on the member record route — compact, segments-aware) ──────

export type DebriefTagCount = { tag: DebriefFailureMode; n: number };

export type NighthawkDebriefRecordSummary = {
  /** Current-methodology graded rows in the window (the anti-blend base). */
  graded: number;
  /** Of those, rows carrying a readable debrief pin. */
  debriefed: number;
  /** Distinct sessions (edition_for) among the debriefed rows. */
  sessions: number;
  /** Non-zero failure-mode counts, n desc then tag asc (stable machine shape). */
  failure_modes: DebriefTagCount[];
  /** Graded rows excluded for non-current grade methodology (#333 quarantine). */
  legacy_excluded: number;
  /** Current graded rows with no debrief pin yet (cron hasn't visited / pre-N10). */
  unpinned: number;
  /** debriefed < LOW_N_THRESHOLD — consumers must badge; nothing here is a record yet. */
  low_n: boolean;
};

/** Failure-mode counts over CURRENT-methodology graded rows only. Pure. */
export function summarizeDebriefPins(rows: DebriefAggregateRow[]): NighthawkDebriefRecordSummary {
  const graded = rows.filter((r) => r.outcome !== "pending");
  const current = graded.filter((r) => isCurrentGradeMethodology(r.grade_methodology));
  const counts = new Map<DebriefFailureMode, number>();
  const sessions = new Set<string>();
  let debriefed = 0;
  for (const row of current) {
    const tag = readPinnedDebriefTag(row.debrief ?? null);
    if (tag == null) continue;
    debriefed += 1;
    sessions.add(row.edition_for);
    counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  const failure_modes = Array.from(counts.entries())
    .map(([tag, n]) => ({ tag, n }))
    .sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag));
  return {
    graded: current.length,
    debriefed,
    sessions: sessions.size,
    failure_modes,
    legacy_excluded: graded.length - current.length,
    unpinned: current.length - debriefed,
    low_n: debriefed < LOW_N_THRESHOLD,
  };
}

// ── Per-conviction / per-tier records ───────────────────────────────────────────────

export type DebriefGroupRecord = {
  key: string;
  n: number;
  /** Scoreable = excludes unfilled + pulled (same denominator rule as analytics.ts). */
  scoreable: number;
  wins: number;
  losses: number;
  /** wins + losses — the ONLY honest win-rate denominator (see groupRecord). */
  decided: number;
  /** Scoreable rows that touched NEITHER level (open + ambiguous). Reported so the
   *  gap between `scoreable` and `decided` is never something a reader has to infer. */
  undecided: number;
  unfilled: number;
  pulled: number;
  win_rate_pct: number | null;
  /** The group's most frequent debriefed failure mode (ties break lexicographically). */
  dominant_failure_mode: DebriefFailureMode | null;
  low_n: boolean;
};

function groupRecord(key: string, rows: DebriefAggregateRow[]): DebriefGroupRecord {
  const scoreable = rows.filter((r) => r.outcome !== "unfilled" && r.pulled !== true);
  const wins = scoreable.filter((r) => r.outcome === "target").length;
  const losses = scoreable.filter((r) => r.outcome === "stop").length;
  // DECIDED (wins+losses), not `scoreable`, is the win-rate denominator — the same rule
  // analytics.ts's buildRecordSegment already enforces for the member-facing headline.
  // `scoreable` only excludes unfilled + pulled; it still carries `open`/`ambiguous`
  // rows (plays that touched NEITHER level), and dividing by it books every undecided
  // play as a loss. Measured LIVE 2026-08-06 on prod /api/admin/nighthawk/analytics
  // (days=90): conviction B came back `n:29, scoreable:15, wins:0, losses:0,
  // win_rate_pct:0, low_n:false` — a stated 0% win rate over ZERO decided plays, badged
  // as sufficient evidence. Same defect class PR #1797 fixed in analytics.ts.
  const decided = wins + losses;
  const counts = new Map<DebriefFailureMode, number>();
  for (const r of rows) {
    const tag = readPinnedDebriefTag(r.debrief ?? null);
    if (tag) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  const dominant =
    Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
  return {
    key,
    n: rows.length,
    scoreable: scoreable.length,
    wins,
    losses,
    decided,
    undecided: scoreable.length - decided,
    unfilled: rows.filter((r) => r.outcome === "unfilled").length,
    pulled: rows.filter((r) => r.pulled === true).length,
    // null, never a fake 0%: "no play was decided" is not "every play lost".
    win_rate_pct: decided > 0 ? round1((wins / decided) * 100) : null,
    dominant_failure_mode: dominant,
    // low_n guards the RATE, so it counts the rate's own denominator.
    low_n: decided < LOW_N_THRESHOLD,
  };
}

const CONVICTION_ORDER = ["A+", "A", "B", "C"] as const;

function byConviction(current: DebriefAggregateRow[]): DebriefGroupRecord[] {
  return CONVICTION_ORDER.map((c) =>
    groupRecord(
      c,
      current.filter((r) => String(r.conviction ?? "").toUpperCase() === c)
    )
  );
}

function byTier(current: DebriefAggregateRow[]): DebriefGroupRecord[] {
  const map = new Map<string, DebriefAggregateRow[]>();
  for (const r of current) {
    const tier = readPinnedTier(r.publish_context ?? null);
    if (tier == null) continue;
    map.set(tier, [...(map.get(tier) ?? []), r]);
  }
  return Array.from(map.entries())
    .map(([tier, rows]) => groupRecord(tier, rows))
    .sort((a, b) => a.key.localeCompare(b.key));
}

// ── Counterfactual publish-gate validation ──────────────────────────────────────────

/** One gate-blocked play as the analyzer consumes it: the nighthawk_rejected audit row
 *  (stage publish_gate) joined with the counterfactual grade debrief-persist.ts pinned
 *  onto it (counterfactual_json; null when not yet graded). */
export type NighthawkGateRejectionInput = {
  ticker: string;
  edition_for: string;
  direction: "LONG" | "SHORT";
  /** Failed gate codes parsed from input_snapshot.gate_blocks (a DELL-class play
   *  carries band_detached AND target_unreachable — it counts under BOTH gates). */
  gate_codes: string[];
  counterfactual: unknown;
};

export type GateRejectionCounterfactualLike = {
  outcome: string;
  would_have_won: boolean;
};

/** Structural read of a persisted rejection counterfactual (never trust JSONB). */
export function readRejectionCounterfactual(raw: unknown): GateRejectionCounterfactualLike | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.outcome !== "string" || c.outcome === "ungradeable") return null;
  return { outcome: c.outcome, would_have_won: c.would_have_won === true };
}

/** Parse the failed gate codes out of a nighthawk_rejected row's input_snapshot. */
export function gateCodesFromSnapshot(inputSnapshot: unknown): string[] {
  if (inputSnapshot == null || typeof inputSnapshot !== "object") return [];
  const blocks = (inputSnapshot as Record<string, unknown>).gate_blocks;
  if (!Array.isArray(blocks)) return [];
  const codes: string[] = [];
  for (const b of blocks) {
    if (b != null && typeof b === "object" && typeof (b as Record<string, unknown>).code === "string") {
      codes.push((b as Record<string, unknown>).code as string);
    }
  }
  return Array.from(new Set(codes));
}

export type GateBlockedValueLine = {
  gate: string;
  /** All plays this gate blocked in the window. */
  blocked_n: number;
  /** Of those, counterfactually graded (persisted, non-ungradeable). */
  graded_n: number;
  ungraded_n: number;
  would_have_won: number;
  would_have_won_rate_pct: number | null;
  /** Counterfactual 'unfilled' — the blocked play wouldn't even have filled (the gate
   *  was trivially right for these; kept out of the won/lost read). */
  unfilled_n: number;
  low_n: boolean;
};

/** Per-gate "blocked value": how many plays each publish gate removed, and what the
 *  removed plays would have done. A gate that blocks winners shows up HERE — the only
 *  way a gate threshold earns or loses its number. */
export function gateBlockedValue(rejections: NighthawkGateRejectionInput[]): GateBlockedValueLine[] {
  const byGate = new Map<string, NighthawkGateRejectionInput[]>();
  for (const r of rejections) {
    for (const code of r.gate_codes) {
      byGate.set(code, [...(byGate.get(code) ?? []), r]);
    }
  }
  return Array.from(byGate.entries())
    .map(([gate, rows]) => {
      const cfs = rows.map((r) => readRejectionCounterfactual(r.counterfactual));
      const graded = cfs.filter((c): c is GateRejectionCounterfactualLike => c != null);
      const unfilled = graded.filter((c) => c.outcome === "unfilled");
      const decisive = graded.filter((c) => c.outcome !== "unfilled");
      const won = decisive.filter((c) => c.would_have_won).length;
      return {
        gate,
        blocked_n: rows.length,
        graded_n: graded.length,
        ungraded_n: rows.length - graded.length,
        would_have_won: won,
        would_have_won_rate_pct: decisive.length > 0 ? round1((won / decisive.length) * 100) : null,
        unfilled_n: unfilled.length,
        low_n: decisive.length < LOW_N_THRESHOLD,
      };
    })
    .sort((a, b) => b.blocked_n - a.blocked_n || a.gate.localeCompare(b.gate));
}

// ── The published mirror: what would each gate have blocked, from the pinned margins ─

export type GateMirrorBucket = {
  /** ALL resolved non-pulled rows in this bucket — unfilled and undecided included.
   *  This is the fillability population, NOT a rate denominator. */
  n: number;
  wins: number;
  losses: number;
  /** wins + losses — the win-rate denominator. */
  decided: number;
  /** Rows that could never be entered at all (gap-away, resolveOutcome → 'unfilled').
   *  These are the plays the band_detached gate exists to prevent; they are counted
   *  here and NEVER in `decided`. */
  unfilled: number;
  win_rate_pct: number | null;
  /** unfilled / n — the fillability read. A gate that stops unenterable geometry earns
   *  its number HERE, not in the win rate (an unfilled play has no win or loss). */
  unfilled_rate_pct: number | null;
  /** decided < LOW_N_THRESHOLD — guards `win_rate_pct`. */
  low_n: boolean;
  /** n < LOW_N_THRESHOLD — guards `unfilled_rate_pct` (different denominator). */
  low_n_fillability: boolean;
};

export type GateMirrorLine = {
  gate: "band_detached" | "target_unreachable";
  would_block: GateMirrorBucket;
  would_pass: GateMirrorBucket;
  /** would_pass WR minus would_block WR, pts — positive means the gate separates real
   *  losers from real winners on published history. Null until both buckets graded. */
  delta_win_rate_pts: number | null;
  /** would_block unfilled-rate MINUS would_pass unfilled-rate, pts — positive means the
   *  gate separates NEVER-FILLABLE geometry from fillable geometry. This is the read
   *  band_detached is actually for, and it was structurally unobservable while the
   *  mirror dropped unfilled rows before bucketing. Null until both buckets have rows. */
  delta_unfilled_rate_pts: number | null;
  /** Graded rows whose pin lacks the geometry this gate thresholds on. */
  no_geometry_n: number;
};

/** A gate's threshold as recovered from the pin. Three DISTINCT states, and the
 *  distinction is the whole point (see pinnedThreshold):
 *   - `{ kind: "pinned" }`  — publish_context.gates.checks[] carried a finite threshold
 *                             for this gate: the number that actually judged this play.
 *   - `{ kind: "absent" }`  — the pin predates gate pinning (or omits this gate) and has
 *                             nothing to say: fall back to the live constant.
 *   - `{ kind: "unusable" }`— the pin HAS an entry for this gate but its threshold is not
 *                             a finite number (corrupt/legacy JSONB): refuse to answer. */
type PinnedThreshold =
  | { kind: "pinned"; value: number }
  | { kind: "absent" }
  | { kind: "unusable" };

type PinGeometry = {
  band_distance_pct: number | null;
  atr14: number | null;
  /** Per-gate threshold PINNED at publish time — publish-gates.ts:226/232 records
   *  `{ code, passed, value, threshold }` into publish_context.gates.checks[] for EVERY
   *  evaluated gate, PASSES included. */
  thresholds: Record<"band_detached" | "target_unreachable", PinnedThreshold>;
};

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** Recover ONE gate's pinned threshold out of publish_context.gates.checks[].
 *  Structural and junk-tolerant — publish_context is JSONB and is never trusted. */
function pinnedThreshold(
  publishContext: Record<string, unknown>,
  gate: "band_detached" | "target_unreachable"
): PinnedThreshold {
  const gates = publishContext.gates;
  if (gates == null || typeof gates !== "object" || Array.isArray(gates)) return { kind: "absent" };
  const checks = (gates as Record<string, unknown>).checks;
  if (!Array.isArray(checks)) return { kind: "absent" };
  for (const raw of checks) {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) continue;
    const check = raw as Record<string, unknown>;
    if (check.code !== gate) continue;
    // The entry EXISTS. From here we either use its threshold or refuse — we must never
    // silently fall through to the live constant, because "this gate was evaluated" is
    // exactly the case where the live constant may no longer be the number that judged it.
    const t = num(check.threshold);
    return t == null ? { kind: "unusable" } : { kind: "pinned", value: t };
  }
  return { kind: "absent" };
}

function pinGeometry(publishContext: unknown): PinGeometry {
  if (publishContext == null || typeof publishContext !== "object" || Array.isArray(publishContext)) {
    return {
      band_distance_pct: null,
      atr14: null,
      thresholds: { band_detached: { kind: "absent" }, target_unreachable: { kind: "absent" } },
    };
  }
  const p = publishContext as Record<string, unknown>;
  return {
    band_distance_pct: num(p.band_distance_pct),
    atr14: num(p.atr14),
    thresholds: {
      band_detached: pinnedThreshold(p, "band_detached"),
      target_unreachable: pinnedThreshold(p, "target_unreachable"),
    },
  };
}

/**
 * Retro would-block verdict for one published row: the geometry PINNED at publish,
 * judged against the threshold that ACTUALLY judged it. Null = the pin can't answer.
 *
 * WHY THE PINNED THRESHOLD AND NOT THE LIVE CONSTANT (fixed 2026-08-06). This function
 * used to compare pinned geometry against the LIVE `publish-gates.ts` constants. That
 * makes `gate_validation.published_mirror` **rewrite its own history**: the instant
 * anyone moves `GATE_TARGET_MAX_ATR_MULTIPLE` or `GATE_BAND_MAX_DISTANCE_PCT`, every
 * already-graded row silently re-buckets between would_block and would_pass — so the
 * mirror cannot serve as a before/after baseline for the very calibration it exists to
 * inform. You could not tell "the new threshold separates better" from "the mirror was
 * recomputed under the new threshold". Measured 2026-08-06: the live mirror reports
 * `target_unreachable` would_block n=1 / would_pass n=21, delta 0 pts — a baseline that
 * would have silently moved under any constant edit.
 *
 * The pin already carries the answer: publish-gates.ts:226 writes `threshold` alongside
 * `value` into publish_context.gates.checks[] on EVERY play, passed or blocked. Reading
 * it makes the mirror a fixed historical fact, which is what a baseline has to be.
 *
 * Fallback discipline: an OLD pin that predates gate pinning has no checks[] entry, and
 * for those the live constant is the only available answer and is used (better a stated
 * approximation than a null bucket for the whole pre-pin era). But a pin that HAS an
 * entry with a non-finite threshold returns null — it is corrupt, and guessing with the
 * live constant is exactly the silent rewrite this fix removes.
 *
 * G-N3 (stale quote) is deliberately absent: its "acceptable sessions" input is a
 * clock-relative fact that cannot be honestly reconstructed for history.
 */
export function retroWouldBlock(
  row: Pick<DebriefAggregateRow, "publish_context" | "direction" | "entry_range_low" | "entry_range_high" | "target">,
  gate: "band_detached" | "target_unreachable"
): boolean | null {
  const geo = pinGeometry(row.publish_context ?? null);
  const pinned = geo.thresholds[gate];
  if (pinned.kind === "unusable") return null;
  const liveThreshold =
    gate === "band_detached" ? GATE_BAND_MAX_DISTANCE_PCT : GATE_TARGET_MAX_ATR_MULTIPLE;
  const threshold = pinned.kind === "pinned" ? pinned.value : liveThreshold;

  if (gate === "band_detached") {
    if (geo.band_distance_pct == null) return null;
    return Math.abs(geo.band_distance_pct) > threshold;
  }
  const fillEdge = (row.direction === "SHORT" ? row.entry_range_low : row.entry_range_high) ?? null;
  if (geo.atr14 == null || geo.atr14 <= 0 || fillEdge == null || row.target == null) return null;
  return Math.abs(row.target - fillEdge) / geo.atr14 > threshold;
}

function mirrorBucket(rows: DebriefAggregateRow[]): GateMirrorBucket {
  const wins = rows.filter((r) => r.outcome === "target").length;
  const losses = rows.filter((r) => r.outcome === "stop").length;
  const unfilled = rows.filter((r) => r.outcome === "unfilled").length;
  // Exactly gateBlockedValue's pattern (this file, ~L275-290): unfilled rows are COUNTED
  // as their own population and the win rate is taken over DECIDED rows only. An unfilled
  // play has no win and no loss — it never entered — so it can never sit in a rate, and
  // an undecided (open/ambiguous) play must not be booked as a loss either.
  const decided = wins + losses;
  return {
    n: rows.length,
    wins,
    losses,
    decided,
    unfilled,
    win_rate_pct: decided > 0 ? round1((wins / decided) * 100) : null,
    unfilled_rate_pct: rows.length > 0 ? round1((unfilled / rows.length) * 100) : null,
    low_n: decided < LOW_N_THRESHOLD,
    low_n_fillability: rows.length < LOW_N_THRESHOLD,
  };
}

/**
 * The mirror over PUBLISHED plays: bucket current-methodology RESOLVED, non-pulled rows
 * by each gate's retro would-block verdict (from the pinned geometry + pinned threshold).
 *
 * WHY UNFILLED ROWS ARE BUCKETED HERE (fixed 2026-08-06). This filter used to drop
 * `outcome === "unfilled"` BEFORE calling retroWouldBlock, i.e. before the gate ever got
 * to judge the row. Those are precisely the plays whose published entry band the session
 * never traded back into — the exact failure `band_detached` (G-N1) exists to prevent —
 * so the gate's own published mirror was structurally blind to its only real effect.
 * Measured LIVE on prod /api/admin/nighthawk/analytics?days=90 (2026-08-06):
 *   band_detached → would_block {n:0}, would_pass {n:27}, delta_win_rate_pts: null
 * while the SAME report's debrief summary carried 9 `unfilled_never_traded_back` +
 * 5 `band_detached` pins and the record carried 19 unfilled of 70 resolved. The gate
 * "blocked nothing" only because every row it could have blocked was deleted first.
 *
 * Unfilled rows are bucketed but kept OUT of the win rate (mirrorBucket's decided
 * denominator) and reported as their own `unfilled` / `unfilled_rate_pct` read, so no
 * unenterable play can land in a rate — the invariant this fix is protecting.
 *
 * PULLED rows stay excluded on purpose: a pulled play was withdrawn pre-open by the
 * INVALIDATED morning latch, so its next-session outcome is a counterfactual, not a
 * fact about the published geometry this mirror is judging.
 */
export function gatePublishedMirror(current: DebriefAggregateRow[]): GateMirrorLine[] {
  const resolved = current.filter((r) => r.pulled !== true && r.outcome !== "pending");
  return (["band_detached", "target_unreachable"] as const).map((gate) => {
    const block: DebriefAggregateRow[] = [];
    const pass: DebriefAggregateRow[] = [];
    let noGeo = 0;
    for (const r of resolved) {
      const verdict = retroWouldBlock(r, gate);
      if (verdict == null) noGeo += 1;
      else (verdict ? block : pass).push(r);
    }
    const wouldBlock = mirrorBucket(block);
    const wouldPass = mirrorBucket(pass);
    const delta =
      wouldBlock.win_rate_pct != null && wouldPass.win_rate_pct != null
        ? round1(wouldPass.win_rate_pct - wouldBlock.win_rate_pct)
        : null;
    const deltaUnfilled =
      wouldBlock.unfilled_rate_pct != null && wouldPass.unfilled_rate_pct != null
        ? round1(wouldBlock.unfilled_rate_pct - wouldPass.unfilled_rate_pct)
        : null;
    return {
      gate,
      would_block: wouldBlock,
      would_pass: wouldPass,
      delta_win_rate_pts: delta,
      delta_unfilled_rate_pts: deltaUnfilled,
      no_geometry_n: noGeo,
    };
  });
}

// ── The improvement queue ───────────────────────────────────────────────────────────

/** Machine-readable improvement signal. `suggestion` is NULL whenever `low_n` is true —
 *  the LOW-N discipline in executable form: thin evidence is VISIBLE (the item ships)
 *  but never ACTIONABLE (no suggestion can rest on it). */
export type DebriefImprovementItem = {
  signal: string;
  evidence: { n: number; delta: number | null };
  suggestion: string | null;
  low_n: boolean;
};

/** A dominant failure mode must cover at least this share of debriefed plays before it
 *  earns a queue item — below it the mix is noise, not a pattern. */
export const IMPROVEMENT_DOMINANT_SHARE = 0.4;
/** Blocked-value: a gate whose graded counterfactuals would have won at/above this rate
 *  is flagged as possibly blocking winners. */
export const IMPROVEMENT_BLOCKED_WINNER_RATE_PCT = 40;
/** Mirror: retro delta (pts) at/above this reads as "the gate separates real losers".
 *  Same bar as the 0DTE calibration graduation delta (calibration.ts). */
export const IMPROVEMENT_MIRROR_DELTA_PTS = 15;

const FAILURE_MODE_SUGGESTION: Record<DebriefFailureMode, string> = {
  clean_win: "wins are clean — protect the current publish discipline; change nothing on this evidence",
  lucky_win:
    "wins are consuming most of their stop budget before paying — risk plans are too tight to the tape; widen stops or demand better entries",
  gap_win:
    "gap-away 'wins' are appearing in a current-methodology segment — grading regression; audit resolveOutcome fillability immediately",
  stopped_normal: "losses are ordinary in-plan stop-outs — the leak, if any, is selection, not execution",
  wrong_direction:
    "direction calls themselves are failing — add a book-vs-tape alignment veto at publish (decision doc N-4/PR-N9 class)",
  gap_through_stop:
    "losses are being decided by overnight gaps, not intraday action — publish-time catalyst/gap-risk veto + binding pre-open pull are the levers (N-7/§3.4 class)",
  target_unreachable:
    "targets are exceeding the one-session horizon — tighten the G-N2 achievable-target multiple toward 1.0× ATR (publish-gates.ts)",
  band_detached:
    "entry bands are publishing detached from the tape — G-N1 is the lever; verify the stale-quote guard and backfill anchoring (N-3 class)",
  unfilled_never_traded_back:
    "bands are near-missing fills — entries are anchored too far from spot for the session's range; re-anchor toward spot at publish",
  pulled_correctly:
    "the morning pull latch is removing plays that would have lost — keep INVALIDATED binding (N-7 working as designed)",
  pulled_wrongly:
    "the morning pull latch is removing plays that would have WON — recalibrate the INVALIDATED thresholds before trusting more pulls",
};

/** Deterministic queue builder. Items sort actionable-first (suggestion-bearing, then
 *  larger n, then signal) so the top of the queue is always the strongest evidence. */
export function buildImprovementQueue(input: {
  summary: NighthawkDebriefRecordSummary;
  blockedValue: GateBlockedValueLine[];
  mirror: GateMirrorLine[];
  byConviction: DebriefGroupRecord[];
}): DebriefImprovementItem[] {
  const items: DebriefImprovementItem[] = [];

  // 1) Dominant failure mode among debriefed plays.
  const top = input.summary.failure_modes[0];
  if (top && input.summary.debriefed > 0) {
    const share = top.n / input.summary.debriefed;
    if (share >= IMPROVEMENT_DOMINANT_SHARE) {
      const lowN = input.summary.debriefed < LOW_N_THRESHOLD;
      items.push({
        signal: `failure_mode:${top.tag}:dominant`,
        evidence: { n: top.n, delta: round1(share * 100) },
        suggestion: lowN ? null : FAILURE_MODE_SUGGESTION[top.tag],
        low_n: lowN,
      });
    }
  }

  // 2) Per-gate blocked value: is a gate removing winners?
  for (const line of input.blockedValue) {
    if (line.graded_n === 0 || line.would_have_won_rate_pct == null) continue;
    const blocksWinners = line.would_have_won_rate_pct >= IMPROVEMENT_BLOCKED_WINNER_RATE_PCT;
    items.push({
      signal: `publish_gate:${line.gate}:blocked_value`,
      evidence: { n: line.graded_n, delta: line.would_have_won_rate_pct },
      suggestion: line.low_n
        ? null
        : blocksWinners
          ? `gate ${line.gate} blocked plays that would have won ${line.would_have_won_rate_pct}% of the time — re-examine its threshold against the PASS margins pinned in publish_context.gates`
          : `gate ${line.gate} is blocking non-winners (${line.would_have_won_rate_pct}% would-have-won) — the threshold is earning its keep; keep enforcing`,
      low_n: line.low_n,
    });
  }

  // 3) Published mirror: does retro-applying the gate separate losers from winners?
  for (const line of input.mirror) {
    if (line.delta_win_rate_pts == null) continue;
    const lowN = line.would_block.low_n || line.would_pass.low_n;
    const strong = line.delta_win_rate_pts >= IMPROVEMENT_MIRROR_DELTA_PTS;
    items.push({
      signal: `publish_gate:${line.gate}:published_mirror`,
      evidence: {
        n: line.would_block.decided + line.would_pass.decided,
        delta: line.delta_win_rate_pts,
      },
      suggestion: lowN
        ? null
        : strong
          ? `plays the ${line.gate} gate would have blocked ran ${line.delta_win_rate_pts} pts worse than passes on the published record — the threshold separates real losers; hold or tighten`
          : `retro-applying ${line.gate} does not separate winners from losers (${line.delta_win_rate_pts} pts) — do not tighten on this evidence`,
      low_n: lowN,
    });
  }

  // 3b) Published mirror, FILLABILITY read: does retro-applying the gate separate plays
  //     that could never be entered from plays that could? This is the only lane in which
  //     band_detached can earn or lose its threshold — an unfillable play is never a win
  //     or a loss, so it is invisible to (3) by construction. Split out rather than folded
  //     into (3) because the two reads have different denominators (n vs decided) and a
  //     gate can be strong on one and silent on the other.
  for (const line of input.mirror) {
    if (line.delta_unfilled_rate_pts == null) continue;
    const lowN = line.would_block.low_n_fillability || line.would_pass.low_n_fillability;
    const strong = line.delta_unfilled_rate_pts >= IMPROVEMENT_MIRROR_DELTA_PTS;
    items.push({
      signal: `publish_gate:${line.gate}:published_mirror_fillability`,
      evidence: { n: line.would_block.n + line.would_pass.n, delta: line.delta_unfilled_rate_pts },
      suggestion: lowN
        ? null
        : strong
          ? `plays the ${line.gate} gate would have blocked went UNFILLED ${line.delta_unfilled_rate_pts} pts more often than passes — the threshold is removing geometry a member could never have entered; hold or tighten`
          : `retro-applying ${line.gate} does not separate fillable from unfillable geometry (${line.delta_unfilled_rate_pts} pts) — the never-filled rate is not this gate's to fix; look at the entry-band anchor, not the threshold`,
      low_n: lowN,
    });
  }

  // 4) Conviction inversion (the F-5/N-6 family): a lower conviction band beating a
  //    higher one by >10 pts at usable n means the letters are mis-weighted.
  const usable = input.byConviction.filter((c) => c.win_rate_pct != null);
  for (let hi = 0; hi < usable.length; hi += 1) {
    for (let lo = hi + 1; lo < usable.length; lo += 1) {
      const higher = usable[hi]!;
      const lower = usable[lo]!;
      const delta = (lower.win_rate_pct ?? 0) - (higher.win_rate_pct ?? 0);
      if (delta > 10) {
        const lowN = higher.low_n || lower.low_n;
        items.push({
          signal: `conviction:${higher.key}_below_${lower.key}:inversion`,
          evidence: { n: higher.scoreable + lower.scoreable, delta: round1(delta) },
          suggestion: lowN
            ? null
            : `conviction ${lower.key} outperforms ${higher.key} by ${round1(delta)} pts — the conviction letters are mis-weighted (N-6); port the earned-tier engine (decision doc PR-N7)`,
          low_n: lowN,
        });
      }
    }
  }

  // Actionable first, then evidence size, then stable name order.
  return items.sort(
    (a, b) =>
      Number(a.low_n) - Number(b.low_n) || b.evidence.n - a.evidence.n || a.signal.localeCompare(b.signal)
  );
}

// ── The full report ─────────────────────────────────────────────────────────────────

export type NighthawkDebriefReport = {
  methodology: string;
  window: { since: string; through: string; days: number };
  summary: NighthawkDebriefRecordSummary;
  by_conviction: DebriefGroupRecord[];
  /** Empty until a tier is ever pinned in publish_context (no NH tier engine yet). */
  by_tier: DebriefGroupRecord[];
  gate_validation: {
    blocked_value: GateBlockedValueLine[];
    published_mirror: GateMirrorLine[];
  };
  /** Distribution of the PINNED target-ATR multiple across published rows in the window —
   *  see targetAtrDistribution. */
  target_atr_distribution: TargetAtrDistribution;
  improvement_queue: DebriefImprovementItem[];
  available: boolean;
};

/** Structural read of the PINNED G-N2 multiple out of publish_context.gates.checks[].
 *  JSONB is never trusted: every level is shape-checked and a non-finite/negative value
 *  reads as absent rather than being coerced. Mirrors publish-gates.ts's
 *  targetAtrMultipleFromGateResult, applied to the persisted (untyped) blob. */
export function pinnedTargetAtrMultiple(publishContext: unknown): number | null {
  if (publishContext == null || typeof publishContext !== "object" || Array.isArray(publishContext)) return null;
  const gates = (publishContext as Record<string, unknown>).gates;
  if (gates == null || typeof gates !== "object" || Array.isArray(gates)) return null;
  const checks = (gates as Record<string, unknown>).checks;
  if (!Array.isArray(checks)) return null;
  for (const raw of checks) {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) continue;
    const check = raw as Record<string, unknown>;
    if (check.code !== "target_unreachable") continue;
    const v = check.value;
    return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
  }
  return null;
}

export type TargetAtrDistribution = {
  /** Published rows in the window (the denominator for `pinned_n`). */
  rows_n: number;
  /** Rows carrying a usable pinned G-N2 multiple. */
  pinned_n: number;
  histogram: TargetAtrHistogramBin[];
  median: number | null;
  /** Rows whose pinned multiple exceeds the LIVE publish-gate bar. */
  over_gate_n: number;
  over_gate_threshold: number;
  low_n: boolean;
};

/**
 * How far the published targets actually sat, read from the PIN rather than reconstructed.
 *
 * WHY THIS EXISTS (2026-08-06): the publish gate measures |target − fill_edge| / ATR14 on
 * every play and pins it (publish-gates.ts:226), but `publish_context` is a Postgres
 * product and raw PG is unreachable from the audit sandbox — so every calibration pass so
 * far had to RECONSTRUCT ATR14 from Polygon daily bars to answer "how far out are our
 * targets", which cannot be byte-identical to the pin whenever production took an
 * hourly/prior-day ATR fallback (polygon-largo.ts:346-352). This exposes the pinned
 * distribution directly, so the next pass measures on the denominator the gate used.
 *
 * Reads ONLY the pin — never recomputes from levels — so it cannot drift from the gate.
 */
export function targetAtrDistribution(rows: DebriefAggregateRow[]): TargetAtrDistribution {
  const multiples = rows.map((r) => pinnedTargetAtrMultiple(r.publish_context ?? null));
  const usable = multiples.filter((m): m is number => m != null).sort((a, b) => a - b);
  const median =
    usable.length === 0
      ? null
      : usable.length % 2 === 1
        ? round2(usable[(usable.length - 1) / 2]!)
        : round2((usable[usable.length / 2 - 1]! + usable[usable.length / 2]!) / 2);
  return {
    rows_n: rows.length,
    pinned_n: usable.length,
    histogram: targetAtrHistogram(multiples),
    median,
    over_gate_n: usable.filter((m) => m > GATE_TARGET_MAX_ATR_MULTIPLE).length,
    over_gate_threshold: GATE_TARGET_MAX_ATR_MULTIPLE,
    low_n: usable.length < LOW_N_THRESHOLD,
  };
}

/** The pure analyzer: graded rows + gate rejections in, report out. Deterministic —
 *  no clock, no IO. */
export function analyzeNighthawkDebriefs(input: {
  rows: DebriefAggregateRow[];
  rejections: NighthawkGateRejectionInput[];
  window: { since: string; through: string; days: number };
}): NighthawkDebriefReport {
  const graded = input.rows.filter((r) => r.outcome !== "pending");
  const current = graded.filter((r) => isCurrentGradeMethodology(r.grade_methodology));
  const summary = summarizeDebriefPins(input.rows);
  const conviction = byConviction(current);
  const blockedValue = gateBlockedValue(input.rejections);
  const mirror = gatePublishedMirror(current);
  return {
    methodology: NIGHTHAWK_DEBRIEF_METHODOLOGY,
    window: input.window,
    summary,
    by_conviction: conviction,
    by_tier: byTier(current),
    gate_validation: { blocked_value: blockedValue, published_mirror: mirror },
    // Over CURRENT-methodology rows only, same anti-blend rule as every other cut here.
    target_atr_distribution: targetAtrDistribution(current),
    improvement_queue: buildImprovementQueue({ summary, blockedValue, mirror, byConviction: conviction }),
    available: summary.debriefed > 0 || blockedValue.length > 0,
  };
}

// ── Thin data layer ─────────────────────────────────────────────────────────────────

function etYmd(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(ms));
}

const DEFAULT_WINDOW_DAYS = 30;
const MAX_WINDOW_DAYS = 180;

/**
 * Fetch + analyze. `nowMs` is a parameter (the route supplies the clock). Fail-soft end
 * to end: a DB failure degrades to an empty-input report (available:false), never a
 * throw into the route. Dynamic RELATIVE imports (CI's tsx ESM loader cannot resolve
 * "@/" aliases in dynamic import positions) keep the analyzer's static graph pure.
 */
export async function buildNighthawkDebriefReport(opts: {
  days?: number;
  nowMs: number;
}): Promise<NighthawkDebriefReport> {
  const days = Math.min(MAX_WINDOW_DAYS, Math.max(1, Math.trunc(opts.days ?? DEFAULT_WINDOW_DAYS)));
  const through = etYmd(opts.nowMs);
  const since = etYmd(opts.nowMs - days * 24 * 60 * 60 * 1000);

  let rows: DebriefAggregateRow[] = [];
  let rejections: NighthawkGateRejectionInput[] = [];
  try {
    const db = await import("../../../lib/db");
    if (db.dbConfigured()) {
      const [{ rows: outcomeRows }, rejectionRows] = await Promise.all([
        db.fetchNighthawkOutcomeAnalytics(days),
        db.fetchNighthawkPublishGateRejections(days),
      ]);
      rows = outcomeRows;
      rejections = rejectionRows.map((r) => ({
        ticker: r.ticker,
        edition_for: r.edition_for,
        direction: r.direction,
        gate_codes: gateCodesFromSnapshot(r.input_snapshot),
        counterfactual: r.counterfactual_json,
      }));
    }
  } catch {
    // Report over empty input (available:false) — never a throw into the caller.
  }

  return analyzeNighthawkDebriefs({ rows, rejections, window: { since, through, days } });
}
