import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignUp } from "@clerk/nextjs";
import { clerkAppearance } from "@/lib/clerk-theme";
import { AuthShell } from "@/components/auth/AuthShell";
import { AuthFailureObserver } from "@/components/auth/AuthFailureObserver";
import { AuthSignedInRedirect } from "@/components/auth/AuthSignedInRedirect";
import { clerkSatelliteAuthRedirect } from "@/lib/clerk-env";
import { clerkPostAuthReturnPath } from "@/lib/clerk-redirect-url";
import { activeClerkUserIdFromRequestCookies } from "@/lib/clerk-session-cookies";
import { isCognitoAuth } from "@/lib/auth-provider";

export const metadata: Metadata = {
  title: "Create account · BlackOut",
  description: "Create your BlackOut account to unlock the live trading desk.",
};

type Props = {
  searchParams: Promise<{ redirect_url?: string }>;
};

export default async function SignUpPage({ searchParams }: Props) {
  const sp = await searchParams;
  const returnPath = clerkPostAuthReturnPath(sp.redirect_url);

  if (isCognitoAuth()) {
    const login = new URL("/api/auth/cognito/login", process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000");
    login.searchParams.set("redirect_url", returnPath);
    login.searchParams.set("mode", "signup");
    redirect(login.toString());
  }

  const satelliteRedirect = clerkSatelliteAuthRedirect("sign-up", returnPath);
  if (satelliteRedirect) {
    redirect(satelliteRedirect);
  }

  if (await activeClerkUserIdFromRequestCookies()) {
    redirect(returnPath);
  }

  return (
    <AuthShell mode="signup">
      <AuthSignedInRedirect fallback={returnPath} />
      <AuthFailureObserver mode="signup">
        <SignUp appearance={clerkAppearance} fallbackRedirectUrl={returnPath} forceRedirectUrl={returnPath} />
      </AuthFailureObserver>
    </AuthShell>
  );
}
