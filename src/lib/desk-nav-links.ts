/**
 * Canonical list of the 7 desk/system nav entries — the single source both `Nav.tsx` (the main
 * nav's Features menu/mega-menu) and `DeskSidebar.tsx` (the desktop icon rail) read from, so the
 * two navs cannot drift into listing different systems. Previously each file kept its own
 * hand-copied array; `DeskSidebar.tsx`'s own top-of-file comment claimed it "reuses Nav's
 * FEATURE_LINKS" while its actual code duplicated the data by hand — accurate today (both arrays
 * happened to still agree) but a landmine, since nothing enforced it.
 *
 * Pure data, no imports beyond nothing — deliberately dependency-free so `DeskSidebar.tsx` can
 * import it without pulling in `Nav.tsx`'s full client-side auth/mobile-menu state tree.
 */
export type DeskNavAccent = "green" | "purple" | "orange" | "blue" | "red" | "teal";

export type DeskNavLink = {
  href: string;
  label: string;
  sub: string;
  accent: DeskNavAccent;
  adminOnly?: boolean;
};

export const DESK_NAV_LINKS: DeskNavLink[] = [
  { href: "/dashboard", label: "SPX Slayer", sub: "SPX structure & 0DTE desk", accent: "green" },
  { href: "/flows", label: "HELIX", sub: "Institutional options flow", accent: "purple" },
  { href: "/heatmap", label: "BlackOut Thermal", sub: "Dealer gamma & vanna map", accent: "orange" },
  { href: "/terminal", label: "Largo", sub: "BlackOut Intelligence desk analyst", accent: "blue" },
  { href: "/nighthawk", label: "Night Hawk", sub: "Playbook + 0DTE Command", accent: "red" },
  { href: "/vector", label: "Vector", sub: "Live SPX chart with dealer gamma & vanna structure", accent: "teal" },
  {
    href: "/meridian",
    label: "Meridian",
    sub: "Catalyst structure desk — macro, earnings, OpEx, FDA",
    accent: "blue",
  },
];
