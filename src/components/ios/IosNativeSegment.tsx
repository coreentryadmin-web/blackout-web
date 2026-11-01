"use client";

import { useId } from "react";
import { clsx } from "clsx";
import { motion } from "framer-motion";

type Segment<T extends string> = {
  id: T;
  label: string;
};

type Props<T extends string> = {
  value: T;
  onChange: (id: T) => void;
  segments: Segment<T>[];
  accent?: string;
  className?: string;
  /** compact = UISegmentedControl-style (~40% shorter) for iPhone desks */
  variant?: "default" | "compact";
  "aria-label"?: string;
};

const SEGMENT_SPRING = { type: "spring" as const, stiffness: 520, damping: 42 };

/** Lens rail — sharp institutional view switcher (not pill tabs). */
export function IosNativeSegment<T extends string>({
  value,
  onChange,
  segments,
  accent = "#a3e635",
  className,
  variant = "default",
  "aria-label": ariaLabel = "View lens",
}: Props<T>) {
  // Framer Motion requires `layoutId` to be unique among simultaneously-mounted elements — when
  // two carry the same id, it treats them as ONE logical element and only the most-recently-
  // mounted copy's indicator stays visible; the other instance's active tab silently loses its
  // pill. This component is reused for several independent segmented controls that DO render at
  // once on the same screen (HelixPageShell mounts both `IosIntelligenceHubSegment`'s Flow/Thermal
  // switcher and FlowFeed's own "Live tape / Analytics" lens switcher together on the native iOS
  // /flows page), so a shared literal id here collided across instances. `useId()` scopes the
  // layoutId to this component instance so the shared-layout slide animation still works WITHIN
  // one segmented control while no longer colliding with any other instance on the page.
  const uid = useId();
  return (
    <div
      className={clsx(
        "ios-native-segment",
        variant === "compact" && "ios-native-segment-compact",
        className
      )}
      role="tablist"
      aria-label={ariaLabel}
      style={{ "--segment-accent": accent } as React.CSSProperties}
    >
      {segments.map((seg) => {
        const active = value === seg.id;
        return (
          <button
            key={seg.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={clsx("ios-native-segment-btn", active && "ios-native-segment-btn-active")}
            onClick={() => onChange(seg.id)}
          >
            {active && (
              <motion.span
                layoutId={`ios-native-segment-indicator-${uid}`}
                className="ios-native-segment-indicator"
                transition={SEGMENT_SPRING}
                aria-hidden
              />
            )}
            {seg.label}
          </button>
        );
      })}
    </div>
  );
}
