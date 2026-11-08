/**
 * Percent change implied by a $-delta over the shift window, expressed relative to the
 * MAGNITUDE of the value before that delta was applied (baseline = current - delta).
 * Dividing by |baseline| (not baseline) keeps the sign of the result tied to the sign of
 * delta itself — a strike that melted from -$1.0M to -$0.5M (delta=+$0.5M, "building" back
 * toward zero) reads +50%, matching the green "built" convention the Shift view already
 * uses (`built = delta > 0`), instead of the confusing negative a bare delta/baseline would
 * produce when baseline is negative.
 *
 * Returns null (never NaN/Infinity) when there's no delta to work with or the baseline is
 * ~zero — a percent change from ~zero is undefined, and this pipeline never fabricates a
 * shift (mirrors GexShift's own `available` gate).
 */
export function shiftPercentForStrike(
  currentValue: number,
  delta: number | null | undefined
): number | null {
  if (delta == null || !Number.isFinite(delta) || !Number.isFinite(currentValue)) return null;
  const baseline = currentValue - delta;
  if (!Number.isFinite(baseline) || Math.abs(baseline) < 1) return null;
  return (delta / Math.abs(baseline)) * 100;
}

/**
 * "+55%" / "−12%" / "—" — whole-percent intraday shift (profile + matrix DR% parity).
 *
 * BUG THIS FIXES: plain `Math.round(pct)` ties toward +Infinity (`Math.round(-2.5) === -2` but
 * `Math.round(2.5) === 3`), a sign-biased asymmetry — a melting strike sitting exactly on a
 * whole-percent tie (e.g. -2.5%) rounded to a SMALLER magnitude ("−2%") than the identical
 * magnitude building the other way ("+3%" for +2.5%) would render. Same bug class already fixed
 * in `fmt-money.ts`'s `fmtPct` (2026-10-26) and `round-floats.ts`; this sibling Thermal-desk
 * formatter was missed in both passes. Rounding `Math.abs(pct)` first and reapplying
 * `Math.sign(pct)` makes both signs tie the same direction (away from zero), matching how humans
 * round signed percentages. Sign is read off the ROUNDED value, not the raw one, so a magnitude
 * that rounds to exactly 0 (e.g. -0.3%) reads "0%", never a misleading signed "−0%".
 */
export function fmtShiftPercentForStrike(
  currentValue: number,
  delta: number | null | undefined,
): string {
  const pct = shiftPercentForStrike(currentValue, delta);
  if (pct == null || !Number.isFinite(pct)) return "—";
  const rounded = Math.sign(pct) * Math.round(Math.abs(pct));
  const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "";
  return `${sign}${Math.abs(rounded)}%`;
}

/**
 * Wall STRENGTH shift: did the dealer gamma parked at this strike get HEAVIER or LIGHTER over the
 * window, and by what %? This is what a trader means by a wall "building" vs "melting".
 *
 * `shiftPercentForStrike` above keys its sign to the raw signed delta — which is correct for a
 * call-side (positive-GEX) strike but INVERTS on the put side: a put wall building means its net
 * GEX goes MORE NEGATIVE (delta < 0), so the raw-delta convention (`built = delta > 0`) mislabels a
 * strengthening put wall as "melted" and a decaying one as "built". This compares |current| vs
 * |baseline| instead, so `built` means the wall's magnitude grew regardless of which side it's on,
 * and the % is signed by that growth (+ = heavier, − = lighter) — always consistent with the verb.
 *
 * Returns null on the same guards (no delta / ~zero baseline) so it never fabricates a shift.
 */
export function wallStrengthShift(
  currentValue: number,
  delta: number | null | undefined
): { pct: number; built: boolean } | null {
  if (delta == null || !Number.isFinite(delta) || !Number.isFinite(currentValue)) return null;
  const baseline = currentValue - delta;
  if (!Number.isFinite(baseline) || Math.abs(baseline) < 1) return null;
  const magnitudeDelta = Math.abs(currentValue) - Math.abs(baseline);
  return { pct: (magnitudeDelta / Math.abs(baseline)) * 100, built: magnitudeDelta > 0 };
}
