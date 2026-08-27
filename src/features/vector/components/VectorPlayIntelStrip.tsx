"use client";

import clsx from "clsx";
import type { VectorRegime } from "@/features/vector/lib/vector-regime";
import type { WallIntegrity } from "@/features/vector/lib/vector-wall-integrity";

type Props = {
  regime: VectorRegime | null;
  expectedMove: string[];
  confluence: string[] | null;
  wallIntegrity: { call: WallIntegrity | null; put: WallIntegrity | null };
  className?: string;
};

/**
 * Compact desk-intel row under the play card — surfaces regime, expected move, confluence, and wall
 * integrity that the chart already computes but no longer narrates in a separate terminal feed.
 */
export function VectorPlayIntelStrip({
  regime,
  expectedMove,
  confluence,
  wallIntegrity,
  className,
}: Props) {
  const em = expectedMove[0];
  const conf = confluence?.[0];
  const wallNote =
    wallIntegrity.call?.tier === "firm"
      ? wallIntegrity.call.note
      : wallIntegrity.put?.tier === "firm"
        ? wallIntegrity.put.note
        : wallIntegrity.call?.note ?? wallIntegrity.put?.note;

  if (!regime && !em && !conf && !wallNote) return null;

  return (
    <div className={clsx("vector-play-intel-strip", className)} aria-label="Desk intelligence">
      {regime ? (
        <span
          className={clsx(
            "vector-play-intel-chip",
            regime.tone === "calm" && "vector-play-intel-chip--calm",
            regime.tone === "volatile" && "vector-play-intel-chip--volatile"
          )}
          title={regime.read}
        >
          <span className="vector-play-intel-chip-label">Regime</span>
          <span className="vector-play-intel-chip-value">{regime.headline}</span>
        </span>
      ) : null}
      {em ? (
        <span className="vector-play-intel-chip vector-play-intel-chip--em" title={expectedMove.join(" · ")}>
          <span className="vector-play-intel-chip-label">Move</span>
          <span className="vector-play-intel-chip-value">{em}</span>
        </span>
      ) : null}
      {conf ? (
        <span className="vector-play-intel-chip vector-play-intel-chip--conf" title={confluence?.join(" · ")}>
          <span className="vector-play-intel-chip-label">Confluence</span>
          <span className="vector-play-intel-chip-value">{conf}</span>
        </span>
      ) : null}
      {wallNote ? (
        <span className="vector-play-intel-chip vector-play-intel-chip--wall" title={wallNote}>
          <span className="vector-play-intel-chip-label">Wall</span>
          <span className="vector-play-intel-chip-value">{wallNote}</span>
        </span>
      ) : null}
    </div>
  );
}
