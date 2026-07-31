import type { MarkProduct } from "@/components/marks/ProductMark";

/** Bottom instrument rail — 5-tab Intelligence hub IA (Flow+Thermal grouped under Intel). */
export type IosTabRailItem = {
  href: string;
  label: string;
  short: string;
  mark: MarkProduct;
  accent: string;
  code: string;
  /** Intel hub: tab stays active for /flows and /heatmap. */
  intelligenceHub?: boolean;
};

export const IOS_TAB_RAIL: IosTabRailItem[] = [
  {
    href: "/dashboard",
    label: "SPX Slayer",
    short: "SPX",
    mark: "spx",
    accent: "#a3e635",
    code: "SPX",
  },
  {
    href: "/flows",
    label: "Intelligence",
    short: "Intel",
    mark: "helix",
    accent: "#bf5fff",
    code: "INT",
    intelligenceHub: true,
  },
  {
    href: "/vector",
    label: "Vector",
    short: "Vector",
    mark: "vector",
    accent: "#2dd4bf",
    code: "VEC",
  },
  {
    href: "/nighthawk",
    label: "Night Hawk",
    short: "Hawk",
    mark: "nighthawk",
    accent: "#ff2d55",
    code: "HWK",
  },
  {
    href: "/terminal",
    label: "Largo",
    short: "Largo",
    mark: "largo",
    accent: "#22d3ee",
    code: "LRG",
  },
];

export function isIosIntelligenceHubPath(path: string): boolean {
  const p = path.split(/[?#]/)[0] ?? path;
  return p === "/flows" || p.startsWith("/flows/") || p === "/heatmap" || p.startsWith("/heatmap/");
}

export function isIosTabRailActive(tab: IosTabRailItem, path: string): boolean {
  const p = path.split(/[?#]/)[0] ?? path;
  if (tab.intelligenceHub) return isIosIntelligenceHubPath(p);
  return p === tab.href || p.startsWith(`${tab.href}/`);
}

export function getIosTabRailIndex(path: string): number {
  const p = path.split(/[?#]/)[0] ?? path;
  return IOS_TAB_RAIL.findIndex((tab) => isIosTabRailActive(tab, p));
}
