// src/lib/swing/closed-plays.ts — map graded CLOSED ledger rows onto deck payloads (CLOSED tab parity).
//
// The horizons lane serves pre-entry + live open book; this mapper covers the third bucket members
// expect from 0DTE parity: finished swing positions with realized P&L. PURE — callers supply DB rows.

import { SWING_TERMINAL_STATUSES, type SwingPositionRow } from "../db";
import { calendarDte } from "../horizon-fanout";
import { HORIZONS } from "../horizons";
import { buildSwingRecord } from "./record";
import {
  archetypeNearTieFromFeatureVector,
  entryPresentPillarsFromFeatureVector,
  topFlowProvenanceFromRow,
} from "./live-plays";

const fin = (n: unknown): number | null => (typeof n === "number" && Number.isFinite(n) ? n : null);
const round2 = (n: number): number => Math.round(n * 100) / 100;

function etYmd(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
}

/** Wire shape for terminalPlayFromHorizon — kept in lib/ to avoid features import. */
export type SwingClosedDeckSource = {
  positionId: number;
  ticker: string;
  direction: "LONG" | "SHORT";
  horizon: "SWING";
  score: number;
  /** True when `score` is a `0` FALLBACK (the terminal leg's `feature_vector.evidence_score` was
   *  missing, never a real measured value — see `HorizonPlay.scoreWithheld`'s doc comment
   *  (live-plays.ts) for the live/open-position sibling of this same field, and
   *  `TerminalPlay.scoreWithheld`'s own doc comment (command-deck/types.ts) for the live repro
   *  this closes. A ROLLED chain's child leg is the one row shape that reliably hits this: its
   *  own commit (roll-plan.ts's `buildRollPlan`) never sets `feature_vector` on the child row at
   *  all (confirmed live 2026-10-16, AMZN root-44/terminal-48 and AAPL root-37/terminal-40 — both
   *  showed a literal `"score": 0` on `GET /api/market/swing/record`'s `closedDeck`, implying
   *  zero conviction/evidence at commit, which was simply false: the chain's real evidence lived
   *  on the parent leg's own feature_vector, never carried forward). A consumer of `score` must
   *  check this before treating `0` as "the lowest real score". */
  scoreWithheld?: boolean;
  status: "CLOSED";
  reason: string;
  contract: {
    strike: number;
    right: "C" | "P";
    expiry: string;
    dte: number;
    mid?: number | null;
    delta?: number | null;
    gamma?: number | null;
    theta?: number | null;
    vega?: number | null;
    iv?: number | null;
  };
  archetype?: string | null;
  subLane?: string | null;
  /** Present-pillar count at commit, ONLY when the entry read was degraded — see
   *  live-plays.ts's `entryPresentPillarsFromFeatureVector` for the full gap this closes. */
  entryPresentPillars?: number | null;
  /** ONLY when the entry-time archetype classification was a near-tie — see
   *  live-plays.ts's `archetypeNearTieFromFeatureVector` / horizon-plays.ts's
   *  `HorizonPlay.archetypeNearTie` for the full gap this closes. */
  archetypeNearTie?: { secondaryLabel: string; marginPct: number } | null;
  /** Entry-time contract-pick provenance against the flow magnet strike, when both strikes are
   *  known — see live-plays.ts's `topFlowProvenanceFromRow` for the full gap this closes. */
  topFlowProvenance?: { topFlowStrike: number; matchedPick: boolean } | null;
  firstSeenAt?: string | null;
  committedAt?: string | null;
  entryPremium?: number | null;
  peakPremium?: number | null;
  troughPremium?: number | null;
  occ?: string | null;
  exitAt?: string | null;
  exitPnlPct?: number | null;
  closedReason?: string | null;
  /** Underlying-terms entry trigger / structural invalidation levels pinned at commit
   *  (SwingPositionRow.entry_underlying_px/thesis_invalidation_px) — static, never depend on
   *  live state, so they stay valid after close. Lets closedCoaching's "check if entry was
   *  extended past invalidation" prompt (play-brief-narrative-coaching.ts) actually answer the
   *  question instead of just asking it. */
  entryTriggerUnderlyingPx?: number | null;
  invalidationUnderlyingPx?: number | null;
  /** Raw entry_context.cortex JSONB — parsed structurally by the adapter (readCortexView),
   *  never trusted here. Carries the Cortex evidence pinned at commit, when one exists. */
  cortex?: unknown;
  /** Raw entry_context.budget_verdict JSONB (swing commit.ts's `budgetVerdictStamp`) — parsed
   *  structurally by the adapter (`parseBudgetVerdictStamp`/`bookRiskLine`), never trusted here.
   *  Ask Largo standing mandate, 2026-10-26, #4076 comment 6410025245. */
  budgetVerdict?: unknown;
  /** Raw entry_context.lane_rank_at_commit JSONB (swing commit.ts's `LaneRankAtCommit`) — parsed
   *  structurally by the adapter, never trusted here. Present only on a row committed after this
   *  field shipped; absent/null on any older row (honest absence, never backfilled/fabricated —
   *  there is no way to reconstruct a commit-time batch snapshot after the fact). */
  laneRankAtCommit: unknown;
  /** Whether a real scale-out trim was ENFORCED on this leg at any point before it closed —
   *  persisted into `scale_out_grade` at grade time (db.ts's `gradeSwingPosition`) from the row's
   *  own pre-update `status`, since a closed row's `status` is always CLOSED/ROLLED and can never
   *  again show a sticky TRIM. Null for rows graded before this field existed (honest absence, not
   *  a fabricated false) — see `trimEnforcedBeforeCloseFromScaleOutGrade` for the parse. */
  trimEnforcedBeforeClose?: boolean | null;
};

