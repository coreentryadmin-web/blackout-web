/**
 * Night Hawk — per-horizon play producer (remodel slice 3b).
 *
 * The brain that turns "8,000 tickers" into "here are the 0DTE, Swing, and LEAPS plays." It sits on top
 * of the two earlier slices:
 *   - horizons.ts       — the 3-lane spec (DTE windows, score floors, exit routing)
 *   - horizon-fanout.ts — one chain → best liquid contract per lane
 *
 * Given a pool of scored whole-market candidates (each with a direction + its full option chain), this
 * fans every candidate across the three windows and emits one structured play per (candidate × lane) that
 * actually has a tradeable contract. Each play is stamped COMMIT (score ≥ the lane's floor) or WATCH
 * (has a real contract but under the floor) — the same "shown but not committed" distinction the desk
 * already uses, now uniform across all three horizons. Lanes come back sorted by score, highest first.
 *
 * Pure and deterministic — no IO. Discovery (the whole-market scan) feeds it candidates; a live route or
 * the sim calls it; the grader/ledger consume its output. Unit-testable with synthetic candidates.
 */

import { HORIZON_ORDER, HORIZONS, type Horizon } from "./horizons";
import {
  fanOutChain,
  DEFAULT_LIQUIDITY,
  type ChainContract,
  type LiquidityGate,
  type PlayDirection,
  explodeChainRows,
} from "./horizon-fanout";
// Type-only imports (erased at build → no runtime cycle with swing/serving, which imports HorizonPlay
// as a type). These enrich a play with the OBSERVABLE swing state the serving router keys on.
import type { SwingArchetype, SwingSubLane, SwingSetupState, SwingEntryState } from "./swing/taxonomy";
import type { SwingServingSection } from "./swing/serving";
import type { SwingManageAction, SwingManageRung } from "./swing/manage";

/**
 * A whole-market candidate from discovery, with its full option chain attached.
 *
 * SCORING IS PER HORIZON, not one number. What makes a name a great 0DTE (hot intraday flow + gamma)
 * is NOT what makes it a great LEAPS (a durable thesis) — so each horizon scores the same candidate
 * through its OWN lens (slice 5 ships the three scorers: flow/gamma for 0DTE, momentum/accumulation for
 * Swing, the thesis composite for LEAPS). A name can COMMIT one lane and not even WATCH another.
 *
 * Provide `horizonScores` with a per-lane 0–100 score. `score` remains as a single-number fallback for
 * any lane `horizonScores` omits (used by the plumbing harness before the real scorers exist). A lane
 * whose resolved score is null/undefined is skipped entirely — no scorer, no play in that lane.
 */
export interface HorizonCandidate {
  ticker: string;
  /** LONG buys calls, SHORT buys puts. */
  direction: PlayDirection;
  /** Per-horizon conviction (0–100), each from that horizon's own scorer. Preferred over `score`. */
  horizonScores?: Partial<Record<Horizon, number>>;
  /** Single-number fallback conviction, used only for a horizon `horizonScores` doesn't cover. */
  score?: number;
  /** As-of date (YYYY-MM-DD) the DTEs are measured from. */
  asOfYmd: string;
  /** The name's full option chain (every listed expiry × strike). */
  chainRows: Parameters<typeof explodeChainRows>[1];
}

/** Resolve the conviction score for one candidate at one horizon: per-lane score wins, else the fallback. */
function scoreForHorizon(cand: HorizonCandidate, horizon: Horizon): number | null {
  const per = cand.horizonScores?.[horizon];
  if (per != null && Number.isFinite(per)) return per;
  if (cand.score != null && Number.isFinite(cand.score)) return cand.score;
  return null; // no score for this lane → this name isn't evaluated here
}

/** Whether a play is committed (over the lane's floor) or watch-only (real contract, under floor). */
export type PlayStatus = "COMMIT" | "WATCH";

/** One produced play: a candidate expressed at one horizon with a concrete, liquid contract. */
export interface HorizonPlay {
  ticker: string;
  direction: PlayDirection;
  horizon: Horizon;
  score: number;
  status: PlayStatus;
  contract: ChainContract;
  /** The lane's commit floor, and whether this score cleared it (for UI/debug transparency). */
  scoreFloor: number;
  /** Human summary of the chosen contract. */
  reason: string;

