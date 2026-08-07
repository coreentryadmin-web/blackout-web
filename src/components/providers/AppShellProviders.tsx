"use client";

import { ClerkProvider } from "@clerk/nextjs";
import { MotionProvider } from "@/components/MotionProvider";
import { SessionCacheGuard } from "@/components/SessionCacheGuard";
import { ClientErrorReporter } from "@/components/ClientErrorReporter";
import { OnboardingGuide } from "@/components/OnboardingGuide";
import { PwaRegister } from "@/components/PwaRegister";
import { IosViewportLock } from "@/components/ios/IosViewportLock";
import { IosKeyboardRoot } from "@/hooks/useIosKeyboardInset";
import { SharedSigilDefs } from "@/components/marks/SharedSigilDefs";
import {
  clerkAllowedRedirectOrigins,
  clerkSatelliteProviderProps,
} from "@/lib/clerk-env";
import { ClerkAuthBridge } from "@/lib/auth-client";
import { Ga4ConversionTracker } from "@/components/analytics/Ga4ConversionTracker";

function DeskShell({ children }: { children: React.ReactNode }) {
  return (
    <MotionProvider>
      <SharedSigilDefs />
      <SessionCacheGuard />
      <ClientErrorReporter />
      <PwaRegister />
      <IosViewportLock />
      <IosKeyboardRoot />
      <OnboardingGuide />
      <Ga4ConversionTracker />
      {children}
    </MotionProvider>
  );
}

/** Clerk + motion + desk client shell — NOT loaded on the public marketing homepage. */
export function AppShellProviders({ children }: { children: React.ReactNode }) {
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
      <ClerkAuthBridge>
        <DeskShell>{children}</DeskShell>
      </ClerkAuthBridge>
    </ClerkProvider>
  );
}
