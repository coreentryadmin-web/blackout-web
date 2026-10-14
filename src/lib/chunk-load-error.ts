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
 *
 * **Reconciled 2026-10-14 with the OLDER, canonical `src/lib/chunk-reload.ts` guard** (the inline
 * `<head>` script in `app/layout.tsx`, shipped 2026-07-17 — over a month before this file, 2862).
 * That mechanism already solved a problem this file's original one-shot design re-introduced: its
 * sessionStorage counter is keyed off the CURRENT BUILD ID (read from the page's own
 * `<script src="/_next/static/<buildId>/...">` tag) and resets every time a fresh build loads, so
 * a member can self-heal through MULTIPLE independent chunk incidents across a session (e.g.
 * navigating Desk A, which self-heals, then later Desk B, hit by a second, later deploy). This
 * file's guard was a bare "have I EVER reloaded in this tab" flag that, once set, stayed set for
 * the rest of the tab's life — found while investigating whether "a session opened before a
 * deployment can still navigate between desks afterward": it can, for the FIRST chunk failure in
 * the tab, but a SECOND, unrelated chunk failure later in the same tab (a different desk, a later
 * deploy) silently stopped self-healing and fell through to the manual "Try again" dead end,
 * because nothing ever cleared `RELOAD_GUARD_KEY` — the exact failure mode `chunk-reload.ts`'s
 * build-id reset was already designed to prevent, just not shared with this file's own guard. Now
 * scoped the same way: the guard value records WHICH build id it last self-healed for, so a fresh
 * build (any later chunk failure after a NEW deploy's HTML has loaded) earns its own one-shot
 * attempt instead of inheriting a stale "already tried" flag from a completely unrelated incident.
 * Also widened to the shared `CHUNK_ERROR_PATTERN_SOURCE` (`isChunkLoadErrorMessage`) so this
 * layer recognizes the same failure set the canonical guard does (CSS-chunk 404s, a failed dynamic
 * `import()`, a MIME-refused script/style, a stale Server Action id) rather than only the bare
 * `ChunkLoadError`/"Loading chunk N failed" subset — a React error boundary can be the ONLY thing
 * that sees one of these (e.g. a rejected `next/dynamic` loader surfaces as a render-phase throw,
 * never an `unhandledrejection` the inline script's listener would catch), so under-matching here
 * meant some of those genuinely missed a self-heal entirely, not just a slower one.
 */

import { isChunkLoadErrorMessage } from "./chunk-reload";

/**
 * True for the browser's own ChunkLoadError (or a sibling deploy-skew failure — see
 * `CHUNK_ERROR_PATTERN_SOURCE`) — not every failed-to-load error. A wrong URL or a genuinely
 * deleted route should never trigger an auto-reload loop, only the specific stale-chunk/stale-
 * build symptom this file exists to self-heal.
 */
export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "ChunkLoadError" || isChunkLoadErrorMessage(error.message);
}

const RELOAD_GUARD_KEY = "bo-chunk-error-reload-attempted";

type ReloadableWindow = {
  sessionStorage: Pick<Storage, "getItem" | "setItem">;
  location: Pick<Location, "reload">;
  /** Optional: used to scope the reload guard to the build id that was live when it fired. */
  document?: Pick<Document, "querySelector">;
};

/**
 * Reads the build id the CURRENT document is actually running, the same way `chunk-reload.ts`'s
 * inline script does: off the content-hashed `/_next/static/<buildId>/...` path of one of the
 * page's own script tags. Returns "" (never throws) when it can't be determined — a test
 * environment with no injected `document`, or a real page whose script tags don't match for some
 * reason — and the caller falls back to the pre-fix "once ever" behavior in that case, which is
 * the conservative choice (never worse than before this fix).
 */
function currentBuildId(win: ReloadableWindow): string {
  try {
    const doc = win.document;
    if (!doc) return "";
    const script = doc.querySelector('script[src*="/_next/static/"]') as { src?: unknown } | null;
    const src = typeof script?.src === "string" ? script.src : "";
    const match = /\/_next\/static\/([^/]+)\//.exec(src);
    return match ? match[1] : "";
  } catch {
    return "";
  }
}

/**
 * Self-heal: reload the page once per observed build id if this is a stale-chunk/stale-build
 * error. Guarded by sessionStorage, scoped to the current build id (see `currentBuildId` above),
 * so a genuinely broken deploy (same build, reload didn't fix it) still shows the normal error UI
 * on a second attempt instead of reload-looping forever — but a LATER, unrelated chunk failure
 * that happens once a newer build has actually loaded gets its own fresh one-shot attempt, rather
 * than inheriting a flag some earlier, unrelated incident already spent. The manual "Try again"
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
  const buildId = currentBuildId(win);
  try {
    const stored = win.sessionStorage.getItem(RELOAD_GUARD_KEY);
    // No build id signal available (test env, or a page whose markup doesn't match): fall back to
    // the original "have we ever reloaded in this tab" guard rather than guessing. With a real
    // build id, only skip the reload when it matches the build we already tried to self-heal.
    if (stored && (!buildId || stored === buildId)) return;
    win.sessionStorage.setItem(RELOAD_GUARD_KEY, buildId || "1");
  } catch {
    return; // private mode / storage disabled — skip the auto-reload, the manual button still works
  }
  win.location.reload();
}
