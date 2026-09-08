import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";

/** Format a market-internal reading with an honest 'est.' suffix when proxy-derived. */
export function formatInternalReading(
  value: number | null | undefined,
  estimated: boolean | undefined,
  decimals = 0
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const base = value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return estimated ? `${base} est.` : base;
}

export function internalEstimatedTip(field: "tick" | "trin" | "add"): string {
  const names = { tick: "NYSE TICK", trin: "TRIN", add: "advance/decline" };
  return `${names[field]} is breadth-derived (estimated) — Polygon returned no live ${field === "add" ? "I:ADD" : `I:${field.toUpperCase()}`} print.`;
}

export function deskInternalsEstimated(desk?: SpxDeskPayload): {
  tick: boolean;
  trin: boolean;
  add: boolean;
} {
  return {
    tick: Boolean(desk?.internals_estimated?.tick),
    trin: Boolean(desk?.internals_estimated?.trin),
    add: Boolean(desk?.internals_estimated?.add),
  };
}

export function anyInternalsEstimated(desk?: SpxDeskPayload): boolean {
  const e = desk?.internals_estimated;
  return Boolean(e?.tick || e?.trin || e?.add);
}