/** Read the `trim_enforced_before_close` fact out of `scale_out_grade` — honestly null, never a
 *  fabricated false, when the row predates this field (scale_out_grade had no other writer before
 *  2026-10-07, so any non-boolean/absent value here means "not recorded", not "did not happen"). */
export function trimEnforcedBeforeCloseFromScaleOutGrade(
  scaleOutGrade: Record<string, unknown> | null | undefined,
): boolean | null {
  const v = scaleOutGrade?.trim_enforced_before_close;
  return typeof v === "boolean" ? v : null;
}

function closedReasonFromRow(row: SwingPositionRow): string | null {
  const pnl = fin(row.realized_pnl_pct);
  if (pnl == null) return null;
  // BUG FIX (2026-09-18, Ask Largo standing mandate, live repro PYPL#24): a position that closed at
  // EXACTLY its entry price (entryPremium === peakPremium === troughPremium, a true flat/breakeven
  // scratch, not a rounding artifact) can still carry a tiny nonzero `realized_pnl_pct` from
  // float-division residue (e.g. -0.0001), which the unrounded `pnl < 0` check below labeled
  // "stopped" — factually wrong (a stop never fired; the premium never moved) and misleading in the
  // play-brief's trade-manager coaching ("Stop fired — check if entry was extended past
  // invalidation"). The sibling chain-composite mapper (`closedDeckSourcesFromChains` below) was
  // already fixed for this exact case on 2026-09-13 by rounding before the zero check — this
  // function was NOT, despite that fix's own comment claiming it already handled it correctly, so
  // `play-brief-resolve.ts` (which calls this function directly, bypassing the composite path)
  // still showed the wrong label. Rounding here brings both paths in line.
  const rounded = round2(pnl);
  if (rounded > 0) return "target";
  if (rounded < 0) return "stopped";
  return "flat";
}

/**
 * Contract identity (strike/right/expiry/dte/occ) PLUS this row's OWN quote fields (mid/delta) —
 * not gated on CLOSED status, unlike `closedDeckSourceFromRow` below. Honest-null when
 * `contract_type` can't be resolved to call/put or strike/expiry are missing, same rule that
 * function already applies for its own (terminal-leg) contract. Extracted (Ask Largo standing
 * mandate, 2026-10-11) so `closedDeckSourcesFromChains` can resolve a NON-terminal leg's own
 * contract too — see that function's own "BUG FOUND 2026-10-11" note for why the terminal leg's
 * contract is wrong to reuse when the worst leg is a different, earlier, rolled-away contract.
 *
 * BUG FIX (Ask Largo standing mandate, 2026-10-18, live repro AAPL positionId 40 (root 37 ->
 * terminal 40) + AMZN positionId 48 (root 44 -> terminal 48)): this function originally returned
 * ONLY identity fields (strike/right/expiry/dte/occ) — no quote. That was enough to fix the
 * 2026-10-11 bug (contract IDENTITY silently reused the terminal leg's), but left the exact same
 * bug class alive one field over: `closedDeckSourcesFromChains` re-pointed `contract`'s
 * strike/right/expiry/occ at the worst leg while still spreading `...src.contract` underneath —
 * and `src.contract.mid`/`src.contract.delta` are the TERMINAL leg's own `last_mark`/
 * `contract_delta` (see `closedDeckSourceFromRow` below), never overridden alongside the identity
 * fields. Result: a served card whose strike/expiry/occ correctly named the worst leg's contract,
 * but whose mid/delta were a DIFFERENT real contract's own price — two different option contracts
 * merged into one row. Live: AAPL's served contract (330C 2026-09-21, the correctly-identified
 * worst leg 37) showed mid 7.70 — that is leg 40's (terminal) own exit_mark; leg 37's REAL
 * exit_mark was 5.23. AMZN's served contract (245C per the pre-this-fix bug, since corrected to
 * leg 44's 605C) showed mid 10.00/delta 0.6 — leg 48's (terminal) own quote; leg 44's REAL
 * exit_mark was 3.73. Returning mid/delta from THIS function (always this row's own
 * `last_mark`/`contract_delta`, never borrowed) lets the call site source the whole contract —
 * identity AND quote — from one consistent row instead of patching fields in piecemeal.
 * `gamma`/`theta`/`vega`/`iv` have no equivalent column on `SwingPositionRow` (always null
 * regardless of which leg is used — unchanged by this fix, same honest-absence as before).
 */
