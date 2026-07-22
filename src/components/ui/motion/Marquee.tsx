import type { CSSProperties, ReactNode } from "react";

// Marquee — a seamless infinite horizontal scroller. Native re-author of the
// 21st.dev / Magic-UI marquee in the phosphor language: pure CSS (phosphor-
// motion.css), server-component safe, edge-faded, pause-on-hover, and
// prefers-reduced-motion gated (the track simply stops, leaving a static,
// legible row).
//
// The children are rendered twice (the second copy aria-hidden) and the track
// translates by exactly one group width, so the loop has no visible seam.
type MarqueeProps = {
  children: ReactNode;
  /** Full-loop duration in seconds (larger = slower). */
  durationSec?: number;
  /** Gap between items (any CSS length). */
  gap?: string;
  /** Pause the scroll while hovered. */
  pauseOnHover?: boolean;
  className?: string;
};

export function Marquee({ children, durationSec = 32, gap, pauseOnHover = true, className }: MarqueeProps) {
  const style = {
    "--pm-mq-dur": `${durationSec}s`,
    ...(gap ? { "--pm-mq-gap": gap } : null),
  } as CSSProperties;
  const cls = ["pm-marquee", pauseOnHover ? "pm-marquee-pause" : "", className].filter(Boolean).join(" ");
  return (
    <div className={cls} style={style}>
      <div className="pm-marquee-track">
        <div className="pm-marquee-group">{children}</div>
        <div className="pm-marquee-group" aria-hidden>{children}</div>
      </div>
    </div>
  );
}

export default Marquee;
