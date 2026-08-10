import type { BieLevel } from "@/lib/bie/answer-envelope";
import { buildLevelLadder, type RailLadderRow, type RailLevelKind } from "@/features/largo/lib/rail-levels";

/**
 * DECISION LEVELS — turn the envelope's extracted levels into the answer card's price ladder.
 *
 * Shares `buildLevelLadder` with the context rail deliberately. The rail and the answer describe
 * the same instrument at the same instant, and two independent implementations of "where is spot
 * relative to these levels" would eventually disagree — silently, in a way a member would read as
 * one of them being wrong without knowing which.
 *
 * MAXIMUM ROWS is capped below. A ladder is a reference a member scans in one look; past roughly
 * half a dozen rungs it becomes a table, and a table is the thing the desk-read card exists to
 * replace.
 */
const MAX_RUNGS = 8;

/**
 * Map an extracted level's label onto a ladder kind.
 *
 * Anything outside the four structural fields is the generic `level` rung rather than being forced
 * into a named kind. A VWAP mislabelled as a gamma flip would be a WRONG row, and the whole
 * discipline of the closed label set upstream is that a miss costs a row and can never invent one.
 */
export function kindOfLevel(label: string): RailLevelKind {
  const l = String(label ?? "").toLowerCase();
  if (l.includes("call wall")) return "call-wall";
  if (l.includes("put wall")) return "put-wall";
  if (l.includes("gamma flip")) return "gamma-flip";
  if (l.includes("max pain")) return "max-pain";
  if (/^spot$/.test(l.trim())) return "spot";
  return "level";
}

/**
 * Build the ladder from an answer's levels.
 *
 * SPOT COMES FROM THE LEVELS THEMSELVES — `extractLevels` lifts a "Spot" row out of the evidence
 * when the answer stated one. When it did not, there is no origin: the ladder renders without a
 * marker and without distances rather than inventing a reference price or borrowing one from a
 * different read. A distance measured from a spot the answer never gave is a fabricated number
 * wearing the same styling as a real one.
 *
 * PURE AND TOTAL: no IO, no clock, no throw.
 */
export function ladderFromLevels(levels: readonly BieLevel[] | undefined): RailLadderRow[] {
  const rows = levels ?? [];
  const spotLevel = rows.find((l) => /^\s*spot\s*$/i.test(String(l?.label ?? "")));
  const spot = typeof spotLevel?.price === "number" && Number.isFinite(spotLevel.price) ? spotLevel.price : null;

  return buildLevelLadder(
    spot,
    rows
      .filter((l) => l !== spotLevel && typeof l?.price === "number" && Number.isFinite(l.price))
      .slice(0, MAX_RUNGS)
      .map((l) => ({
        label: String(l.label).toUpperCase(),
        price: l.price as number,
        kind: kindOfLevel(l.label),
      }))
  );
}