function contractBundleFromRow(
  row: SwingPositionRow,
): {
  strike: number;
  right: "C" | "P";
  expiry: string;
  dte: number;
  occ: string | null;
  mid: number | null;
  delta: number | null;
} | null {
  const expiry = row.contract_expiry;
  const strike = row.contract_strike;
  if (!expiry || strike == null || !Number.isFinite(strike)) return null;
  if (row.contract_type !== "call" && row.contract_type !== "put") return null;
  const right = row.contract_type === "put" ? "P" : "C";
  // FINDINGS 2026-09-06 (swing-closed-dte-negative): a CLOSED position's DTE must be frozen to its
  // own trade lifecycle, never recomputed against "now". The ledger carries no dedicated
  // dte-at-entry/dte-at-exit column, but it DOES carry the exit timestamp (closed_at, falling back to
  // graded_at for legacy rows graded without a distinct close stamp) — so "days to expiry as of the
  // day this trade actually closed" is available for free and is the only DTE reading that stays
  // stable no matter when the record is viewed later. Using etYmd() (today) here previously produced
  // a negative DTE for any contract that has since expired (e.g. EWZ/GLW: expiry 2026-09-04, dte -2
  // when read on 2026-09-06) and a wrong-but-plausible-looking number for anything still short of
  // expiry (AAPL: true DTE at exit was 5, but the live-recomputed value read 3 and silently kept
  // shrinking on every subsequent view).
  const exitAt = row.closed_at ?? row.graded_at;
  const dte = calendarDte((exitAt ?? etYmd()).slice(0, 10), expiry.slice(0, 10));
  return { strike, right, expiry, dte, occ: row.contract_occ, mid: row.last_mark, delta: row.contract_delta };
}

/**
 * Map one graded terminal (CLOSED or ROLLED) ledger row to a deck source. Null when not
 * reconstructible.
 *
 * BUG FIX (2026-11-01, Ask Largo standing mandate, follow-on gap from #7316's leg-identity fix,
 * caught by audit before it could manifest live — deploy hadn't caught up to #7316 yet).
 * This gate used to be a literal `row.status !== "CLOSED"`, which refused to build a card for a
 * ROLLED row at all — returning `null` instead. That was invisible before #7316 because the OLD,
 * buggy `loadClosedPlay` id-matching (`graded.find((r) => r.id === positionId || r.root_position_id
 * === positionId)`, no precedence between the two disjuncts) usually surfaced a DIFFERENT, later
 * leg's row for a ROOT/intermediate leg's own id — so this gate's `null` on the ROLLED row itself
 * was rarely the thing callers actually observed. #7316 fixed that id-matching to check the EXACT
 * id match first, which means a caller asking for a rolled chain's ROOT/intermediate leg BY ITS OWN
 * id now correctly reaches ITS OWN row here — a row whose real DB `status` is `"ROLLED"`, never
 * `"CLOSED"` (confirmed live, AMZN leg id 44: `status: "ROLLED"`). This gate then refused it,
 * flipping the user-visible symptom from "serves the wrong leg's data" to a flat 404 "play not
 * found" for every such request, for a leg that is fully graded (`graded_at` set, `realized_pnl_pct`
 * frozen — see `gradeSwingPosition`, db.ts) and whose own outcome is exactly as disclosable as a
 * CLOSED row's.
 *
 * `SWING_TERMINAL_STATUSES` (db.ts) already treats CLOSED and ROLLED as the two equally-terminal/
 * gradeable statuses everywhere else in the ledger (the monotonic status-transition guard, every
 * `fetchSwingPositionsRange`-style "closed or rolled" query) — this is the one remaining place that
 * had its own narrower, CLOSED-only notion of "terminal". Importing the shared constant instead of
 * redefining it means this call site can never drift from that definition again.
 *
 * `status: "CLOSED"` below stays a HARDCODED literal — never `row.status` — for both CLOSED and
 * ROLLED rows: `TerminalPlay.status` is `DeckStatus` (command-deck/types.ts), which has no `ROLLED`
 * member, and the adapter's own `asStatus()` (adapters.ts) silently coerces any string outside its
 * six-member whitelist to `"WATCH"` — so threading a literal `"ROLLED"` through would have swapped
 * a correctness bug for a worse one (a settled, graded position rendering as a live WATCH
 * candidate). `"CLOSED"` here means "this leg is a settled, terminal, non-live card", which is
 * equally true of a CLOSED and a ROLLED leg; the leg's own P&L/contract/dates (not its UI bucket)
 * are what tell the real CLOSED-vs-ROLLED story, and `closedReasonFromRow` below already derives
 * those honestly from this row's own data (sign of `realized_pnl_pct`), unaffected by this gate.
 */
