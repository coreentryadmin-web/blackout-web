import type { Metadata } from "next";
import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { MethodologyContent } from "@/components/landing/MethodologyContent";
import { DatasetJsonLd, WebPageJsonLd } from "@/components/seo/JsonLd";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { publicPageMetadata } from "@/lib/page-metadata";
import { buildPublicTrackRecord } from "@/lib/track-record-public";
import { buildTrackRecordPagePayload } from "@/lib/track-record-page";

export const metadata: Metadata = publicPageMetadata(
  "Public Track Record & Grading Methodology | BlackOut",
  "How BlackOut grades SPX Slayer, Night Hawk, and 0DTE Command setups — live win/loss stats, anti-blend rules, and full transparency on every logged play.",
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
      {spxRecord.available && (
        <DatasetJsonLd
          path="/methodology"
          name="BlackOut SPX Slayer public track record"
          description="Live-graded win/loss aggregate for BlackOut's SPX Slayer plays — every closed play counted, no cherry-picking, no blended win rates across strategies."
          dateModified={spxRecord.generated_at}
          measurementTechnique="Aggregate win/loss tally over every closed SPX Slayer play, graded mechanically by the same pipeline members see on the live desk — no manual curation or after-the-fact exclusion."
          variables={[
            { name: "Win rate", value: spxRecord.win_rate_pct, unitText: "percent" },
            { name: "Total closed plays", value: spxRecord.total_closed },
            { name: "Wins", value: spxRecord.wins },
            { name: "Losses", value: spxRecord.losses },
            { name: "Breakeven", value: spxRecord.breakeven },
            { name: "Days of data", value: spxRecord.days_of_data },
          ]}
        />
      )}
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
