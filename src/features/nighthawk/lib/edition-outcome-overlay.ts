// Read-time merge of durable outcome-row pins onto the member edition payload:
//  - publish_context.tier → play.tier (tier engine factors for the right rail)
//  - morning_verdict.checked_at → per-play confirm timestamp (when surfaced)

import type { NighthawkEditionOutcomeOverlayRow } from "@/lib/db";
import { readNighthawkMorningVerdict } from "@/lib/bie/nighthawk-edition-read";
import { readPinnedTierAssignment } from "./debrief-aggregate";
import { capGatePromotedConviction } from "./publish-gates";
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

/** Merge tier pins (and optional morning check time) onto edition plays. Fail-soft: unknown tickers pass through.
 *
 *  BUG (found 2026-09-16, live audit): `overlay.tier` is the RAW tier-engine assignment pinned at
 *  publish time (publish-context.ts: `assignNighthawkTier(nhTierInputFromScored(scored))`), computed
 *  independently of whether the play was later gate-promoted. `capGatePromotedConviction`
 *  (publish-gates.ts) caps a gate_promoted play's displayed conviction at "B" — "a mechanically
 *  blocked A does not read as top-tier overnight merit" — but that cap is applied ONCE, at build
 *  time, before the edition is persisted. This overlay runs on every `/api/market/nighthawk/edition`
 *  read (edition/route.ts's `withOutcomeOverlay`) and was unconditionally setting
 *  `next.conviction = overlay.tier.tier`, silently re-inflating a capped "B" back to the tier
 *  engine's original (often "A") reading on every live read — defeating the cap the same session
 *  that shipped it was built to enforce. Route the overlay's conviction assignment through the same
 *  shared `capGatePromotedConviction` publish-time uses, so a gate-promoted play stays capped
 *  regardless of how many times its edition is re-read. */
export function applyEditionOutcomeOverlay(
  edition: NightHawkEdition,
  overlays: Map<string, EditionPlayOutcomeOverlay>
): NightHawkEdition {
  if (!edition.plays?.length || overlays.size === 0) return edition;
  const plays: PlaybookPlayWithTier[] = edition.plays.map((p) => {
    const overlay = overlays.get(p.ticker?.toUpperCase() ?? "");
    if (!overlay) return p;
    let next: PlaybookPlayWithTier = { ...p };
    if (overlay.tier) {
      next.tier = overlay.tier;
      next.conviction = overlay.tier.tier;
      next = capGatePromotedConviction(next) as PlaybookPlayWithTier;
    }
    if (overlay.morning_checked_at) {
      next.morning_checked_at = overlay.morning_checked_at;
    }
    return next;
  });
  return { ...edition, plays: plays as NightHawkEdition["plays"] };
}
