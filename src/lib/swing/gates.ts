// src/lib/swing/gates.ts — the SWING 3-way decision gate: COMMIT / WATCH / SKIP (PR-5).
//
// This is the decision layer that turns a scored dossier + a chosen contract into a verdict. Its ONE hard rule,
// and the reason this PR exists, is the ENFORCE-vs-EVIDENCE split (SEV-5):
//
//   • STRUCTURAL gates ENFORCE. These are mechanical TRADEABILITY facts, not opinions about edge: the contract
//     isn't liquid, the spread is too wide, the quote is stale, the daily bar hasn't closed, there isn't enough
//     time to expiry, the thesis already broke, an earnings/binary event sits in the window without explicit
//     authorization, or we simply don't have the context to judge (fail-CLOSED). Any of these VETOES the trade —
//     downgrading the verdict to SKIP (hard-invalid) or WATCH (transient/data). `enforced: true`.
//
//   • EDGE gates are EVIDENCE-ONLY. `reward_risk_floor` (1.8 R:R) and `entry_extended` (0.5·ATR) express a view
//     about whether the trade is GOOD, and their thresholds are UNGRADUATED — no swing bucket has earned them
//     yet. So they log `wouldBlock: true` for the record but `enforced: false`, and they DO NOT change the
//     verdict. They graduate into enforcement only through calibration.ts (PR-16), never by fiat here.
//
// The score-floor comparison (score ≥ the archetype/sub-lane provisional floor) is likewise EVIDENCE-ONLY: the
// floors ship `scoreFloorGraduated: false`, so clearing the floor ROUTES a structurally-clean setup to COMMIT
// vs WATCH on the desk — it does not authorize sizing. Nothing here graduated is what enforces real risk; that
// stays with the ledger + calibration ladder.
//
// PURE & deterministic — no IO. Reuses the canonical setup-state / entry-model / theme resolvers so the gate
// and the (future) allocator agree on the same partitions.

import type { ChainContract, LiquidityGate } from "../horizon-fanout";
import { ARCHETYPE_META, SWING_SUB_LANES, type SwingSetupState } from "./taxonomy";
import type { SwingDossier } from "./dossier";
import { deriveSetupState, type SetupStateReads } from "./setup-state";
import { deriveEntryPlan, type EntryReads, type SwingEntryPlan } from "./entry-model";
import { checkPortfolioOverlap, type PortfolioPosition } from "./portfolio";

export type SwingVerdict = "COMMIT" | "WATCH" | "SKIP";

/** How an enforced structural block downgrades the verdict. Hard-invalid → SKIP; transient/data → WATCH. */
export type BlockSeverity = "SKIP" | "WATCH";

export interface GateBlock {
  code: string;
  /** "structural" gates enforce; "edge" gates are evidence-only. */
  kind: "structural" | "edge";
  /** True when the gate actually vetoes the verdict. Structural: true. Edge: false (evidence-only). */
  enforced: boolean;
  /** True when the gate's condition tripped (structural: same as a veto; edge: logged but not enforced). */
  wouldBlock: boolean;
  /** For enforced structural blocks, the verdict floor they impose; null for edge gates. */
  severity: BlockSeverity | null;
  reason: string;
  detail?: Record<string, number | string | boolean | null>;
}

export interface SoftPenalty {
  code: string;
  /** Advisory points (evidence-only; the desk may discount the score, the gate never subtracts risk). */
  points: number;
  reason: string;
}

export interface GateCalibration {
  /** v1: always false — the floors are provisional until their bucket graduates (calibration.ts, PR-16). */
  scoreFloorGraduated: boolean;
  /** Provisional per-archetype commit floor, or null when unclassified. */
  archetypeFloor: number | null;
  /** Provisional per-sub-lane commit floor, or null when no sub-lane. */
  subLaneFloor: number | null;
  /** The effective floor used to route COMMIT vs WATCH = max(present floors), or null when neither present. */
  effectiveFloor: number | null;
  score: number;
  /** Whether the score cleared the effective floor; null when no floor could be resolved. */
  clearsFloor: boolean | null;
  note: string;
}

export interface SwingGateResult {
  verdict: SwingVerdict;
  setupState: SwingSetupState;
  entryPlan: SwingEntryPlan;
  blocks: GateBlock[];
  softPenalties: SoftPenalty[];
  calibration: GateCalibration;
}

