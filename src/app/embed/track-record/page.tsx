import type { Metadata } from "next";
import { TrackRecordEmbed } from "@/components/embeds/TrackRecordEmbed";
import { buildPublicTrackRecord } from "@/lib/track-record-public";

// Public social-proof iframe — sanitized aggregate-only data (see
// buildPublicTrackRecord / PublicTrackRecord docs). Re-published 2026-08;
// see docs/marketing/SEO-GROWTH.md finding #2.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "SPX Track Record — BlackOut Trades",
  description: "Live SPX Slayer track record widget.",
  robots: { index: false, follow: false },
};

export default async function EmbedTrackRecordPage() {
  const record = await buildPublicTrackRecord();
  return (
    <div
      style={{ background: "transparent", padding: 8 }}
      className="min-h-screen flex items-start justify-center"
    >
      <div className="w-full max-w-md">
        <TrackRecordEmbed record={record} />
      </div>
    </div>
  );
}
