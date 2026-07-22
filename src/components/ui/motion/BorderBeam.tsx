import type { CSSProperties } from "react";

// BorderBeam — a phosphor comet that traces the parent's rounded border.
// Native re-author of the 21st.dev / Magic-UI "border beam" in the PHOSPHOR
// LADDER language: pure CSS (styles live in phosphor-motion.css), so it stays a
// server component and is prefers-reduced-motion gated. Drop it inside any
// position:relative element that has a border-radius; the beam ring inherits
// that radius. Tint/timing come from CSS vars, so a card can theme its beam to
// its own accent with a single `color` value.
type BorderBeamProps = {
  /** Beam color (defaults to the violet brand chrome). Pass a product accent to theme it. */
  color?: string;
  /** Full-loop duration, e.g. "7s". */
  duration?: string;
  /** Ring thickness, e.g. "1.5px". */
  width?: string;
  /** Stagger start so sibling beams don't travel in lockstep, e.g. "-3s". */
  delay?: string;
  className?: string;
};

export function BorderBeam({ color, duration, width, delay, className }: BorderBeamProps) {
  const style = {
    ...(color ? { "--pm-beam-color": color } : null),
    ...(duration ? { "--pm-beam-dur": duration } : null),
    ...(width ? { "--pm-beam-width": width } : null),
    ...(delay ? { "--pm-beam-delay": delay } : null),
  } as CSSProperties;
  return <span aria-hidden className={className ? `pm-beam ${className}` : "pm-beam"} style={style} />;
}

export default BorderBeam;