export function closedDeckSourceFromRow(row: SwingPositionRow): SwingClosedDeckSource | null {
  if (!SWING_TERMINAL_STATUSES.has(row.status) || !row.graded_at) return null;
  const bundle = contractBundleFromRow(row);
  if (!bundle) return null;
  const { strike, right, expiry, dte, mid, delta } = bundle;
  const exitAt = row.closed_at ?? row.graded_at;
  // BUG FIX (Ask Largo standing mandate, live repro 2026-10-16, AMZN root-44/terminal-48 + AAPL
  // root-37/terminal-40): `evidence_score` was unconditionally defaulted to the literal `0` with
  // no companion flag — indistinguishable from a real, measured zero-conviction score. The
  // live/open-position sibling path (live-plays.ts's `livePlayFromSwingPosition`) already treats
  // this exact gap honestly with `scoreWithheld`; this mirrors that idiom rather than inventing a
  // new one. See `SwingClosedDeckSource.scoreWithheld`'s doc comment for the full live repro.
  const evidenceScore =
    row.feature_vector && typeof row.feature_vector.evidence_score === "number"
      ? (row.feature_vector.evidence_score as number)
      : null;
  const score = evidenceScore ?? 0;
  const scoreWithheld = evidenceScore == null;
  const entryPresentPillars = entryPresentPillarsFromFeatureVector(row.feature_vector);
  const archetypeNearTie = archetypeNearTieFromFeatureVector(row.feature_vector);
  // Gated to the root leg only (roll_seq === 0) — see live-plays.ts's topFlowProvenanceFromRow call
  // site for why a rolled leg's contract_strike (freshly re-picked) can't be honestly compared
  // against top_flow_strike (carried forward unchanged from the original commit).
  const topFlowProvenance =
    (row.roll_seq ?? 0) === 0 ? topFlowProvenanceFromRow(row.top_flow_strike, row.contract_strike) : null;
  const exitPnl = fin(row.realized_pnl_pct);
  return {
    positionId: row.id,
    ticker: row.ticker.toUpperCase(),
    direction: row.direction === "short" ? "SHORT" : "LONG",
    horizon: "SWING",
    score,
    scoreWithheld,
    status: "CLOSED",
    reason: `closed — ${row.archetype ?? "swing"} thesis`,
    contract: {
      strike,
      right,
      expiry,
      dte,
      mid,
      delta,
      gamma: null,
      theta: null,
      vega: null,
      iv: null,
    },
    archetype: row.archetype,
    subLane: row.sub_lane,
    entryPresentPillars,
    archetypeNearTie,
    topFlowProvenance,
    firstSeenAt: row.first_seen_at,
    committedAt: row.committed_at,
    // BUG FIX (2026-10-21, Ask Largo standing mandate, live repro BE): these three raw DB floats
    // used to pass straight through, unrounded — but `terminalPlayFromClosedSwing`'s `peakDisplay`/
    // `troughDisplay` (adapters.ts) derive a percentage directly from them, while the SEPARATE
    // `GET /api/market/swing/record` HTTP route (the Command Deck UI's own CLOSED-tab source,
    // containers.tsx) independently wraps the SAME raw columns in `roundFloats(..., dp=2)` before
    // feeding the identical `terminalPlayFromClosedSwing` function. Two real consumers of one pure
    // function, fed two different precision bases for the same closed position — exactly the
    // raw-vs-rounded shape already found and fixed for 0DTE (FINDINGS.md, peak_pnl_pct/
    // mfe_capture_pct). Rounding once, here, at the single shared source, makes both callers
    // (the direct-DB Ask Largo brief path AND the HTTP /record route) agree, and makes /record's
    // own roundFloats() a no-op on these three fields rather than a second, uncoordinated rounding.
    entryPremium: row.entry_premium != null ? round2(row.entry_premium) : null,
    peakPremium: row.peak_premium != null ? round2(row.peak_premium) : null,
    troughPremium: row.trough_premium != null ? round2(row.trough_premium) : null,
    occ: bundle.occ,
    exitAt,
    exitPnlPct: exitPnl,
    closedReason: closedReasonFromRow(row),
    cortex: row.entry_context?.cortex ?? null,
    budgetVerdict: row.entry_context?.budget_verdict ?? null,
    laneRankAtCommit: row.entry_context?.lane_rank_at_commit ?? null,
    entryTriggerUnderlyingPx: fin(row.entry_underlying_px),
    invalidationUnderlyingPx: fin(row.thesis_invalidation_px),
    trimEnforcedBeforeClose: trimEnforcedBeforeCloseFromScaleOutGrade(row.scale_out_grade),
  };
}

/**
 * From roll chains already loaded for the record API: one CLOSED deck row per resolved chain
 * (terminal leg graded + CLOSED). Uses chain-composite P&L/outcome (deep-dive Q26), not terminal leg only.
 */
