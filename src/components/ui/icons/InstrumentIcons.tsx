import type { SVGProps } from "react";
import type { MarketingModuleId } from "@/lib/images";

// INSTRUMENT ICONS — one glyph per desk product, drawn in the PHOSPHOR LADDER
// language. "Data is the only ornament": each mark encodes what the product
// actually does rather than a generic pictogram —
//   spx     → the gamma ladder (magnitude rungs + spot notch)
//   helix   → the interwoven institutional-flow strands
//   thermal → the dealer-gamma heatmap grid (hot diagonal)
//   largo   → the desk-intelligence graph (hub → structured answer)
//   hawk    → the night scanner reticle (crosshair + sweep to target)
//   vector  → the universe radar (concentric sweeps + an outbound vector)
//
// All strokes are `currentColor`, so a product card tints its icon simply by
// setting `color: var(--accent)`. Pure markup — safe in server components.

type IconProps = SVGProps<SVGSVGElement> & { size?: number; title?: string };

function Svg({ size = 24, title, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? "img" : "presentation"}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

/** SPX Slayer — the gamma ladder: magnitude rungs with the spot notch. */
export function LadderIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 5.5h8" />
      <path d="M4 9h13" />
      <path d="M4 12.5h6" />
      <path d="M4 16h15" />
      <path d="M4 19.5h9" />
      {/* spot marker riding the widest rung */}
      <circle cx="19" cy="16" r="1.5" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/** HELIX — two interwoven flow strands framed as a tape. */
export function HelixIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 3c6 3 6 7 0 9s-6 6 0 9" />
      <path d="M15 3c-6 3-6 7 0 9s6 6 0 9" />
      <path d="M9 3h6" />
      <path d="M9 21h6" />
      <path d="M10.5 12h3" />
    </Svg>
  );
}

/** BlackOut Thermal — the dealer-gamma heatmap grid with a hot diagonal. */
export function ThermalIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M9.33 4v16M14.67 4v16M4 9.33h16M4 14.67h16" />
      {/* hot cells along the diagonal — the pinned zone */}
      <rect x="4" y="4" width="5.33" height="5.33" fill="currentColor" stroke="none" opacity="0.9" />
      <rect x="9.33" y="9.33" width="5.34" height="5.34" fill="currentColor" stroke="none" opacity="0.55" />
      <rect x="14.67" y="14.67" width="5.33" height="5.33" fill="currentColor" stroke="none" opacity="0.28" />
    </Svg>
  );
}

/** Largo — the desk-intelligence graph: a hub resolving to structured answers. */
export function GraphIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="2.4" />
      <path d="M10.3 10.3 6.4 6.4M13.7 10.4 18 6.6M10.5 13.6 6.6 17.6M13.7 13.7 18 18" />
      <circle cx="5" cy="5" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="19" cy="5.6" r="1.5" />
      <circle cx="5.4" cy="18.6" r="1.5" />
      <circle cx="19" cy="19" r="1.5" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/** Night Hawk — the scanner reticle: crosshair, ring, sweep to a target lock. */
export function ReticleIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="11" cy="12" r="7.5" />
      <path d="M11 1.5v3.5M11 19v3.5M1 12h3.5M17.5 12H21" />
      <circle cx="11" cy="12" r="2.6" />
      {/* sweep line to the locked target */}
      <path d="M11 12 17.5 6.6" />
      <circle cx="18" cy="6" r="1.5" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/** Vector — the universe radar: concentric sweeps around an origin + an outbound vector. */
export function RadarIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="6.5" cy="17.5" r="1.6" fill="currentColor" stroke="none" />
      {/* concentric radar sweeps opening off the origin */}
      <path d="M12.5 17.5a6 6 0 0 0-6-6" />
      <path d="M17 17.5a10.5 10.5 0 0 0-10.5-10.5" />
      {/* the outbound vector + arrowhead */}
      <path d="M6.5 17.5 19 5" />
      <path d="M19 5h-4.4M19 5v4.4" />
    </Svg>
  );
}

const BY_ID: Record<MarketingModuleId, (p: IconProps) => JSX.Element> = {
  spx: LadderIcon,
  helix: HelixIcon,
  thermal: ThermalIcon,
  largo: GraphIcon,
  hawk: ReticleIcon,
  vector: RadarIcon,
};

/** Keyed accessor — `<InstrumentIcon id="spx" />` renders that product's glyph. */
export function InstrumentIcon({ id, ...props }: IconProps & { id: MarketingModuleId }) {
  const Glyph = BY_ID[id];
  return Glyph ? <Glyph {...props} /> : null;
}

export default InstrumentIcon;
