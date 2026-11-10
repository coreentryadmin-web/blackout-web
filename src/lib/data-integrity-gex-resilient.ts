// Pure retry helper for RTH data-integrity GEX cache reads (no server-only gate — unit-tested).

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Polygon circuit-open / cache-miss blips can return null once; retry before paging RTH CI. */
export async function retryGexPositioningRead<T>(
  ticker: string,
  read: (t: string) => Promise<T | null>,
  opts: {
    attempts?: number;
    baseDelayMs?: number;
    sleepMs?: (ms: number) => Promise<void>;
  } = {}
): Promise<T | null> {
  const attempts = opts.attempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 1200;
  const wait = opts.sleepMs ?? defaultSleep;
  let last: T | null = null;
  for (let i = 0; i < attempts; i++) {
    last = await read(ticker);
    if (last) return last;
    if (i + 1 < attempts) await wait(baseDelayMs * (i + 1));
  }
  return last;
}
