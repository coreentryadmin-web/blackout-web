import type { Metadata } from "next";
import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { LegalPageLayout } from "@/components/landing/LegalPageLayout";
import { WebPageJsonLd } from "@/components/seo/JsonLd";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { publicPageMetadata } from "@/lib/page-metadata";

export const metadata: Metadata = publicPageMetadata(
  "Privacy Policy — BlackOut Trades",
  "How BlackOut Trades collects, uses, and protects your personal information, data retention practices, third-party providers, and your rights under CCPA and GDPR.",
  "/privacy"
);

export default function PrivacyPage() {
  return (
    <MarketingPageShell showChart={false}>
      <WebPageJsonLd
        title="Privacy Policy — BlackOut Trades"
        description="How BlackOut Trades collects, uses, and protects your personal information."
        path="/privacy"
      />
      <Breadcrumbs items={[
        { name: "Home", href: "/" },
        { name: "Privacy Policy", href: "/privacy" },
      ]} />
      <LegalPageLayout kicker="Legal" title="Privacy Policy" updated="July 27, 2026">
        <h2>1. Information We Collect</h2>

        <h3>Account Information</h3>
        <p>
          When you create an account, we collect your name, email address, and phone number. This
          information is used for authentication, account management, and customer support.
        </p>

        <h3>Payment Information</h3>
        <p>
          Payments are processed through our third-party payment provider. We do not store your full
          credit card number, CVV, or banking details on our servers. We retain transaction records
          (amounts, dates, subscription status) for billing and accounting purposes.
        </p>

        <h3>Usage Data</h3>
        <p>
          We collect information about how you interact with the platform, including pages visited,
          features used, session duration, device type, browser, and IP address. This data helps us
          improve performance and user experience.
        </p>

        <h2>2. Cookies &amp; Tracking</h2>
        <p>BlackOut uses cookies for:</p>
        <ul>
          <li>
            <strong>Authentication:</strong> Session cookies to keep you logged in securely
          </li>
          <li>
            <strong>Analytics:</strong> Understanding how features are used so we can improve the
            platform
          </li>
          <li>
            <strong>Preferences:</strong> Remembering your settings and display preferences
          </li>
        </ul>
        <p>
          We do not use cookies for third-party advertising. You can manage cookie preferences
          through your browser settings, though disabling essential cookies may affect functionality.
        </p>

        <h2>3. Analytics</h2>
        <p>
          We use analytics tools to understand usage patterns, diagnose performance issues, and
          improve the platform. Analytics data is aggregated and does not identify you personally. We
          do not sell analytics data to third parties.
        </p>

        <h2>4. How We Use Your Information</h2>
        <ul>
          <li>Providing and maintaining the BlackOut platform</li>
          <li>Processing payments and managing subscriptions</li>
          <li>Sending service-related communications (billing, security, updates)</li>
          <li>Improving platform performance and features</li>
          <li>Responding to support requests</li>
          <li>Enforcing our Terms of Service</li>
        </ul>
        <p>We do not sell your personal information to third parties.</p>

        <h2>5. Third-Party Providers</h2>
        <p>We share limited data with trusted third parties that help operate the platform:</p>
        <ul>
          <li>
            <strong>Authentication:</strong> Clerk (account management, login)
          </li>
          <li>
            <strong>Payments:</strong> Whop (subscription billing)
          </li>
          <li>
            <strong>Hosting:</strong> Amazon Web Services (infrastructure)
          </li>
          <li>
            <strong>CDN:</strong> Cloudflare (performance, security)
          </li>
        </ul>
        <p>
          Each provider operates under its own privacy policy and processes data only as necessary
          to provide their services.
        </p>

        <h2>6. Data Retention</h2>
        <p>
          We retain your account data for as long as your account is active. If you cancel your
          account, we delete personal data within 90 days, except where retention is required by law
          (e.g., billing records). Usage analytics are retained in aggregated, anonymized form
          indefinitely.
        </p>

        <h2>7. Data Security</h2>
        <p>
          We use industry-standard security measures including encrypted connections (TLS),
          secure authentication, and access controls. No system is 100% secure, but we take
          reasonable steps to protect your information.
        </p>

        <h2>8. Your Rights</h2>
        <p>You have the right to:</p>
        <ul>
          <li>Access the personal data we hold about you</li>
          <li>Request correction of inaccurate data</li>
          <li>Request deletion of your account and associated data</li>
          <li>Export your data in a portable format</li>
        </ul>
        <p>
          To exercise any of these rights, contact us at{" "}
          <a href="mailto:support@blackouttrades.com">support@blackouttrades.com</a>.
        </p>

        <h2>9. California Privacy Rights (CCPA/CPRA)</h2>
        <p>
          If you are a California resident, you have additional rights under the California
          Consumer Privacy Act (CCPA) and the California Privacy Rights Act (CPRA):
        </p>
        <ul>
          <li>The right to know what personal information we collect, use, and disclose</li>
          <li>The right to request deletion of your personal information</li>
          <li>The right to opt out of the sale or sharing of your personal information</li>
          <li>The right to non-discrimination for exercising your privacy rights</li>
        </ul>
        <p>
          BlackOut does not sell your personal information. To exercise any of these rights,
          contact us at{" "}
          <a href="mailto:support@blackouttrades.com">support@blackouttrades.com</a>.
        </p>

        <h2>10. International Users (GDPR)</h2>
        <p>
          If you are located in the European Economic Area (EEA) or the United Kingdom, we process
          your personal data under the following lawful bases: performance of our contract with you
          (providing the platform), our legitimate interests (improving the service, preventing
          fraud), and your consent (where applicable, such as marketing communications).
        </p>
        <p>In addition to the rights listed above, you may also:</p>
        <ul>
          <li>Request restriction of processing of your personal data</li>
          <li>Object to processing based on our legitimate interests</li>
          <li>Lodge a complaint with your local data protection authority</li>
        </ul>
        <p>
          We transfer data outside the EEA using standard contractual clauses approved by the
          European Commission. For questions about international data transfers, contact us at{" "}
          <a href="mailto:support@blackouttrades.com">support@blackouttrades.com</a>.
        </p>

        <h2>11. Children&apos;s Privacy</h2>
        <p>
          BlackOut is not intended for users under 18. We do not knowingly collect data from minors.
          If we learn that a user is under 18, we will promptly delete their account.
        </p>

        <h2>12. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy periodically. Material changes will be communicated via
          email or platform notification. Continued use after changes constitutes acceptance.
        </p>

        <h2>13. Contact</h2>
        <p>
          Privacy questions? Contact us at{" "}
          <a href="mailto:support@blackouttrades.com">support@blackouttrades.com</a>.
        </p>
      </LegalPageLayout>
    </MarketingPageShell>
  );
}
