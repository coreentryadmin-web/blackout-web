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

/**
 * Guards against a redaction placeholder getting committed as a real config default.
 *
 * scripts/audit/zerodte-session-replay.mjs shipped, from its very first commit (#3419), with
 * `process.env.POLYGON_API_BASE = "[REDACTED]"` — a literal 12-character placeholder string,
 * not a URL. Confirmed byte-for-byte via `git show <sha>:<path> | sha256sum`, not a display
 * artifact: whatever wrote the self-default guard had its own view of the real URL redacted
 * (the same thing happens to anyone reading this file in a sandboxed session) and copied the
 * placeholder text verbatim instead of substituting the real value. The guard looked correct
 * (checks for a missing/malformed env var, assigns a fallback) but the fallback was itself
 * invalid, so `api-tracked-fetch.ts`'s host allowlist rejected every request with "refusing to
 * fetch disallowed host" — an error that reads like a security block, not a broken default, so
 * this went unnoticed until `npm run replay:0dte-session` was actually run for the first time.
 *
 * This scans every script using the same self-default pattern (~35 as of this writing) and
 * asserts the assigned literal always parses as an http(s) URL — catches this exact class of
 * bug in any script, present or future, not just the one instance that shipped broken.
 */
test("no scripts/audit/*.mjs POLYGON_API_BASE self-default is a non-URL placeholder", () => {
  const files = tracked().filter((p) => p.startsWith("scripts/audit/") && p.endsWith(".mjs"));
  const bad: string[] = [];
  for (const file of files) {
    const content = readFileSync(file, "utf8");
    const assignments = content.matchAll(/process\.env\.POLYGON_API_BASE\s*=\s*"([^"]*)"/g);
    for (const m of assignments) {
      if (!/^https?:\/\//.test(m[1] ?? "")) {
        bad.push(`${file}: assigns "${m[1]}" (not an http(s) URL)`);
      }
    }
  }
  assert.deepEqual(bad, [], `these self-defaults are broken:\n  ${bad.join("\n  ")}`);
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
