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
import { isIosAppShellFromHeaders } from "@/lib/ios-app-shell-server";

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

  // Apple 3.1.1: no purchase-adjacent flows inside the iOS shell. Account
  // creation happens on the WEBSITE (Whop). Any iOS user landing here (e.g.
  // via a stale in-app link) sees a plain "manage on web" callout with a path
  // back to /sign-in — never Clerk's sign-up widget with sign-up CTAs the
  // in-app user can't complete.
  if (await isIosAppShellFromHeaders()) {
    return (
      <AuthShell mode="signup">
        <div className="px-4 py-12 text-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-bull">Membership</p>
          <p className="mx-auto mt-4 max-w-md text-base leading-relaxed text-white/90">
            New accounts are created on the web — sign up there first.
          </p>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-sky-300">
            Once your membership is active, come back and sign in here to access the desk.
          </p>
          <a
            href="/sign-in"
            className="mt-8 inline-flex items-center gap-2 rounded-lg border border-bull/40 bg-bull/10 px-6 py-3 font-syne text-sm text-white hover:bg-bull/20"
          >
            Sign in →
          </a>
        </div>
      </AuthShell>
    );
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
