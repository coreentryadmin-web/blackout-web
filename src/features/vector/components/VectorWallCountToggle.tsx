"use client";

import clsx from "clsx";
import {
  VECTOR_WALL_COUNT_CHOICES,
  type VectorWallCountChoice,
} from "@/features/vector/lib/vector-bar-timeframes";

type Props = {
  choice: VectorWallCountChoice;
  onChoice: (c: VectorWallCountChoice) => void;
  disabled?: boolean;
};

/**
 * Wall-row density selector — AUTO / 8 / 10 / 12 rows per side.
 *
 * Member-reported: on a 3m chart with the 0DTE horizon active the rail draws 12 rows per side
 * (wallCountForTimeframe(3)=8, lifted to 12 by VECTOR_0DTE_WALL_COUNT) and reads as "painted".
 *
 * The numbers are a CAP over the existing timeframe curve, not a replacement for it — see
 * resolveWallCount. Capping only ever reduces, which is the whole point of the control; AUTO is the
 * default and leaves every chart exactly as it is today, so nobody's view changes until they ask.
 */
export function VectorWallCountToggle({ choice, onChoice, disabled = false }: Props) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Wall rows per side">
      {VECTOR_WALL_COUNT_CHOICES.map((key) => {
        const active = choice === key;
        return (
          <button
            key={String(key)}
            type="button"
            disabled={disabled}
            onClick={() => onChoice(key)}
            aria-pressed={active}
            data-testid={`vector-wallcount-${key}`}
            title={
              key === "auto"
                ? "Wall rows scale with the candle timeframe (today's behaviour)"
                : `Cap the rail at ${key} wall rows per side`
            }
            className={clsx(
              "font-mono text-[10px] font-bold uppercase tracking-[0.12em] rounded-lg border px-2 py-1.5 transition-colors",
              active && "border-emerald-400/70 bg-emerald-400/15 text-emerald-300",
              !active && !disabled && "border-white/15 text-cyan-400 hover:border-white/25",
              disabled && "cursor-not-allowed border-white/10 text-white/30"
            )}
          >
            {key === "auto" ? "AUTO" : key}
          </button>
        );
      })}
    </div>
  );
}
