"use client";

import { clsx } from "clsx";
import { VectorBoardMeter } from "@/features/nighthawk/components/VectorBoardMeter";
import type { VectorBoardScorecard as ScorecardData } from "@/features/nighthawk/lib/vector-board-row-utils";

function fmtSigned(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v}%`;
}

function meterFromPct(pct: number | null, label: string) {
  if (pct == null) return null;
  const tone = pct >= 50 ? "up" : pct >= 25 ? "flat" : "down";
  return {
    valueLabel: label,
    fillPct: Math.max(0, Math.min(100, pct)),
    caption: `${pct}%`,
    tone: tone as "up" | "down" | "flat",
  };
}

export function VectorBoardScorecard({ data, sessionLabel }: { data: ScorecardData; sessionLabel: string }) {
  const meters = [
    { key: "floor", label: "Winners floor", meter: meterFromPct(data.winnersFloorPct, "Open winners") },
    { key: "pipeline", label: "Runner pipeline", meter: meterFromPct(data.runnerPipelinePct, "Open runners") },
    {
      key: "giveback",
      label: "Avg giveback",
      meter:
        data.avgGivebackPct != null
          ? {
              valueLabel: `${data.avgGivebackPct}%`,
              fillPct: Math.max(0, Math.min(100, data.avgGivebackPct)),
              caption: "from peak",
              tone: data.avgGivebackPct > 25 ? ("down" as const) : ("flat" as const),
            }
          : null,
    },
  ];

  return (
    <section className="vector-board-scorecard" aria-label="Session scorecard">
      <div className="vector-board-scorecard-head">
        <span className="vector-board-scorecard-title">{sessionLabel}</span>
        <span className="vector-board-scorecard-meta tabular-nums">
          {data.total} picks · {data.winners} winners · {data.runners} runners · {data.closed} closed
        </span>
        {data.hitRate != null ? (
          <span className="vector-board-scorecard-meta tabular-nums">Hit rate {data.hitRate}%</span>
        ) : null}
        {data.netPremiumPct != null ? (
          <span
            className={clsx(
              "vector-board-scorecard-net tabular-nums",
              data.netPremiumPct > 0 && "is-up",
              data.netPremiumPct < 0 && "is-down"
            )}
          >
            Net premium {fmtSigned(data.netPremiumPct)}
          </span>
        ) : null}
        {data.bestPick ? (
          <span className="vector-board-scorecard-best">
            Best: <strong>{data.bestPick.ticker}</strong> {fmtSigned(data.bestPick.premiumPct)}
          </span>
        ) : null}
      </div>
      <div className="vector-board-scorecard-meters">
        {meters.map(({ key, label, meter }) => (
          <div key={key} className="vector-board-scorecard-meter">
            <span className="vector-board-scorecard-meter-label">{label}</span>
            <VectorBoardMeter meter={meter} compact />
          </div>
        ))}
      </div>
    </section>
  );
}
