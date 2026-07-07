"use client";

import clsx from "clsx";

type Props = {
  replayMode: boolean;
  playing: boolean;
  canReplay: boolean;
  cursorIndex: number;
  stepCount: number;
  clockLabel: string;
  speed: number;
  onToggleReplay: () => void;
  onTogglePlay: () => void;
  onScrub: (index: number) => void;
  onSpeed: (speed: number) => void;
};

const SPEEDS = [0.5, 1, 2, 4] as const;

/** Session replay transport — scrub + play through recorded wall-trail timeline. */
export function VectorReplayControls({
  replayMode,
  playing,
  canReplay,
  cursorIndex,
  stepCount,
  clockLabel,
  speed,
  onToggleReplay,
  onTogglePlay,
  onScrub,
  onSpeed,
}: Props) {
  const maxIndex = Math.max(0, stepCount - 1);

  return (
    <div className="vector-replay-bar mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
      <button
        type="button"
        onClick={onToggleReplay}
        disabled={!canReplay && !replayMode}
        className={clsx(
          "font-mono text-[10px] font-semibold rounded-lg border px-3 py-[5px] transition-all",
          replayMode
            ? "border-gold/70 text-gold bg-gold/15"
            : "border-[rgba(0,230,118,0.3)] text-[#00e676] disabled:cursor-not-allowed disabled:opacity-30"
        )}
      >
        {replayMode ? "■ Exit replay" : "▶ Replay session"}
      </button>

      {replayMode && stepCount > 0 && (
        <>
          <button
            type="button"
            onClick={onTogglePlay}
            className="font-mono text-[10px] font-semibold rounded-lg border border-white/15 px-2.5 py-[5px] text-sky-300"
          >
            {playing ? "⏸ Pause" : "▶ Play"}
          </button>

          <input
            type="range"
            min={0}
            max={maxIndex}
            value={cursorIndex}
            onChange={(e) => onScrub(Number(e.target.value))}
            className="min-w-[120px] flex-1 accent-cyan-400"
            aria-label="Replay position"
          />

          <span className="font-mono text-[10px] text-cyan-400 tabular-nums whitespace-nowrap">
            {clockLabel}
            <span className="text-white/50">
              {" "}
              · {cursorIndex + 1}/{stepCount}
            </span>
          </span>

          <div className="flex items-center gap-1">
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onSpeed(s)}
                className={clsx(
                  "font-mono text-[10px] rounded-md border px-2 py-0.5",
                  speed === s
                    ? "border-gold/60 bg-gold/20 text-gold"
                    : "border-white/10 text-cyan-400"
                )}
              >
                {s}×
              </button>
            ))}
          </div>
        </>
      )}

      {!replayMode && (
        <span className="font-mono text-[10px] text-sky-300">
          Gamma wall beads sample every 15s · live levels ~1s
        </span>
      )}
    </div>
  );
}
