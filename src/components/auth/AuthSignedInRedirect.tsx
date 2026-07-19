"use client";

import { useAuth } from "@clerk/nextjs";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { clerkPostAuthReturnPath } from "@/lib/clerk-redirect-url";

/**
 * Client fallback after OAuth / ticket auth when the session is live in the browser
 * but the first paint still shows the Clerk sign-in widget (middleware already ran).
 */
function AuthSignedInRedirectInner({ fallback = "/" }: { fallback?: string }) {
  const { isSignedIn, isLoaded } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;

    // Pay-before-sign-up: match Whop membership to this Clerk account on first authenticated paint.
    // Server cooldown (45s) dedupes OAuth double-fires; webhook sync is the other path.
    void fetch("/api/membership/sync", { method: "POST" }).catch(() => undefined);

    const raw = searchParams.get("redirect_url");
    const dest = raw ? clerkPostAuthReturnPath(raw) : fallback;
    router.replace(dest.startsWith("/") ? dest : `/${dest}`);
  }, [isLoaded, isSignedIn, router, searchParams, fallback]);

  return null;
}

export function AuthSignedInRedirect(props: { fallback?: string }) {
  return (
    <Suspense fallback={null}>
      <AuthSignedInRedirectInner {...props} />
    </Suspense>
  );
}
