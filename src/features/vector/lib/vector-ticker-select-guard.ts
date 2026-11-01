/**
 * Runs one generation-guarded ticker-select fetch. Extracted into its own pure module (no React,
 * no JSX) so the race it closes is directly unit-testable — see vector-ticker-select-guard.test.ts
 * for a fake-fetcher race that resolves out of order.
 *
 * Mirrors ContractDrilldownDrawer.tsx's own `runGenerationGuardedLoad` (same race, same fix shape,
 * round 231) and TickerDrawer.tsx's `loadGenerationRef` ("Bug 13"): `VectorPageClient`'s
 * `onTickerSelect` used to fetch-then-`setSeed` with no protection against out-of-order
 * resolution. Clicking ticker A in the scanner/comparison strip (`navigateTicker` →
 * `onTickerSelect("A")`) starts a fetch for A; clicking ticker B before A's fetch resolves starts a
 * second fetch for B — both calls were guarded only by `next === seed.ticker`, which reads the SAME
 * still-stale `seed` state for both clicks (neither has resolved yet), so neither call blocks the
 * other. Network timing, not click order, then decided which `setSeed` applied last — if A's
 * response arrived after B's, the desk URL/header would read ticker B while the chart/walls/bars
 * underneath were still ticker A's.
 */
export async function runTickerSelectGuardedLoad<T>(
  generation: number,
  currentGeneration: () => number,
  fetcher: () => Promise<T>,
  handlers: { onSuccess: (data: T) => void; onSettle: () => void }
): Promise<void> {
  try {
    const data = await fetcher();
    if (generation !== currentGeneration()) return;
    handlers.onSuccess(data);
  } finally {
    if (generation === currentGeneration()) handlers.onSettle();
  }
}
