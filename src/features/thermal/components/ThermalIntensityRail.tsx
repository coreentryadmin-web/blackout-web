"use client";

import clsx from "clsx";
import {
  thermalIntensityGlowOpacity,
  thermalIntensityRatio,
  thermalIntensityWidthPct,
} from "@/features/thermal/lib/thermal-intensity";

export function ThermalIntensityRail({
  value,
  peak,
  positiveHex,
  negativeHex,
  className,
  title,
}: {
  value: number;
  peak: number;
  positiveHex: string;
  negativeHex: string;
  className?: string;
  title?: string;
}) {
  const ratio = thermalIntensityRatio(value, peak);
  const widthPct = thermalIntensityWidthPct(ratio);
  const positive = value > 0;
  const color = value === 0 ? "transparent" : positive ? positiveHex : negativeHex;
  const glow = thermalIntensityGlowOpacity(ratio);

  return (
    <span
      className={clsx("thermal-intensity-rail relative block min-w-0 flex-1", className)}
      title={title}
      aria-hidden={value === 0 || peak <= 0}
    >
      <span className="thermal-intensity-rail-track absolute inset-0 rounded-[3px] bg-[rgba(4,4,7,0.65)]" />
      {ratio > 0 ? (
        <>
          <span
            className="thermal-intensity-rail-glow pointer-events-none absolute left-0 top-1/2 h-[18px] -translate-y-1/2 rounded-r-[4px]"
            style={{
              width: `${widthPct}%`,
              background: `linear-gradient(90deg, ${color} 0%, ${color}88 45%, transparent 100%)`,
              opacity: glow * 0.85,
              filter: "blur(5px)",
            }}
          />
          <span
            className="thermal-intensity-rail-core pointer-events-none absolute left-0 top-1/2 h-[13px] -translate-y-1/2 rounded-r-[2px] motion-safe:transition-[width] motion-safe:duration-300"
            style={{
              width: `${widthPct}%`,
              background: `linear-gradient(90deg, ${color} 0%, ${color}dd 55%, ${color}99 100%)`,
              boxShadow: `0 0 ${6 + ratio * 14}px ${color}${ratio > 0.45 ? "cc" : "66"}`,
              opacity: 0.55 + ratio * 0.4,
            }}
          />
          <span
            className="thermal-intensity-rail-spark pointer-events-none absolute left-0 top-1/2 h-[13px] w-[2px] -translate-y-1/2"
            style={{
              backgroundColor: color,
              boxShadow: `0 0 10px ${color}`,
              opacity: 0.95,
            }}
          />
        </>
      ) : null}
    </span>
  );
}
