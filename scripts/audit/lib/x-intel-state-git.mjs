/**
 * Git commit + push helper for x-intel state (data/x-intel/*.json).
 * Used by ephemeral crons to persist rotation state durably.
 *
 * Commits uncommitted data/x-intel/*.json files, then pushes to a long-lived branch
 * (chore/x-intel-rotation-state) so changes survive container reclaim.
 * The coordinator can then merge the rolling PR when appropriate.
 *
 * Intended usage: in a cron or audit script, after modifying data/x-intel/*.json:
 *   import { commitXIntelStateIfChanged } from "./x-intel-state-git.mjs";
 *   const result = await commitXIntelStateIfChanged();
 *   if (result.ok) console.log(`Pushed ${result.files} files to ${result.branch}`);
 */
import { spawnSync } from "node:child_process";

const BRANCH = "chore/x-intel-rotation-state";
const COMMIT_MESSAGE = "chore(x-intel): rotation state snapshot";

/**
 * Check if there are uncommitted changes to data/x-intel/*.json
 */
function hasUncommittedChanges() {
  const result = spawnSync("git", ["status", "--porcelain", "data/x-intel"], {
    encoding: "utf-8",
  });
  if (result.error) throw result.error;
  // porcelain format: "XY path" where X=staged, Y=unstaged
  // We care about any changes (modified, untracked, deleted, etc.)
  return result.stdout.trim().length > 0;
}

/**
 * List files in data/x-intel that would be staged
 */
function listStagedFiles() {
  const result = spawnSync(
    "git",
    ["diff", "--cached", "--name-only", "data/x-intel"],
    { encoding: "utf-8" },
  );
  if (result.error) throw result.error;
  return result.stdout
    .trim()
    .split("\n")
    .filter(Boolean);
}

/**
 * Stage all changes to data/x-intel/*.json and commit locally.
 * Does NOT push — caller handles that.
 */
function commitLocally() {
  // Stage all x-intel changes
  const stageResult = spawnSync("git", ["add", "data/x-intel"], {
    encoding: "utf-8",
  });
  if (stageResult.error) throw stageResult.error;
  if (stageResult.status !== 0) {
    throw new Error(`git add failed: ${stageResult.stderr}`);
  }

  // Commit
  const commitResult = spawnSync(
    "git",
    ["commit", "-m", COMMIT_MESSAGE],
    { encoding: "utf-8" },
  );
  if (commitResult.error) throw commitResult.error;
  // commit exits 1 if there's nothing to commit, which is OK
  if (commitResult.status !== 0 && !commitResult.stderr.includes("nothing to commit")) {
    throw new Error(`git commit failed: ${commitResult.stderr}`);
  }

  const stagedFiles = listStagedFiles();
  return { success: commitResult.status === 0, filesStaged: stagedFiles };
}

/**
 * Ensure the dedicated branch exists and is up to date with origin/main.
 * Creates it if missing, rebases if it exists.
 */
function ensureBranchReady() {
  // Check if branch exists locally
  const existsResult = spawnSync("git", ["rev-parse", "--verify", BRANCH], {
    encoding: "utf-8",
    stdio: "pipe",
  });
  const exists = existsResult.status === 0;

  if (!exists) {
    // Create branch off origin/main
    const createResult = spawnSync(
      "git",
      ["checkout", "-b", BRANCH, "origin/main"],
      { encoding: "utf-8" },
    );
    if (createResult.error) throw createResult.error;
    if (createResult.status !== 0) {
      throw new Error(`Failed to create branch: ${createResult.stderr}`);
    }
  } else {
    // Branch exists; make sure we're on it
    const checkoutResult = spawnSync("git", ["checkout", BRANCH], {
      encoding: "utf-8",
    });
    if (checkoutResult.error) throw checkoutResult.error;
    if (checkoutResult.status !== 0) {
      throw new Error(`Failed to checkout branch: ${checkoutResult.stderr}`);
    }

    // Rebase onto origin/main to pick up any remote changes
    const rebaseResult = spawnSync("git", ["rebase", "origin/main"], {
      encoding: "utf-8",
    });
    if (rebaseResult.error) throw rebaseResult.error;
    // Rebase might exit 1 if there are conflicts; that's fatal
    if (rebaseResult.status !== 0) {
      throw new Error(`Failed to rebase onto origin/main: ${rebaseResult.stderr}`);
    }
  }
}

/**
 * Push the current branch to origin with --force-with-lease.
 * Uses force-with-lease to protect against accidental overwrites of remote changes,
 * but allows pushing after a rebase (safe because we just rebased).
 */
function pushToOrigin() {
  const result = spawnSync(
    "git",
    ["push", "-u", "origin", BRANCH, "--force-with-lease"],
    { encoding: "utf-8" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git push failed: ${result.stderr}`);
  }
}

/**
 * Commit and push data/x-intel/*.json changes to a long-lived branch.
 * Returns { ok: true, branch, files, commit } on success,
 * { ok: false, reason } if nothing to commit or on error.
 */
export async function commitXIntelStateIfChanged() {
  try {
    if (!hasUncommittedChanges()) {
      return { ok: false, reason: "no changes to x-intel state" };
    }

    ensureBranchReady();
    const { success, filesStaged } = commitLocally();

    if (!success) {
      return { ok: false, reason: "nothing to commit" };
    }

    pushToOrigin();

    // Get current commit SHA for the response
    const shaResult = spawnSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf-8",
    });
    const commit = shaResult.stdout.trim().slice(0, 8);

    return {
      ok: true,
      branch: BRANCH,
      files: filesStaged,
      commit,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      reason: `git operation failed: ${message}`,
      error: message,
    };
  }
}