  // ── SWING-only enrichment (all OPTIONAL, ADDITIVE — 0DTE/LEAPS and every existing consumer ignore
  //    them; PR-12 wires the real reads). They carry the observable state the serving router keys on. ──
  /** The classified swing archetype (taxonomy.ts) — the calibration partition key. */
  archetype?: SwingArchetype;
  /** The contract sub-lane (Tactical/Standard/Extended) this play's DTE resolved to. */
  subLane?: SwingSubLane;
  /** Pre-entry setup maturity (setup-state.ts) — an OBSERVABLE the serving router branches on. */
  setupState?: SwingSetupState;
  /** Entry-execution stance (entry-model.ts) — the other OBSERVABLE the serving router branches on. */
  entryStatus?: SwingEntryState;
  /** For a live-position play, the pre-entry play it was entered from (ledger linkage, PR-10+). */
  parentPlayId?: string;
  /** The serving section this play resolved to (serving.ts) — stamped once the section router runs. */
  serving?: SwingServingSection;
  /** ISO instant the thesis was first observed (accumulation store). */
  firstSeenAt?: string;
  /** Underlying price when the thesis was first flagged — WATCH track anchor (stock-level proxy). */
  flagUnderlyingPx?: number | null;
  /**
   * The actual entry-trigger level (setup-state.ts's `triggerPx` / entry-model.ts's `triggerPx` —
   * both read `dossier.plan.entryUnderlyingPx`), distinct from `flagUnderlyingPx` above: the flag
   * anchor is PINNED to the price when the thesis was first flagged and never moves, while this is
   * the CURRENT live level a break/reclaim of would flip PRE_TRIGGER/FORMING to AT_TRIGGER/TRIGGERED
   * — the two can diverge once a dossier refreshes its plan on a later scan pass. Neither was ever
   * surfaced to the member as "the price that actually matters for entry" before this field existed
   * (found live 2026-09-12: a member read "Flag anchor" as the entry level, which it is not).
   */
  entryTriggerUnderlyingPx?: number | null;
  /**
   * Structural invalidation level in underlying terms (setup-state.ts's `invalidationPx`) — the
   * counterpart to `entryTriggerUnderlyingPx` above, needed to live-derive `setupState` for a
   * COMMITTED position the same way the WATCH lane already does (a committed row's dossier state
   * doesn't survive the WATCH→COMMIT transition, so this + `entryTriggerUnderlyingPx` + `liveSpot`
   * let `deriveSetupState` be called fresh on every read instead of leaving `setupState` permanently
   * null for live capital — Ask Largo standing mandate, #4076).
   */
  invalidationUnderlyingPx?: number | null;
  /**
   * Live underlying spot (the third leg `deriveSetupState` needs alongside the two levels above).
   * Also read by the WATCH track overlay (`HorizonDeckSource.liveSpot`, adapters.ts).
   */
  liveSpot?: number | null;
  /** Live swing book — option entry/mark/P&L when this row is an OPEN ledger position. */
  entryPremium?: number | null;
  livePnlPct?: number | null;
  peakPremium?: number | null;
  troughPremium?: number | null;
  /** ISO instant the ledger last observed a real option quote (last_mark_at). */
  markAsOf?: string | null;
  /** ISO instant capital was committed (live ledger). */
  committedAt?: string;
  /** Discovery provenance kinds (FLOW / STRUCTURE / CATALYST). */
  signalKinds?: string[];
  /**
   * Whether this play's archetype×sub-lane bucket has graduated the Wilson-LB ladder. Required for
   * COMMIT_NOW (serving.ts) — absent/false keeps a clean entry geometry in WAITING_FOR_ENTRY so the
   * desk never says "Act now" on a cold-book setup the model will not open.
   */
  bucketGraduated?: boolean;
  /** Pillar contributions for the desk (label + points) — optional SWING enrichment. */
  factors?: Array<{ label: string; points: number }>;
  /** SWING only, committed positions: present-pillar count at commit, ONLY when the entry read was
   *  degraded (dossier.ts's dataQuality.degraded) — see live-plays.ts's
   *  `entryPresentPillarsFromFeatureVector` for the full gap this closes. Null on a healthy entry. */
  entryPresentPillars?: number | null;
  /** Regime / archetype label blend for the desk, or null when absent. */
  regime?: string | null;
  /** SWING only: the raw industry-group RS facts behind the SECTOR_ROTATION signal (benchmark ETF/
   *  label, name/group %-returns, delta) — echoed off the dossier. Null/absent when no benchmark
   *  resolved or not enough history (honest absence, never fabricated). */
  sectorLeadershipFacts?: {
    benchmarkEtf: string;
    benchmarkLabel: string;
    kind: "industry" | "sector";
    nameReturnPct: number;
    groupReturnPct: number;
    deltaPct: number;
  } | null;
  /** Thesis-health level for the desk — "unknown" when no setup read (never a fabricated intact). */
  thesisLevel?: "intact" | "warn" | "break" | "unknown";
  thesisNote?: string | null;
  /** Open ledger row id when this play is live capital — disambiguates ticker collisions in briefs. */
  positionId?: number;
  /** Live-position status when this play is an OPEN swing (OPEN/HOLD/TRIM) — drives live sections. */
  liveStatus?: "OPEN" | "HOLD" | "TRIM";
  /** Management action for a live position (manage.ts) — drives MANAGING/SCALING_OUT/EXITING. */
  manageAction?: SwingManageAction;
  /** The manage-sync rung that decided manageAction (manage.ts) — e.g. "expiry_risk" (thesis still
   *  intact, time-based force-manage) vs "structural_stop"/"thesis_stop" (thesis actually broke).
   *  Null when no manage-sync snapshot has fired yet. Lets narrative text state the REAL reason
   *  instead of a generic "thesis or ladder fired" that is wrong whenever the real cause is a
   *  theta-cliff/time-based exit with the thesis fully intact. */
  manageReason?: SwingManageRung | null;
  /**
   * GAP FOUND (2026-09-18, Ask Largo standing mandate): `evaluateSwingManagement` (manage.ts)
   * computes a full, specific prose `reason` for every verdict alongside the bare rung name — e.g.
   * the exact structural-stop breach ("underlying 145.20 ≤ structural stop 148.00 — LONG thesis
   * broken in underlying terms") rather than just "structural_stop" — and `manage-sync.ts` persists
   * it verbatim onto every snapshot's `event_json.reason`. `live-plays.ts`'s
   * `manageObservablesFromEvent`, the sole reader of that event_json, only ever extracted the rung
   * (`manageReason` above) — never this specific sentence — so play-brief-narrative.ts's
   * sellReasonClause/trimReasonClause have always had to fall back to a generic canned phrase per
   * rung (e.g. "— thesis broke", with no level/price) even though the real, specific reason was
   * computed and persisted on the exact same tick. Null whenever no manage-sync snapshot has fired
   * yet, or the field is absent/malformed (an older snapshot shape) — never a guessed reason.
   */
  manageReasonDetail?: string | null;
  /**
   * GAP FOUND (2026-09-18, Ask Largo standing mandate): `evaluateSwingManagement` (manage.ts)
   * always computes `dteMigration`/`rollIntent` — theta-vs-thesis-progress disproportion at low
   * DTE, the SAME signal `roll.ts`'s executor actually acts on to auto-roll a still-valid thesis
   * — and `manage-sync.ts` persists BOTH into every snapshot's `event_json` (`dte_migration`/
   * `roll_intent`). But `live-plays.ts`'s `manageObservablesFromEvent`, the sole reader of that
   * event_json, only ever extracted `action`/`rung`/`thesis_state` — never these two — so a
   * position already flagged as a roll candidate (DTE inside the lane's migration horizon,
   * premium decaying faster than thesis progress) gave a member ZERO warning before the roll
   * executes. Command Deck has no UI for it either (grepped `src/features/nighthawk`: no hit).
   * Same wiring-gap shape as the FINDINGS 2026-08-06 SEV-3 greeks bug and its Ask-Largo sibling
   * fix (#5161, `play.greeks`) — data computed and persisted every tick, never read back out.
   *
   * `reason` is `rollIntent.roll === true` gating `dteMigration.reason`'s prose (the
   * post-veto-authoritative "yes" — vetoed by a broken thesis or a hit structural stop, exactly
   * as `roll.ts`'s own executor vetoes) — never `rollIntent.reason` verbatim. That was originally
   * to dodge a stale "(INTENT ONLY; execution deferred to PR-15)" note the string used to carry
   * from before PR-15 wired up live execution; that note was fixed at its source in manage.ts
   * (2026-09-20), but the preference for `dteMigration.reason` stands regardless — it is the
   * member-clean prose either way, and any snapshot row persisted before the 2026-09-20 fix still
   * has the stale text frozen in its stored `event_json` forever (a historical row is never
   * rewritten), so this call site still must not read `rollIntent.reason` verbatim.
   * Null whenever no snapshot has fired yet or the position isn't currently a roll candidate —
   * never fabricated, and never shown as a false "not a candidate" line (absence is silence,
   * matching this file's own null-honesty convention throughout).
   */
  rollCandidate?: { reason: string } | null;
  /**
   * GAP FOUND (2026-09-18, Ask Largo standing mandate): whether the rung that decided
   * `manageAction` is currently ENFORCED — true always for the four capital-preservation gates
   * (structural_stop/thesis_stop/expiry_risk/premium_stop), but for an EDGE rung (catalyst_shift,
   * regime_shift, flow_decay, rel_strength_loss, vol_collapse, time_stop, add_eligible) only once
   * that specific rung has graduated in the calibration ladder (manage.ts's `isEnforced`). Until
   * graduation the ledger itself takes NO action on that rung (`latchSwingLiveStatus`, manage-
   * sync.ts — only an enforced `profit_ladder` latches TRIM), so a member-facing recommendation
   * built from an un-graduated edge rung is advisory only, not something the system will act on.
   * `manageAction`/the "SELL"/"TRIM"/"BUY" recommendation badge previously carried no signal of
   * this distinction — an un-graduated advisory rung read with identical weight to a hard gate.
   * Null when no manage-sync snapshot has fired yet (never a fabricated true/false).
   */
  manageEnforced?: boolean | null;
  /** True when the thesis was observed this scan but has NOT cleared cross-session persistence. */
  persistenceObserved?: boolean;
  /** Honest reason the persistence gate has not promoted this name to WATCH yet. */
  persistenceGapReason?: string | null;
  /** V2 commit gates (G-S6/G-S14) that would block an open — stamped at discovery for honest BUY/WAIT UI. */
  commitGateBlockedBy?: string[];
  /**
   * GAP FOUND (2026-09-18, Ask Largo standing mandate): `archetype.ts`'s `classifyArchetype` always
   * computes a decisiveness `margin` (topFit − secondFit) alongside the winning label, and
   * `classificationMetaFromVerdict` pins that margin plus the ranked runner-up archetypes onto
   * `entry_context`/`feature_vector.classification_margin`/`.secondary` at commit (commit.ts,
   * discovery.ts) — captured specifically, per feature-vector.ts's own comment, "for later
   * mis/secondary-classification analysis." Every play-brief consumer read the pinned `score`
   * number and the `archetype_scores` blob's *primary* label off the same feature_vector
   * (live-plays.ts/closed-plays.ts) but never the margin or the runner-up sitting right next to it
   * — a member sees ONLY "Archetype: Breakout" with no signal that the classifier's own tie-break
   * logic (MARGIN_EPS=0.05) treats this as a near-coin-flip against, say, Pullback continuation.
   * That matters because scoring/gating/calibration all partition on this single label (feature-
   * vector.ts's own header: "Calibration keys off `archetype`/`primary` ONLY"), so a razor-thin
   * classification is a real, disclosed uncertainty the member has a right to see, not an internal
   * scoring detail. Same shape as `entryPresentPillars` a few lines up: pinned every tick, never
   * read back out until now.
   * Deliberately null unless the margin actually clears the classifier's own near-tie bar
   * (`ARCHETYPE_NEAR_TIE_MARGIN` in live-plays.ts, mirroring archetype.ts's own MARGIN_EPS) — a
   * decisive classification renders nothing extra, matching this file's honest-absence discipline.
   */
  archetypeNearTie?: { secondaryLabel: string; marginPct: number } | null;
  /**
   * GAP FOUND (2026-09-18, Ask Largo standing mandate): `dossier.ts`'s `SwingDossier.topFlowStrike`
   * (the multi-day accumulation flow's magnet strike) is pinned onto every committed position's
   * `top_flow_strike` column at commit (commit.ts) as "provenance for the contract pick" —
   * `contract-ranker.ts`'s `rankSwingContracts` independently chooses the best contract by
   * tradability×thesisFit (never influenced by the flow strike) and separately notes whether that
   * pick happens to equal the flow strike, but neither the raw number nor the match fact was ever
   * read back out anywhere in the serving/brief layer. See live-plays.ts's
   * `topFlowProvenanceFromRow` for the full gap this closes. Null whenever either strike is
   * unavailable — never a guessed provenance. `matchedPick` is recomputed from the two pinned
   * strikes, not a second persisted boolean (there isn't one).
   */
  topFlowProvenance?: { topFlowStrike: number; matchedPick: boolean } | null;
  /**
   * GAP FOUND (2026-09-18, Ask Largo standing mandate): `manage-sync.ts`'s `signedExcursionPct`
   * computes the UNDERLYING's own signed favorable/adverse excursion (%, direction-aware) since
   * entry on EVERY management tick and persists it as `running_mfe`/`running_mae` — dedicated
   * columns on `swing_position_snapshots`, also echoed into that tick's `feature_vector` blob
   * (feature-vector.ts) for the trajectory studies (`studyTwoStagnantSessions`,
   * `studyIvKillsGoodSetups`) to read. It answers a question distinct from anything already shown:
   * "how far has the underlying itself moved in my favor / against me since I entered" — separate
   * from the OPTION premium peak/P&L this brief already surfaces (a position can show modest
   * premium P&L while the underlying quietly ran hard favorable and gave most of it back, or vice
   * versa under IV effects). `fetchLatestSwingSnapshotEvents` (db.ts) selects only `event_json`/
   * `thesis_state` off the latest snapshot row — `running_mfe`/`running_mae` sit right next to
   * those on the same row and were never selected, so this real per-tick read never reached the
   * serving/brief layer for a single open position. Null whenever the latest snapshot hasn't
   * computed a usable excursion yet (fresh position, missing entry/spot) — never a fabricated 0%
   * (signedExcursionPct's own honest-null convention, mirrored here).
   */
  underlyingExcursion?: { mfePct: number; maePct: number } | null;
}

