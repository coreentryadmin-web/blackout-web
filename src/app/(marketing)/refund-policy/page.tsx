import type { Metadata } from "next";
import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { LegalPageLayout } from "@/components/landing/LegalPageLayout";
import { WebPageJsonLd } from "@/components/seo/JsonLd";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { publicPageMetadata } from "@/lib/page-metadata";

export const metadata: Metadata = publicPageMetadata(
  "Refund Policy — BlackOut",
  "BlackOut's subscription refund and cancellation policy. Cancel anytime, with no long-term contracts.",
  "/refund-policy"
);

export default function RefundPolicyPage() {
  return (
    <MarketingPageShell showChart={false}>
      <WebPageJsonLd
        title="Refund Policy — BlackOut"
        description="BlackOut subscription refund and cancellation policy."
        path="/refund-policy"
      />
      <Breadcrumbs items={[
        { name: "Home", href: "/" },
        { name: "Refund Policy", href: "/refund-policy" },
      ]} />
      <LegalPageLayout kicker="Legal" title="Refund Policy" updated="July 27, 2026">
        <h2>Monthly Subscriptions</h2>
        <p>
          Monthly subscriptions are non-refundable once access has been granted. When you subscribe,
          you receive immediate access to all premium features for the billing period. Because
          digital access is delivered instantly and cannot be &ldquo;returned,&rdquo; we do not offer
          refunds for monthly billing cycles.
        </p>

        <h2>Annual Subscriptions</h2>
        <p>
          Annual subscriptions are non-refundable after the first 7 days. If you are unsatisfied with
          the platform within the first 7 days of your annual subscription, contact us for a full
          refund. After the 7-day window, annual subscriptions are non-refundable for the remainder
          of the billing period.
        </p>

        <h2>Cancellation</h2>
        <p>
          You may cancel your subscription at any time through your account settings. Cancellation
          stops future billing but does not trigger a refund for the current period. You will retain
          access to premium features until the end of your current billing cycle.
        </p>

        <h2>Unauthorized Purchases</h2>
        <p>
          If you believe a charge was made without your authorization, contact us within 30 days at{" "}
          <a href="mailto:support@blackouttrades.com">support@blackouttrades.com</a>. We review
          unauthorized purchase claims on a case-by-case basis and may issue a refund at our
          discretion.
        </p>

        <h2>Service Disruptions</h2>
        <p>
          In the event of extended platform outages (more than 48 consecutive hours) caused by
          issues within our control, we may offer account credits or pro-rated refunds at our
          discretion. Scheduled maintenance windows do not qualify.
        </p>

        <h2>How to Request a Refund</h2>
        <p>
          To request a refund, email{" "}
          <a href="mailto:support@blackouttrades.com">support@blackouttrades.com</a> with your
          account email and reason for the request. We aim to respond within 2 business days. Approved
          refunds are processed to the original payment method within 5&ndash;10 business days.
        </p>
      </LegalPageLayout>
    </MarketingPageShell>
  );
}
