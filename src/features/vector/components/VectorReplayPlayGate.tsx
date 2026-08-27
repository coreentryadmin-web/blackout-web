"use client";

import clsx from "clsx";

type Props = {
  className?: string;
};

/** Honest banner when chart replay is active — play engine and live pick quotes are paused. */
export function VectorReplayPlayGate({ className }: Props) {
  return (
    <div className={clsx("vector-replay-play-gate", className)} role="status" data-testid="vector-replay-play-gate">
      <span className="vector-replay-play-gate-label">REPLAY</span>
      <span className="vector-replay-play-gate-msg">Play engine paused — exit replay for live plays and picks</span>
    </div>
  );
}
