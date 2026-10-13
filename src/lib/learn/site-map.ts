import type { LearnSlug } from "@/lib/learn/nav";
import type { LearnNavItem } from "@/lib/learn/types";

/** Live app routes — cross-linked from Learn docs. */
export const TOOL_ROUTES: Record<
  Exclude<LearnSlug, "getting-started" | "glossary">,
  string
> = {
  "spx-slayer": "/dashboard",
  "helix-flows": "/flows",
  "largo-ai": "/terminal",
  "night-hawk": "/nighthawk",
  "heat-maps": "/heatmap",
  vector: "/vector",
  meridian: "/meridian",
};

export function toolRoute(slug: LearnSlug): string | null {
  if (slug === "getting-started" || slug === "glossary") return null;
  return TOOL_ROUTES[slug as keyof typeof TOOL_ROUTES] ?? null;
}

export const PRIMARY_NAV: LearnNavItem[] = [
  {
    label: "SPX Slayer",
    href: "/dashboard",
    description: "Primary RTH desk — GEX structure, play engine, live 0DTE intelligence.",
    badge: "Core desk",
  },
  {
    label: "HELIX",
    href: "/flows",
    description: "Institutional options flow tape — sweeps, blocks, and unusual prints.",
  },
  {
    label: "BlackOut Thermal",
    href: "/heatmap",
    description: "GEX, VEX, DEX, and CHARM surfaces across strikes and expiries.",
  },
  {
    label: "Largo",
    href: "/terminal",
    description: "BlackOut Intelligence analyst grounded in live platform data.",
  },
  {
    label: "Night Hawk",
    href: "/nighthawk",
    description: "Evening playbook plus 0DTE Command always-on scanner.",
  },
  {
    label: "Vector",
    href: "/vector",
    description: "Live SPX chart with dealer gamma and vanna structure overlaid on price.",
  },
  {
    label: "Meridian",
    href: "/meridian",
    description: "Catalyst structure desk — earnings, macro releases, OpEx, and FDA decisions.",
  },
  {
    label: "Learn",
    href: "/learn",
    description: "This documentation hub — textbook flow from orientation to advanced workflows.",
  },
  {
    label: "Account",
    href: "/account",
    description: "Membership, alerts, and account settings.",
  },
  {
    label: "Upgrade",
    href: "/upgrade",
    description: "Premium membership and billing.",
  },
];
