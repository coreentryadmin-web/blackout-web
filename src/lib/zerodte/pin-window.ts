// The PIN lane's own trading window — extracted PURE so it can be read (and tested) without
// dragging in the whole-universe GEX provider graph.
//
// `pin-discovery.ts` transitively imports `server-only`, so anything that needs to reason about the
// pin window from outside a server component — the scan orchestrator's provenance bookkeeping, and
// this module's unit tests — cannot import it from there. These constants are DEFINED here and
// imported by pin-discovery, so there is exactly one source of truth for the window.

/** Directional PIN window in ET minutes-since-midnight: [9:30, 15:30) — same gate as BREAKOUT /
 *  NEW_PLAY_CUTOFF / G-14. */
export const PIN_RTH_OPEN_ET_MINUTES = 9 * 60 + 30;
export const PIN_RTH_CUTOFF_ET_MINUTES = 15 * 60 + 30;
/** Stop hunting new condors after the directional commit cutoff (3:30 PM ET). */
export const PIN_CONDOR_LATE_CUTOFF_ET_MINUTES = 15 * 60 + 30;

/**
 * Is the PIN lane inside its own window at `nowEtMinutes`?
 *
 * WHY THIS IS EXPORTED: `discoverPinSetups` returns a bare `EnrichedZeroDteSetup[]`, so "ran and
 * found no qualifying pins" and "was outside its own window" are the SAME empty array. A caller
 * recording lane provenance must be able to tell them apart — reporting the 8am zero as a market
 * read would fabricate a "no pins qualified" verdict nobody measured.
 */
export function pinWindowStatus(nowEtMinutes: number): "open" | "off_hours" {
  if (nowEtMinutes < PIN_RTH_OPEN_ET_MINUTES) return "off_hours";
  if (nowEtMinutes >= PIN_CONDOR_LATE_CUTOFF_ET_MINUTES) return "off_hours";
  return "open";
}
