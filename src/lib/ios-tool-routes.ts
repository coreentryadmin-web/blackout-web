import type { MarkProduct } from "@/components/marks/ProductMark";

/** Primary product routes where the iOS bottom tab bar should appear. */
export const IOS_TOOL_ROUTES = [
  "/dashboard",
  "/flows",
  "/heatmap",
  "/terminal",
  "/nighthawk",
  "/grid",
] as const;

export type IosToolRoute = (typeof IOS_TOOL_ROUTES)[number];

export type IosToolMeta = {
  href: IosToolRoute;
  label: string;
  short: string;
  mark: MarkProduct;
  accent: string;
  tagline: string;
};

/** Canonical tool metadata for native iOS chrome (header, tab bar, menu). */
export const IOS_TOOLS: IosToolMeta[] = [
  {
    href: "/dashboard",
    label: "SPX Slayer",
    short: "SPX",
    mark: "spx",
    accent: "#00e676",
    tagline: "0DTE structure desk",
  },
  {
    href: "/flows",
    label: "HELIX",
    short: "HELIX",
    mark: "helix",
    accent: "#bf5fff",
    tagline: "Institutional flow tape",
  },
  {
    href: "/heatmap",
    label: "BlackOut Thermal",
    short: "Thermal",
    mark: "heatmap",
    accent: "#ff6b2b",
    tagline: "Dealer gamma map",
  },
  {
    href: "/terminal",
    label: "Largo",
    short: "Largo",
    mark: "largo",
    accent: "#22d3ee",
    tagline: "AI desk analyst",
  },
  {
    href: "/nighthawk",
    label: "Night Hawk",
    short: "Hawk",
    mark: "nighthawk",
    accent: "#ff2d55",
    tagline: "Overnight playbook",
  },
  {
    href: "/grid",
    label: "0DTE Command",
    short: "0DTE",
    mark: "grid",
    accent: "#ffcc4d",
    tagline: "Always-on hunter",
  },
];

export const IOS_TOOL_NAV_LABELS: Record<IosToolRoute, string> = Object.fromEntries(
  IOS_TOOLS.map((t) => [t.href, t.label])
) as Record<IosToolRoute, string>;

export function isIosToolRoute(path: string): boolean {
  return IOS_TOOL_ROUTES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export function getIosToolMeta(path: string): IosToolMeta | null {
  return IOS_TOOLS.find((t) => path === t.href || path.startsWith(`${t.href}/`)) ?? null;
}

/** Resolve the active tool label for iOS nav chrome (null when not on a tool route). */
export function getIosToolNavLabel(path: string): string | null {
  return getIosToolMeta(path)?.label ?? null;
}

/** In-app routes that use the native header (signed-in product shell). */
export function isIosNativeShellRoute(path: string): boolean {
  if (isIosToolRoute(path)) return true;
  return (
    path.startsWith("/account") ||
    path.startsWith("/faq") ||
    path.startsWith("/learn") ||
    path.startsWith("/upgrade") ||
    path.startsWith("/admin")
  );
}
