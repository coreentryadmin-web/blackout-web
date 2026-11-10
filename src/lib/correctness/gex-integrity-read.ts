/** Retry wrapper for RTH data-integrity GEX cache reads (no server-only deps — unit-testable). */

export const GEX_INTEGRITY_READ_ATTEMPTS = 3;
export const GEX_INTEGRITY_READ_DELAY_MS = 3_500;

export async function readGexPositioningWithRetryForIntegrity<T>(
  ticker: string,
  read: (t: string) => Promise<T | null>
): Promise<T | null> {
  for (let attempt = 1; attempt <= GEX_INTEGRITY_READ_ATTEMPTS; attempt++) {
    const pos = await read(ticker).catch(() => null);
    if (pos) return pos;
    if (attempt < GEX_INTEGRITY_READ_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, GEX_INTEGRITY_READ_DELAY_MS));
    }
  }
  return null;
}
