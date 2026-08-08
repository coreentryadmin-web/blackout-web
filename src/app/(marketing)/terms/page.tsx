import type { Metadata } from "next";
import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { LegalPageLayout } from "@/components/landing/LegalPageLayout";
import { WebPageJsonLd } from "@/components/seo/JsonLd";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { publicPageMetadata } from "@/lib/page-metadata";

export const metadata: Metadata = publicPageMetadata(
  "Terms of Service — BlackOut",
  "The terms and conditions governing your use of the BlackOut platform, subscriptions, and services.",
  "/terms"
);

export default function TermsPage() {
  return (
    <MarketingPageShell showChart={false}>
      <WebPageJsonLd
        title="Terms of Service — BlackOut"
        description="The terms and conditions governing your use of the BlackOut platform, subscriptions, and services."
        path="/terms"
      />
      <Breadcrumbs items={[
        { name: "Home", href: "/" },
        { name: "Terms of Service", href: "/terms" },
      ]} />
      <LegalPageLayout kicker="Legal" title="Terms of Service" updated="July 27, 2026">
        <h2>1. Agreement to Terms</h2>
        <p>
          By accessing or using BlackOut Trades (&ldquo;BlackOut,&rdquo; &ldquo;we,&rdquo;
          &ldquo;us,&rdquo; or &ldquo;our&rdquo;) at blackouttrades.com, you agree to be bound by
          these Terms of Service. If you do not agree, do not use the platform.
        </p>

        <h2>2. Description of Service</h2>
        <p>
          BlackOut is an educational market-analysis platform that provides real-time options flow,
          dealer positioning data, gamma exposure analytics, and AI-assisted trade verification tools.
          BlackOut does not provide investment advice, manage funds, or execute trades on your behalf.
          All tools are for educational and informational purposes only.
        </p>

        <h2>3. Eligibility</h2>
        <p>
          You must be at least 18 years old and legally able to enter into binding contracts. By using
          BlackOut, you represent that you meet these requirements.
        </p>

        <h2>4. Memberships &amp; Billing</h2>
        <p>
          BlackOut offers paid memberships billed on a recurring basis (monthly or annually). By
          subscribing, you authorize us to charge your payment method at the applicable rate. Prices
          are listed on our Pricing page and may change with 30 days&apos; notice.
        </p>
        <p>
          All payments are processed through our third-party payment provider. BlackOut does not store
          your full payment card details.
        </p>

        <h2>5. Cancellation</h2>
        <p>
          You may cancel your subscription at any time through your account settings. Cancellation
          takes effect at the end of the current billing period. You will retain access to paid
          features until your current period expires. No partial refunds are issued for unused
          portions of a billing cycle.
        </p>

        <h2>6. Intellectual Property</h2>
        <p>
          All content, software, analytics, branding, and proprietary methodologies on the platform
          are owned by BlackOut Trading and protected by applicable intellectual property laws. You
          may not reproduce, redistribute, or resell any part of the service without written
          permission.
        </p>

        <h2>7. No Account Sharing</h2>
        <p>
          Your BlackOut account is personal and non-transferable. Sharing login credentials or
          streaming premium content to unauthorized users is prohibited and may result in immediate
          account termination without refund.
        </p>

        <h2>8. User Conduct</h2>
        <p>You agree not to:</p>
        <ul>
          <li>Use the platform for any unlawful purpose</li>
          <li>Attempt to reverse-engineer, scrape, or extract data from the platform</li>
          <li>Redistribute, resell, or publicly broadcast premium content</li>
          <li>Interfere with the operation of the service or other users&apos; experience</li>
          <li>Impersonate BlackOut staff or other members</li>
        </ul>
        <p>Violations may result in suspension or permanent ban at our sole discretion.</p>

        <h2>9. Limitation of Liability</h2>
        <p>
          BlackOut provides market data and analytical tools on an &ldquo;as is&rdquo; basis. We make
          no warranties, express or implied, regarding accuracy, completeness, or reliability of data.
          To the fullest extent permitted by law, BlackOut and its officers, employees, and affiliates
          shall not be liable for any direct, indirect, incidental, consequential, or special damages
          arising from your use of the platform, including but not limited to financial losses
          incurred from trading decisions.
        </p>

        <h2>10. No Financial Advice</h2>
        <p>
          Nothing on BlackOut constitutes investment advice, a solicitation, or a recommendation to
          buy or sell any security. All analysis is educational. You are solely responsible for your
          own trading decisions and should consult a qualified financial advisor before making
          investment decisions.
        </p>

        <h2>11. Indemnification</h2>
        <p>
          You agree to indemnify and hold harmless BlackOut Trading, its officers, and affiliates from
          any claims, damages, or expenses arising from your use of the platform or violation of
          these Terms.
        </p>

        <h2>12. Modifications</h2>
        <p>
          We reserve the right to modify these Terms at any time. Material changes will be
          communicated via email or platform notification. Continued use after changes constitutes
          acceptance.
        </p>

        <h2>13. Governing Law &amp; Dispute Resolution</h2>
        <p>
          These Terms are governed by and construed in accordance with the laws of the State of
          Delaware, without regard to conflict of law principles.
        </p>
        <p>
          Any dispute arising from these Terms or your use of the platform shall be resolved through
          binding arbitration administered by the American Arbitration Association (AAA) under its
          Consumer Arbitration Rules. Arbitration shall be conducted in English, and the arbitrator&apos;s
          decision shall be final and binding.
        </p>
        <p>
          You agree to resolve disputes on an individual basis — class actions and class arbitrations
          are not permitted. Nothing in this section prevents either party from seeking injunctive
          relief in a court of competent jurisdiction.
        </p>

        <h2>14. Contact</h2>
        <p>
          Questions about these Terms? Contact us at{" "}
          <a href="mailto:support@blackouttrades.com">support@blackouttrades.com</a>.
        </p>

        <h2>15. Severability</h2>
        <p>
          If any provision of these Terms is held to be unenforceable, the remaining provisions
          shall continue in full force and effect.
        </p>
      </LegalPageLayout>
    </MarketingPageShell>
  );
}
