export const dynamic = "force-static";

import type { Metadata } from "next";
import Link from "next/link";
import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { LegalPageLayout } from "@/components/landing/LegalPageLayout";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Contact · BlackOut",
  description:
    "Get in touch with BlackOut Trades — support, billing questions, and community channels.",
};

export default function ContactPage() {
  return (
    <MarketingPageShell showChart={false}>
      <LegalPageLayout kicker="Support" title="Contact Us" updated="July 27, 2026">
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
      </LegalPageLayout>
    </MarketingPageShell>
  );
}
