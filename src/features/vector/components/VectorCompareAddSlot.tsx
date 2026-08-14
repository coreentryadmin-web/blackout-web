"use client";

import { useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { vectorUniverseTickers } from "@/lib/heatmap-allowlist";
import { isVectorTickerAllowed, normalizeVectorTicker } from "@/features/vector/lib/vector-ticker";

const PRESETS = vectorUniverseTickers();

type Props = {
  onPick: (ticker: string) => void;
  exclude: Set<string>;
  disabled?: boolean;
};

/** Inline symbol search for an empty compare slot. */
export function VectorCompareAddSlot({ onPick, exclude, disabled }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const typed = query.trim().toUpperCase();

  const options = useMemo(() => {
    const matches = typed ? PRESETS.filter((t) => t.startsWith(typed) && !exclude.has(t)) : PRESETS.filter((t) => !exclude.has(t));
    const extra =
      typed && isVectorTickerAllowed(typed) && !PRESETS.includes(typed) && !exclude.has(typed) ? [typed] : [];
    return [...extra, ...matches].slice(0, 8);
  }, [typed, exclude]);

  const go = (raw: string) => {
    if (!isVectorTickerAllowed(raw)) return;
    const next = normalizeVectorTicker(raw);
    if (exclude.has(next)) return;
    setOpen(false);
    setQuery("");
    onPick(next);
  };

  return (
    <div className="vector-compare-add-slot">
      <div className="vector-compare-add-slot-icon" aria-hidden="true">
        +
      </div>
      <p className="vector-compare-add-slot-title">Add symbol</p>
      <p className="vector-compare-add-slot-hint">Search any optionable ticker</p>
      <div
        className="vector-compare-add-search"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <input
          ref={inputRef}
          type="text"
          inputMode="text"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={8}
          disabled={disabled}
          placeholder="e.g. NVDA"
          aria-label="Add compare symbol"
          data-testid="vector-compare-add-search"
          className="vector-compare-add-input"
          value={query}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onChange={(e) => {
            setQuery(e.target.value.toUpperCase());
            setOpen(true);
            setHighlight(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setHighlight((h) => Math.min(h + 1, options.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlight((h) => Math.max(h - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              go(options[highlight] ?? typed);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
        />
        {open && options.length > 0 ? (
          <ul className="vector-compare-add-menu" role="listbox">
            {options.map((opt, i) => (
              <li key={opt} role="option" aria-selected={i === highlight}>
                <button
                  type="button"
                  className={clsx("vector-compare-add-opt", i === highlight && "is-active")}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    go(opt);
                  }}
                >
                  {opt}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
