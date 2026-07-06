"use client";

import { clsx } from "clsx";

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
  "aria-label"?: string;
};

/** Native-style pill segment control — iOS shell only (parent gates visibility). */
export function IosNativeSegment<T extends string>({
  value,
  onChange,
  segments,
  accent = "#00e676",
  className,
  "aria-label": ariaLabel = "View",
}: Props<T>) {
  return (
    <div
      className={clsx("ios-native-segment", className)}
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
            className={clsx("ios-native-segment-btn font-syne", active && "ios-native-segment-btn-active")}
            onClick={() => onChange(seg.id)}
          >
            {seg.label}
          </button>
        );
      })}
    </div>
  );
}
