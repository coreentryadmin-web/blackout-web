import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const title = searchParams.get("title") ?? "BlackOut Trades";
  const subtitle = searchParams.get("subtitle") ?? "Trade like the lights are on.";
  const kicker = searchParams.get("kicker") ?? "";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "linear-gradient(135deg, #040407 0%, #0a0a14 50%, #12061e 100%)",
          color: "#fff",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {kicker && (
          <div
            style={{
              fontSize: 18,
              fontWeight: 600,
              letterSpacing: "0.2em",
              textTransform: "uppercase" as const,
              color: "#bf5fff",
              marginBottom: 24,
            }}
          >
            {kicker}
          </div>
        )}
        <div style={{ fontSize: 56, fontWeight: 700, lineHeight: 1.15, marginBottom: 24 }}>
          {title}
        </div>
        <div
          style={{
            fontSize: 24,
            color: "rgba(255,255,255,0.6)",
            lineHeight: 1.5,
            maxWidth: 800,
          }}
        >
          {subtitle}
        </div>
        <div
          style={{
            position: "absolute",
            bottom: 60,
            left: 80,
            fontSize: 16,
            color: "rgba(255,255,255,0.35)",
            letterSpacing: "0.15em",
          }}
        >
          blackouttrades.com
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
