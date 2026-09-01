// Read-time merge of durable outcome-row pins onto the member edition payload:
//  - publish_context.tier → play.tier (tier engine factors for the right rail)
//  - morning_verdict.checked_at → per-play confirm timestamp (when surfaced)

import type { NighthawkEditionOutcomeOverlayRow } from "@/lib/db";
import { readNighthawkMorningVerdict } from "@/lib/bie/nighthawk-edition-read";
import { readPinnedTierAssignment } from "./debrief-aggregate";
import type { NighthawkTierAssignment } from "./nighthawk-tiers";
import type { NightHawkEdition, PlaybookPlay } from "./types";

export type EditionPlayOutcomeOverlay = {
  tier: NighthawkTierAssignment | null;
  morning_checked_at: string | null;
};

export function buildOutcomeOverlayMap(
  rows: NighthawkEditionOutcomeOverlayRow[]
): Map<string, EditionPlayOutcomeOverlay> {
  const map = new Map<string, EditionPlayOutcomeOverlay>();
  for (const row of rows) {
    const tk = row.ticker.toUpperCase();
    const verdict = readNighthawkMorningVerdict(row.morning_verdict ?? null);
    map.set(tk, {
      tier: readPinnedTierAssignment(row.publish_context ?? null),
      morning_checked_at: verdict?.checked_at ?? null,
    });
  }
  return map;
}

export type PlaybookPlayWithTier = PlaybookPlay & {
  tier?: NighthawkTierAssignment | null;
  morning_checked_at?: string | null;
};

/** Merge tier pins (and optional morning check time) onto edition plays. Fail-soft: unknown tickers pass through. */
export function applyEditionOutcomeOverlay(
  edition: NightHawkEdition,
  overlays: Map<string, EditionPlayOutcomeOverlay>
): NightHawkEdition {
  if (!edition.plays?.length || overlays.size === 0) return edition;
  const plays: PlaybookPlayWithTier[] = edition.plays.map((p) => {
    const overlay = overlays.get(p.ticker?.toUpperCase() ?? "");
    if (!overlay) return p;
    const next: PlaybookPlayWithTier = { ...p };
    if (overlay.tier) {
      next.tier = overlay.tier;
      next.conviction = overlay.tier.tier;
    }
    if (overlay.morning_checked_at) {
      next.morning_checked_at = overlay.morning_checked_at;
    }
    return next;
  });
  return { ...edition, plays };
}
