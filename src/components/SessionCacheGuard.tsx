"use client";

import { useEffect, useRef } from "react";
import { useAuth } from "@clerk/nextjs";
import { clearAllSessionCache } from "@/lib/session-cache";

/** Clears blackout sessionStorage keys when Clerk session ends. */
export function SessionCacheGuard() {
  const { isSignedIn, isLoaded } = useAuth();
  const wasSignedIn = useRef(false);

  useEffect(() => {
    if (!isLoaded) return;
    if (wasSignedIn.current && !isSignedIn) {
      clearAllSessionCache();
    }
    wasSignedIn.current = Boolean(isSignedIn);
  }, [isSignedIn, isLoaded]);

  return null;
}
