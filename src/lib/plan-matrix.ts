import { MEMBERSHIP_PRICING, usd } from "@/lib/pricing";

/** Canonical plan IDs — must match Whop product mapping in src/lib/whop.ts */
export type PlanSku = "free" | "spx_slayer" | "premium_monthly" | "premium_yearly";

export type PlanDefinition = {
  sku: PlanSku;
  /** Member-facing name (never "Community Discord") */
  name: string;
  priceLabel: string;
  headline: string;
  includes: readonly string[];
  excludes: readonly string[];
};

/** Single source of truth for marketing + FAQ + Whop remodel script. */
export const PLAN_MATRIX: Record<Exclude<PlanSku, "free">, PlanDefinition> = {
  spx_slayer: {
    sku: "spx_slayer",
    name: "SPX Slayer",
    priceLabel: `${usd(MEMBERSHIP_PRICING.community)}/mo`,
    headline: "Live SPX 0DTE desk — regime, GEX, graded plays",
    includes: [
      "SPX Slayer desk (live SPX/SPXW)",
      "Dealer gamma & GEX positioning",
      "0DTE graded plays (A–F)",
      "Strike-level heatmaps on SPX",
      "Private Discord access",
    ],
    excludes: [
      "HELIX live flow tape",
      "Largo AI desk analyst",
      "Night Hawk / 0DTE Command scanners",
      "Thermal multi-ticker heatmaps",
      "Vector cross-ticker desk",
    ],
  },
  premium_monthly: {
    sku: "premium_monthly",
    name: "Premium Monthly",
    priceLabel: `${usd(MEMBERSHIP_PRICING.monthly)}/mo`,
    headline: "Full platform — every live module",
    includes: [
      "Everything in SPX Slayer",
      "HELIX live options-flow tape",
      "Largo AI desk analyst",
      "Night Hawk evening + 0DTE Command",
      "Thermal heatmaps (GEX/VEX/DEX/CHARM)",
      "Vector scanner + Meridian",
      "Graded play log & Discord",
    ],
    excludes: [] as const,
  },
  premium_yearly: {
    sku: "premium_yearly",
    name: "Premium Yearly",
    priceLabel: `${usd(MEMBERSHIP_PRICING.yearly)}/yr`,
    headline: "Full platform — best annual value",
    includes: [
      "Everything in Premium Monthly",
      `Save ${usd(MEMBERSHIP_PRICING.yearlySavingsVsMonthly)} vs paying monthly`,
    ],
    excludes: [] as const,
  },
};
