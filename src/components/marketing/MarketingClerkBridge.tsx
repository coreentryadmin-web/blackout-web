"use client";

import type { ReactNode } from "react";
import { ClerkProvider } from "@clerk/nextjs";
import {
  clerkAllowedRedirectOrigins,
  clerkSatelliteProviderProps,
} from "@/lib/clerk-env";
import { ClerkAuthBridge } from "@/lib/auth-client";

/**
 * Minimal Clerk shell for marketing routes that need auth-aware client widgets
 * (/upgrade sync, etc.) without pulling the full desk AppShellProviders bundle.
 */
export function MarketingClerkBridge({ children }: { children: ReactNode }) {
  const allowedRedirectOrigins = clerkAllowedRedirectOrigins();
  const satellite = clerkSatelliteProviderProps();
  return (
    <ClerkProvider
      dynamic
      signInFallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/"
      {...satellite}
      {...(allowedRedirectOrigins ? { allowedRedirectOrigins } : {})}
    >
      <ClerkAuthBridge>{children}</ClerkAuthBridge>
    </ClerkProvider>
  );
}
