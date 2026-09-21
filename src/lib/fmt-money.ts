// Single source of truth for the "compact signed dollar magnitude" formatter
// (e.g. "$38.2M" / "-$4.1K"). Dependency-free so it's safe to import from both
// server code and client components.
//
// MONEY-PATH INVARIANT: this MUST stay byte-identical in behavior to the ~15
// copies it replaces across polygon-options-gex.ts, gex-positioning.ts,
// spx-commentary.ts, gex-heatmap-display.ts, nighthawk/format.ts,
// nighthawk/grounding.ts, largo/flow-strike-stacks.ts, and zerodte/intel.ts —
// several of which rendered a DIFFERENT string for the same dollar figure
// (a real production data-correctness bug). Do not change the branch
// thresholds or decimal precision without auditing every call site.

/**
 * Absolute per-contract option-premium PRICE at 2dp, e.g. "$6.18" — never signed (a stop/entry/
 * mark/target price is a price, not a delta; callers that need a signed value format it
 * separately). This MUST round with the exact same algorithm `roundFloats` uses at every API
 * route boundary (`src/lib/round-floats.ts`: `Math.round(n * 100) / 100`, THEN stringify) rather
 * than calling `n.toFixed(2)` directly on the raw float — `toFixed` and `Math.round(n*100)/100`
 * can disagree by a full cent on an IEEE-754 double that lands near an exact half-cent boundary
 * (`(6.175).toFixed(2)` is `"6.17"` because 6.175 is actually stored as
 * 6.1749999999999998..., while `Math.round(6.175 * 100) / 100` is `6.18`, because the
 * floating-point *multiplication* rounds the other way first).
 *
 * Live repro (Ask Largo standing mandate, 2026-09-12): AAPL swing position #37's
 * `GET /api/market/swing/play-brief` response carried the SAME raw `mark` value twice — once as
 * a plain JSON number inside the response's own `briefContentKey` diagnostic field (which the
 * route wraps in `roundFloats()`, giving `6.18`), and once baked into the markdown "Position" and
 * "Trade manager read" sections via this module's OWN local `n.toFixed(2)` formatter, which
 * printed `"$6.17"` for the identical underlying number. `roundFloats()` cannot fix the markdown
 * copy because by the time it runs the number is already a string inside `body`/`markdown` — the
 * exact "systemic: several endpoints serve unrounded floats" class CLAUDE.md already names, one
 * layer deeper (a *consistently* wrong rounding, not a raw unrounded float). The same bug had
 * already been independently pasted into FOUR files (`play-brief.ts`'s `fmtUsd`,
 * `play-brief-narrative.ts`'s `fmtOptionUsd`, `play-brief-narrative-coaching.ts`'s `fmtUsd`,
 * `play-brief-intel.ts`'s `fmtUsd`) as an exact byte-for-byte copy — each one previously carried
 * (and was fixed for) the same *sign* defect on 2026-09-09/11, confirming they are the same
 * function maintained in four places rather than four independent designs. Centralizing here
 * fixes the rounding bug and removes the duplication in one pass, same as `fmtPremium` above.
 */
export function fmtOptionUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${(Math.round(n * 100) / 100).toFixed(2)}`;
}

/**
 * Bare (no `$`) price-LEVEL at 2dp, e.g. "152.04" — for underlying spot/wall/flip/pin levels,
 * never a dollar amount (those are `fmtOptionUsd` above). Same rounding-consistency requirement,
 * same fix: `Math.round(n * 100) / 100` THEN `.toFixed(2)`, matching `roundFloats` exactly,
 * rather than `n.toFixed(2)` directly, which can disagree by a full cent at an IEEE-754 half-cent
 * boundary (see `fmtOptionUsd`'s own header for the mechanism).
 *
 * THIRD OCCURRENCE of this exact bug class (Ask Largo standing mandate, 2026-09-21). `fmtOptionUsd`
 * above already documents two prior fixes for option-mark/stop/target dollar amounts (a sign defect
 * 2026-09-09, this same rounding mismatch 2026-09-12) — but those never covered the BARE price
 * levels (`spot`/`level.price`/wall/flip/pin) narrated across `play-brief-narrative.ts`,
 * `play-brief-narrative-coaching.ts`, `play-brief-intel.ts`, `play-brief.ts`, `play-brief-ladder.ts`
 * and `play-brief-diff.ts`, all of which independently call `n.toFixed(2)` on a raw float that is
 * ALSO exposed as a plain JSON number elsewhere in the same swing play-brief response (`envelope.
 * levels[].price`, `envelope.structureLadder`), which the route rounds via `roundFloats` at the
 * response boundary. Live repro (SPCX, 2026-09-21): the same request's narrative text read
 * "Spot **152.03**" (`n.toFixed(2)` on the raw float) while `envelope.levels` and
 * `envelope.structureLadder.spot` both carried the number `152.04` (`roundFloats`'s
 * `Math.round(n*100)/100` on the identical raw float) — two different values for the same fact in
 * one response, the exact Largo-contract precision violation (C9) `fmtOptionUsd`'s own history
 * already names.
 */
export function fmtPriceLevel(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return (Math.round(n * 100) / 100).toFixed(2);
}

/** Compact signed dollar magnitude, e.g. "$38.2M" / "-$4.1K". */
export function fmtPremium(n: number | null): string {
  // NaN/Infinity guard (not just null): these formatters are used pervasively by desk
  // components, and one NaN input (a failed Number() upstream) rendered a literal
  // "$NaN" on the member UI. An unrepresentable number displays as the same honest
  // em-dash a missing one does.
  if (n == null || !Number.isFinite(n)) return "—";
  // Sign OUTSIDE the currency glyph so negatives read "-$1.2M", never "$-1.2M".
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  // Billions branch BEFORE the millions branch — otherwise Net GEX (≈ -$5B) printed
  // "$5000.0M" instead of "$5.0B" (GexDealerPanel.tsx:39). Mirrors the sibling
  // fmtMoney formatters (GexHeatmap.tsx:254, gex-positioning.ts:80).
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  // Below $10K, keep 1 decimal so $1.4K and $1.5K don't collapse to the same
  // string (premium size is the signal); $10K+ stays whole-K for compactness.
  if (abs >= 1_000) {
    const k = abs / 1_000;
    return `${sign}$${k < 10 ? k.toFixed(1) : k.toFixed(0)}K`;
  }
  return `${sign}$${abs.toFixed(0)}`;
}
