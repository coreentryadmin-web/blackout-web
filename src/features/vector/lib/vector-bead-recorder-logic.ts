/** Wall bead trail sample cadence — every ticker in the shared universe, viewer or not. */
export const VECTOR_BEAD_RECORD_TICK_MS = 5_000;

/** Parallel heatmap reads per tick (Polygon cache-first; tune via env on prod). */
export function vectorBeadRecordConcurrency(): number {
  const raw = process.env.VECTOR_BEAD_RECORD_CONCURRENCY?.trim();
  const n = raw ? Number(raw) : 25;
  return Number.isFinite(n) && n >= 1 ? Math.min(50, Math.floor(n)) : 25;
}

/** Process tickers in fixed-size chunks — pure helper for tests + recorder. */
export async function mapInChunks<T, R>(
  items: T[],
  chunkSize: number,
  fn: (item: T) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = [];
  const size = Math.max(1, chunkSize);
  for (let i = 0; i < items.length; i += size) {
    const chunk = items.slice(i, i + size);
    const chunkResults = await Promise.allSettled(chunk.map(fn));
    out.push(...chunkResults);
  }
  return out;
}
