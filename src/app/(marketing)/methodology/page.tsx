import type { Metadata } from "next";
import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { MethodologyContent } from "@/components/landing/MethodologyContent";
import { WebPageJsonLd } from "@/components/seo/JsonLd";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { publicPageMetadata } from "@/lib/page-metadata";
import { buildPublicTrackRecord } from "@/lib/track-record-public";
import { buildTrackRecordPagePayload } from "@/lib/track-record-page";

export const metadata: Metadata = publicPageMetadata(
  "Public Track Record & Grading Methodology | BlackOut",
  "How BlackOut grades SPX Slayer, Night Hawk, and 0DTE Command setups — live aggregate win/loss stats, anti-blend rules, and full transparency on every logged play.",
  "/methodology"
);

export const dynamic = "force-dynamic";

export default async function MethodologyPage() {
  const [spxRecord, payload] = await Promise.all([
    buildPublicTrackRecord(),
    buildTrackRecordPagePayload(),
  ]);

  return (
    <MarketingPageShell>
      <WebPageJsonLd
        title="Public Track Record & Grading Methodology"
        description="How BlackOut grades every setup — SPX Slayer, Night Hawk, and 0DTE Command — with live aggregate stats and no blended win rates."
        path="/methodology"
      />
      <MethodologyContent
        breadcrumbs={
          <Breadcrumbs
            items={[
              { name: "Home", href: "/" },
              { name: "Methodology", href: "/methodology" },
            ]}
          />
        }
        spxRecord={spxRecord}
        payload={payload}
      />
    </MarketingPageShell>
  );
}
