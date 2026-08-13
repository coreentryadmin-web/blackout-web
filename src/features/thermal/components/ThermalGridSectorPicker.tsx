"use client";

import { useEffect, useId, useRef, useState } from "react";
import { clsx } from "clsx";
import {
  THERMAL_COMPARE_PRESETS,
  type ThermalComparePresetId,
} from "@/features/thermal/lib/thermal-compare-presets";

type Props = {
  value: ThermalComparePresetId;
  onChange: (id: ThermalComparePresetId) => void;
  compact?: boolean;
  nativeShell?: boolean;
  className?: string;
};

/** Desk-native sector picker — custom menu (native `<select>` options render unreadable on dark UI). */
export function ThermalGridSectorPicker({
  value,
  onChange,
  compact = false,
  nativeShell = false,
  className,
}: Props) {
  const btnId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(() =>
    Math.max(0, THERMAL_COMPARE_PRESETS.findIndex((p) => p.id === value)),
  );

  const current = THERMAL_COMPARE_PRESETS.find((p) => p.id === value)?.label ?? value;

  useEffect(() => {
    setActive(Math.max(0, THERMAL_COMPARE_PRESETS.findIndex((p) => p.id === value)));
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const commit = (id: ThermalComparePresetId) => {
    onChange(id);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (open) {
        const opt = THERMAL_COMPARE_PRESETS[active];
        if (opt) commit(opt.id);
      } else {
        setOpen(true);
      }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const dir = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + dir + THERMAL_COMPARE_PRESETS.length) % THERMAL_COMPARE_PRESETS.length);
    }
    if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    }
    if (e.key === "End") {
      e.preventDefault();
      setActive(THERMAL_COMPARE_PRESETS.length - 1);
    }
  };

  return (
    <div
      ref={rootRef}
      className={clsx(
        "thermal-grid-sector-picker",
        compact && "thermal-grid-sector-picker--compact",
        nativeShell && "thermal-grid-sector-picker--native",
        open && "is-open",
        className,
      )}
    >
      <button
        type="button"
        id={btnId}
        role="combobox"
        aria-expanded={open}
        aria-controls={`${btnId}-menu`}
        aria-label="Sector compare preset"
        className="thermal-grid-sector-picker-trigger"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKeyDown}
      >
        <span className="thermal-grid-sector-picker-value">{current}</span>
        <span className={clsx("thermal-grid-sector-picker-chevron", open && "is-open")} aria-hidden>
          ▾
        </span>
      </button>

      <ul
        id={`${btnId}-menu`}
        role="listbox"
        aria-labelledby={btnId}
        className={clsx("thermal-grid-sector-menu", open && "is-open")}
      >
        {THERMAL_COMPARE_PRESETS.map((p, i) => {
          const selected = p.id === value;
          const highlighted = i === active;
          return (
            <li key={p.id} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={selected}
                className={clsx(
                  "thermal-grid-sector-option",
                  selected && "is-selected",
                  highlighted && "is-active",
                )}
                onMouseEnter={() => setActive(i)}
                onClick={() => commit(p.id)}
              >
                {p.label}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
