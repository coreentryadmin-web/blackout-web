import { ImageResponse } from "next/og";
import { buildPublicTrackRecord } from "@/lib/track-record-public";
import { SITE } from "@/lib/site";

export const runtime = "nodejs";
// Render on-request, not at build time. The aggregate win-rate is dynamic and the
// build-time prerender of @vercel/og fails to resolve its font URL in some
// environments; forcing dynamic both fixes that and keeps the preview live.
export const dynamic = "force-dynamic";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "BlackOut SPX Slayer Track Record";

// Dynamic social-share image so a shared link previews the LIVE win rate.
export default async function OgImage() {
  const r = await buildPublicTrackRecord();
  const winRate = r.available ? `${r.win_rate_pct}%` : "—";
  const sub = r.available
    ? `${r.total_closed} verified plays · ${r.days_of_data} days`
    : "Track record warming up";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          background: "#040407",
          color: "#ffffff",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ fontSize: 28, letterSpacing: 8, color: "#00e676", textTransform: "uppercase" }}>
          {SITE.name} · SPX Slayer
        </div>
        <div style={{ fontSize: 220, fontWeight: 800, color: "#00e676", lineHeight: 1 }}>
          {winRate}
        </div>
        <div style={{ fontSize: 36, color: "#7dd3fc" }}>{sub}</div>
      </div>
    ),
    { ...size }
  );
}
