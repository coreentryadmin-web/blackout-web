"use client";

// Slim icon rail for switching between systems — the left-rail piece of the X Ads
// Manager reference the Night Hawk reskin (#3081) was built from. Desktop-only
// (hidden below 1024px via .desk-sidebar's CSS, see globals.css) so it never
// touches the mobile chrome, which already has its own navigation (Nav's hamburger
// menu + IosAppTabBar) — this is additive for wide viewports only, not a
// replacement for either. Reuses Nav's FEATURE_LINKS accent/href/label data so the
// two navs can never drift into listing different systems.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { ProductMark, NAV_TO_MARK, type MarkProduct } from "@/components/marks/ProductMark";
import { toolKeyForHref, type ToolKey } from "@/lib/tool-access";

type Accent = "green" | "purple" | "orange" | "blue" | "red" | "teal";
type RailLink = { href: string; label: string; accent: Accent };

// Kept in sync with Nav.tsx's FEATURE_LINKS by hand (same 7 systems) — importing
// from Nav.tsx directly would pull in its full client-side auth/mobile-menu state
// tree into this much smaller component for no benefit.
const RAIL_LINKS: RailLink[] = [
  { href: "/dashboard", label: "SPX Slayer", accent: "green" },
  { href: "/flows", label: "HELIX", accent: "purple" },
  { href: "/heatmap", label: "BlackOut Thermal", accent: "orange" },
  { href: "/terminal", label: "Largo", accent: "blue" },
  { href: "/nighthawk", label: "Night Hawk", accent: "red" },
  { href: "/vector", label: "Vector", accent: "teal" },
  { href: "/meridian", label: "Meridian", accent: "blue" },
];

export function DeskSidebar({ lockedTools = [] }: { lockedTools?: ToolKey[] }) {
  const path = usePathname();

  return (
    <nav className="desk-sidebar" aria-label="Switch system">
      <ul className="desk-sidebar-list">
        {RAIL_LINKS.map((link) => {
          const active = path.startsWith(link.href);
          const key = toolKeyForHref(link.href);
          const locked = key != null && lockedTools.includes(key);
          const mark: MarkProduct | undefined = NAV_TO_MARK[link.accent] as MarkProduct | undefined;
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                className={clsx("desk-sidebar-item", active && "is-active", locked && "is-locked")}
                aria-current={active ? "page" : undefined}
                title={link.label}
              >
                <span className="desk-sidebar-icon" aria-hidden>
                  {link.href === "/meridian" ? (
                    <span className="meridian-mark text-[1rem]">✦</span>
                  ) : mark ? (
                    <ProductMark product={mark} size={22} animated={false} />
                  ) : null}
                </span>
                <span className="desk-sidebar-tooltip">{link.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export default DeskSidebar;
