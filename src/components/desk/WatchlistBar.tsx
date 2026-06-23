"use client";

import { AnimatePresence, motion } from "framer-motion";
import { clsx } from "clsx";

// Compact starred-ticker rail. Click a chip to filter the tape; click × to unstar.
// Palette: yellow-300 / sky-300 / cyan-400 / white only (no grey).
export function WatchlistBar({
  watchlist,
  activeTicker,
  onSelect,
  onRemove,
  onClear,
}: {
  watchlist: string[];
  /** currently-applied tickerFilter, for highlighting the active chip */
  activeTicker?: string;
  onSelect: (ticker: string) => void;
  onRemove: (ticker: string) => void;
  onClear: () => void;
}) {
  if (watchlist.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="font-mono text-[9px] tracking-[0.3em] uppercase font-bold text-yellow-300 hidden sm:block">
        ★ Watchlist
      </span>
      <AnimatePresence initial={false}>
        {watchlist.map((t) => {
          const active = activeTicker && activeTicker.toUpperCase() === t;
          return (
            <motion.div
              key={t}
              layout
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85 }}
              className={clsx(
                "flex items-center gap-1 rounded-md border px-2 py-[3px] font-mono text-[10px] font-bold transition-colors",
                active
                  ? "border-yellow-400/70 bg-yellow-950/30 text-yellow-300"
                  : "border-cyan-800/40 bg-cyan-950/15 text-sky-300 hover:border-cyan-600/60 hover:text-white"
              )}
            >
              <button type="button" onClick={() => onSelect(t)} className="tracking-widest">
                {t}
              </button>
              <button
                type="button"
                onClick={() => onRemove(t)}
                title={`Remove ${t} from watchlist`}
                className="text-cyan-400 hover:text-white leading-none"
              >
                ×
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
      <button
        type="button"
        onClick={onClear}
        className="font-mono text-[9px] text-cyan-400 hover:text-white underline-offset-2 hover:underline ml-1"
      >
        clear
      </button>
    </div>
  );
}
