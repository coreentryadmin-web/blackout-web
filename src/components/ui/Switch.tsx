"use client";

import { forwardRef } from "react";
import { clsx } from "clsx";

export type SwitchProps = {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Accessible label (visually rendered when `label` is provided). */
  label?: React.ReactNode;
  disabled?: boolean;
  /** Accent when on — defaults to the signal emerald. */
  accent?: "bull" | "cyan" | "violet" | "gold";
  id?: string;
  className?: string;
};

const ACCENT: Record<NonNullable<SwitchProps["accent"]>, string> = {
  bull: "data-[on=true]:border-bull/55 data-[on=true]:bg-bull/20 [&_.knob]:data-[on=true]:bg-bull [&_.knob]:data-[on=true]:shadow-[0_0_12px_var(--bull)]",
  cyan: "data-[on=true]:border-cyan/55 data-[on=true]:bg-cyan/20 [&_.knob]:data-[on=true]:bg-cyan [&_.knob]:data-[on=true]:shadow-[0_0_12px_#22d3ee]",
  violet: "data-[on=true]:border-purple/55 data-[on=true]:bg-purple/20 [&_.knob]:data-[on=true]:bg-purple [&_.knob]:data-[on=true]:shadow-[0_0_12px_#bf5fff]",
  gold: "data-[on=true]:border-gold/55 data-[on=true]:bg-gold/20 [&_.knob]:data-[on=true]:bg-gold [&_.knob]:data-[on=true]:shadow-[0_0_12px_#ffd23f]",
};

/**
 * Toggle switch — VITALS tempo, emerald-glow knob when on. Transform-only knob
 * transition; reduced-motion is honoured by the global duration collapse.
 */
export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { checked, onChange, label, disabled, accent = "bull", id, className },
  ref
) {
  const control = (
    <button
      ref={ref}
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      data-on={checked}
      onClick={() => !disabled && onChange(!checked)}
      className={clsx(
        "relative h-[26px] w-[46px] shrink-0 rounded-full border border-white/15 bg-void/70",
        "transition-[background-color,border-color] duration-base ease-snap",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 focus-visible:ring-offset-void",
        "disabled:cursor-not-allowed disabled:opacity-45",
        ACCENT[accent]
      )}
    >
      <span
        className={clsx(
          "knob absolute left-[2px] top-[2px] h-[20px] w-[20px] rounded-full bg-white/40",
          "transition-[transform,background-color,box-shadow] duration-base ease-snap",
          checked && "translate-x-[20px]"
        )}
      />
    </button>
  );

  if (!label) return control;
  return (
    <label className={clsx("inline-flex cursor-pointer items-center gap-3 text-sm text-secondary", className)}>
      {control}
      <span>{label}</span>
    </label>
  );
});
