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

/** Short nav titles for the iOS top bar context line. */
export const IOS_TOOL_NAV_LABELS: Record<IosToolRoute, string> = {
  "/dashboard": "SPX Slayer",
  "/flows": "HELIX",
  "/heatmap": "BlackOut Thermal",
  "/terminal": "Largo",
  "/nighthawk": "Night Hawk",
  "/grid": "0DTE Command",
};

export function isIosToolRoute(path: string): boolean {
  return IOS_TOOL_ROUTES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/** Resolve the active tool label for iOS nav chrome (null when not on a tool route). */
export function getIosToolNavLabel(path: string): string | null {
  const match = IOS_TOOL_ROUTES.find((prefix) => path === prefix || path.startsWith(`${prefix}/`));
  return match ? IOS_TOOL_NAV_LABELS[match] : null;
}
