/**
 * Pure helpers for data-integrity GEX freshness (C6) — kept server-agnostic for unit tests.
 */

/** Null GEX during RTH is only incident-worthy when the Polygon circuit is not open. */
export function shouldFlagGexColdDuringRth(
  pos: unknown,
  polygonCircuitOpen: boolean
): boolean {
  return !pos && !polygonCircuitOpen;
}
