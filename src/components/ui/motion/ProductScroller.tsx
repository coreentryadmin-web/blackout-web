"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

// ProductScroller — a horizontal scroll-snap carousel for the marketing homepage's
// bottom "every module in depth" strip. The six product deep-dives used to stack as
// six tall alternating rows (the page's longest block, and the THIRD place the same
// MARKETING_PRODUCTS list rendered) — this collapses that block into one compact,
// swipeable strip. Native overflow scroll does the heavy lifting (trackpad, touch,
// and the scrollbar all work with zero JS); this client shell only adds the arrow
// buttons + progress dots and keeps them in sync with the scroll position.
//
// Children are server-rendered cards passed in by composition — each MUST carry
// `data-hscroll-card` so we can measure snap offsets and highlight the active dot.
// Pointer-drag is deliberately NOT added: the cards contain CTA links, and a
// drag-vs-click shim would swallow those taps. Arrows/dots/native scroll cover it.
type ProductScrollerProps = {
  children: ReactNode;
  /** Number of cards — drives the dot count. Must match the children length. */
  count: number;
  ariaLabel?: string;
};

export function ProductScroller({ children, count, ariaLabel = "Products" }: ProductScrollerProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  // Recompute edge state + nearest-snapped card from the live scroll position.
  const measure = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setAtStart(scrollLeft <= 2);
    setAtEnd(scrollLeft + clientWidth >= scrollWidth - 2);
    const cards = el.querySelectorAll<HTMLElement>("[data-hscroll-card]");
    let best = 0;
    let bestDist = Infinity;
    cards.forEach((c, i) => {
      const d = Math.abs(c.offsetLeft - el.offsetLeft - scrollLeft);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    setActive(best);
  }, []);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      el.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  // One card + gap per arrow press; falls back to ~80% of the viewport if we can't
  // read a card (keeps the arrows useful even before layout settles).
  const nudge = useCallback((dir: 1 | -1) => {
    const el = trackRef.current;
    if (!el) return;
    const card = el.querySelector<HTMLElement>("[data-hscroll-card]");
    const gap = 22;
    const step = card ? card.offsetWidth + gap : el.clientWidth * 0.8;
    el.scrollBy({ left: dir * step, behavior: "smooth" });
  }, []);

  const scrollToIndex = useCallback((i: number) => {
    const el = trackRef.current;
    if (!el) return;
    const cards = el.querySelectorAll<HTMLElement>("[data-hscroll-card]");
    const c = cards[i];
    if (c) el.scrollTo({ left: c.offsetLeft - el.offsetLeft, behavior: "smooth" });
  }, []);

  return (
    <div className="rl-hscroll" role="group" aria-roledescription="carousel" aria-label={ariaLabel}>
      <div className="rl-hscroll-track" ref={trackRef}>
        {children}
      </div>
      <div className="rl-hscroll-ctrl">
        <button
          type="button"
          className="rl-hscroll-arrow"
          onClick={() => nudge(-1)}
          disabled={atStart}
          aria-label="Previous module"
        >
          ‹
        </button>
        <div className="rl-hscroll-dots">
          {Array.from({ length: count }).map((_, i) => (
            <button
              // eslint-disable-next-line react/no-array-index-key -- fixed-length static dot list
              key={i}
              type="button"
              className={`rl-hscroll-dot${i === active ? " on" : ""}`}
              aria-label={`Go to module ${i + 1}`}
              aria-current={i === active}
              onClick={() => scrollToIndex(i)}
            />
          ))}
        </div>
        <button
          type="button"
          className="rl-hscroll-arrow"
          onClick={() => nudge(1)}
          disabled={atEnd}
          aria-label="Next module"
        >
          ›
        </button>
      </div>
    </div>
  );
}
