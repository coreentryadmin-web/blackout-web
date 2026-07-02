import type { Metadata } from "next";
import { TrackRecordEmbed } from "@/components/embeds/TrackRecordEmbed";
import { requireAdmin } from "@/lib/admin-access";
import { buildPublicTrackRecord } from "@/lib/track-record-public";

// Admin-only embed preview (formerly public social-proof iframe).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "SPX Track Record — BlackOut Trades",
  description: "Live SPX Slayer track record widget.",
  robots: { index: false, follow: false },
};

export default async function EmbedTrackRecordPage() {
  await requireAdmin();
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
