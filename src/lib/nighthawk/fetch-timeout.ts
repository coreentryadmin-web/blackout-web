/** Race a fetch against a deadline — slow providers return fallback instead of blocking the dossier. */
export function withFetchTimeout<T>(promise: Promise<T>, fallback: T, ms = 8000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

export function dossierFetch<T>(fn: () => Promise<T>, fallback: T, ms = 8000): Promise<T> {
  return withFetchTimeout(fn().catch(() => fallback), fallback, ms);
}
