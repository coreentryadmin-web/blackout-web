import { TrackRecordEmbed } from "@/components/embeds/TrackRecordEmbed";
import { buildPublicTrackRecord } from "@/lib/track-record-public";

// Iframe-embeddable, chrome-less social-proof card. Public (not protected).
// Cross-origin framing for this route is enabled in next.config.mjs: the global
// X-Frame-Options: SAMEORIGIN + CSP `frame-ancestors 'self'` deny framing app-wide,
// but a scoped `/embed/:path*` header rule drops X-Frame-Options and relaxes
// `frame-ancestors *` so users can embed this card on their own sites. Framing for
// every non-/embed route stays locked down. Keep this route free of any auth or
// state-changing UI so relaxed framing carries no clickjacking risk.
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
