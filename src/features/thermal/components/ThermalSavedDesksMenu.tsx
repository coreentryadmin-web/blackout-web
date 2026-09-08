"use client";

import clsx from "clsx";
import { useCallback, useEffect, useState } from "react";
import type { ThermalComparePresetId } from "@/features/thermal/lib/thermal-compare-presets";
import type { ThermalLens } from "@/features/thermal/lib/thermal-desk-state";
import {
  defaultSavedDeskName,
  deleteThermalSavedDesk,
  listThermalSavedDesks,
  THERMAL_SAVED_DESK_SLOTS,
  upsertThermalSavedDesk,
  type ThermalSavedDesk,
} from "@/features/thermal/lib/thermal-saved-desks";

export type ThermalDeskSnapshot = {
  ticker: string;
  lens: ThermalLens;
  compare: boolean;
  compareSet: ThermalComparePresetId | null;
  expiryScope: string;
  pairView: "pair-a" | "pair-b" | "pair-c" | "pair-d";
};

export function ThermalSavedDesksMenu({
  snapshot,
  onRecall,
  className,
}: {
  snapshot: ThermalDeskSnapshot;
  onRecall: (desk: ThermalSavedDesk) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [desks, setDesks] = useState<ThermalSavedDesk[]>([]);
  const [name, setName] = useState("");

  const refresh = useCallback(() => {
    setDesks(listThermalSavedDesks());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const saveCurrent = () => {
    const label = name.trim() || defaultSavedDeskName(snapshot.ticker, snapshot.lens);
    upsertThermalSavedDesk({
      name: label,
      ticker: snapshot.ticker,
      lens: snapshot.lens,
      compare: snapshot.compare,
      compareSet: snapshot.compareSet,
      expiryScope: snapshot.expiryScope,
      pairView: snapshot.pairView,
    });
    setName("");
    refresh();
    setOpen(false);
  };

  const remove = (id: string) => {
    deleteThermalSavedDesk(id);
    refresh();
  };

  return (
    <div className={clsx("relative", className)} data-thermal-saved-desks>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        className={clsx(
          "rounded-md border border-white/12 px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wider outline-none transition-colors",
          "text-sky-300/80 hover:bg-white/[0.06] hover:text-white focus-visible:ring-2 focus-visible:ring-sky-400"
        )}
        onClick={() => setOpen((v) => !v)}
      >
        Desks {desks.length > 0 ? `· ${desks.length}` : ""}
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1.5 w-[min(18rem,calc(100vw-2rem))] rounded-xl border border-white/12 bg-[#0a0b10] p-2 shadow-xl"
        >
          <p className="mb-2 px-1 font-mono text-[9px] uppercase tracking-[0.18em] text-sky-300/65">
            Save current view
          </p>
          <div className="mb-2 flex gap-1.5">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={defaultSavedDeskName(snapshot.ticker, snapshot.lens)}
              className="min-w-0 flex-1 rounded-md border border-white/12 bg-black/40 px-2 py-1 font-mono text-[11px] text-white outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
              maxLength={32}
            />
            <button
              type="button"
              className="shrink-0 rounded-md bg-sky-500/20 px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-sky-200 outline-none hover:bg-sky-500/30 focus-visible:ring-2 focus-visible:ring-sky-400"
              onClick={saveCurrent}
            >
              Save
            </button>
          </div>

          {desks.length === 0 ? (
            <p className="px-1 py-2 font-mono text-[10px] text-sky-300/60">
              No saved desks yet — up to {THERMAL_SAVED_DESK_SLOTS} layouts per browser.
            </p>
          ) : (
            <ul className="max-h-48 space-y-1 overflow-y-auto">
              {desks.map((d) => (
                <li key={d.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    role="menuitem"
                    className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-left font-mono text-[11px] text-sky-100 outline-none hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-sky-400"
                    onClick={() => {
                      onRecall(d);
                      setOpen(false);
                    }}
                  >
                    <span className="font-bold">{d.name}</span>
                    <span className="mt-0.5 block text-[9px] text-sky-300/60">
                      {d.ticker} · {d.lens.toUpperCase()}
                      {d.compare ? " · grid" : ""}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete saved desk ${d.name}`}
                    className="shrink-0 rounded px-1.5 py-1 font-mono text-[10px] text-sky-300/50 hover:bg-bear/10 hover:text-bear"
                    onClick={() => remove(d.id)}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
