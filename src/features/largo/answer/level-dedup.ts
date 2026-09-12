import type { BieLevel } from "@/lib/bie/answer-envelope";

/**
 * Structural nodes the Structure Ladder (`BieStructureLadder`, off `play-brief-ladder.ts`'s
 * `buildStructureLadder`) already renders as exactly ONE row each — call wall, put wall, gamma
 * flip, GEX king, max pain, gamma magnet.
 *
 * `envelope.levels` (rendered by `BieKeyLevelsTable`, just above the ladder in `BieAnswer.tsx`) is
 * built independently by `levelsFromContext` (play-brief.ts) off the SAME underlying Vector-
 * ladder/GEX-matrix reads, for the SAME swing OPEN/WATCH envelope — so without this filter both
 * widgets would print the identical call-wall/put-wall/flip/king/max-pain/magnet price TWICE,
 * directly adjacent, in two different formats. That is the opposite of "one clean read" — the
 * whole stated point of adding the ladder — and it is exactly the two-independent-copies-of-one-
 * precedence-rule shape this codebase's own comments elsewhere (GEX king strike, nearest wall —
 * see `preferredGexWalls`'s header) document as having already shipped and been fixed twice. The
 * two computations currently agree, but nothing ties them together, so the duplicate rows are
 * filtered here rather than trusted to keep matching forever.
 *
 * DELIBERATELY NOT INCLUDING "dark pool": `collectFocalLevels` (the ladder's own source) caps dark
 * pool to the top 3 prints, while `levelsFromContext` carries every dark-pool level it has (up to
 * the envelope's own 10-row-total cap). A label-based filter cannot tell "this exact print is
 * already on the ladder" from "this print exists only because the table wasn't capped the same
 * way" — filtering the label wholesale would silently drop any 4th+ dark-pool print from the
 * answer ENTIRELY rather than just de-duplicating it. Tolerating one duplicated top print is a far
 * smaller defect than silently dropping real prints the ladder never carried at all, so "dark
 * pool" stays off this list.
 *
 * `spot` and `confluence (...)` rows are also deliberately NOT in this set — the ladder does not
 * carry either, so the table keeps showing them; filtering never drops information found nowhere
 * else on the ladder.
 */
export const LADDER_COVERED_LEVEL_LABELS: ReadonlySet<string> = new Set([
  "call wall",
  "put wall",
  "gamma flip",
  "max pain",
  "gex king",
  "gamma magnet",
]);

/**
 * Drop rows from `levels` that the Structure Ladder already renders — but ONLY when a ladder is
 * actually present on this envelope (`hasLadder`). Every other Largo product's `BieKeyLevelsTable`
 * (no `structureLadder` field at all) is unaffected; `levels` passes through unchanged.
 *
 * Pure, total, case-insensitive on the label (defensive against a future casing drift between the
 * two independent producers — see this module's own header).
 */
export function filterLevelsCoveredByLadder(
  levels: readonly BieLevel[] | undefined,
  hasLadder: boolean,
): BieLevel[] | undefined {
  if (!hasLadder || !levels) return levels as BieLevel[] | undefined;
  return levels.filter((l) => !LADDER_COVERED_LEVEL_LABELS.has(String(l.label).toLowerCase()));
}
