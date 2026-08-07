"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAuth as useClerkAuth, useUser as useClerkUser } from "@clerk/nextjs";

export type AppAuthState = {
  isLoaded: boolean;
  isSignedIn: boolean;
  userId: string | null;
  email: string | null;
  tier: string | null;
  signOut: () => void;
};

const unloaded: AppAuthState = {
  isLoaded: false,
  isSignedIn: false,
  userId: null,
  email: null,
  tier: null,
  signOut: () => {},
};

const ClerkAuthContext = createContext<AppAuthState | null>(null);

/** Must render under ClerkProvider — hooks live here, not in useAppAuth. */
function ClerkAuthBridge({ children }: { children: ReactNode }) {
  const clerk = useClerkAuth();
  const { user } = useClerkUser();
  const meta = user?.publicMetadata as { tier?: string; role?: string } | undefined;
  // role:admin must bypass client-side Premium gates (matches requireTierApi server-side).
  const tier =
    meta?.role === "admin" ? "admin" : meta?.tier === "premium" ? "premium" : meta?.tier ?? null;

  const value = useMemo<AppAuthState>(
    () => ({
      isLoaded: clerk.isLoaded,
      isSignedIn: Boolean(clerk.isSignedIn),
      userId: clerk.userId ?? null,
      email: user?.primaryEmailAddress?.emailAddress ?? null,
      tier,
      signOut: () => {
        void clerk.signOut?.();
      },
    }),
    [clerk.isLoaded, clerk.isSignedIn, clerk.userId, clerk.signOut, user, tier]
  );

  return <ClerkAuthContext.Provider value={value}>{children}</ClerkAuthContext.Provider>;
}

export function useAppAuth(): AppAuthState {
  const clerkCtx = useContext(ClerkAuthContext);
  return clerkCtx ?? unloaded;
}

export { ClerkAuthBridge };
