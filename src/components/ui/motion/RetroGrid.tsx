import type { CSSProperties } from "react";

// RetroGrid — a perspective phosphor floor receding to a horizon. Native
// re-author of the 21st.dev / Magic-UI "retro grid" in the PHOSPHOR LADDER
// language: pure CSS (phosphor-motion.css), server-component safe, and
// prefers-reduced-motion gated (the floor stops scrolling but still frames the
// section). Drop it as the first child of a position:relative, overflow:hidden
// section; it fills the section behind the content.
type RetroGridProps = {
  /** Grid-line color (defaults to low-alpha violet — the phosphor grid decoration). */
  lineColor?: string;
  /** Overall opacity of the floor, 0–1. */
  opacity?: number;
  className?: string;
};

export function RetroGrid({ lineColor, opacity, className }: RetroGridProps) {
  const style = {
    ...(lineColor ? { "--pm-grid-line": lineColor } : null),
    ...(opacity != null ? { "--pm-grid-opacity": String(opacity) } : null),
  } as CSSProperties;
  return (
    <div aria-hidden className={className ? `pm-retrogrid ${className}` : "pm-retrogrid"} style={style}>
      <div className="pm-retrogrid-plane" />
    </div>
  );
}

export default RetroGrid;
