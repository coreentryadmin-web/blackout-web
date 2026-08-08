import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

// Regression (2026-08-08): a `node_modules` entry got committed to `main` as a
// symlink pointing at its own absolute path (`/home/user/.../node_modules ->
// /home/user/.../node_modules`) — self-referential, so any fresh `git checkout`
// materializes a broken symlink that fails every subsequent filesystem call
// under it with ELOOP ("too many levels of symbolic links"), breaking `npm
// install`/`npm ci` for every clone.
//
// `.gitignore`'s `node_modules/` pattern (trailing slash = directory-only) did
// NOT stop this: the entry being ignored was a symlink, not a directory, so a
// broad `git add -A`/`git add .` staged it anyway. This test catches that class
// of defect directly against the git index rather than relying on .gitignore.
function trackedPaths(): string[] {
  const out = execFileSync("git", ["ls-files"], { encoding: "utf8", cwd: `${__dirname}/../../..` });
  return out.split("\n").filter(Boolean);
}

test("repo hygiene: no node_modules directory is ever tracked in git", () => {
  const offenders = trackedPaths().filter((p) => p === "node_modules" || p.endsWith("/node_modules") || p.includes("/node_modules/"));
  assert.deepEqual(offenders, [], `these paths must never be tracked: ${offenders.join(", ")}`);
});

test("repo hygiene: no build-output directory (.next/out/build) is ever tracked in git", () => {
  const offenders = trackedPaths().filter((p) => /(^|\/)(\.next|out|build)\//.test(p) || p === ".next" || p === "out" || p === "build");
  assert.deepEqual(offenders, [], `these build-output paths must never be tracked: ${offenders.join(", ")}`);
});
