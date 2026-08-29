/**
 * Auto-commits pending mutations to the x-intel rotation-state files
 * (data/x-intel/creative-rotation.json, data/x-intel/post-rotation.json) at the
 * end of a posting run.
 *
 * Root cause this exists to fix: `x-social-creative.mjs`'s `saveCreativeState` and
 * `x-social-post-kit.mjs`'s `saveRotation` write those files as a side effect of
 * building a post, but neither committed the change. The mutation then sat as an
 * uncommitted diff in whatever container ran the script, and only got captured
 * when some unrelated later session happened to notice the dirty tree and sweep
 * it in as a standalone "chore" PR — which happened 9 times in a single day
 * (2026-08-29: #3087, #3113, #3132, #3140, #3141, #3142, #3145, #3147, #3148,
 * #3153), each one a full `verify` CI run for a two-file JSON diff. Worse, a run
 * whose container is reclaimed before any sweep happens loses the rotation
 * advance entirely — silently defeating the "never the same shots twice" point
 * of tracking it at all.
 *
 * Called once from each posting CLI's own `main()` (x-post-now.mjs,
 * x-social-post.mjs, x-deep-post.mjs, x-quad-post.mjs) — deliberately NOT from
 * the shared post-kit/creative-state library functions themselves, since those
 * are imported and exercised directly by unit tests
 * (x-social-post-kit.test.mjs, x-social-creative.test.mjs) that must never
 * trigger a real git commit as a side effect of running `npm test`.
 *
 * Local commit only — never pushes. Push stays owned by whatever branch/PR flow
 * the calling session is already driving; auto-pushing here could land a commit
 * on whatever branch happens to be checked out (main included) without review.
 */
import { execFileSync } from "node:child_process";

const STATE_DIR = "data/x-intel";

/**
 * Commits any pending changes under data/x-intel/. Returns true if it committed.
 * `cwd` is test-only — production callers always run from the repo root and
 * never pass it, letting execFileSync inherit process.cwd().
 */
export function commitXIntelStateIfChanged({ cwd } = {}) {
  try {
    const status = execFileSync("git", ["status", "--porcelain", "--", STATE_DIR], {
      encoding: "utf8",
      cwd,
    });
    if (!status.trim()) return false;
    execFileSync("git", ["add", "--", STATE_DIR], { cwd });
    execFileSync("git", ["commit", "-m", "chore(x-intel): auto-commit rotation state"], { cwd });
    return true;
  } catch (err) {
    console.warn(`[x-intel-state-git] auto-commit skipped: ${err?.message ?? err}`);
    return false;
  }
}
