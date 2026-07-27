// PUBLIC, UNAUTHENTICATED privacy policy — App Store hard requirement.
//
// The App Store Connect listing points here. Apple review REQUIRES that the URL
// is reachable without sign-in, so this page lives in the (marketing) route
// group whose shell (`MarketingPageShell`) does not gate on auth. The policy
// content itself (`components/landing/PrivacyPolicy.tsx`) is grounded in the
// actual data-collection inventory documented in
// `docs/ios/NATIVE-VALUE-AND-PRIVACY-AUDIT.md`. Update EFFECTIVE_DATE in that
// component only when a MATERIAL practice change lands.
export const dynamic = "force-static";

import type { Metadata } from "next";
import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { PrivacyPolicy } from "@/components/landing/PrivacyPolicy";

export const metadata: Metadata = {
  title: "Privacy · BlackOut",
  description:
    "How BlackOut Trades collects, uses, and safeguards personal information — matched to what the platform actually does.",
  robots: { index: true, follow: true },
};

export default function PrivacyPage() {
  return (
    <MarketingPageShell showChart={false}>
      <PrivacyPolicy />
    </MarketingPageShell>
  );
}
