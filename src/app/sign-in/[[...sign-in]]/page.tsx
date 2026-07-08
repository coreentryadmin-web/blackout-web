import type { Metadata } from "next";
import { SignIn } from "@clerk/nextjs";
import { clerkAppearance } from "@/lib/clerk-theme";
import { AuthShell } from "@/components/auth/AuthShell";
import { AuthFailureObserver } from "@/components/auth/AuthFailureObserver";
import { clerkSanitizeStagingReturnUrl } from "@/lib/clerk-redirect-url";

export const metadata: Metadata = {
  title: "Sign in · BlackOut",
  description: "Sign in to your BlackOut account to access the live trading desk.",
};

type Props = {
  searchParams: Promise<{ redirect_url?: string }>;
};

export default async function SignInPage({ searchParams }: Props) {
  const sp = await searchParams;
  const forceRedirectUrl = clerkSanitizeStagingReturnUrl(sp.redirect_url) ?? undefined;

  return (
    <AuthShell mode="signin">
      <AuthFailureObserver mode="signin">
        <SignIn appearance={clerkAppearance} {...(forceRedirectUrl ? { forceRedirectUrl } : {})} />
      </AuthFailureObserver>
    </AuthShell>
  );
}
