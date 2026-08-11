/**
 * ONE TRUNCATION, USED EVERYWHERE TEXT IS CUT FOR DISPLAY.
 *
 * There were three copies of this, and they disagreed in the way that shows up on a shareable
 * asset. The live NVDA card's headline ended `…holding resistance….` — four dots — because
 * `headlineFromMarkdown` sliced at 89 characters, `trimEnd()`ed, and appended an ellipsis on top of
 * the sentence's own full stop. `x-content-humanize` had the same bug; only `generic-extract`'s
 * copy stripped the trailing punctuation first.
 *
 * Both properties matter and neither is decoration:
 *
 *   - BACK UP TO A WORD BOUNDARY. A hard cut mid-word reads as a rendering fault rather than as
 *     "there is more text", which on a card that travels is the difference between a brand asset
 *     and a broken one. Only when the break lands in the last third is it taken — a long unbroken
 *     token (an OCC symbol, a URL) must still be cut rather than collapse the string to nothing.
 *   - STRIP TRAILING PUNCTUATION BEFORE THE ELLIPSIS. `resistance….` and `flow, …` are both
 *     artefacts of appending to whatever character the slice happened to land on.
 *
 * Pure and total: no clock, no IO, no throw.
 */

/** The characters that must never sit immediately before the ellipsis. */
const TRAILING = /[\s,;:.–—-]+$/;

export function truncateText(raw: string, max: number): string {
  const t = raw.trim();
  if (t.length <= max) return t;
  // `max - 1` leaves room for the ellipsis itself, so the RESULT honours `max`, not the slice.
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  const body = space > max * 0.6 ? cut.slice(0, space) : cut;
  return `${body.replace(TRAILING, "")}…`;
}