/** Everything the pure gate needs from the outside world. Missing critical fields ⇒ fail-CLOSED (SKIP). */
export interface SwingGateContext {
  /** As-of for the entry deadline; defaults to now. */
  asOf?: string | number | Date;
  /** Liquidity gate to clear — normally the sub-lane's spec gate. */
  liquidity: LiquidityGate;
  /** Price-vs-level reads for setup maturity. */
  setupReads: SetupStateReads;
  /** Price-vs-zone reads for the entry model. */
  entryReads: EntryReads;
  /** Age of the contract's quote in ms; > quoteMaxAgeMs ⇒ quote_stale (WATCH). Null ⇒ unknown (not stale). */
  quoteAgeMs?: number | null;
  quoteMaxAgeMs?: number;
  /** False ⇒ the reference daily bar has not closed (daily_bar_incomplete, WATCH). Null/true ⇒ fine. */
  dailyBarComplete?: boolean | null;
  /** Reward:risk of the underlying-terms plan; < 1.8 trips the EVIDENCE-ONLY reward_risk_floor gate. */
  rewardRiskRatio?: number | null;
  /** ATR(14) for the entry_extended edge gate. */
  atr?: number | null;
  /** An earnings report sits inside the holding window. */
  earningsInWindow?: boolean | null;
  /** A binary event (FDA/PDUFA/vote) sits inside the holding window. */
  binaryEventInWindow?: boolean | null;
  /** Explicit authorization to hold through the above event — without it, the event vetoes (SKIP). */
  eventAuthorized?: boolean;
  /** The open book, for the evidence-only portfolio-overlap soft flag. */
  existingPositions?: PortfolioPosition[];
}

const isNum = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

const RR_FLOOR = 1.8; // ungraduated — evidence-only.
const ENTRY_EXTENDED_ATR_MULT = 0.5; // ungraduated — evidence-only.
const DEFAULT_QUOTE_MAX_AGE_MS = 5 * 60 * 1000;

/** Local re-implementation of horizon-fanout's (module-private) `clearsLiquidity`, SPLIT into OI/premium/quote
 *  presence vs. spread so the two can surface as distinct structural gates. Kept in lock-step with that gate's
 *  logic; PR-5 must not widen its blast radius by exporting from horizon-fanout. */
function liquidityCore(c: ChainContract, gate: LiquidityGate): { ok: boolean; reason: string } {
  if (c.openInterest < gate.minOpenInterest)
    return { ok: false, reason: `OI ${c.openInterest} < min ${gate.minOpenInterest}` };
  if (c.mid == null || c.mid <= 0) return { ok: false, reason: "no valid mid (quote absent)" };
  if (c.mid > gate.maxPremiumPerShare)
    return { ok: false, reason: `mid ${c.mid.toFixed(2)} > premium cap ${gate.maxPremiumPerShare}` };
  if (c.bid == null || c.ask == null) return { ok: false, reason: "bid/ask absent" };
  return { ok: true, reason: "ok" };
}

function spreadPctOf(c: ChainContract): number | null {
  if (c.bid == null || c.ask == null || c.mid == null || c.mid <= 0) return null;
  return (c.ask - c.bid) / c.mid;
}

function skipBlock(code: string, reason: string, detail?: GateBlock["detail"]): GateBlock {
  return { code, kind: "structural", enforced: true, wouldBlock: true, severity: "SKIP", reason, detail };
}
function watchBlock(code: string, reason: string, detail?: GateBlock["detail"]): GateBlock {
  return { code, kind: "structural", enforced: true, wouldBlock: true, severity: "WATCH", reason, detail };
}

/**
 * Evaluate the swing gate stack. Structural gates enforce (SKIP/WATCH); edge gates log `wouldBlock` without
 * touching the verdict; the score-floor routes COMMIT vs WATCH on a structurally-clean, TRIGGERED setup.
 */
