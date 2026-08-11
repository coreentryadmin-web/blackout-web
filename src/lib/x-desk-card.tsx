/**
 * LIVE DESK CARD — the image attached to every X autopost.
 *
 * WHY THIS IS A satori RENDER AND NOT AN SVG STRING.
 * This file used to hand-write an SVG and hand it to `sharp(...).png()`. `sharp`'s SVG backend is
 * librsvg, which resolves `font-family` through fontconfig — it has no access to the repo's TTFs
 * and ignores an `@font-face` data URI. The card asked for `system-ui,sans-serif`, the container
 * has neither, so **every live X autopost rendered in DejaVu**: the brand face has never actually
 * appeared on a posted card. Proven by rendering Anton and DejaVu side by side through librsvg in
 * one SVG — both came out DejaVu.
 *
 * satori takes font BUFFERS directly, so fontconfig is out of the picture. The buffers come from
 * `loadVisualFonts()` — the SAME committed TTFs the Largo visual templates use, not a second copy,
 * so a font swap can never leave the two asset families looking like different products.
 *
 * The palette is `visual/tokens.ts` for the same reason: the desk card and a Largo-generated card
 * land in the same feed, and the colour code (green bullish / red bearish / amber caution / cyan
 * live data) has to mean the same thing in both.
 *
 * HONESTY. Every value is `MarketSnapshot` or absent — a missing level renders an em dash and its
 * row drops to muted rather than being filled with a plausible number. `x-content.ts`'s
 * `marketDataReady()` already gates whether a live-data post runs at all; this is the second line.
 *
 * The signature is unchanged (`renderDeskCardPng(postType, data) => Promise<Buffer>`) so
 * `x-autopost/route.ts` needs no edit and keeps its static-image fallback on throw.
 */

import type { PostType } from "@/lib/x-content-types";
import type { MarketSnapshot } from "@/lib/x-content";
import { C, FONT } from "@/lib/brand/tokens";
import { loadVisualFonts } from "@/lib/brand/font-buffers";

const W = 1200;
const H = 675;

const PRODUCT_LABEL: Record<PostType, string> = {
  desk_open: "Night Hawk → Vector → SPX Slayer",
  desk_flow: "Helix flow + Thermal walls",
  desk_ai: "Largo AI + SPX Slayer",
  desk_matrix: "Thermal matrix + Vector ladder",
  desk_midday: "Full desk midday read",
  desk_close: "Close recap · SPX Slayer",
  desk_evening: "Dealer gamma · 6-tool desk",
  weekend_desk: "Weekend gamma prep",
};

export const DASH = "—";

/** Whole-dollar level with thousands separators, or the em dash. Never a rounded-looking guess. */
export function deskLevel(n: number | null | undefined): string {
  return n != null && Number.isFinite(n) ? `$${Math.round(n).toLocaleString("en-US")}` : DASH;
}

/**
 * One label/value pair. `present` drives the colour so an absent level reads as absent at a
 * glance — a muted em dash, not a confident-looking blank.
 */
function Stat({
  label,
  value,
  color,
  width,
}: {
  label: string;
  value: string;
  color: string;
  width: number;
}) {
  const present = value !== DASH;
  return (
    <div style={{ display: "flex", flexDirection: "column", width, gap: 8 }}>
      <div
        style={{
          fontFamily: FONT.mono,
          fontSize: 20,
          letterSpacing: 1.6,
          textTransform: "uppercase",
          color: C.faint,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: FONT.display,
          fontSize: 46,
          color: present ? color : C.faint,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function DeskCard({ postType, data }: { postType: PostType; data: MarketSnapshot }) {
  const spx = deskLevel(data.spxPrice);
  const regime = (data.regime ?? "live desk").slice(0, 120);
  const product = PRODUCT_LABEL[postType] ?? "BlackOut desk";

  return (
    <div
      style={{
        width: W,
        height: H,
        display: "flex",
        flexDirection: "column",
        backgroundColor: C.void,
        padding: 56,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          backgroundColor: C.card,
          border: `1px solid ${C.rule}`,
          borderRadius: 20,
          padding: 44,
        }}
      >
        {/* Header — wordmark in brand lime, which is reserved for the wordmark so it never
            competes with the semantic bull green inside the data. */}
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ fontFamily: FONT.display, fontSize: 26, color: C.brand, letterSpacing: 1 }}>
            BLACKOUT
          </div>
          <div style={{ fontFamily: FONT.mono, fontSize: 20, color: C.faint }}>·</div>
          <div style={{ fontFamily: FONT.mono, fontSize: 20, color: C.info, letterSpacing: 2 }}>
            LIVE DESK
          </div>
        </div>

        {/* Hero — SPX and the regime read it came with. */}
        <div style={{ display: "flex", flexDirection: "column", marginTop: 34, gap: 12 }}>
          <div style={{ fontFamily: FONT.display, fontSize: 116, color: C.primary, lineHeight: 1 }}>
            {spx}
          </div>
          <div style={{ fontFamily: FONT.mono, fontSize: 26, color: C.info }}>{regime}</div>
        </div>

        <div style={{ display: "flex", height: 1, backgroundColor: C.rule, marginTop: 34 }} />

        {/* Positioning row. Call wall is resistance (red), put wall is support (green), flip is
            the regime boundary (amber) — the desk's own level colour code. */}
        <div style={{ display: "flex", marginTop: 30, gap: 24 }}>
          <Stat label="Gamma flip" value={deskLevel(data.flipLevel)} color={C.warn} width={330} />
          <Stat label="Call wall" value={deskLevel(data.topCallWall)} color={C.bear} width={330} />
          <Stat label="Put wall" value={deskLevel(data.topPutWall)} color={C.bull} width={330} />
        </div>

        <div style={{ display: "flex", flex: 1 }} />

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderTop: `1px solid ${C.ruleSoft}`,
            paddingTop: 24,
          }}
        >
          {/* The old footer carried the product label AND a six-tool strip. They are the same
              information — `PRODUCT_LABEL.desk_open` is literally three of those six tools — and
              together they overflowed 1120px, so one had to wrap or be clipped. The strip is the
              redundant half; the domain is what a reader actually needs off a shared image. */}
          <div style={{ fontFamily: FONT.mono, fontSize: 21, color: C.muted, whiteSpace: "nowrap" }}>
            {product}
          </div>
          <div
            style={{
              fontFamily: FONT.mono,
              fontSize: 20,
              color: C.faint,
              letterSpacing: 1,
              whiteSpace: "nowrap",
            }}
          >
            blackouttrades.com
          </div>
        </div>
      </div>
    </div>
  );
}

/** Live-data desk card PNG — replaces the static marketing webp in autopost. */
export async function renderDeskCardPng(
  postType: PostType,
  data: MarketSnapshot,
): Promise<Buffer> {
  const { ImageResponse } = await import("next/og");
  const fonts = await loadVisualFonts();
  const res = new ImageResponse(<DeskCard postType={postType} data={data} />, {
    width: W,
    height: H,
    fonts: fonts.map((f) => ({ name: f.name, data: f.data, weight: f.weight, style: f.style })),
  });
  return Buffer.from(await res.arrayBuffer());
}
