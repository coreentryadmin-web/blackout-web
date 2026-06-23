import { TrackRecordEmbed } from "@/components/embeds/TrackRecordEmbed";
import { buildPublicTrackRecord } from "@/lib/track-record-public";

// Iframe-embeddable, chrome-less social-proof card. Public (not protected).
// Next does not set X-Frame-Options by default, so this is framable. If a global
// frame-deny header is later added, this route must be excepted (see manualUserSteps).
export const dynamic = "force-dynamic";

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
