// src/lib/swing/entry-model.ts — the SWING entry-execution model (PR-5).
//
// A setup being TRIGGERED (setup-state.ts) says the thesis is live; it does NOT say WHERE or by WHEN to enter.
// This module produces that plan: the entry-execution stance (`SwingEntryState`) from price-vs-trigger, the
// limit level to work, and — critically — an ENTRY-VALIDITY DEADLINE that is DISTINCT from the option's expiry.
//
// TWO invariants the drafts kept violating (both asserted in the tests):
//   • `actualFill` is ALWAYS null here. A plan is a plan, never its own fill. A real fill is written later by
//     the execution/ledger layer; fabricating an entry price from the plan is the "phantom fill" bug that
//     poisons every downstream P&L and grade. Null until a REAL fill exists — a null is honest, a fabricated
//     number is a lie.
//   • `entryDeadline !== contract.expiry`. The window to ENTER a setup cleanly (a few days — the trigger goes
//     stale, the edge decays) is a different clock from when the OPTION expires (weeks out). Conflating them
//     let stale setups look enterable for the life of the contract. The deadline here is a short, sub-lane-
//     scoped ISO timestamp, always strictly before expiry.
//
// DIRECTION-AWARE & PURE — no IO. Evidence-only: the plan surfaces on the desk; it sizes and fills nothing.

import type { PlayDirection, ChainContract } from "../horizon-fanout";
import type { SwingEntryState, SwingSubLane } from "./taxonomy";
import type { SwingDossier } from "./dossier";

/** Grounded reads placing current price against the entry zone. Every field nullable (null ≠ 0). */
export interface EntryReads {
  /** Current underlying price. */
  price: number | null;
  /** The trigger level the thesis fires on. */
  triggerPx: number | null;
  /** The far edge of the acceptable pullback entry zone (support below the trigger for LONG / resistance
   *  above it for SHORT). Price between this and the trigger is a PULLBACK_TO_ENTRY. */
  entryZoneFar?: number | null;
  /** ATR(14) — sizes the EXTENDED_CHASE distance (0.5·ATR past the trigger, ties to the entry_extended gate). */
  atr?: number | null;
}

export interface SwingEntryPlan {
  /** Where price sits vs the trigger → the entry-execution stance. */
  entryState: SwingEntryState;
  /** The limit level to work (the trigger, or the pullback zone edge); null when ungroundable. */
  entryLimitPx: number | null;
  /** Entry-validity deadline as an ISO timestamp — the setup is stale after this. NOT the option expiry
   *  (invariant: entryDeadline !== contract.expiry), and always strictly before it. */
  entryDeadline: string;
  /** ALWAYS null here — a real fill is written by the ledger/execution layer, never fabricated from the plan. */
  actualFill: number | null;
  /** The contract sub-lane (from the dossier) that scoped the entry-validity window. */
  subLane: SwingSubLane | null;
  reason: string;
}

const isNum = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

/** How long a triggered setup stays enterable, per sub-lane. Faster lanes go stale faster — a Tactical
 *  trigger that hasn't filled in ~2 days has lost its edge; an Extended thesis tolerates a longer entry. */
const ENTRY_VALIDITY_DAYS: Record<SwingSubLane, number> = {
  TACTICAL: 2,
  STANDARD: 3,
  EXTENDED: 5,
};
const DEFAULT_ENTRY_VALIDITY_DAYS = 3;

/** Fraction of ATR past the trigger beyond which entry is an EXTENDED_CHASE (ties to gates.entry_extended). */
const CHASE_ATR_MULT = 0.5;

const DAY_MS = 86_400_000;

function toMs(asOf: string | number | Date | undefined): number {
  if (asOf == null) return Date.now();
  const d = asOf instanceof Date ? asOf : new Date(asOf);
  const t = d.getTime();
  return Number.isNaN(t) ? Date.now() : t;
}

/** Parse a YYYY-MM-DD expiry to epoch-ms (UTC midnight); NaN when unparseable. */
function expiryMs(expiry: string): number {
  return Date.parse(`${expiry.slice(0, 10)}T00:00:00Z`);
}

/**
 * Derive the entry plan for a triggered/forming setup. `entryState` comes from signed price-vs-trigger; the
 * deadline is `asOf + sub-lane validity days`, clamped to strictly before the contract expiry so the two
 * clocks can never coincide.
 */
