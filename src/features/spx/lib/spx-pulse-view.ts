// Pure presentation mapping for the SPX Pulse rail — kept out of the component so the
// "color by type" contract is unit-testable and can't drift between the rail and its tests.

import type { PulseSignalKind, PulseSignal } from "@/features/vector/lib/vector-pulse";
import { signalTier } from "@/features/vector/lib/vector-pulse";

/** Filter buckets shown as chips. `session` has no chip — it only appears under "All". */
export type SpxPulseCategory = "regime" | "walls" | "flow" | "macro" | "plays" | "session";

export type SpxPulseKindView = {
  /** Short badge label. */
  badge: string;
  /** Emoji icon. */
  icon: string;
  /** CSS accent colour (used as a custom property on the row). */
  color: string;
  /** Which filter chip this kind belongs to. */
  category: SpxPulseCategory;
};

// COLOR BY TYPE (per spec): regime=amber, walls=blue, pin/magnet=purple, flow=cyan,
// vol=orange, macro=red, play=green. Session phase = slate (context-only, no chip).
export const SPX_PULSE_KIND_VIEW: Record<PulseSignalKind, SpxPulseKindView> = {
  "regime-flip": { badge: "REGIME", icon: "⚡", color: "#fbbf24", category: "regime" }, // amber
  "vol-regime": { badge: "VOL", icon: "🌊", color: "#fb923c", category: "regime" }, // orange
  "wall-break": { badge: "WALL BREAK", icon: "🧱", color: "#38bdf8", category: "walls" }, // blue
  "wall-build": { badge: "WALL", icon: "🧱", color: "#38bdf8", category: "walls" }, // blue
  "magnet-shift": { badge: "MAGNET", icon: "🧲", color: "#a78bfa", category: "walls" }, // purple
  "pin-shift": { badge: "PIN", icon: "📌", color: "#a78bfa", category: "walls" }, // purple
  "flow-print": { badge: "FLOW", icon: "💵", color: "#22d3ee", category: "flow" }, // cyan
  "macro-window": { badge: "MACRO", icon: "📅", color: "#f87171", category: "macro" }, // red
  "play-state": { badge: "PLAY", icon: "🎯", color: "#34d399", category: "plays" }, // green
  "session-phase": { badge: "SESSION", icon: "🕐", color: "#94a3b8", category: "session" }, // slate
  // Vector-only kinds — never emitted on the SPX rail, but the map must be total.
  proximity: { badge: "PROX", icon: "🎯", color: "#22d3ee", category: "walls" },
  integrity: { badge: "INTEGRITY", icon: "◈", color: "#38bdf8", category: "walls" },
  "wall-structure": { badge: "WALL", icon: "🧱", color: "#38bdf8", category: "walls" },
};

export function kindView(kind: PulseSignalKind): SpxPulseKindView {
  return SPX_PULSE_KIND_VIEW[kind] ?? SPX_PULSE_KIND_VIEW["session-phase"];
}

export type SpxPulseFilter = "all" | SpxPulseCategory;

/** The chips rendered in the header, in order. `all` first; `session` has no chip. */
export const SPX_PULSE_FILTERS: Array<{ id: SpxPulseFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "regime", label: "Regime" },
  { id: "walls", label: "Walls" },
  { id: "flow", label: "Flow" },
  { id: "macro", label: "Macro" },
  { id: "plays", label: "Plays" },
];

/** Does a signal pass the active filter? "All" passes everything. */
export function signalPassesFilter(sig: PulseSignal, filter: SpxPulseFilter): boolean {
  if (filter === "all") return true;
  return kindView(sig.kind).category === filter;
}

/** Split a feed into pinned (Tier-1) and stream, each preserving the caller's order. Generic
 *  so the rail's `FeedItem` (PulseSignal + id) keeps its id through the split. */
export function orderPulseFeed<T extends PulseSignal>(feed: T[]): { pinned: T[]; stream: T[] } {
  const pinned: T[] = [];
  const stream: T[] = [];
  for (const s of feed) {
    if (signalTier(s) === 1) pinned.push(s);
    else stream.push(s);
  }
  return { pinned, stream };
}
