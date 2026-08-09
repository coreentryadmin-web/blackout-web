"use client";

import Link from "next/link";
import { UserButton, useAuth } from "@clerk/nextjs";
import { useAppAuth } from "@/lib/auth-client";

const CLERK_APPEARANCE = {
  variables: {
    colorBackground: "#040407",
    colorText: "#f4f6fb",
    colorTextSecondary: "#9fb4d4",
    colorPrimary: "#a3e635",
    colorNeutral: "rgba(255,255,255,0.16)",
    borderRadius: "12px",
  },
  elements: {
    avatarBox: "w-9 h-9 ring-1 ring-bull/40",
    userButtonPopoverCard:
      "!bg-[#040407] border border-white/10 shadow-[0_8px_40px_-8px_rgba(0,0,0.9)]",
    userButtonPopoverActionButton: "text-sky-200 hover:text-white hover:!bg-white/5",
    userButtonPopoverActionButtonText: "text-sky-200",
    userButtonPopoverFooter: "!bg-[#040407] border-t border-white/8",
  },
} as const;

/** UserButton throws if ClerkProvider is not active yet — gate on Clerk's own isLoaded. */
function ClerkUserButton() {
  const { isLoaded: clerkReady } = useAuth();
  if (!clerkReady) {
    return <span className="inline-block h-9 w-9 rounded-full bg-white/5" aria-hidden />;
  }
  return <UserButton appearance={CLERK_APPEARANCE} userProfileUrl="/account" />;
}

export function AuthUserMenu() {
  const { isSignedIn, isLoaded, email, signOut } = useAppAuth();

  if (!isLoaded) {
    return <span className="inline-block h-9 w-9 rounded-full bg-white/5" aria-hidden />;
  }

  if (!isSignedIn) {
    return (
      <Link href="/sign-in" className="nav-cta">
        Sign in
      </Link>
    );
  }

  return <ClerkUserButton />;
}
