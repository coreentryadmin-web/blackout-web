import type { Metadata } from "next";
import { SignUp } from "@clerk/nextjs";
import { clerkAppearance } from "@/lib/clerk-theme";
import { AuthShell } from "@/components/auth/AuthShell";
import { AuthFailureObserver } from "@/components/auth/AuthFailureObserver";
import { clerkSanitizeStagingReturnUrl } from "@/lib/clerk-redirect-url";

export const metadata: Metadata = {
  title: "Create account · BlackOut",
  description: "Create your BlackOut account to unlock the live trading desk.",
};

type Props = {
  searchParams: Promise<{ redirect_url?: string }>;
};

export default async function SignUpPage({ searchParams }: Props) {
  const sp = await searchParams;
  const forceRedirectUrl = clerkSanitizeStagingReturnUrl(sp.redirect_url) ?? undefined;

  return (
    <AuthShell mode="signup">
      <AuthFailureObserver mode="signup">
        <SignUp appearance={clerkAppearance} {...(forceRedirectUrl ? { forceRedirectUrl } : {})} />
      </AuthFailureObserver>
    </AuthShell>
  );
}
