/**
 * Pure "nearest wall" helper, split out of gex-positioning.ts so it can be imported from code that
 * must NOT pull in that module's `server-only` guard (e.g. play-brief.ts, which needs the exact
 * same nearest-wall logic to stay consistent with whichever call/put wall source — Vector or GEX
 * matrix — the rest of the brief is displaying; see the 2026-09-08 Dealer-posture finding).
 */

export type NearestWall = {
  strike: number;
  kind: "resistance" | "support";
  distance_pts: number;
} | null;

export function nearestWallFromLevels(
  callWall: number | null | undefined,
  putWall: number | null | undefined,
  spot: number
): NearestWall {
  let nearest: NearestWall = null;
  const candidates: Array<{ strike: number; kind: "resistance" | "support" }> = [];
  if (callWall != null && Number.isFinite(callWall)) {
    candidates.push({ strike: callWall, kind: "resistance" });
  }
  if (putWall != null && Number.isFinite(putWall)) {
    candidates.push({ strike: putWall, kind: "support" });
  }
  for (const c of candidates) {
    const dist = Number((c.strike - spot).toFixed(2));
    if (nearest == null || Math.abs(dist) < Math.abs(nearest.distance_pts)) {
      nearest = { strike: c.strike, kind: c.kind, distance_pts: dist };
    }
  }
  return nearest;
}
