"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ProductGallery — a phosphor-skinned screenshot carousel for the marketing
// product deep-dives. One image → renders a plain static shot (no controls);
// two or more → a slider with arrows, dots, a counter, keyboard nav, and gentle
// auto-advance (paused on hover/focus, disabled under prefers-reduced-motion).
//
// The image keeps the existing `.rl-deep-shot` class so it inherits the deep-
// dive framing/sizing; the carousel chrome uses `pm-gallery-*` classes from
// phosphor-motion.css. Client component (needs state + timers), fed a plain
// string[] of asset URLs by the server-rendered page.
type ProductGalleryProps = {
  images: readonly string[];
  label: string;
  /** Auto-advance interval in ms. */
  intervalMs?: number;
};

export function ProductGallery({ images, label, intervalMs = 4800 }: ProductGalleryProps) {
  const [i, setI] = useState(0);
  const n = images.length;
  const paused = useRef(false);

  const go = useCallback((next: number) => setI(((next % n) + n) % n), [n]);

  useEffect(() => {
    if (n < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => {
      if (!paused.current) setI((c) => (c + 1) % n);
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [n, intervalMs]);

  if (n === 0) return null;

  if (n === 1) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- marketing product shot
      <img
        src={images[0]}
        alt={`${label} — live product screen`}
        className="rl-deep-shot"
        loading="lazy"
        decoding="async"
      />
    );
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") { e.preventDefault(); go(i - 1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); go(i + 1); }
  };

  return (
    // The carousel container is a labelled group that owns arrow-key navigation
    // between slides — an intentional, WAI-ARIA-pattern interactive region.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- carousel keyboard/pointer container
    <div
      className="pm-gallery"
      role="group"
      aria-roledescription="carousel"
      aria-label={`${label} screenshots`}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onMouseEnter={() => { paused.current = true; }}
      onMouseLeave={() => { paused.current = false; }}
      onFocusCapture={() => { paused.current = true; }}
      onBlurCapture={() => { paused.current = false; }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- marketing product shot */}
      <img
        key={i}
        src={images[i]}
        alt={`${label} — screen ${i + 1} of ${n}`}
        className="rl-deep-shot pm-gallery-img"
        loading="lazy"
        decoding="async"
      />
      <button type="button" className="pm-gallery-arrow prev" aria-label="Previous screenshot" onClick={() => go(i - 1)}>‹</button>
      <button type="button" className="pm-gallery-arrow next" aria-label="Next screenshot" onClick={() => go(i + 1)}>›</button>
      <div className="pm-gallery-dots">
        {images.map((src, k) => (
          <button
            key={src}
            type="button"
            className={k === i ? "pm-gallery-dot on" : "pm-gallery-dot"}
            aria-label={`Show screenshot ${k + 1} of ${n}`}
            aria-current={k === i}
            onClick={() => go(k)}
          />
        ))}
      </div>
      <span className="pm-gallery-count" aria-hidden>{i + 1}/{n}</span>
    </div>
  );
}

export default ProductGallery;
