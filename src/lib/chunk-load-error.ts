/**
 * Self-heal for the classic Next.js/webpack `ChunkLoadError`: a client that loaded its HTML from
 * one ECS task hits a JS chunk whose content-hashed filename rotated because a newer deploy
 * replaced that task mid-request. The chunk genuinely 404s (or the edge/LB serves the new task's
 * error page for it, wrong MIME type, refused by the browser) — nothing is broken about the
 * deployed code, the client is just holding a manifest from a build that's no longer being served.
 * A hard reload re-fetches the current HTML with the current chunk manifest and clears it.
 *
 * Reproduced live 2026-08-24: `/heatmap` crashed to `global-error.tsx`'s full "CRITICAL ERROR"
 * screen (2 of 4 attempts) during a window with an in-progress production deploy
 * (`ecr-push-production.yml`) plus several rapid cancelled runs immediately before it — exactly
 * the fast-merge-queue rollout pattern this repo's CLAUDE.md already documents elsewhere as a
 * source of narrow, real timing windows. The console carried
 * `ChunkLoadError: Loading chunk 6750 failed.` A retry with no deploy in flight loaded cleanly.
 */

/**
 * True for the browser's own ChunkLoadError — not every failed-to-load error. A wrong URL or a
 * genuinely deleted route should never trigger an auto-reload loop, only the specific stale-chunk
 * symptom this file exists to self-heal.
 */
export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "ChunkLoadError" || /Loading chunk [\w-]+ failed/i.test(error.message);
}

const RELOAD_GUARD_KEY = "bo-chunk-error-reload-attempted";

type ReloadableWindow = {
  sessionStorage: Pick<Storage, "getItem" | "setItem">;
  location: Pick<Location, "reload">;
};

/**
 * One-shot self-heal: reload the page once if this is a stale-chunk error. Guarded by
 * sessionStorage so a genuinely broken deploy (or a chunk that's gone for good) shows the normal
 * error UI on the second attempt instead of reload-looping forever — the manual "Try again"
 * button in the caller stays the fallback either way.
 *
 * `win` is injectable (defaults to the real `window`) so the reload decision is testable without
 * a DOM — this repo has no jsdom/testing-library harness (see CLAUDE.md / other test files' own
 * notes on that), so a real `window` isn't available under `node --test`.
 */
export function autoReloadOnceOnChunkError(
  error: unknown,
  win: ReloadableWindow | undefined = typeof window === "undefined" ? undefined : window
): void {
  if (!win || !isChunkLoadError(error)) return;
  try {
    if (win.sessionStorage.getItem(RELOAD_GUARD_KEY)) return;
    win.sessionStorage.setItem(RELOAD_GUARD_KEY, "1");
  } catch {
    return; // private mode / storage disabled — skip the auto-reload, the manual button still works
  }
  win.location.reload();
}
