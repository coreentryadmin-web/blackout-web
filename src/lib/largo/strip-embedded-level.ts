/**
 * Remove a parenthetical LEVEL from a regime read before it reaches the model.
 *
 * PURE AND IMPORT-FREE ON PURPOSE. This lived inside `gex-heatmap-for-largo.ts`, which reaches
 * Polygon and Redis, so its test could not import it and asserted on a hand-copied regex instead.
 * That copy then drifted from the implementation the moment the real one was hardened for CodeQL —
 * the test kept passing while verifying a pattern no longer in use. Duplicated logic that only a
 * test can see is still duplicated logic; it just fails more quietly.
 *
 * WHAT IT IS FOR. The regime read is prose that restates a level already supplied as a typed field:
 *
 *     flip (typed field) .... 7893.38
 *     gamma_regime_read ..... "Spot 7,707.98 is below the gamma flip (7,887.15) -> short gamma ..."
 *
 * Those disagreed on prod, so Largo received the same quantity twice with two values and reported
 * both — "Gamma flip 7891.94 (7886.81 on Thermal matrix)" — which reads as the product
 * contradicting itself. The prose duplicate carries nothing the typed field lacks, so removing it
 * costs no information.
 *
 * Only the PARENTHETICAL goes. Bare levels in the sentence ("Resistance 7,800, support 7,700") are
 * not duplicates of anything and must survive.
 */

/**
 * BOUNDED QUANTIFIERS THROUGHOUT — CodeQL alert 735 flagged the first draft as polynomial
 * backtracking on uncontrolled input. `\s*\(\s*[\d,]+...\s*\)` places unbounded quantifiers next to
 * each other, so a long run of spaces before a paren that never closes makes the engine retry every
 * split. The read is server-generated from numbers rather than member text, so exploitation was
 * unlikely — but a bound costs nothing and an unbounded quantifier on a string crossing a trust
 * boundary is not worth defending. Widths are sized to the real thing: " (7,887.15)".
 */
const PARENTHETICAL_LEVEL = / {0,4}\( {0,4}[\d,]{1,20}(?:\.\d{1,6})? {0,4}\)/g;

export function stripEmbeddedLevel(read: string | null | undefined): string | null {
  if (!read) return null;
  return String(read).replace(PARENTHETICAL_LEVEL, "").replace(/ {2,}/g, " ").trim();
}
