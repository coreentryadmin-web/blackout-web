import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * Guards against dependency/build directories being committed.
 *
 * This is not hypothetical housekeeping. A self-referential `node_modules -> node_modules`
 * symlink was committed to main in #1906 and sat there undetected: `.gitignore` listed
 * `node_modules/` WITH a trailing slash, which matches a directory only, so a symlink of the same
 * name was never ignored and `git add` took it happily. Nothing downstream caught it either —
 * `.dockerignore` excludes node_modules from the build context (so production images kept
 * building), and `npm ci` unlinks whatever is there before installing (so CI stayed green).
 *
 * The damage only shows up on a developer machine: a fresh clone lands an ELOOP symlink, and any
 * `git checkout`/`git reset --hard` mid-session silently replaces a working install with it —
 * every subsequent node/npx invocation then fails with a bare non-zero exit and no message.
 */

function tracked(): string[] {
  return execFileSync("git", ["ls-files"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\n")
    .filter(Boolean);
}

const FORBIDDEN = ["node_modules", ".next", "out", "build"];

test("no dependency or build directory is tracked in git", () => {
  const bad = tracked().filter((p) => {
    const segments = p.split("/");
    return segments.some((s) => FORBIDDEN.includes(s));
  });
  assert.deepEqual(
    bad,
    [],
    `these paths must never be committed:\n  ${bad.join("\n  ")}`
  );
});

test("data-correctness cron's markdown scorecard is never tracked in git", () => {
  // docs/auto/data-correctness-<date>.md is best-effort local convenience output (the durable
  // record is logCronRun's structured payload, per docs/DATA_CORRECTNESS.md). Tracking it meant
  // a recurring no-op "chore: commit stray placeholder" PR every time a sandbox session's local
  // run happened to produce one (#3087, #3113, #3132) — see .gitignore for the full writeup.
  const bad = tracked().filter((p) => /^docs\/auto\/data-correctness-.*\.md$/.test(p));
  assert.deepEqual(
    bad,
    [],
    `these must stay gitignored, not committed:\n  ${bad.join("\n  ")}`
  );
});

test("gitignore entries for node_modules have no trailing slash", () => {
  // A trailing slash restricts the pattern to directories, leaving a same-named symlink or file
  // un-ignored. Every node_modules rule must match regardless of file type.
  const ignore = readFileSync(".gitignore", "utf8");
  const lines = ignore.split("\n").map((l) => l.trim());
  for (const line of lines) {
    if (line.startsWith("#") || !line.includes("node_modules")) continue;
    assert.ok(
      !line.endsWith("/"),
      `.gitignore rule "${line}" ends in "/" and so ignores only a directory — drop the slash`
    );
  }
});
