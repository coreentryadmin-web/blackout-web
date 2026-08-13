import type { GexDepthBlock } from "@/lib/providers/polygon-options-gex";

/** Wire key for a member-selected expiry scope (single date or sorted multi-expiry join). */
export function depthScopeKey(selectedExpiries: readonly string[] | null | undefined): string | null {
  if (!selectedExpiries?.length) return null;
  if (selectedExpiries.length === 1) return selectedExpiries[0]!;
  return [...selectedExpiries].sort().join("|");
}

/** Pick the forced-flow ladder for the active expiry scope; fall back to near-term aggregate. */
export function resolveDepthForScope(
  depth: GexDepthBlock | undefined,
  depthByScope: Record<string, GexDepthBlock> | undefined,
  selectedExpiries: string[] | null,
): GexDepthBlock | undefined {
  if (!depth?.levels?.length) return undefined;
  const key = depthScopeKey(selectedExpiries);
  if (!key) return depth;
  const scoped = depthByScope?.[key];
  if (scoped?.levels?.length) return scoped;
  return depth;
}

/** True when the member narrowed scope but only the near-term aggregate ladder is available. */
export function depthScopeUsesNearTermFallback(
  depthByScope: Record<string, GexDepthBlock> | undefined,
  selectedExpiries: string[] | null,
): boolean {
  if (!selectedExpiries?.length) return false;
  const key = depthScopeKey(selectedExpiries);
  if (!key) return false;
  return !(depthByScope?.[key]?.levels?.length);
}
