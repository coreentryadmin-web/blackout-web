import { auth as clerkAuth } from "@clerk/nextjs/server";
import { requestCache } from "@/lib/react-request-cache";

export type AppSession = {
  userId: string | null;
  email: string | null;
  sessionClaims: Record<string, unknown> | null;
};

/**
 * Per-request memo — layout + page + canAccessTool used to each call auth() independently,
 * multiplying clerkAuth() work on every desk RSC fetch. requestCache (React.cache in RSC)
 * collapses that to one verification per navigation segment.
 */
export const getSession = requestCache(async (): Promise<AppSession> => {
  try {
    const { userId, sessionClaims } = await clerkAuth();
    return {
      userId: userId ?? null,
      email: null,
      sessionClaims: (sessionClaims as Record<string, unknown> | undefined) ?? null,
    };
  } catch {
    // Stale/invalid __session after Clerk key or domain changes — treat as signed out.
    return { userId: null, email: null, sessionClaims: null };
  }
});

/** Drop-in for Clerk auth() — returns { userId, sessionClaims } used across the app. */
export const auth = requestCache(async (): Promise<{
  userId: string | null;
  sessionClaims: Record<string, unknown> | null;
}> => {
  const session = await getSession();
  return { userId: session.userId, sessionClaims: session.sessionClaims };
});
