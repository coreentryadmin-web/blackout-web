export const dynamic = "force-static";

import type { Metadata } from "next";
import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { LegalPageLayout } from "@/components/landing/LegalPageLayout";

export const metadata: Metadata = {
  title: "Privacy Policy · BlackOut",
  description:
    "How BlackOut Trades collects, uses, and protects your personal information — cookies, analytics, payments, and data retention.",
};

export default function PrivacyPage() {
  return (
    <MarketingPageShell showChart={false}>
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

        <h2>9. Children&apos;s Privacy</h2>
        <p>
          BlackOut is not intended for users under 18. We do not knowingly collect data from minors.
          If we learn that a user is under 18, we will promptly delete their account.
        </p>

        <h2>10. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy periodically. Material changes will be communicated via
          email or platform notification. Continued use after changes constitutes acceptance.
        </p>

        <h2>11. Contact</h2>
        <p>
          Privacy questions? Contact us at{" "}
          <a href="mailto:support@blackouttrades.com">support@blackouttrades.com</a>.
        </p>
      </LegalPageLayout>
    </MarketingPageShell>
  );
}
