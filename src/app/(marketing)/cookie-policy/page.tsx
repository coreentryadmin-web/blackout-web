import type { Metadata } from "next";
import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { LegalPageLayout } from "@/components/landing/LegalPageLayout";
import { WebPageJsonLd } from "@/components/seo/JsonLd";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { publicPageMetadata } from "@/lib/page-metadata";

export const metadata: Metadata = publicPageMetadata(
  "Cookie Policy — BlackOut",
  "How BlackOut uses cookies and similar technologies, and how you can manage your cookie preferences.",
  "/cookie-policy"
);

export default function CookiePolicyPage() {
  return (
    <MarketingPageShell showChart={false}>
      <WebPageJsonLd
        title="Cookie Policy — BlackOut"
        description="How BlackOut uses cookies and similar technologies."
        path="/cookie-policy"
      />
      <LegalPageLayout
        breadcrumbs={<Breadcrumbs items={[
        { name: "Home", href: "/" },
        { name: "Cookie Policy", href: "/cookie-policy" },
      ]} />} kicker="Legal" title="Cookie Policy" updated="July 27, 2026">
        <h2>What Are Cookies</h2>
        <p>
          Cookies are small text files stored on your device when you visit a website. They help
          the site remember your preferences and understand how you use it. BlackOut uses cookies
          to keep you logged in, remember your settings, and improve the platform.
        </p>

        <h2>Cookies We Use</h2>

        <h3>Essential Cookies (Required)</h3>
        <p>
          These cookies are necessary for the platform to function. They handle authentication,
          session management, and security. You cannot opt out of essential cookies without
          losing access to the platform.
        </p>
        <ul>
          <li><strong>__session</strong> — Clerk authentication session token</li>
          <li><strong>__client_uat</strong> — Clerk client state indicator</li>
          <li><strong>__clerk_db_jwt</strong> — Clerk development/debug token (development only)</li>
        </ul>

        <h3>Analytics Cookies (Optional)</h3>
        <p>
          We use analytics cookies to understand how members use the platform — which tools are
          popular, where users encounter issues, and how we can improve the experience. Analytics
          data is aggregated and does not personally identify you.
        </p>

        <h3>Preference Cookies (Optional)</h3>
        <p>
          These cookies remember your display settings, theme preferences, and layout choices so
          you don&apos;t have to set them every visit.
        </p>

        <h2>Third-Party Cookies</h2>
        <p>
          BlackOut does not use third-party advertising cookies. We do not serve ads or allow
          ad networks to place cookies on our platform. The only third-party cookies come from
          our authentication provider (Clerk) and are essential for login functionality.
        </p>

        <h2>Managing Cookies</h2>
        <p>
          You can manage or delete cookies through your browser settings. Most browsers allow you
          to block or delete cookies, though this may affect your ability to use the platform:
        </p>
        <ul>
          <li><strong>Chrome:</strong> Settings → Privacy and Security → Cookies</li>
          <li><strong>Firefox:</strong> Settings → Privacy &amp; Security → Cookies</li>
          <li><strong>Safari:</strong> Preferences → Privacy → Manage Website Data</li>
          <li><strong>Edge:</strong> Settings → Cookies and Site Permissions</li>
        </ul>
        <p>
          Blocking essential cookies (authentication) will prevent you from logging in to
          BlackOut.
        </p>

        <h2>Cookie Retention</h2>
        <ul>
          <li><strong>Session cookies:</strong> Deleted when you close your browser</li>
          <li><strong>Authentication cookies:</strong> Expire after 7 days of inactivity</li>
          <li><strong>Preference cookies:</strong> Retained for up to 1 year</li>
          <li><strong>Analytics cookies:</strong> Retained for up to 1 year</li>
        </ul>

        <h2>Updates to This Policy</h2>
        <p>
          We may update this Cookie Policy as our use of cookies evolves. Material changes will
          be noted on this page with an updated revision date.
        </p>

        <h2>Contact</h2>
        <p>
          Questions about our cookie practices? Contact us at{" "}
          <a href="mailto:support@blackouttrades.com">support@blackouttrades.com</a>.
        </p>
      </LegalPageLayout>
    </MarketingPageShell>
  );
}
