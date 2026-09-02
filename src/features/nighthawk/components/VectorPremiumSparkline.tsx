"use client";

import { vectorBoardSparklinePoints } from "@/features/nighthawk/lib/vector-board-row-utils";
import type { VectorBoardTableRow } from "@/features/nighthawk/lib/vector-board-table-utils";

export function VectorPremiumSparkline({ row }: { row: VectorBoardTableRow }) {
  const points = vectorBoardSparklinePoints(row);
  if (points.length < 2) return null;

  const w = 120;
  const h = 36;
  const pad = 2;
  const min = Math.min(...points, 0);
  const max = Math.max(...points, 1);
  const span = max - min || 1;

  const coords = points.map((v, i) => {
    const x = pad + (i / (points.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / span) * (h - pad * 2);
    return `${x},${y}`;
  });

  const last = points[points.length - 1] ?? 0;
  const stroke =
    last > 0 ? "var(--nh-desk-up, #00d9a3)" : last < 0 ? "var(--nh-desk-down, #f0637c)" : "var(--nh-desk-warn, #f0b94a)";

  return (
    <svg
      className="vector-board-sparkline"
      viewBox={`0 0 ${w} ${h}`}
      width={w}
      height={h}
      aria-hidden
    >
      <polyline
        fill="none"
        stroke={stroke}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={coords.join(" ")}
      />
    </svg>
  );
}
