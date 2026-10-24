// Read-time merge of durable outcome-row pins onto the member edition payload:
//  - publish_context.tier → play.tier (tier engine factors for the right rail)
//  - morning_verdict.checked_at → per-play confirm timestamp (when surfaced)

import type { NighthawkEditionOutcomeOverlayRow } from "@/lib/db";
import { readNighthawkMorningVerdict } from "@/lib/bie/nighthawk-edition-read";
import { readPinnedTierAssignment } from "./debrief-aggregate";
import { capGatePromotedConviction } from "./publish-gates";
import { capGatePromotedTierAssignment, type NighthawkTierAssignment } from "./nighthawk-tiers";
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
 *  regardless of how many times its edition is re-read.
 *
 *  BUG FIX (Ask Largo standing mandate, 2026-10-21, live repro MSTR): the fix above only ever
 *  capped `conviction` (and, per a later fix, `key_signal`'s trailing grade token) — it never
 *  capped the full `tier` ASSIGNMENT object this same block also re-derives from the raw pin on
 *  every read. So a gate-promoted play correctly showed `conviction: "B"` right next to
 *  `tier: { tier: "A", factors: [...] }` (still uncapped) on every live read — the exact
 *  self-contradiction `capGatePromotedTierAssignment` (nighthawk-tiers.ts) was built to prevent at
 *  publish-context.ts's build-time pin, reopened one layer up here because this read-time overlay
 *  independently re-derives `tier` from the raw pin and was never given the same cap. Fixed by
 *  running the pinned tier through the identical shared helper before assigning it — the same
 *  defense-in-depth principle this block already applies to `conviction` (trust nothing the pin
 *  says about a gate-promoted play without re-checking it on every read).
 *
 *  BUG FIX (Ask Largo standing mandate, 2026-10-21, 4th site, live repro MSTR score 52):
 *  `capGatePromotedConviction` (publish-gates.ts) rewrites `key_signal`'s trailing "(A)"/"(A+)"
 *  grade token ONLY when its own stale-detection guard reads the play's `conviction` as still
 *  "A"/"A+" — that is how it knows a cap is actually needed here. This block used to overwrite
 *  `next.conviction` to the ALREADY-CAPPED tier letter (`cappedTier.tier`, e.g. "B") BEFORE calling
 *  `capGatePromotedConviction`, so by the time that guard ran, `conviction` already read "B" and
 *  the guard's own `=== "A"/"A+"` check was always false — the rewrite branch could never fire,
 *  and `key_signal` kept citing the stale, pre-cap grade forever. Fixed by feeding
 *  `capGatePromotedConviction` the RAW, pre-cap tier letter (`overlay.tier.tier`) so its guard
 *  sees exactly what it needs to decide whether a cap-and-rewrite is due, then re-deriving the
 *  final `conviction` from `cappedTier.tier` afterward (needed for every play this block touches,
 *  not just the gate-promoted-and-capped case — `capGatePromotedConviction` is a no-op whenever
 *  `gate_promoted` is false or the raw tier wasn't A/A+, so something must still sync `conviction`
 *  to the tier pin in those cases). */
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
      const cappedTier = capGatePromotedTierAssignment(overlay.tier, p.gate_promoted === true);
      next.tier = cappedTier;
      // Feed capGatePromotedConviction the RAW, pre-cap letter so its own "was this A/A+"
      // stale-detection guard still fires — assigning the already-capped letter here first
      // (as a prior version of this block did) makes that guard permanently false. See the
      // 2026-10-21 bug-fix comment above.
      next.conviction = overlay.tier.tier;
      next = capGatePromotedConviction(next) as PlaybookPlayWithTier;
      // Re-derive the final conviction from the (possibly capped) tier assignment. This is a
      // no-op when capGatePromotedConviction just capped it (both land on cappedTier.tier), and
      // necessary when it didn't fire (not gate-promoted, or the raw tier wasn't A/A+) — those
      // plays still need `conviction` synced to the tier pin.
      next.conviction = cappedTier.tier;
    }
    if (overlay.morning_checked_at) {
      next.morning_checked_at = overlay.morning_checked_at;
    }
    return next;
  });
  return { ...edition, plays: plays as NightHawkEdition["plays"] };
}
