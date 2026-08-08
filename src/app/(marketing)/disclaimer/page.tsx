import type { Metadata } from "next";
import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { LegalPageLayout } from "@/components/landing/LegalPageLayout";
import { WebPageJsonLd } from "@/components/seo/JsonLd";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { publicPageMetadata } from "@/lib/page-metadata";

export const metadata: Metadata = publicPageMetadata(
  "Risk Disclaimer — BlackOut",
  "Important risk disclosures. BlackOut provides educational tools and market analysis only and does not provide investment advice.",
  "/disclaimer"
);

export default function DisclaimerPage() {
  return (
    <MarketingPageShell showChart={false}>
      <WebPageJsonLd
        title="Risk Disclaimer — BlackOut"
        description="Important risk disclosures for BlackOut educational market analysis tools."
        path="/disclaimer"
      />
      <LegalPageLayout
        breadcrumbs={<Breadcrumbs items={[
        { name: "Home", href: "/" },
        { name: "Risk Disclaimer", href: "/disclaimer" },
      ]} />} kicker="Legal" title="Risk Disclaimer" updated="July 27, 2026">
        <h2>Educational Purpose Only</h2>
        <p>
          BlackOut Trades (&ldquo;BlackOut&rdquo;) is an educational market-analysis platform. All
          content, data, analytics, alerts, and tools provided on this platform are for educational
          and informational purposes only. Nothing on BlackOut constitutes investment advice, a
          solicitation, or a recommendation to buy, sell, or hold any security, derivative, or
          financial instrument.
        </p>

        <h2>Not Financial Advice</h2>
        <p>
          BlackOut is not a registered investment advisor, broker-dealer, or financial planner. The
          information provided does not take into account your individual financial situation,
          objectives, or risk tolerance. You should consult with a qualified, licensed financial
          advisor before making any investment or trading decisions.
        </p>

        <h2>Substantial Risk of Loss</h2>
        <p>
          Trading options, futures, equities, and other financial instruments involves substantial
          risk of loss and is not suitable for every investor. You can lose more than your initial
          investment. The high degree of leverage that is often obtainable in options trading can work
          against you as well as for you. The use of leverage can lead to large losses as well as
          large gains.
        </p>

        <h2>Past Performance</h2>
        <p>
          Past performance is not indicative of future results. Any historical data, backtests, trade
          records, or performance metrics displayed on the platform are provided for educational
          context only. They do not guarantee or predict future performance or profitability.
        </p>

        <h2>Data Accuracy</h2>
        <p>
          While we strive to provide accurate and timely market data, BlackOut makes no warranty
          regarding the accuracy, completeness, or reliability of any information displayed.
          Market data is sourced from third-party providers and may be delayed, inaccurate, or
          incomplete. Do not rely solely on data from BlackOut for trading decisions.
        </p>

        <h2>Your Responsibility</h2>
        <p>
          You are solely responsible for your own investment and trading decisions. Any trades or
          investments you make are at your own risk. BlackOut and its officers, employees, and
          affiliates assume no responsibility or liability for any losses you may incur.
        </p>

        <h2>No Guarantee of Results</h2>
        <p>
          BlackOut makes no guarantee that using the platform will result in profitable trades. The
          platform provides tools and analytics — how you use them and the results you achieve are
          entirely your responsibility.
        </p>

        <h2>Regulatory Notice</h2>
        <p>
          BlackOut does not execute trades, hold customer funds, or provide order routing. All trade
          execution occurs through your own brokerage account, which is subject to its own terms,
          fees, and regulatory requirements.
        </p>
      </LegalPageLayout>
    </MarketingPageShell>
  );
}
