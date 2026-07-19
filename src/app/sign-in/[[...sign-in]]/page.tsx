import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignIn } from "@clerk/nextjs";
import { clerkAppearance } from "@/lib/clerk-theme";
import { AuthShell } from "@/components/auth/AuthShell";
import { AuthFailureObserver } from "@/components/auth/AuthFailureObserver";
import { AuthSignedInRedirect } from "@/components/auth/AuthSignedInRedirect";
import { clerkSatelliteAuthRedirect } from "@/lib/clerk-env";
import { clerkPostAuthReturnPath } from "@/lib/clerk-redirect-url";
import { activeClerkUserIdFromRequestCookies } from "@/lib/clerk-session-cookies";
import { isCognitoAuth } from "@/lib/auth-provider";

export const metadata: Metadata = {
  title: "Sign in · BlackOut",
  description: "Sign in to your BlackOut account to access the live trading desk.",
};

type Props = {
  searchParams: Promise<{ redirect_url?: string }>;
};

export default async function SignInPage({ searchParams }: Props) {
  const sp = await searchParams;
  const returnPath = clerkPostAuthReturnPath(sp.redirect_url);

  if (isCognitoAuth()) {
    const login = new URL("/api/auth/cognito/login", process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000");
    login.searchParams.set("redirect_url", returnPath);
    redirect(login.toString());
  }

  const satelliteRedirect = clerkSatelliteAuthRedirect("sign-in", returnPath);
  if (satelliteRedirect) {
    redirect(satelliteRedirect);
  }

  if (await activeClerkUserIdFromRequestCookies()) {
    redirect(returnPath);
  }

  return (
    <AuthShell mode="signin">
      <AuthSignedInRedirect fallback={returnPath} />
      <AuthFailureObserver mode="signin">
        <SignIn appearance={clerkAppearance} fallbackRedirectUrl={returnPath} forceRedirectUrl={returnPath} />
      </AuthFailureObserver>
    </AuthShell>
  );
}