/** The three lanes a candidate pool fans out into. */
export type HorizonPlaySet = Record<Horizon, HorizonPlay[]>;

/** An empty play set (all three lanes present, per the spine's always-three invariant). */
function emptyPlaySet(): HorizonPlaySet {
  return { ZERO_DTE: [], SWING: [], LEAPS: [] };
}

/**
 * Fan a pool of candidates across all three horizons. Every (candidate × lane) that has BOTH a tradeable
 * contract AND a score for that lane becomes one play, stamped COMMIT/WATCH against the lane's floor —
 * scored through that horizon's OWN lens (see HorizonCandidate.horizonScores). A name absent from a
 * lane's scorer, or with no liquid contract there, simply doesn't appear in that lane. Each lane is
 * returned sorted by score (desc), then by delta-fit tie-break already applied inside the fan-out.
 */
export function produceHorizonPlays(
  candidates: HorizonCandidate[],
  gate: LiquidityGate = DEFAULT_LIQUIDITY,
): HorizonPlaySet {
  const out = emptyPlaySet();

  for (const cand of candidates) {
    if (!cand.ticker) continue;
    const picks = fanOutChain(cand.ticker, cand.chainRows, cand.asOfYmd, cand.direction, gate);
    for (const pick of picks) {
      if (!pick.contract) continue; // no liquid contract at this horizon → this name simply isn't in this lane
      const score = scoreForHorizon(cand, pick.horizon);
      if (score == null) continue; // this horizon's scorer didn't rate this name → not in this lane
      const spec = HORIZONS[pick.horizon];
      out[pick.horizon].push({
        ticker: cand.ticker.toUpperCase(),
        direction: cand.direction,
        horizon: pick.horizon,
        score,
        status: score >= spec.scoreFloor ? "COMMIT" : "WATCH",
        contract: pick.contract,
        scoreFloor: spec.scoreFloor,
        reason: pick.reason,
      });
    }
  }

  for (const h of HORIZON_ORDER) {
    out[h].sort((a, b) => b.score - a.score);
  }
  return out;
}

/** The committed plays only (score ≥ floor) for a lane — what the desk surfaces as a live play. */
export function committedPlays(set: HorizonPlaySet, horizon: Horizon): HorizonPlay[] {
  return set[horizon].filter((p) => p.status === "COMMIT");
}

/** The watch-only plays (real contract, under floor) for a lane — the "skipped & watching" rail. */
export function watchPlays(set: HorizonPlaySet, horizon: Horizon): HorizonPlay[] {
  return set[horizon].filter((p) => p.status === "WATCH");
}

/** Flat count of committed plays across all three lanes. */
export function totalCommitted(set: HorizonPlaySet): number {
  return HORIZON_ORDER.reduce((n, h) => n + committedPlays(set, h).length, 0);
}
