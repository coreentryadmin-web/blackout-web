"use client";

import type { ReactNode } from "react";
import { useAppAuth } from "@/lib/auth-client";
import { SyncMembershipButton } from "@/components/SyncMembershipButton";

/**
 * /upgrade sync row — SSR ships the anonymous sign-in link from the server page;
 * after Clerk loads, signed-in members swap to the interactive paid-sync button.
 */
export function SyncMembershipClientSwitch({ signInLink }: { signInLink: ReactNode }) {
  const { isLoaded, isSignedIn } = useAppAuth();
  if (!isLoaded || !isSignedIn) return signInLink;
  return <SyncMembershipButton />;
}
