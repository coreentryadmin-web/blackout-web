import { auth as clerkAuth } from "@clerk/nextjs/server";

export type AppSession = {
  userId: string | null;
  email: string | null;
  sessionClaims: Record<string, unknown> | null;
};

/** Server session (Clerk). */
export async function getSession(): Promise<AppSession> {
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
}

/** Drop-in for Clerk auth() — returns { userId, sessionClaims } used across the app. */
export async function auth(): Promise<{
  userId: string | null;
  sessionClaims: Record<string, unknown> | null;
}> {
  const session = await getSession();
  return { userId: session.userId, sessionClaims: session.sessionClaims };
}
