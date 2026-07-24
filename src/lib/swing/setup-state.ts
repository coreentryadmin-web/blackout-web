// src/lib/swing/setup-state.ts — pre-entry SETUP MATURITY derivation (PR-5).
//
// A swing thesis is not binary "trade / no-trade"; it lives on a maturity lifecycle the serving router branches
// on. This module maps GROUNDED price-vs-level reads onto the ONE canonical `SwingSetupState`
// (taxonomy.ts): FORMING → TRIGGERED → EXTENDED → INVALIDATED. Keeping the router on these four observable
// states — never on an ungraduated statistic — is SEV-6: it folds the drafts' parallel EARLY|CONFIRMED|DEGRADED
// vocabulary into the canonical set so every downstream branch fires against a real state:
//   • EARLY      → FORMING   (thesis building, price has not reached the trigger)
//   • CONFIRMED  → TRIGGERED (price is in the valid entry window)
//   • DEGRADED   → NOT a distinct state — it is a SOFT FLAG the gate lays on top of TRIGGERED
//                  (via dossier.dataQuality.degraded), so a thin read still routes as TRIGGERED but is
//                  penalized, not silently dropped. This module returns the pure enum; the gate reads the flag.
//
// DIRECTION-AWARE: LONG triggers ABOVE its level and invalidates BELOW; SHORT mirrors. All comparisons are
// signed by the dossier's resolved direction so a SHORT setup matures symmetrically to its LONG mirror.
//
// PURE & deterministic — no IO. Evidence-only shapes; the gate decides what a state MEANS for the verdict.

import type { SwingSetupState } from "./taxonomy";
import type { SwingDossier } from "./dossier";

/** Grounded price-vs-level reads. Every field nullable — a missing feed stays null, never a fabricated 0. */
export interface SetupStateReads {
  /** Current underlying price. */
  price: number | null;
  /** The entry trigger level (breakout / reclaim / pivot the thesis fires on). */
  triggerPx: number | null;
  /** The structural invalidation level — thesis breaks if price closes past it (below for LONG, above SHORT). */
  invalidationPx: number | null;
  /** ATR(14) of the underlying — sizes the "too far past the trigger to enter" (EXTENDED) distance. */
  atr?: number | null;
  /** Multiples of ATR past the trigger that count as EXTENDED (missed the clean entry). Default 1.0. */
  extendedAtrMult?: number | null;
}

const isNum = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

/** Default: >1 ATR past the trigger is "extended" — a wider band than the 0.5·ATR entry-CHASE edge gate,
 *  because EXTENDED means "the move already ran", not merely "not the ideal fill". */
const DEFAULT_EXTENDED_ATR_MULT = 1.0;

/**
 * Derive the canonical setup maturity from price-vs-level reads. Precedence (most-decisive first):
 *   1. INVALIDATED — price has closed through the structural invalidation level (thesis broke). This wins
 *      over everything: a broken thesis is not "forming" or "triggered" no matter where the trigger sits.
 *   2. FORMING — price has not yet reached the trigger in the trade direction (thesis still building).
 *   3. EXTENDED — price is past the trigger by more than `extendedAtrMult · ATR` (the move already ran; a
 *      clean entry is gone).
 *   4. TRIGGERED — price is at/just past the trigger, inside the valid entry window.
 * Missing direction or missing both trigger AND invalidation ⇒ FORMING (honest "not actionable yet"), never
 * a fabricated TRIGGERED.
 */
export function deriveSetupState(dossier: SwingDossier, reads: SetupStateReads): SwingSetupState {
  const dir = dossier.direction;
  const { price, triggerPx, invalidationPx } = reads;
  const atr = isNum(reads.atr) ? reads.atr : null;
  const extMult = isNum(reads.extendedAtrMult) ? reads.extendedAtrMult : DEFAULT_EXTENDED_ATR_MULT;

  // 1. Invalidation dominates — check it first, and independently of whether we know the trigger.
  if (dir != null && isNum(price) && isNum(invalidationPx)) {
    const broken = dir === "LONG" ? price <= invalidationPx : price >= invalidationPx;
    if (broken) return "INVALIDATED";
  }

  // Without direction or a trigger we cannot place price on the maturity line → honest "still forming".
  if (dir == null || !isNum(price) || !isNum(triggerPx)) return "FORMING";

  // 2. Not yet reached the trigger in the trade direction.
  const reachedTrigger = dir === "LONG" ? price >= triggerPx : price <= triggerPx;
  if (!reachedTrigger) return "FORMING";

  // 3. Past the trigger — how far? Beyond extMult·ATR is EXTENDED (the move already ran).
  if (atr != null && atr > 0) {
    const distancePast = dir === "LONG" ? price - triggerPx : triggerPx - price;
    if (distancePast > extMult * atr) return "EXTENDED";
  }

  // 4. At / just past the trigger, inside the valid entry window.
  return "TRIGGERED";
}