export function evaluateSwingGates(
  dossier: SwingDossier,
  contract: ChainContract | null,
  ctx: SwingGateContext | null | undefined,
): SwingGateResult {
  const blocks: GateBlock[] = [];
  const softPenalties: SoftPenalty[] = [];

  // ── gate_context_unavailable — FAIL CLOSED. If we cannot assemble the inputs to judge tradeability, we do
  //    not guess; we SKIP. (A missing feed must never read as a green light.) ──
  if (contract == null || ctx == null || ctx.liquidity == null || ctx.setupReads == null || ctx.entryReads == null) {
    blocks.push(
      skipBlock(
        "gate_context_unavailable",
        "Gate context incomplete (missing contract / liquidity gate / setup or entry reads) — failing closed to SKIP.",
      ),
    );
    return failClosedResult(dossier, blocks);
  }

  const setupState = deriveSetupState(dossier, ctx.setupReads);
  const entryPlan = deriveEntryPlan(dossier, contract, ctx.entryReads, ctx.asOf);

  // ── STRUCTURAL (enforce) ──────────────────────────────────────────────────────────────────────

  // liquidity — OI / premium cap / quote presence.
  const liq = liquidityCore(contract, ctx.liquidity);
  if (!liq.ok) blocks.push(skipBlock("liquidity", `Contract fails liquidity gate: ${liq.reason}.`, { detail: liq.reason }));

  // spread — a distinct structural gate (only meaningful once quotes exist).
  const spreadPct = spreadPctOf(contract);
  if (spreadPct != null && spreadPct > ctx.liquidity.maxSpreadPct) {
    blocks.push(
      skipBlock("spread", `Spread ${(spreadPct * 100).toFixed(1)}% > max ${(ctx.liquidity.maxSpreadPct * 100).toFixed(1)}%.`, {
        spreadPct: Math.round(spreadPct * 1000) / 1000,
      }),
    );
  }

  // expiry_insufficient — the intended DTE must land in a sub-lane, and the contract must carry its floor of days.
  if (dossier.subLane == null) {
    blocks.push(skipBlock("expiry_insufficient", "No sub-lane for the intended DTE (outside the 2–30 SWING window)."));
  } else {
    const spec = SWING_SUB_LANES[dossier.subLane];
    if (contract.dte < spec.dteMin) {
      blocks.push(
        skipBlock("expiry_insufficient", `Contract ${contract.dte}DTE < sub-lane ${dossier.subLane} floor ${spec.dteMin}DTE.`, {
          dte: contract.dte,
          floor: spec.dteMin,
        }),
      );
    }
  }

  // thesis_invalidated — a broken thesis is not tradeable, no matter the score.
  if (setupState === "INVALIDATED") {
    blocks.push(skipBlock("thesis_invalidated", "Setup INVALIDATED — price closed through the structural invalidation level."));
  }

  // earnings / binary event in window without explicit authorization.
  const hasEvent = ctx.earningsInWindow === true || ctx.binaryEventInWindow === true;
  if (hasEvent && ctx.eventAuthorized !== true) {
    const which = ctx.binaryEventInWindow === true ? "binary event" : "earnings";
    blocks.push(
      skipBlock("event_in_window", `${which} inside the holding window without explicit authorization — SKIP (binary-gap risk).`),
    );
  }

  // quote_stale — transient; the quote will refresh, so WATCH rather than SKIP.
  const quoteMaxAge = ctx.quoteMaxAgeMs ?? DEFAULT_QUOTE_MAX_AGE_MS;
  if (isNum(ctx.quoteAgeMs) && ctx.quoteAgeMs > quoteMaxAge) {
    blocks.push(
      watchBlock("quote_stale", `Quote ${Math.round(ctx.quoteAgeMs / 1000)}s old > max ${Math.round(quoteMaxAge / 1000)}s — WATCH until fresh.`, {
        quoteAgeMs: ctx.quoteAgeMs,
      }),
    );
  }

  // daily_bar_incomplete — the reference bar hasn't closed; the read may shift, so WATCH.
  if (ctx.dailyBarComplete === false) {
    blocks.push(watchBlock("daily_bar_incomplete", "Reference daily bar has not closed — WATCH until the session settles."));
  }

  // ── EDGE (evidence-only — log wouldBlock, DO NOT enforce) ────────────────────────────────────────
  if (isNum(ctx.rewardRiskRatio) && ctx.rewardRiskRatio < RR_FLOOR) {
    blocks.push({
      code: "reward_risk_floor",
      kind: "edge",
      enforced: false,
      wouldBlock: true,
      severity: null,
      reason: `R:R ${ctx.rewardRiskRatio.toFixed(2)} < provisional floor ${RR_FLOOR} — logged, NOT enforced (ungraduated threshold).`,
      detail: { rewardRiskRatio: Math.round(ctx.rewardRiskRatio * 100) / 100, floor: RR_FLOOR },
    });
  }

  const extendedByState = entryPlan.entryState === "EXTENDED_CHASE";
  const extendedByDistance = entryExtendedByDistance(dossier, ctx);
  if (extendedByState || extendedByDistance) {
    blocks.push({
      code: "entry_extended",
      kind: "edge",
      enforced: false,
      wouldBlock: true,
      severity: null,
      reason: `Entry is >${ENTRY_EXTENDED_ATR_MULT}·ATR past the trigger (chase) — logged, NOT enforced (ungraduated threshold).`,
      detail: { entryState: entryPlan.entryState },
    });
  }

  // ── SOFT PENALTIES (evidence-only) ──────────────────────────────────────────────────────────────
  // DEGRADED read → the SEV-6 soft flag on TRIGGERED: penalize, don't drop.
  if (dossier.dataQuality.degraded) {
    softPenalties.push({
      code: "degraded_read",
      points: 8,
      reason: `Thin read (${dossier.dataQuality.presentPillars} pillars; missing ${dossier.dataQuality.missing.join(", ") || "none"}).`,
    });
  }
  // Portfolio overlap (evidence-only): flag concentration / internal conflict against the open book.
  if (dossier.direction != null) {
    const overlap = checkPortfolioOverlap(
      { ticker: dossier.ticker, direction: dossier.direction },
      ctx.existingPositions ?? [],
    );
    if (overlap.hasOverlap) {
      softPenalties.push({
        code: "portfolio_overlap",
        points: overlap.sameThemeOpposedDirection.length > 0 ? 10 : 5,
        reason: overlap.reason,
      });
    }
  }

  // ── CALIBRATION (evidence-only score-floor routing) ─────────────────────────────────────────────
  const calibration = buildCalibration(dossier);

  // ── VERDICT ─────────────────────────────────────────────────────────────────────────────────────
  const verdict = deriveVerdict(blocks, setupState, calibration);

  return { verdict, setupState, entryPlan, blocks, softPenalties, calibration };
}

