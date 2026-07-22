"use client";

import { useEffect, useRef, useState } from "react";

// NumberTicker — a count-up numeral that animates 0 → value the first time it
// scrolls into view. Native re-author of the 21st.dev / Magic-UI number ticker
// in the phosphor system. Client component (it needs rAF + IntersectionObserver),
// kept as a tiny leaf island so a server-rendered page can drop it inline.
//
// SSR correctness: the initial render is the FINAL value, so no-JS visitors and
// crawlers see the real number and there's no hydration mismatch; the animation
// only kicks in after mount. Reduced-motion → the value is shown outright, never
// animated.
type NumberTickerProps = {
  value: number;
  /** Count-up duration in ms. */
  durationMs?: number;
  /** Intl locale for grouping separators (e.g. 1999 → "1,999"). */
  locale?: string;
  className?: string;
};

export function NumberTicker({ value, durationMs = 1400, locale = "en-US", className }: NumberTickerProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const started = useRef(false);
  const [display, setDisplay] = useState(value); // final value for SSR / first paint

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplay(value);
      return;
    }
    const run = () => {
      if (started.current) return;
      started.current = true;
      const start = performance.now();
      const from = 0;
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / durationMs);
        const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
        setDisplay(from + (value - from) * eased);
        if (t < 1) requestAnimationFrame(tick);
        else setDisplay(value);
      };
      requestAnimationFrame(tick);
    };
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            run();
            io.disconnect();
            break;
          }
        }
      },
      { threshold: 0.4 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [value, durationMs]);

  return (
    <span ref={ref} className={className}>
      {Math.round(display).toLocaleString(locale)}
    </span>
  );
}

export default NumberTicker;
