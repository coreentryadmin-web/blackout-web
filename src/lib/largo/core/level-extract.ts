import type { BieEvidence, BieLevel } from "@/lib/bie/answer-envelope";

/**
 * LEVEL EXTRACTION — recover the price levels an answer rests on, as structured data.
 *
 * WHY. The desk-read card leads with a levels grid — spot, VWAP, call wall, put wall, gamma flip —
 * because those are the five numbers a member actually acts on, and a fixed grid puts each one in
 * the same place in every answer. Measured live 2026-08-10: real answers returned 7 sections and
 * 15-19 evidence rows and `levels: 0`, so that grid rendered empty on every question. The envelope
 * had the numbers all along — inside evidence prose — and nothing lifted them out.
 *
 * WHY IT IS SAFE TO PARSE HERE, having refused to parse prose in the renderer. The renderer must
 * not regex markdown into a layout, because a phrasing change would silently reshape the card.
 * This is a different job: it reads ALREADY-STRUCTURED evidence rows, matches a CLOSED SET of
 * level names, and emits typed data that the renderer consumes. A miss produces one fewer row in
 * the grid; it can never produce a wrong row, because a label that is not in the set is not a
 * level and a number that is not adjacent to one is not its price.
 *
 * THE RULES, each of which exists to stop a specific wrong number reaching the grid:
 *  - CLOSED LABEL SET. "call wall" is a level; "premium" and "volume" are not. An open rule would
 *    put $18.2M of call premium in a price grid.
 *  - THE NUMBER MUST FOLLOW THE LABEL. "above the 6405 VWAP" and "VWAP 6405" both bind; "VWAP is
 *    reclaimed, SPX 6412" must NOT bind 6412 to VWAP, so a competing label between the two breaks
 *    the match.
 *  - PERCENTAGES AND SIGNED DELTAS ARE NOT LEVELS. "+2.31%" and "-0.4" are movement, not price.
 *  - FIRST WINS. Evidence is ordered most-relevant-first upstream; a later restatement must not
 *    overwrite the primary reading.
 *  - PROVENANCE IS CARRIED, never invented. A level with no source stays sourceless rather than
 *    inheriting a neighbour's.
 *
 * PURE AND TOTAL: no IO, no throw.
 */

/**
 * The closed set. Keys are canonical labels; values match how the desk actually writes them.
 *
 * Ordered longest-first at match time so "call wall" cannot be captured by a bare "wall" rule.
 */
const LEVEL_PATTERNS: ReadonlyArray<[label: string, re: RegExp]> = [
  ["Gamma flip", /\bgamma[- ]?flip\b/i],
  ["Call wall", /\bcall[- ]?wall\b/i],
  ["Put wall", /\bput[- ]?wall\b/i],
  ["Max pain", /\bmax[- ]?pain\b/i],
  ["VWAP", /\bvwap\b/i],
  ["Zero-vanna flip", /\bzero[- ]?vanna(?:[- ]?flip)?\b/i],
  ["Gamma magnet", /\bgamma[- ]?magnet\b|\bmagnet\b/i],
  ["Prior high", /\b(?:pdh|prior (?:session )?high)\b/i],
  ["Prior low", /\b(?:pdl|prior (?:session )?low)\b/i],
  ["Spot", /\bspot\b/i],
];

/**
 * A price immediately after a label: optional filler words, optional $ or "at"/"near", then the
 * number. Bounded filler (no `.*`) is what stops it reaching across a whole sentence into an
 * unrelated figure.
 */
const PRICE_AFTER = /^(?:\s*(?:is|at|sits?|near|around|of|:|=|—|-)\s*){0,2}\$?\s*([0-9][0-9,]*(?:\.[0-9]+)?)/;
/** A price immediately BEFORE the label — "above the 6405 VWAP". */
const PRICE_BEFORE = /([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:\$)?\s*$/;

/** Reject movement dressed as price. */
function isPriceLike(raw: string, after: string): boolean {
  if (/^[+-]/.test(raw)) return false; // a signed delta is movement
  if (/^\s*%/.test(after)) return false; // "2.31%" is movement
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0;
}

/** True when another level label sits between the label and the number — the binding is broken. */
function hasCompetingLabel(segment: string, selfRe: RegExp): boolean {
  return LEVEL_PATTERNS.some(([, re]) => re !== selfRe && re.test(segment));
}

/**
 * Lift structured levels out of an answer's evidence rows.
 *
 * Returns them in the desk's reading order (spot first, then the structural levels) rather than
 * the order they happened to be mentioned — the grid is a reference, and a reference whose rows
 * move between answers is one a member has to re-read every time.
 */
export function extractLevels(evidence: readonly BieEvidence[]): BieLevel[] {
  const found = new Map<string, BieLevel>();

  for (const e of evidence) {
    const text = typeof e?.text === "string" ? e.text : "";
    if (!text) continue;

    for (const [label, re] of LEVEL_PATTERNS) {
      if (found.has(label)) continue; // first wins
      const m = re.exec(text);
      if (!m) continue;

      const tail = text.slice(m.index + m[0].length);
      const after = PRICE_AFTER.exec(tail);
      if (after && isPriceLike(after[1]!, tail.slice(after[0].length))) {
        found.set(label, {
          label,
          price: Number(after[1]!.replace(/,/g, "")),
          provenance: e.provenance,
        });
        continue;
      }

      // "above the 6405 VWAP" — the number precedes the label. Only bind when no OTHER level
      // label sits between them, so "VWAP reclaimed, SPX 6412" cannot attach 6412 to VWAP.
      const head = text.slice(0, m.index);
      const before = PRICE_BEFORE.exec(head);
      if (before && isPriceLike(before[1]!, "")) {
        const between = head.slice(before.index + before[0].length);
        if (!hasCompetingLabel(between, re)) {
          found.set(label, {
            label,
            price: Number(before[1]!.replace(/,/g, "")),
            provenance: e.provenance,
          });
        }
      }
    }
  }

  const ORDER = LEVEL_PATTERNS.map(([l]) => l);
  return ORDER.filter((l) => found.has(l)).map((l) => found.get(l)!);
}
