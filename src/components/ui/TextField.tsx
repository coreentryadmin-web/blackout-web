"use client";

import { forwardRef, useId } from "react";
import { clsx } from "clsx";

type CommonProps = {
  label?: React.ReactNode;
  /** Uppercase mono hint under the field. */
  hint?: React.ReactNode;
  /** Error message — turns the field red and sets aria-invalid. */
  error?: string | null;
  /** Leading adornment (icon / symbol). */
  leading?: React.ReactNode;
  /** Trailing adornment (unit / action). */
  trailing?: React.ReactNode;
  className?: string;
};

export type TextFieldProps = CommonProps &
  Omit<React.InputHTMLAttributes<HTMLInputElement>, keyof CommonProps>;

/**
 * Labeled input — emerald focus ring, void field, mono hint. Matches the desk's
 * glass surfaces (no flat grey). Focus ring is opacity/box-shadow only.
 */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, leading, trailing, className, id, ...rest },
  ref
) {
  const auto = useId();
  const fieldId = id ?? auto;
  const invalid = Boolean(error);

  return (
    <div className={clsx("flex min-w-[220px] flex-col gap-1.5", className)}>
      {label && (
        <label
          htmlFor={fieldId}
          className="font-mono text-[10px] uppercase tracking-[0.16em] text-mute"
        >
          {label}
        </label>
      )}
      <div className="relative">
        {leading && (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute">
            {leading}
          </span>
        )}
        <input
          ref={ref}
          id={fieldId}
          aria-invalid={invalid || undefined}
          className={clsx(
            "w-full rounded-xl border bg-void/70 px-3.5 py-3 text-sm text-white",
            "placeholder:text-mute/60 outline-none",
            "transition-[border-color,box-shadow] duration-base ease-snap",
            leading && "pl-10",
            trailing && "pr-10",
            invalid
              ? "border-bear/60 focus:border-bear focus:shadow-[0_0_0_3px_rgba(255,45,85,0.14)]"
              : "border-white/15 focus:border-bull/55 focus:shadow-[0_0_0_3px_rgba(0,230,118,0.14)]",
            "disabled:cursor-not-allowed disabled:opacity-45"
          )}
          {...rest}
        />
        {trailing && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-mute">{trailing}</span>
        )}
      </div>
      {(error || hint) && (
        <p
          className={clsx(
            "font-mono text-[10px] uppercase tracking-[0.12em]",
            invalid ? "text-bear-text" : "text-mute/70"
          )}
        >
          {error || hint}
        </p>
      )}
    </div>
  );
});
