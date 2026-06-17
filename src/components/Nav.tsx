"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import { clsx } from "clsx";

const NAV_LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/flows", label: "Flow Feed" },
  { href: "/heatmap", label: "Heatmaps" },
  { href: "/terminal", label: "AI Terminal" },
  { href: "/nighthawk", label: "Night Hawk" },
];

export function Nav() {
  const path = usePathname();

  return (
    <nav className="sticky top-0 z-50 flex items-center justify-between px-8 py-4 border-b border-surface-2 bg-black/95 backdrop-blur-md">
      {/* Logo */}
      <Link href="/" className="flex flex-col leading-none group">
        <span className="font-display text-2xl tracking-[4px] text-white group-hover:text-white/90 transition-colors">
          BLACKOUT
        </span>
        <span className="text-[10px] tracking-[5px] text-text-muted font-light mt-[-3px]">
          TRADING
        </span>
      </Link>

      {/* Links — only show when signed in */}
      <SignedIn>
        <ul className="hidden md:flex items-center gap-8">
          {NAV_LINKS.map(({ href, label }) => (
            <li key={href}>
              <Link
                href={href}
                className={clsx(
                  "text-[11px] tracking-[2px] uppercase transition-colors",
                  path.startsWith(href)
                    ? "text-white"
                    : "text-text-secondary hover:text-text-primary"
                )}
              >
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </SignedIn>

      {/* Auth buttons */}
      <div className="flex items-center gap-4">
        <SignedOut>
          <Link
            href="/sign-in"
            className="text-[11px] tracking-[2px] uppercase text-text-secondary hover:text-white transition-colors"
          >
            Sign In
          </Link>
          <Link
            href="/sign-up"
            className="bg-white text-black px-5 py-2 text-[11px] tracking-[2px] uppercase font-bold hover:bg-white/90 transition-opacity"
          >
            Join Now
          </Link>
        </SignedOut>
        <SignedIn>
          <UserButton
            appearance={{
              elements: {
                avatarBox: "w-8 h-8",
                userButtonPopoverCard: "bg-surface-2 border border-border text-text-primary",
              },
            }}
          />
        </SignedIn>
      </div>
    </nav>
  );
}