export function deriveEntryPlan(
  dossier: SwingDossier,
  contract: ChainContract,
  reads: EntryReads,
  asOf?: string | number | Date,
): SwingEntryPlan {
  const dir = dossier.direction;
  const subLane = dossier.subLane;
  const nowMs = toMs(asOf);

  const entryState = deriveEntryState(dir, reads);
  const entryLimitPx = deriveEntryLimit(dir, reads, entryState);

  // ── entry-validity deadline: short, sub-lane-scoped, and provably NOT the option expiry ──
  const validityDays = subLane ? ENTRY_VALIDITY_DAYS[subLane] : DEFAULT_ENTRY_VALIDITY_DAYS;
  let deadlineMs = nowMs + validityDays * DAY_MS;
  const expMs = expiryMs(contract.expiry);
  // Clamp to strictly before expiry — a stale-setup clock must expire well before the contract does.
  if (Number.isFinite(expMs) && deadlineMs >= expMs - DAY_MS) {
    deadlineMs = expMs - DAY_MS;
  }
  const entryDeadline = new Date(deadlineMs).toISOString();

  return {
    entryState,
    entryLimitPx,
    entryDeadline,
    actualFill: null, // INVARIANT: never fabricated from the plan.
    subLane,
    reason: entryReason(entryState, dir),
  };
}

/**
 * Place price on the entry line, direction-signed. Monotonic zones (LONG shown; SHORT mirrors around each
 * level): price < entryZoneFar ⇒ PRE_TRIGGER · [entryZoneFar, trigger) ⇒ PULLBACK_TO_ENTRY ·
 * [trigger, trigger + 0.5·ATR] ⇒ AT_TRIGGER · > trigger + 0.5·ATR ⇒ EXTENDED_CHASE.
 * Without direction or price ⇒ PRE_TRIGGER (honest "not entering yet").
 */
function deriveEntryState(dir: PlayDirection | null, reads: EntryReads): SwingEntryState {
  const { price, triggerPx } = reads;
  if (dir == null || !isNum(price) || !isNum(triggerPx)) return "PRE_TRIGGER";

  const atr = isNum(reads.atr) ? reads.atr : null;
  const far = isNum(reads.entryZoneFar) ? reads.entryZoneFar : null;
  const chaseDist = atr != null && atr > 0 ? CHASE_ATR_MULT * atr : 0;

  if (dir === "LONG") {
    if (far != null && price < far) return "PRE_TRIGGER";
    if (price < triggerPx) return far != null ? "PULLBACK_TO_ENTRY" : "PRE_TRIGGER";
    if (price <= triggerPx + chaseDist) return "AT_TRIGGER";
    return "EXTENDED_CHASE";
  }
  // SHORT — mirror image around each level.
  if (far != null && price > far) return "PRE_TRIGGER";
  if (price > triggerPx) return far != null ? "PULLBACK_TO_ENTRY" : "PRE_TRIGGER";
  if (price >= triggerPx - chaseDist) return "AT_TRIGGER";
  return "EXTENDED_CHASE";
}

/** The level to work: the pullback zone edge when pulling back, else the trigger. Null when ungroundable. */
function deriveEntryLimit(
  dir: PlayDirection | null,
  reads: EntryReads,
  state: SwingEntryState,
): number | null {
  if (dir == null) return null;
  if (state === "PULLBACK_TO_ENTRY" && isNum(reads.entryZoneFar)) return reads.entryZoneFar;
  if (isNum(reads.triggerPx)) return reads.triggerPx;
  return null;
}

function entryReason(state: SwingEntryState, dir: PlayDirection | null): string {
  const side = dir ?? "—";
  switch (state) {
    case "PRE_TRIGGER":
      return `${side}: price has not reached the trigger — waiting for the setup to fire.`;
    case "AT_TRIGGER":
      return `${side}: price is at the trigger, inside the valid entry window.`;
    case "PULLBACK_TO_ENTRY":
      return `${side}: price pulled back into the entry zone — enter on the retest.`;
    case "EXTENDED_CHASE":
      return `${side}: price is >0.5·ATR past the trigger — entering here is a chase (see entry_extended).`;
  }
}
