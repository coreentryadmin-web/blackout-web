import type { Metadata } from "next";
import Link from "next/link";
import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { LegalPageLayout } from "@/components/landing/LegalPageLayout";
import { WebPageJsonLd } from "@/components/seo/JsonLd";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { publicPageMetadata } from "@/lib/page-metadata";
import { SITE } from "@/lib/site";

export const metadata: Metadata = publicPageMetadata(
  "Contact BlackOut — Support & Questions",
  "Get in touch with the BlackOut team for support, billing, or questions about the platform. Reach us here or join the community on Discord.",
  "/contact"
);

export default function ContactPage() {
  return (
    <MarketingPageShell showChart={false}>
      <WebPageJsonLd
        title="Contact BlackOut — Support & Questions"
        description="Get in touch with the BlackOut team for support, billing, or questions about the platform."
        path="/contact"
      />
      <LegalPageLayout
        breadcrumbs={<Breadcrumbs items={[
        { name: "Home", href: "/" },
        { name: "Contact", href: "/contact" },
      ]} />} kicker="Support" title="Contact Us" updated="July 27, 2026">
        <div className="legal-contact-cta">
          <h2>Send Us a Message</h2>
          <p>
            Have a question, issue, or suggestion? Reach out and we will get back to you
            within <strong>24 hours</strong> on business days.
          </p>
          <a href="mailto:support@blackouttrades.com?subject=BlackOut%20Support%20Request" className="legal-contact-btn">
            Open Email to Support
          </a>
          <p className="legal-contact-alt">
            Or message us directly at{" "}
            <a href="mailto:support@blackouttrades.com">support@blackouttrades.com</a>
          </p>
        </div>

        <h2>Email Support</h2>
        <p>
          For billing questions, account issues, refund requests, or general inquiries, email us
          at:
        </p>
        <p className="legal-highlight">
          <a href="mailto:support@blackouttrades.com">support@blackouttrades.com</a>
        </p>
        <p>
          We aim to respond within <strong>24 hours</strong> on business days. Complex issues
          (billing disputes, account recovery) may take up to 48 hours.
        </p>

        <h2>Discord Community</h2>
        <p>
          Join the BlackOut Discord for real-time help from the community and team. Discord is the
          fastest way to get answers about the platform, tools, and trading concepts.
        </p>
        <p className="legal-highlight">
          <a href={SITE.social.discord.url} target="_blank" rel="noopener noreferrer">
            Join BlackOut Discord
          </a>
        </p>

        <h2>Social</h2>
        <p>
          Follow us for updates, market insights, and announcements:
        </p>
        <ul>
          <li>
            <strong>X (Twitter):</strong>{" "}
            <a href={SITE.social.x.url} target="_blank" rel="noopener noreferrer">
              @{SITE.social.x.handle}
            </a>
          </li>
          <li>
            <strong>Instagram:</strong>{" "}
            <a href={SITE.social.instagram.url} target="_blank" rel="noopener noreferrer">
              @{SITE.social.instagram.handle}
            </a>
          </li>
        </ul>

        <h2>Billing &amp; Subscription</h2>
        <p>
          To manage your subscription, update payment methods, or cancel, visit your{" "}
          <Link href="/account">account settings</Link>. For billing disputes or refund requests,
          please review our <Link href="/refund-policy">Refund Policy</Link> and email us with
          your account details.
        </p>

        <h2>Bug Reports &amp; Feedback</h2>
        <p>
          Found a bug or have a feature request? Let us know through Discord or email. Include as
          much detail as possible — screenshots, the page/tool you were using, and what you expected
          to happen.
        </p>

        <h2>Response Times</h2>
        <ul>
          <li><strong>General inquiries:</strong> Within 24 hours (business days)</li>
          <li><strong>Billing &amp; refund requests:</strong> Within 2 business days</li>
          <li><strong>Account recovery:</strong> Within 48 hours</li>
          <li><strong>Bug reports:</strong> Acknowledged within 24 hours; resolution time varies</li>
        </ul>
      </LegalPageLayout>
    </MarketingPageShell>
  );
}
