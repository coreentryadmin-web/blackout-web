/**
 * Pure precedence-arm helpers for scripts/audit/merge-precedence-ab.mjs, factored out so the
 * exact bug fixed here (2026-08-05) has a regression test — see merge-precedence-ab.mjs's header
 * comment on flowFirstDirection for the full root-cause writeup.
 *
 * Both functions read a committed row's frozen `entry_context.origin_maps` (WS-06:
 * origin_direction_map / origin_score_map / direction_owner) and return which rail's direction
 * each precedence arm would have kept, or null when the maps don't support that arm.
 */

/** Fixed discovery-rail seating order the v1 "FLOW-first" merge used: FLOW > BREAKOUT > PIN. */
export const PRECEDENCE = ["FLOW", "BREAKOUT", "PIN"];

/**
 * FLOW-first (v1 seating-order) choice: the highest-precedence rail PRESENT on the row's
 * `origin_direction_map`, full stop — computed from the seating order alone, NEVER from
 * `direction_owner`. `direction_owner` is a policy-VERSIONED field (MERGE_POLICY_VERSION):
 * under v1 it happened to equal the seating-order pick (v1's merge always kept the incumbent),
 * but under v2 (shipped 2026-07-28, board.ts) it is the EVIDENCE-WEIGHTED owner instead. An
 * earlier version of this function read `direction_owner` first and only fell back to the
 * seating order when it was absent — on every real v2 row that made this function collapse
 * onto the SAME value as `evidenceWeightedDirection`, so the A/B could never observe a
 * disagreement on any post-v2 data (see the two real rows in the test below).
 */
export function flowFirstDirection(maps) {
  for (const o of PRECEDENCE) {
    if (maps?.origin_direction_map?.[o]) return { dir: maps.origin_direction_map[o], owner: o };
  }
  return null;
}

/** Evidence-weighted choice: the direction of the rail with the max frozen score. Ties → null. */
export function evidenceWeightedDirection(maps) {
  const entries = Object.entries(maps?.origin_score_map ?? {});
  if (entries.length === 0) return null;
  let best = null;
  let tie = false;
  for (const [o, s] of entries) {
    const score = Number(s);
    if (!Number.isFinite(score)) continue;
    if (!best || score > best.score) {
      best = { owner: o, score };
      tie = false;
    } else if (score === best.score && o !== best.owner) {
      tie = true;
    }
  }
  if (!best || tie) return null;
  const dir = maps?.origin_direction_map?.[best.owner];
  return dir ? { dir, owner: best.owner, score: best.score } : null;
}
