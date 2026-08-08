import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";

export const runtime = "edge";

import { truncateOgTitle } from "@/lib/seo/og-title";

/** Map article type slugs to human-readable category labels. */
const TYPE_LABELS: Record<string, string> = {
  article: "Learn Academy",
  pillar: "Learn Academy",
  glossary: "Glossary",
};

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  // `/api/og` is a public, directly-fetchable endpoint (?title=...) with no server-side
  // validation elsewhere — every current caller (publicPageMetadata) keeps titles short, but the
  // route itself must not trust that. An unbounded title has no truncation/overflow guard (unlike
  // `description` below), so a very long or unbroken-string value can overflow the 1200x630
  // canvas past the bottom branding bar, or risk a slow/pathological Satori render.
  const title = truncateOgTitle(searchParams.get("title") ?? "BlackOut Trades");
  // Support both "description" (new) and "subtitle" (legacy) params.
  const description =
    searchParams.get("description") ??
    searchParams.get("subtitle") ??
    "";
  // Support both "type" (new) and "kicker" (legacy) params.
  // "type" maps to a category label; "kicker" is displayed verbatim.
  const rawType = searchParams.get("type");
  const kicker = searchParams.get("kicker");
  const categoryLabel = rawType
    ? TYPE_LABELS[rawType] ?? rawType
    : kicker ?? "";

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
          background:
            "linear-gradient(145deg, #050509 0%, #0a0a14 40%, #0c1020 100%)",
          color: "#fff",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        {/* Subtle top-edge accent line */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "4px",
            background:
              "linear-gradient(90deg, transparent 0%, #22d3ee 30%, #22d3ee 70%, transparent 100%)",
          }}
        />

        {/* Category badge at top */}
        {categoryLabel && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              marginBottom: 28,
            }}
          >
            <div
              style={{
                fontSize: 15,
                fontWeight: 700,
                letterSpacing: "0.18em",
                textTransform: "uppercase" as const,
                color: "#22d3ee",
                borderBottom: "2px solid rgba(34, 211, 238, 0.3)",
                paddingBottom: 4,
              }}
            >
              {categoryLabel}
            </div>
          </div>
        )}

        {/* Title */}
        <div
          style={{
            fontSize: title.length > 60 ? 42 : title.length > 40 ? 48 : 56,
            fontWeight: 700,
            lineHeight: 1.15,
            marginBottom: description ? 20 : 0,
            maxWidth: 1000,
          }}
        >
          {title}
        </div>

        {/* Description / subtitle */}
        {description && (
          <div
            style={{
              fontSize: 22,
              color: "rgba(255,255,255,0.55)",
              lineHeight: 1.5,
              maxWidth: 850,
            }}
          >
            {description.length > 140
              ? description.slice(0, 137) + "..."
              : description}
          </div>
        )}

        {/* Bottom branding bar */}
        <div
          style={{
            position: "absolute",
            bottom: 50,
            left: 80,
            right: 80,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            {/* Cyan dot brand mark */}
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                background: "#22d3ee",
              }}
            />
            <div
              style={{
                fontSize: 18,
                fontWeight: 700,
                letterSpacing: "0.06em",
                color: "rgba(255,255,255,0.85)",
              }}
            >
              BlackOut Trades
            </div>
          </div>
          <div
            style={{
              fontSize: 14,
              color: "rgba(255,255,255,0.3)",
              letterSpacing: "0.1em",
            }}
          >
            blackouttrades.com
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
