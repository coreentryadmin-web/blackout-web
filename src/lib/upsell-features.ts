// Presentation-only upsell data. Pure, alias-free, no React, no env reads.
// Capability copy sourced from src/lib/marketing/product-manifest.ts.

import type { MarkProduct } from "@/components/marks/ProductMark";
import { PRODUCT_MANIFEST } from "@/lib/marketing/product-manifest";
import { DESK_TIER_REQUIREMENTS } from "@/lib/desk-tier-requirements";
import { tierAtLeast } from "@/lib/tiers";
import type { ToolKey } from "@/lib/tool-access";

export type FeatureRow = {
  /** Short feature name shown in the left column. */
  label: string;
  /** One-line benefit framing (kept concise for the matrix). */
  detail: string;
  /** Whether the Free tier includes this. */
  free: boolean;
  /** Whether SPX Slayer ($49/mo, "community" tier) includes this. */
  community: boolean;
  /** Whether Premium includes this (all current premium gates => true). */
  premium: boolean;
  /**
   * Optional product sigil for the row. Keyed off a STABLE product id, not the
   * display copy — a label edit can no longer silently break the sigil lookup
   * (the old LABEL_TO_MARK maps drifted from these labels and rendered nothing).
   */
  mark?: MarkProduct;
};

/** Derives community/premium access for a desk row from the same manifest the desk's own
 *  layout.tsx gate is verified against (desk-tier-requirements.test.ts) — a row can't silently
 *  say "included" for a tier the desk itself would redirect that tier away from. */
function deskAccess(key: ToolKey): Pick<FeatureRow, "community" | "premium"> {
  const minTier = DESK_TIER_REQUIREMENTS[key];
  return {
    community: tierAtLeast("community", minTier),
    premium: tierAtLeast("premium", minTier),
  };
}

/**
 * Free / SPX Slayer / Premium feature matrix. Order = perceived value, high to low.
 * Edit copy here; the component renders it verbatim.
 */
export const FEATURE_MATRIX: FeatureRow[] = [
  {
    label: "HELIX live flow feed",
    detail: "Real-time options-flow tape, sorted and tagged",
    free: false,
    ...deskAccess("flows"),
    mark: "helix",
  },
  {
    label: "SPX Slayer desk",
    detail: "Confluence, GEX walls, dealer gamma — live",
    free: false,
    ...deskAccess("spx"),
    mark: "spx",
  },
  {
    label: "Largo AI desk analyst",
    detail: "Plain-English answers grounded in every tool's live data",
    free: false,
    ...deskAccess("largo"),
    mark: "largo",
  },
  {
    label: "Night Hawk 0DTE Command",
    detail: PRODUCT_MANIFEST.hawk.positioning,
    free: false,
    ...deskAccess("nighthawk"),
    mark: "nighthawk",
  },
  {
    label: "Thermal dealer-gamma heatmaps",
    detail: PRODUCT_MANIFEST.thermal.positioning,
    free: false,
    ...deskAccess("heatmap"),
    mark: "heatmap",
  },
  {
    label: "Vector universe scanner",
    detail: PRODUCT_MANIFEST.vector.positioning,
    free: false,
    ...deskAccess("vector"),
    mark: "vector",
  },
  {
    label: "Meridian earnings desk",
    detail: PRODUCT_MANIFEST.meridian.positioning,
    free: false,
    ...deskAccess("meridian"),
  },
  {
    label: "SPX AI commentary",
    detail: "Generated read on the current tape",
    free: false,
    // Part of the SPX dashboard itself (src/features/spx/), gated the same as the desk it lives on.
    ...deskAccess("spx"),
  },
  {
    label: "Playbook & docs",
    detail: "SPX Slayer playbook and method docs",
    free: false,
    ...deskAccess("spx"),
  },
  {
    label: "0DTE graded plays",
    detail: "SPX Slayer: SPX 0DTE grades. Premium: every desk's graded play log.",
    free: false,
    // Scope differs by tier (see detail) but both paid tiers get a graded log — the exact scope
    // difference is prose, not a boolean this table can express; cross-checked against
    // PLAN_MATRIX.spx_slayer's own "0DTE graded plays (A–F)" include line in upsell-features.test.ts.
    community: true,
    premium: true,
  },
  {
    label: "Private Discord access",
    detail: "Member-only trade discussion",
    free: false,
    // Not a code-level gate (external Discord invite) — cross-checked against
    // PLAN_MATRIX.spx_slayer's own "Private Discord access" include line in upsell-features.test.ts.
    community: true,
    premium: true,
  },
  {
    label: "Ticker search",
    detail: "Look up any symbol",
    free: true,
    community: true,
    premium: true,
  },
  {
    label: "Account & updates",
    detail: "Sign in, profile, product updates",
    free: true,
    community: true,
    premium: true,
  },
];

export type PlanValueProp = {
  /** Optional badge text rendered above the card (e.g. "Best value"). */
  badge?: string;
  /** Sub-price framing line, e.g. "$58/mo billed yearly". */
  subline?: string;
  /** Savings callout, e.g. "Save $260 vs monthly". */
  savings?: string;
  /** Visually emphasize this card (anchor option). */
  featured?: boolean;
};

/**
 * Value framing keyed by the EXACT WHOP_PREMIUM_CHECKOUT_OPTIONS label
 * (see src/lib/whop-checkout.ts). If a label has no entry here the card still
 * renders with just its label/href — framing is purely additive and optional.
 *
 * Numbers below are presentation copy derived from the list prices
 * ($49/mo SPX Slayer, $199/mo Premium, $1,999/yr Premium). If you
 * change Whop prices, update the labels in whop-checkout.ts AND these strings together.
 */
export const PLAN_VALUE_PROPS: Record<string, PlanValueProp> = {
  "SPX Slayer — $49": {
    subline: "SPX desk access · billed monthly",
  },
  "Monthly — $199": {
    subline: "Billed monthly · stand down anytime",
  },
  "Yearly — $1,999": {
    badge: "Standard issue",
    subline: "≈ $167/mo · billed yearly",
    savings: "Save $389 vs monthly",
    featured: true,
  },
};

/** Lookup helper kept pure for unit tests. */
export function valuePropFor(label: string): PlanValueProp {
  return PLAN_VALUE_PROPS[label] ?? {};
}
