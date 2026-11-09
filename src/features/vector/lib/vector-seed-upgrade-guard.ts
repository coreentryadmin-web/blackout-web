/**
 * Pure guard for the Vector desk's two-phase client bootstrap (`VectorPageClient.tsx`): a fast
 * rail-bootstrap seed renders first, then `fetchVectorClientSeed` is called to upgrade it with
 * the fuller, gap-filled wall history.
 *
 * `fetchVectorClientSeed` (vector-client-seed.ts) never rejects — every one of its internal
 * fetches goes through `fetchJson`, which swallows a network/parse failure and resolves `null`
 * rather than throwing:
 *
 * ```ts
 * async function fetchJson<T>(url: string): Promise<T | null> {
 *   try {
 *     const res = await fetch(url, { cache: "no-store" });
 *     if (!res.ok) return null;
 *     return (await res.json()) as T;
 *   } catch {
 *     return null;
 *   }
 * }
 * ```
 *
 * So a transient failure on just the phase-2 bars fetch (a 500, a timeout, an ALB blip — nothing
 * wrong with the phase-1 fast seed, which already succeeded and is on screen) makes the full seed
 * resolve with `initialBars: []` (the `barsPayload?.bars ?? []` null-coalesce in
 * `fetchVectorClientSeed`), not reject. Before this guard existed, `VectorPageClient.tsx` called
 * `setSeed(full)` UNCONDITIONALLY once the full seed resolved — replacing a chart that was
 * already correctly showing real bars (from the fast seed) with an empty one, on a fetch that has
 * nothing to do with the bars already on screen. A member has no way to distinguish that from
 * "this ticker genuinely has no bars right now" (which never happens once a session exists).
 *
 * Same root cause, and the same fix shape, as `shouldAdoptFullVectorSeed`'s sibling regression in
 * `SpxVectorEmbed.tsx` (the SPX Slayer embed) — `VectorPageClient.tsx` runs the identical
 * fast-seed-then-full-seed-upgrade sequence on the same `setSeed` state, so it carries the exact
 * same defect independently. Kept as its own small module (rather than folded into
 * `vector-client-seed.ts`) purely to keep this fix's diff minimal and self-contained.
 */
export function shouldAdoptFullVectorPageSeed(fastBarsCount: number, fullBarsCount: number): boolean {
  // Adopt whenever the upgrade genuinely carries bars, OR when the fast seed never had any bars
  // to protect in the first place (e.g. a genuinely pre-open session) — in that case the full
  // seed's other fields (wall history, gamma flip, etc.) should still be allowed to land.
  return fullBarsCount > 0 || fastBarsCount === 0;
}
