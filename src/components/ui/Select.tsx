"use client";

import { useEffect, useId, useRef, useState } from "react";
import { clsx } from "clsx";

export type SelectOption = {
  value: string;
  label: React.ReactNode;
  /** Optional accent dot (hex or token color). */
  dot?: string;
  disabled?: boolean;
};

export type SelectProps = {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  label?: React.ReactNode;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Menu width — matches the trigger by default. */
  id?: string;
};

/**
 * Accessible dropdown select — glass menu, emerald focus ring, keyboard driven
 * (↑/↓/Home/End/Enter/Esc), click-outside + Escape close. Purely presentational
 * state; the caller owns `value`. Motion is transform/opacity only and collapses
 * under reduced-motion via the global duration tokens.
 */
export function Select({
  options,
  value,
  onChange,
  label,
  placeholder = "Select…",
  disabled,
  className,
  id,
}: SelectProps) {
  const auto = useId();
  const btnId = id ?? auto;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(() => Math.max(0, options.findIndex((o) => o.value === value)));
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const commit = (i: number) => {
    const opt = options[i];
    if (!opt || opt.disabled) return;
    onChange(opt.value);
    setOpen(false);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === "Escape") { setOpen(false); return; }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (open) commit(active);
      else setOpen(true);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      const dir = e.key === "ArrowDown" ? 1 : -1;
      let next = active;
      for (let n = 0; n < options.length; n++) {
        next = (next + dir + options.length) % options.length;
        if (!options[next]?.disabled) break;
      }
      setActive(next);
    }
    if (e.key === "Home") { e.preventDefault(); setActive(0); }
    if (e.key === "End") { e.preventDefault(); setActive(options.length - 1); }
  };

  return (
    <div className={clsx("flex min-w-[220px] flex-col gap-1.5", className)}>
      {label && (
        <label htmlFor={btnId} className="font-mono text-[10px] uppercase tracking-[0.16em] text-mute">
          {label}
        </label>
      )}
      <div ref={rootRef} className="relative">
        <button
          id={btnId}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${btnId}-list`}
          aria-haspopup="listbox"
          disabled={disabled}
          onClick={() => !disabled && setOpen((o) => !o)}
          onKeyDown={onKey}
          className={clsx(
            "flex w-full items-center justify-between gap-2.5 rounded-xl border bg-void/70 px-3.5 py-3 text-sm text-white",
            "transition-[border-color,box-shadow] duration-base ease-snap",
            "focus-visible:outline-none",
            open
              ? "border-bull/55 shadow-[0_0_0_3px_rgba(0,230,118,0.14)]"
              : "border-white/15 hover:border-white/25",
            "disabled:cursor-not-allowed disabled:opacity-45"
          )}
        >
          <span className={clsx("flex items-center gap-2.5 truncate", !selected && "text-mute/60")}>
            {selected?.dot && (
              <span className="size-2 shrink-0 rounded-full" style={{ background: selected.dot }} />
            )}
            {selected ? selected.label : placeholder}
          </span>
          <svg
            width="12" height="12" viewBox="0 0 12 12" aria-hidden
            className={clsx("shrink-0 text-mute transition-transform duration-base ease-snap", open && "rotate-180")}
          >
            <path d="M2.5 4.5L6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <div
          id={`${btnId}-list`}
          role="listbox"
          aria-activedescendant={open ? `${btnId}-opt-${active}` : undefined}
          className={clsx(
            "absolute inset-x-0 top-[calc(100%+8px)] z-20 rounded-xl border border-white/13 bg-[#121A25] p-1.5",
            "shadow-[0_30px_70px_-20px_rgba(0,0,0,0.8)]",
            "origin-top transition duration-base ease-draw",
            open ? "pointer-events-auto opacity-100 translate-y-0 scale-100" : "pointer-events-none opacity-0 -translate-y-2 scale-[0.98]"
          )}
        >
          {options.map((opt, i) => {
            const isSel = opt.value === value;
            return (
              // Keyboard is driven at the combobox (onKey → Enter commits the active option) per the
              // aria-activedescendant listbox pattern; a per-option key handler would double-fire.
              // eslint-disable-next-line jsx-a11y/click-events-have-key-events
              <div
                key={opt.value}
                id={`${btnId}-opt-${i}`}
                role="option"
                tabIndex={-1}
                aria-selected={isSel}
                aria-disabled={opt.disabled || undefined}
                onMouseEnter={() => setActive(i)}
                onClick={() => commit(i)}
                className={clsx(
                  "flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2.5 text-[13.5px]",
                  opt.disabled && "cursor-not-allowed opacity-40",
                  i === active && !opt.disabled && "bg-white/5",
                  isSel ? "text-bull" : "text-white"
                )}
              >
                {opt.dot && <span className="size-2 shrink-0 rounded-full" style={{ background: opt.dot }} />}
                <span className="truncate">{opt.label}</span>
                {isSel && <span className="ml-auto text-bull">✓</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
