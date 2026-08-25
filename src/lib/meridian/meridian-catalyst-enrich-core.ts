/**
 * Pure reshaping logic for `meridian-catalyst-enrich.ts`, split out so it is unit-testable.
 *
 * `meridian-catalyst-enrich.ts` carries `import "server-only"`, which throws unconditionally
 * under a plain `tsx --test` run (it does not check for an actual browser context the way its doc
 * comment implies) — so nothing in that file can be imported from a test. This file has no
 * server-only import and no network call of its own; it's pure data-in, data-out.
 */

import { looksLikeAnalystAction, meridianFeedText } from "@/lib/meridian/meridian-feed-text";

export type CatalystBriefInput = {
  type: "binary" | "guidance" | "m&a" | "insider" | "buyback" | "offering" | "short" | "ipo" | "other";
  title: string;
  published: string;
};

export type CatalystBriefOutput = {
  type: string;
  title: string;
  published: string | null;
};

const CATALYST_BRIEF_TYPES = new Set(["m&a", "guidance", "buyback", "offering", "binary", "insider"]);

/**
 * Shapes raw Benzinga catalyst rows into the compact list `catalyst_briefs` renders.
 *
 * A "guidance"-channel item whose title is really an analyst rating/PT action is dropped rather
 * than relabeled: live evidence (2026-08-25, DKS earnings) found `enrichment.corporate_guidance`
 * at 0% fill even for mega-cap earnings, while every catalyst_briefs item Benzinga tagged
 * `type: "guidance"` was, in fact, an analyst note — the SAME headline `analyst_revisions`
 * already shows correctly elsewhere on the page. Letting it also appear here, mislabeled
 * "GUIDANCE", is a member-facing mislabel of a duplicate, not new information.
 */
export function shapeCatalystBriefs(catalysts: readonly CatalystBriefInput[]): CatalystBriefOutput[] {
  return catalysts
    .filter((c) => CATALYST_BRIEF_TYPES.has(c.type))
    .filter((c) => c.type !== "guidance" || !looksLikeAnalystAction(meridianFeedText(c.title)))
    .slice(0, 8)
    .map((c) => ({
      type: c.type,
      title: meridianFeedText(c.title),
      published: c.published || null,
    }));
}
