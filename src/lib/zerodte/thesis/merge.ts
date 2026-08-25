import type { RailHit, RailScoreMap, ThesisRail } from "./types";
import { THESIS_RAIL_ORDER } from "./types";

function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Majority direction from rail hits; ties → higher total score side. */
export function resolveMergedDirection(hits: RailHit[]): "long" | "short" | null {
  if (hits.length === 0) return null;
  let longScore = 0;
  let shortScore = 0;
  for (const h of hits) {
    if (h.direction === "long") longScore += h.score;
    else shortScore += h.score;
  }
  if (longScore === shortScore) return hits[0]!.direction;
  return longScore > shortScore ? "long" : "short";
}

/** Merge rail hits by ticker — preserve independent per-rail scores. */
export function mergeRailHitsByTicker(hits: RailHit[]): Map<string, RailHit[]> {
  const byTicker = new Map<string, RailHit[]>();
  for (const h of hits) {
    const key = h.ticker.toUpperCase();
    const arr = byTicker.get(key) ?? [];
    const existing = arr.find((x) => x.rail === h.rail);
    if (existing) {
      if (h.score > existing.score) {
        const idx = arr.indexOf(existing);
        arr[idx] = h;
      }
    } else {
      arr.push(h);
    }
    byTicker.set(key, arr);
  }
  return byTicker;
}

export function buildRailScoreMap(hits: RailHit[]): {
  rail_scores: RailScoreMap;
  rails_fired: ThesisRail[];
  summaries: Partial<Record<ThesisRail, string>>;
  structural_state: RailHit["structural_state"];
  trigger_price: number | null;
} {
  const rail_scores: RailScoreMap = {};
  const summaries: Partial<Record<ThesisRail, string>> = {};
  let structural_state: RailHit["structural_state"] = null;
  let trigger_price: number | null = null;

  for (const h of hits) {
    rail_scores[h.rail] = clampScore(h.score);
    summaries[h.rail] = h.summary;
    if (h.structural_state) structural_state = h.structural_state;
    const trigger = h.meta?.trigger_price;
    if (typeof trigger === "number" && Number.isFinite(trigger)) {
      trigger_price = trigger;
    }
  }

  const rails_fired = THESIS_RAIL_ORDER.filter((r) => rail_scores[r] != null);
  return { rail_scores, rails_fired, summaries, structural_state, trigger_price };
}

export function countSystemsAligned(rail_scores: RailScoreMap, floor = 60): number {
  return THESIS_RAIL_ORDER.filter((r) => (rail_scores[r] ?? 0) >= floor).length;
}
