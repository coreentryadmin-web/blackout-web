/**
 * Per-source timeout race for the swing play-brief's context loader.
 *
 * Extracted into its own dependency-free file (mirrors src/lib/sse-safe-tick.ts's reasoning) so
 * it stays importable from a plain `tsx --test` file — play-brief-context.ts pulls in
 * `@/lib/db` and the Vector/ecosystem BIE readers, several of which transitively hit
 * `import "server-only"`, which throws outside Next's RSC compiler.
 *
 * Same race-against-a-timer shape as `withSourceTimeout` in nighthawk/cortex/fetch.ts, kept as a
 * separate small helper rather than imported from there — that module's import graph has nothing
 * to do with swing.
 */

export const BRIEF_SOURCE_TIMEOUT_MS = 8_000;

export function withBriefSourceTimeout<T>(p: Promise<T>, ms: number = BRIEF_SOURCE_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error(`brief source read exceeded ${ms}ms`);
      err.name = "SwingBriefSourceTimeout";
      reject(err);
    }, ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