/** Is the entry more than 0.5·ATR past the trigger by raw distance (independent of the coarse entryState)? */
function entryExtendedByDistance(dossier: SwingDossier, ctx: SwingGateContext): boolean {
  const dir = dossier.direction;
  const price = ctx.entryReads.price;
  const trigger = ctx.entryReads.triggerPx;
  const atr = isNum(ctx.atr) ? ctx.atr : isNum(ctx.entryReads.atr) ? ctx.entryReads.atr : null;
  if (dir == null || !isNum(price) || !isNum(trigger) || atr == null || atr <= 0) return false;
  const past = dir === "LONG" ? price - trigger : trigger - price;
  return past > ENTRY_EXTENDED_ATR_MULT * atr;
}

function buildCalibration(dossier: SwingDossier): GateCalibration {
  const archetype = dossier.archetype.archetype;
  const archetypeFloor = archetype ? ARCHETYPE_META[archetype].scoreFloor : null;
  const subLaneFloor = dossier.subLane ? SWING_SUB_LANES[dossier.subLane].scoreFloor : null;
  const floors = [archetypeFloor, subLaneFloor].filter((f): f is number => f != null);
  const effectiveFloor = floors.length ? Math.max(...floors) : null;
  const score = dossier.score.score;
  const clearsFloor = effectiveFloor == null ? null : score >= effectiveFloor;
  return {
    scoreFloorGraduated: false, // v1 invariant — provisional until the bucket graduates (PR-16).
    archetypeFloor,
    subLaneFloor,
    effectiveFloor,
    score,
    clearsFloor,
    note:
      effectiveFloor == null
        ? "No provisional floor resolved (unclassified / no sub-lane) — score-floor cannot route COMMIT."
        : `Score ${score} vs provisional floor ${effectiveFloor} (evidence-only: routes COMMIT/WATCH, does not size).`,
  };
}

/**
 * Final verdict. Precedence: any enforced SKIP → SKIP; else any enforced WATCH → WATCH; else the setup must be
 * TRIGGERED and clear the (evidence-only) score floor to route COMMIT, otherwise WATCH. Edge gates never appear
 * here — they are evidence-only by construction.
 */
function deriveVerdict(blocks: GateBlock[], setupState: SwingSetupState, cal: GateCalibration): SwingVerdict {
  const enforced = blocks.filter((b) => b.enforced);
  if (enforced.some((b) => b.severity === "SKIP")) return "SKIP";
  if (enforced.some((b) => b.severity === "WATCH")) return "WATCH";

  // Structurally clean. Only a TRIGGERED setup is actionable now; FORMING/EXTENDED wait on the WATCH rail.
  if (setupState !== "TRIGGERED") return "WATCH";

  // Score-floor is EVIDENCE-ONLY routing: clears floor → COMMIT rail; below → WATCH rail. It sizes nothing.
  if (cal.clearsFloor === true) return "COMMIT";
  return "WATCH";
}

/** Shape a fail-closed SKIP result without needing valid downstream context (no contract to build an entry). */
function failClosedResult(dossier: SwingDossier, blocks: GateBlock[]): SwingGateResult {
  return {
    verdict: "SKIP",
    setupState: "FORMING",
    entryPlan: {
      entryState: "PRE_TRIGGER",
      entryLimitPx: null,
      entryDeadline: new Date().toISOString(),
      actualFill: null,
      subLane: dossier.subLane,
      reason: "Fail-closed: gate context unavailable.",
    },
    blocks,
    softPenalties: [],
    calibration: buildCalibration(dossier),
  };
}
