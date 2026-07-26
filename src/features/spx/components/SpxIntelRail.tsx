"use client";

// SPX left-column intel rail host (2026-07-26). Owns the ⚡ Pulse ⇄ Largo commentary TOGGLE
// so the Largo narration is never lost — only demoted from default. Default = Pulse (the
// enhanced live event feed); opt-in = the original Largo commentary rail, byte-for-byte the
// same component and backend. The choice persists per device.
//
// Both rails receive the SAME props (desk / live / focus) and both keep their brain effects
// running while mounted, so switching never drops session context on the visible one. In
// FOCUS mode the toggle chrome hides (each rail renders its own slim strip).

import { useCallback, useEffect, useState } from "react";
import { clsx } from "clsx";

import type { PulseSignal } from "@/features/vector/lib/vector-pulse";
import type { SpxDeskPayload } from "@/lib/api";
import { SpxPulseRail } from "./SpxPulseRail";
import { SpxCommentaryRail } from "./SpxCommentaryRail";

type IntelMode = "pulse" | "commentary";
const STORAGE_KEY = "spx-intel-rail-mode";

export function SpxIntelRail({
  desk,
  live,
  focus,
  onFocusLevel,
}: {
  desk?: SpxDeskPayload;
  live?: boolean;
  focus?: boolean;
  /** Chart-anchor seam — threaded straight to SpxPulseRail so a Pulse "→ chart" click reaches the
   *  embedded Vector chart. Largo (SpxCommentaryRail) has no per-event levels, so it doesn't take it. */
  onFocusLevel?: (level: number, label: string, tone: PulseSignal["tone"]) => void;
}) {
  // Default Pulse; hydrate the persisted choice after mount so SSR markup is deterministic.
  const [mode, setMode] = useState<IntelMode>("pulse");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === "commentary" || saved === "pulse") setMode(saved);
    } catch {
      /* storage unavailable — keep default */
    }
  }, []);
  const choose = useCallback((next: IntelMode) => {
    setMode(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* best-effort persistence */
    }
  }, []);

  // Focus mode: no toggle chrome — the active rail renders its own vertical strip.
  if (focus) {
    return mode === "commentary" ? (
      <SpxCommentaryRail desk={desk} live={live} focus />
    ) : (
      <SpxPulseRail desk={desk} live={live} focus onFocusLevel={onFocusLevel} />
    );
  }

  return (
    <div className="spx-intel-rail-host">
      <div className="spx-intel-rail-toggle" role="tablist" aria-label="Intel rail mode">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "pulse"}
          className={clsx("spx-intel-rail-tab", mode === "pulse" && "spx-intel-rail-tab--active")}
          onClick={() => choose("pulse")}
        >
          ⚡ Pulse
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "commentary"}
          className={clsx("spx-intel-rail-tab", mode === "commentary" && "spx-intel-rail-tab--active")}
          onClick={() => choose("commentary")}
        >
          Largo
        </button>
      </div>
      {mode === "commentary" ? (
        <SpxCommentaryRail desk={desk} live={live} focus={focus} />
      ) : (
        <SpxPulseRail desk={desk} live={live} focus={focus} onFocusLevel={onFocusLevel} />
      )}
    </div>
  );
}