export function closedDeckSourcesFromChains(chains: readonly SwingPositionRow[][]): SwingClosedDeckSource[] {
  const out: SwingClosedDeckSource[] = [];
  const seen = new Set<number>();
  for (const chain of chains) {
    const ordered = [...chain].sort((a, b) => a.roll_seq - b.roll_seq || a.id - b.id);
    const terminal = ordered[ordered.length - 1];
    if (!terminal) continue;
    const record = buildSwingRecord(ordered);
    if (!record.composite.chainResolved) continue;
    const src = closedDeckSourceFromRow(terminal);
    if (!src || seen.has(src.positionId)) continue;
    seen.add(src.positionId);
    const compositePnl = record.composite.worstLegPnlPct;
    // BUG FIX (2026-09-13, Ask Largo standing mandate, live repro NFLX#12/WULF#13/IGV#16/WULF#17/
    // PYPL#24): `record.composite.outcome` is deliberately conservative — `isSwingWin` requires
    // `pnl > 0`, so a leg that closed at EXACTLY its entry price (pnl === 0, a true flat/breakeven
    // close, not a rounding artifact) makes `allLegsWon` false, which the composite unconditionally
    // reports as `"loss"` (record.ts's own "preserved-loss invariant" — a leg that didn't WIN is
    // treated as not-won for win-rate purposes, a defensible, intentionally strict scoring choice
    // this fix does NOT change). But this function then mapped `"loss"` straight to the closedReason
    // LABEL `"stopped"` — which is not conservative, it's factually wrong: "stopped" means a
    // stop-loss actually fired, and a position that closed unchanged from entry never triggered one.
    // All five live examples confirmed `entryPremium === peakPremium === troughPremium` (the premium
    // never moved even a cent across the whole holding period) yet displayed "stopped" — misleading
    // members reading trade history, and silently corrupting win-rate/track-record math that reads
    // `closedReason` as a stop-vs-target signal. The sibling single-leg mapper (`closedReasonFromRow`
    // just above) already gets this right with a real three-way split (target/stopped/flat) — this
    // brings the chain-composite path in line with it, changing ONLY the label text for the exact-0
    // case, not the win/loss scoring semantics `record.ts` documents as intentional.
    const compositeReason =
      record.composite.outcome === "win"
        ? "target"
        : record.composite.outcome === "loss"
          ? compositePnl === 0
            ? "flat"
            : "stopped"
          : src.closedReason;
    // BUG FIX (2026-09-15, Ask Largo standing mandate, forensic batch 31, live repro INTC:30/35):
    // `exitPnlPct` above is the chain-COMPOSITE worst-leg P&L (by design — the preserved-loss
    // invariant, record.ts's own file header), but `entryPremium`/`peakPremium`/`troughPremium`
    // come from `src`, which is the TERMINAL leg only (`closedDeckSourceFromRow(terminal)` above).
    // Whenever the worst leg is an EARLIER leg (a rolled chain where the parent lost more than the
    // child), those two halves describe different legs entirely — live: INTC's served row paired
    // leg 1's own price bounds (entry 2.26 -> peak 2.84, i.e. "+25.7% at peak") with leg 0's -40.83%
    // realized loss, so peak-vs-entry computed a POSITIVE 25.7% next to a reported -40.83% exit, and
    // that "peak" chronologically postdates the loss it's shown beside (leg 1 didn't exist until
    // leg 0's roll). Downstream, `primaryReturnPct` (play-card-display.ts) prefers `peak` as the
    // CLOSED-tab headline number, so this fabricated a green "+25.7%" card for a chain whose real
    // worst outcome was a loss. This fix originally (2026-09-15) omitted the three fields outright —
    // **SUPERSEDED by the 2026-10-21 fix below**, which found a genuine per-leg equivalent to borrow
    // instead of omitting; see that comment for why omission was never actually necessary here.
    const terminalPnl = fin(terminal.realized_pnl_pct);
    const worstLegIsTerminal =
      compositePnl != null && terminalPnl != null && round2(terminalPnl) === compositePnl;
    // BUG FOUND (Ask Largo standing mandate, 2026-10-11, live repro AMZN root 44/terminal 48): the
    // 2026-09-15 fix above correctly stopped pairing the TERMINAL leg's price bounds with a worse,
    // earlier leg's P&L — but left `contract`/`occ` untouched, which carries the identical mismatch
    // one layer deeper. Live: root 44 (entry $5.15 -> exit $3.73, -27.67%, ROLLED) rolled into
    // terminal 48 (entry $5.80 -> exit $10.00, +72.41%, CLOSED); the composite correctly reports
    // -27.67% (the preserved worst leg), but the served row paired that -27.67% with leg 48's OWN
    // contract (`occ: "AMZN261009C00245000"`, its real strike/expiry) — a contract that never lost
    // 27.67%; that loss belongs to leg 44's different, earlier, rolled-away strike/expiry entirely.
    // A member/Largo reading the row sees "245C 2026-10-09, exited -27.67%, stopped" — a specific,
    // checkable, and simply false claim about that contract. Fix: when the worst leg isn't the
    // terminal leg, resolve ITS OWN contract bundle (same `contractBundleFromRow` helper used for
    // single-leg rows) and use that leg's strike/right/expiry/dte/occ instead of the terminal's —
    // correct identity for the P&L being shown, not just an honest omission (the worst leg's own
    // contract IS knowable here — see the 2026-10-21 fix below for why entryPremium/peakPremium/
    // troughPremium are exactly the same case, not the "no per-leg equivalent" exception this
    // comment originally claimed). Falls back to omitting `occ` (nullable) only in the defensive
    // case where the worst leg's own row can't yield a contract bundle either (malformed/legacy
    // data) — `contract` itself stays non-optional per its type, so the terminal's bundle is kept
    // rather than left absent, same trade-off `SwingClosedDeckSource.contract` already makes.
    //
    // BUG FIX (Ask Largo standing mandate, 2026-10-18, live repro AAPL positionId 40 (root 37 ->
    // terminal 40) + AMZN positionId 48 (root 44 -> terminal 48)): the fix above re-points
    // strike/right/expiry/dte/occ at the worst leg but builds `contract` as `{ ...src.contract,
    // <those four fields> }` — `src.contract` is `closedDeckSourceFromRow(terminal)`'s own
    // contract, so `mid`/`delta` (and gamma/theta/vega/iv) survive the spread UNCHANGED, still the
    // TERMINAL leg's own `last_mark`/`contract_delta`. Same bug class as the 2026-10-11 fix above,
    // one field deeper: the card now correctly NAMES the worst leg's contract but still PRICES it
    // with a different, real contract's own quote. Live: AAPL's worst leg (37, -22.3%) has its own
    // real exit_mark 5.23; the served card showed mid 7.70 — leg 40's (terminal) own exit_mark, a
    // different contract entirely. AMZN's worst leg (44, -27.67%) has its own real exit_mark 3.73;
    // the served card showed mid 10.00/delta 0.6 — leg 48's (terminal) own quote. Fix: `mid`/`delta`
    // now come from `worstLegBundle` (contractBundleFromRow's own `row.last_mark`/
    // `row.contract_delta`, extended above to carry quote fields for exactly this reason), the same
    // worst-leg row the identity fields already source from — one consistent leg, not two merged.
    //
    // BUG FIX (Ask Largo standing mandate, 2026-10-21, live repro AMZN positionId 48 (root 44) +
    // AAPL positionId 40 (root 37)): the 2026-09-15 fix above (see its comment, now marked
    // SUPERSEDED) unconditionally NULLED entryPremium/peakPremium/troughPremium whenever the worst
    // leg wasn't the terminal leg, reasoning that the terminal leg's own price bounds don't belong
    // to the worst leg's journey — correct — but it never checked whether the WORST LEG'S OWN row
    // (`worstLegRow`, already resolved two lines above and already used to borrow strike/mid/delta)
    // carries these same three columns. It does: `entry_premium`/`peak_premium`/`trough_premium` are
    // per-row columns on `swing_positions` (SwingPositionRow), exactly the same class as
    // `contract_strike`/`last_mark`/`contract_delta`, which this function ALREADY correctly borrows
    // from `worstLegRow` via `worstLegBundle` two lines below. There never was a "no per-leg
    // equivalent" case for these fields — that was this code's own misconception, not a real data
    // gap. Live: AMZN leg 44 (the worst leg, -27.67%) has its own real `entry_premium: 5.15`,
    // `peak_premium`/`trough_premium` likewise real — the served row nulled all three instead of
    // showing them, despite `worstLegRow` sitting in scope with the real values. Same for AAPL leg
    // 37 (entry_premium: 6.73, -22.3%). Fix: borrow entryPremium/peakPremium/troughPremium from
    // `worstLegRow` the same way contract identity/mid/delta already are, falling back to omission
    // only in the genuine absence case (the column itself is null on that row — a real data gap,
    // not a leg-mismatch one).
    const worstLegRow = worstLegIsTerminal
      ? null
      : (ordered.find((r) => {
          const pnl = fin(r.realized_pnl_pct);
          return pnl != null && round2(pnl) === compositePnl;
        }) ?? null);
    const worstLegBundle = worstLegRow ? contractBundleFromRow(worstLegRow) : null;
    const worstLegEntryPremium =
      worstLegRow?.entry_premium != null ? round2(worstLegRow.entry_premium) : null;
    const worstLegPeakPremium =
      worstLegRow?.peak_premium != null ? round2(worstLegRow.peak_premium) : null;
    const worstLegTroughPremium =
      worstLegRow?.trough_premium != null ? round2(worstLegRow.trough_premium) : null;
    // BUG FIX (Ask Largo standing mandate, 2026-10-31, live repro AMZN positionId 48 (root 44),
    // 5th site of the same bug class as the four fixes above): `...src` (the spread below) carries
    // `entryTriggerUnderlyingPx`/`invalidationUnderlyingPx`/`exitAt`/`committedAt`/`firstSeenAt`
    // from the TERMINAL leg (`closedDeckSourceFromRow(terminal)`) — every one of the four prior
    // fixes re-pointed a different field (positionId, contract/occ/mid/delta, entry/peak/trough
    // premium) at the worst leg's own row when it isn't the terminal leg, but left these five
    // untouched, so the identical mismatch survived one layer deeper. All five are genuine per-leg
    // columns on `swing_positions` (`entry_underlying_px`/`thesis_invalidation_px`/`closed_at`/
    // `graded_at`/`committed_at`/`first_seen_at` — db.ts `SwingPositionRow`), the same class as
    // `entry_premium`/`contract_delta` already borrowed above — there was never a "no per-leg
    // equivalent" gap here either, same misconception the 2026-10-21 fix's comment names for
    // entryPremium/peakPremium/troughPremium.
    //
    // Consequence, live-confirmed: `closedCoaching` (play-brief-narrative-coaching.ts) narrates
    // "Stop fired — entry **X** vs invalidation **Y**, a **Z%** cushion at commit" using
    // `entryTriggerUnderlyingPx`/`invalidationUnderlyingPx` specifically for a `closedReason ===
    // "stopped"` play — and `closedReason` above is ALREADY the worst leg's own composite reason.
    // AMZN root 44 (the worst leg, -27.67%, correctly named/priced/dated by the four prior fixes)
    // paired its own real loss with leg 48's (terminal, +72.41%) own entry-trigger/invalidation
    // underlying prices (247.45/241.58) — a specific, checkable, false "cushion at commit" claim
    // about a trade that was never leg 44's. Same shape for `exitAt`: `closedSection` (play-brief.ts)
    // renders "Exit P&L: **-27.67%** / Reason: **stopped** / Closed: **<date>**" as one connected
    // "Outcome" block — pairing the worst leg's own P&L/reason with the TERMINAL leg's own close
    // date (when the chain finally finished, not when leg 44 itself rolled away) is the same
    // cross-leg pairing bug, one field over. `committedAt`/`firstSeenAt` get the identical fix for
    // the same reason — `playTriggeredEvent` (play-card-lifecycle.ts) documents `firstFlaggedAt`
    // (== `committedAt`) as "when the trade started" for a closed row, which must mean the leg whose
    // outcome is actually being shown, not a different leg's own entry.
    //
    // Fix: borrow all five from `worstLegRow` the same way contract/mid/delta/premiums already are,
    // falling back to `src`'s own (terminal) value only when the worst leg IS the terminal leg
    // (`worstLegRow` is `null` in exactly that case) — same `worstLegIsTerminal` gate every sibling
    // field above already uses, no new branch invented.
    const worstLegEntryTriggerUnderlyingPx = worstLegRow ? fin(worstLegRow.entry_underlying_px) : null;
    const worstLegInvalidationUnderlyingPx = worstLegRow ? fin(worstLegRow.thesis_invalidation_px) : null;
    const worstLegExitAt = worstLegRow ? worstLegRow.closed_at ?? worstLegRow.graded_at : null;
    const worstLegCommittedAt = worstLegRow ? worstLegRow.committed_at : null;
    const worstLegFirstSeenAt = worstLegRow ? worstLegRow.first_seen_at : null;
    // BUG FIX (Ask Largo standing mandate, 2026-11-01, 6th site of the same bug class as the five
    // fixes above — caught by audit before a live wrong-boolean repro, unlike those five's live
    // reproductions): `trimEnforcedBeforeClose` was the one remaining field still surviving
    // unconditionally from the `...src` spread below (`closedDeckSourceFromRow(terminal)`'s own
    // `scale_out_grade.trim_enforced_before_close`), never re-pointed at `worstLegRow` the way
    // positionId / entryPremium|peakPremium|troughPremium / contract|occ|mid|delta /
    // entryTriggerUnderlyingPx|invalidationUnderlyingPx / exitAt|committedAt|firstSeenAt all already
    // are. `trim_enforced_before_close` is a real per-row fact persisted onto `scale_out_grade` at
    // grade time (db.ts's `gradeSwingPosition`, from that row's OWN pre-update status) — the same
    // per-leg class as every sibling field above, so there is no "no per-leg equivalent" exception
    // here either. Consequence: for a worst-leg != terminal-leg chain, this field would describe the
    // TERMINAL leg's own trim history while `closedReason`/`exitPnlPct` on the exact same served card
    // already correctly describe the WORST leg — `adapters.ts`'s exit-ladder "fired" gate
    // (`status === "TRIM" || src.trimEnforcedBeforeClose === true`) and the CLOSED-bucket "TARGET"
    // badge (`play-card-lifecycle.ts`) would both be gated on the wrong leg's own trim history. Fix:
    // borrow it from `worstLegRow` via the same `trimEnforcedBeforeCloseFromScaleOutGrade` parser
    // used for the single-leg path, falling back to `src`'s own (terminal) value only when the worst
    // leg IS the terminal leg — the identical `worstLegIsTerminal` gate every sibling field uses.
    const worstLegTrimEnforcedBeforeClose = worstLegRow
      ? trimEnforcedBeforeCloseFromScaleOutGrade(worstLegRow.scale_out_grade)
      : null;
    // BUG FIX (Ask Largo standing mandate, 2026-11-02, 7th site of the same bug class as the six
    // fixes above): `cortex`/`budgetVerdict`/`laneRankAtCommit` are set once in
    // `closedDeckSourceFromRow` (above) from `row.entry_context.cortex`/`.budget_verdict`/
    // `.lane_rank_at_commit` — real per-row JSONB columns on `swing_positions`, the same class as
    // `entry_premium`/`contract_delta`/`entry_underlying_px` already re-pointed above. They were
    // never added to the re-pointing list and survive unconditionally via the `...src` spread
    // below (`src` is always `closedDeckSourceFromRow(terminal)`), so a worst-leg != terminal-leg
    // chain pairs the worst leg's own P&L/contract/exit identity (already correctly re-pointed by
    // the six fixes above) with the TERMINAL leg's own Cortex veto/decision snapshot, budget
    // verdict, and lane rank at commit — the same cross-leg mismatch, one field further. Reachable:
    // `terminalPlayFromClosedSwing` (adapters.ts) carries `src.cortex`/`src.budgetVerdict`/
    // `src.laneRankAtCommit` straight into every served `TerminalPlay` for CLOSED swing cards. Fix:
    // borrow all three from `worstLegRow.entry_context` the same way every sibling field above
    // already does, falling back to `src`'s own (terminal) value only when the worst leg IS the
    // terminal leg — the identical `worstLegIsTerminal` gate every sibling field uses.
    const worstLegCortex = worstLegRow ? worstLegRow.entry_context?.cortex ?? null : null;
    const worstLegBudgetVerdict = worstLegRow ? worstLegRow.entry_context?.budget_verdict ?? null : null;
    const worstLegLaneRankAtCommit = worstLegRow
      ? worstLegRow.entry_context?.lane_rank_at_commit ?? null
      : null;
    out.push({
      ...src,
      // BUG FIX (Ask Largo standing mandate, 2026-10-22, live repro AMZN positionId 48 (root 44) +
      // AAPL positionId 40 (root 37)): every sibling field above (contract/occ/mid/delta, and the
      // 2026-10-21 fix's entryPremium/peakPremium/troughPremium) is already re-pointed at the worst
      // leg's own row when it isn't the terminal leg — but `positionId` stayed unconditionally
      // `src.positionId` (the TERMINAL leg's own `row.id`, from `closedDeckSourceFromRow`), the one
      // identity field nobody had re-pointed yet. Consequence: the served card's CONTENT describes
      // the worst leg (its contract, its mid/delta, its premium bounds, its P&L) while its IDENTITY
      // points at a different, real leg entirely. Concretely, `play-brief-resolve.ts`'s
      // `loadClosedPlay` resolves a brief request by `r.id === positionId` — clicking through on the
      // served AMZN card (`positionId: 48`) would resolve leg 48 itself and build a PER-LEG brief
      // from `closedDeckSourceFromRow(terminal)`, i.e. leg 48's own +72.41% outcome — directly
      // contradicting the card the member just clicked, which correctly showed leg 44's -27.67%.
      // Fix: borrow `positionId` from `worstLegRow` the same way every other identity/content field
      // already does, falling back to `src.positionId` only when the worst leg IS the terminal leg
      // (`worstLegRow` is `null` in exactly that case) or the worst leg's own row can't be resolved.
      positionId: worstLegRow?.id ?? src.positionId,
      exitPnlPct: compositePnl ?? src.exitPnlPct,
      entryPremium: worstLegIsTerminal ? src.entryPremium : worstLegEntryPremium,
      peakPremium: worstLegIsTerminal ? src.peakPremium : worstLegPeakPremium,
      troughPremium: worstLegIsTerminal ? src.troughPremium : worstLegTroughPremium,
      entryTriggerUnderlyingPx: worstLegIsTerminal ? src.entryTriggerUnderlyingPx : worstLegEntryTriggerUnderlyingPx,
      invalidationUnderlyingPx: worstLegIsTerminal ? src.invalidationUnderlyingPx : worstLegInvalidationUnderlyingPx,
      exitAt: worstLegIsTerminal ? src.exitAt : worstLegExitAt,
      committedAt: worstLegIsTerminal ? src.committedAt : worstLegCommittedAt,
      firstSeenAt: worstLegIsTerminal ? src.firstSeenAt : worstLegFirstSeenAt,
      trimEnforcedBeforeClose: worstLegIsTerminal ? src.trimEnforcedBeforeClose : worstLegTrimEnforcedBeforeClose,
      cortex: worstLegIsTerminal ? src.cortex : worstLegCortex,
      budgetVerdict: worstLegIsTerminal ? src.budgetVerdict : worstLegBudgetVerdict,
      laneRankAtCommit: worstLegIsTerminal ? src.laneRankAtCommit : worstLegLaneRankAtCommit,
      closedReason: compositeReason,
      reason: `${src.reason} · chain composite (${record.composite.gradedLegs} leg${record.composite.gradedLegs === 1 ? "" : "s"})`,
      ...(worstLegBundle
        ? {
            contract: {
              ...src.contract,
              strike: worstLegBundle.strike,
              right: worstLegBundle.right,
              expiry: worstLegBundle.expiry,
              dte: worstLegBundle.dte,
              mid: worstLegBundle.mid,
              delta: worstLegBundle.delta,
            },
            occ: worstLegBundle.occ,
          }
        : worstLegIsTerminal
          ? {}
          : { occ: null }),
    });
  }
  return out.sort((a, b) => {
    const at = Date.parse(a.exitAt ?? "") || 0;
    const bt = Date.parse(b.exitAt ?? "") || 0;
    return bt - at;
  });
}

/** Score floor constant for closed rows — matches live horizon plays. */
export const SWING_CLOSED_SCORE_FLOOR = HORIZONS.SWING.scoreFloor;
