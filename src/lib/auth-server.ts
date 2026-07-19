import { auth as clerkAuth } from "@clerk/nextjs/server";
import { isCognitoAuth } from "@/lib/auth-provider";
import { getCognitoSession } from "@/lib/cognito-session";

export type AppSession = {
  userId: string | null;
  email: string | null;
  sessionClaims: Record<string, unknown> | null;
};

/** Unified server session — Clerk or Cognito depending on AUTH_PROVIDER. */
export async function getSession(): Promise<AppSession> {
  if (isCognitoAuth()) {
    const session = await getCognitoSession();
    if (!session) return { userId: null, email: null, sessionClaims: null };
    return {
      userId: session.userId,
      email: typeof session.claims.email === "string" ? session.claims.email : null,
      sessionClaims: null,
    };
  }
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
