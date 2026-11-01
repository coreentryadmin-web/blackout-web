import type { MarkProduct } from "@/components/marks/ProductMark";

/** Primary product routes where the iOS bottom tab bar should appear. */
export const IOS_TOOL_ROUTES = [
  "/dashboard",
  "/flows",
  "/heatmap",
  "/terminal",
  "/nighthawk",
  "/vector",
  "/meridian",
] as const;

export type IosToolRoute = (typeof IOS_TOOL_ROUTES)[number];

function normalizeIosPath(path: string): string {
  return path.split(/[?#]/)[0] ?? path;
}

export type IosRouteKey =
  | "dashboard"
  | "flows"
  | "heatmap"
  | "largo"
  | "nighthawk"
  | "vector"
  | "meridian"
  | "account"
  | "faq"
  | "learn"
  | "upgrade"
  | "admin"
  | "other";

export type IosToolMeta = {
  href: IosToolRoute;
  label: string;
  short: string;
  mark: MarkProduct;
  accent: string;
  tagline: string;
  /** Terminal instrument code (instrument rail). */
  code: string;
};

/** Canonical tool metadata for native iOS chrome (header, tab bar, menu). */
export const IOS_TOOLS: IosToolMeta[] = [
  {
    href: "/dashboard",
    label: "SPX Slayer",
    short: "SPX",
    mark: "spx",
    accent: "#a3e635",
    tagline: "0DTE structure desk",
    code: "SPX",
  },
  {
    href: "/flows",
    label: "HELIX",
    short: "HELIX",
    mark: "helix",
    accent: "#bf5fff",
    tagline: "Institutional flow tape",
    code: "HLX",
  },
  {
    href: "/heatmap",
    label: "BlackOut Thermal",
    short: "Thermal",
    mark: "heatmap",
    accent: "#ff6b2b",
    tagline: "Dealer gamma map",
    code: "THM",
  },
  {
    href: "/terminal",
    label: "Largo",
    short: "Largo",
    mark: "largo",
    accent: "#22d3ee",
    tagline: "AI desk analyst",
    code: "LRG",
  },
  {
    href: "/nighthawk",
    label: "Night Hawk",
    short: "Hawk",
    mark: "nighthawk",
    accent: "#ff2d55",
    tagline: "0DTE Command desk",
    code: "HWK",
  },
  {
    href: "/vector",
    label: "Vector",
    short: "Vector",
    mark: "vector",
    accent: "#2dd4bf",
    tagline: "Gamma-wall radar · cross-ticker",
    code: "VEC",
  },
  {
    href: "/meridian",
    label: "Meridian",
    short: "Meridian",
    mark: "largo",
    accent: "#22d3ee",
    tagline: "Catalyst structure desk",
    code: "MRD",
  },
];

const IOS_UTILITY_META: Record<
  "account" | "faq" | "learn" | "upgrade" | "admin" | "other",
  { title: string; accent: string }
> = {
  account: { title: "Account", accent: "#7dd3fc" },
  faq: { title: "FAQ", accent: "#7dd3fc" },
  learn: { title: "Learn", accent: "#7dd3fc" },
  upgrade: { title: "Membership", accent: "#7dd3fc" },
  admin: { title: "Admin", accent: "#7dd3fc" },
  other: { title: "BlackOut", accent: "#a3e635" },
};

/** Maps URL path → `data-ios-route` key (used by chrome + CSS). */
export function getIosRouteKey(path: string): IosRouteKey {
  // Strip a query string/hash before matching — same bug class, same sibling file, as the
  // isIosNativeShellPath fix above. The "/dashboard" branch below is the one check in this
  // function that requires an EXACT match or a startsWith(`${prefix}/`) match (every other
  // branch here is a bare startsWith, which already tolerates a suffix appended directly
  // after the prefix), so an un-stripped query string or hash on "/dashboard" itself
  // ("/dashboard?ref=upgrade", "/dashboard#widgets") failed both checks and fell through
  // every branch to "other" instead of "dashboard".
  const p = normalizeIosPath(path);
  if (p === "/dashboard" || p.startsWith("/dashboard/")) return "dashboard";
  if (p.startsWith("/flows")) return "flows";
  if (p.startsWith("/heatmap")) return "heatmap";
  if (p.startsWith("/terminal")) return "largo";
  if (p.startsWith("/nighthawk")) return "nighthawk";
  if (p.startsWith("/vector")) return "vector";
  if (p.startsWith("/meridian")) return "meridian";
  if (p.startsWith("/account")) return "account";
  if (p.startsWith("/faq")) return "faq";
  if (p.startsWith("/learn")) return "learn";
  if (p.startsWith("/upgrade")) return "upgrade";
  if (p.startsWith("/admin")) return "admin";
  return "other";
}

export function isIosToolRoute(path: string): boolean {
  const p = normalizeIosPath(path);
  return IOS_TOOL_ROUTES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}

/** Tab order index for direction-aware iOS page transitions (-1 when not a tool route). */
export function getIosToolRouteIndex(path: string): number {
  const p = normalizeIosPath(path);
  return IOS_TOOL_ROUTES.findIndex((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}

export function getIosToolMeta(path: string): IosToolMeta | null {
  const p = normalizeIosPath(path);
  return IOS_TOOLS.find((t) => p === t.href || p.startsWith(`${t.href}/`)) ?? null;
}

/** Resolve the active tool label for iOS nav chrome (null when not on a tool route). */
export function getIosToolNavLabel(path: string): string | null {
  return getIosToolMeta(path)?.label ?? null;
}

export type IosHeaderMeta = {
  key: IosRouteKey;
  title: string;
  kicker: string;
  accent: string;
  mark?: MarkProduct;
  /** Show back-to-desk affordance (utility routes). */
  showBack: boolean;
};

/** Header title/accent for native chrome — tools + utility routes. */
export function getIosHeaderMeta(path: string): IosHeaderMeta {
  const p = path.split(/[?#]/)[0] ?? path;
  if (p === "/heatmap" || p.startsWith("/heatmap/")) {
    return {
      key: "heatmap",
      title: "Intelligence",
      kicker: "Dealer gamma map",
      accent: "#ff6b2b",
      mark: "heatmap",
      showBack: false,
    };
  }
  if (p === "/flows" || p.startsWith("/flows/")) {
    return {
      key: "flows",
      title: "Intelligence",
      kicker: "Institutional flow tape",
      accent: "#bf5fff",
      mark: "helix",
      showBack: false,
    };
  }
  const tool = getIosToolMeta(path);
  if (tool) {
    return {
      key: getIosRouteKey(path),
      title: tool.label,
      kicker: tool.tagline,
      accent: tool.accent,
      mark: tool.mark,
      showBack: false,
    };
  }
  const key = getIosRouteKey(path);
  const utilityKey =
    key === "account" ||
    key === "faq" ||
    key === "learn" ||
    key === "upgrade" ||
    key === "admin" ||
    key === "other"
      ? key
      : "other";
  const utility = IOS_UTILITY_META[utilityKey];
  return {
    key,
    title: utility.title,
    kicker: "",
    accent: utility.accent,
    showBack: key !== "other" && !isIosToolRoute(path),
  };
}

/** Product paths that use native chrome once signed in (head script pre-flag). */
export const IOS_NATIVE_SHELL_PATH_PREFIXES = [
  "/dashboard",
  "/flows",
  "/heatmap",
  "/terminal",
  "/nighthawk",
  "/vector",
  "/meridian",
  "/account",
  "/faq",
  "/learn",
  "/upgrade",
  "/admin",
] as const;

export function isIosNativeShellPath(path: string): boolean {
  // Strip a query string/hash before matching, same as isIosToolRoute/getIosToolMeta/
  // getIosToolRouteIndex above (normalizeIosPath) — without it, a utility path carrying
  // a query string or hash (e.g. "/account?from=upgrade", "/upgrade#plans") fails both the
  // exact-match and the startsWith(`${prefix}/`) check and is wrongly read as not a
  // native-shell path.
  const p = normalizeIosPath(path);
  return IOS_NATIVE_SHELL_PATH_PREFIXES.some(
    (prefix) => p === prefix || p.startsWith(`${prefix}/`)
  );
}

/** In-app routes that use the native header (signed-in product shell). */
export function isIosNativeShellRoute(path: string): boolean {
  if (isIosToolRoute(path)) return true;
  return isIosNativeShellPath(path);
}
